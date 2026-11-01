// The chat store: Threads, Runs, Quotes, Events and the audit trail as JSON
// documents over documentStore, so one persistence path serves Bay and the
// desktop. Events and audit are segmented so no append rewrites a long history:
// 100 Events to a document, one audit document a day. Every function handed to
// `update()` is pure (Bay re-reads and retries it); the clock and the ids are
// taken before it runs.
//
//   chat/<owner>.json                          index: ThreadSummary[], newest first, 50
//   chat/<owner>/<threadId>.json               Thread
//   chat/<owner>/runs/<runId>.json             Run
//   chat/<owner>/quotes/<quoteId>.json         Quote
//   chat/<owner>/audit/<yyyy-mm-dd>.json       AuditRow[] of that UTC day, append only
//   chat-events/<owner>/<threadId>/<nnnn>.json Events, nnnn = floor((seq - 1) / 100)
//
// (`chat/<owner>/ledger.json` is the Gate's.) The longest key is 83 characters,
// well under the desktop's 140.
import { randomUUID } from 'node:crypto';

import { documentStore, list } from '../storage.ts';
import {
  type Asset,
  type AuditRow,
  type Event,
  MAX_MESSAGES_BAY,
  type Message,
  type Quote,
  type Run,
  type RunFilter,
  type Store,
  type Thread,
  type ThreadSummary,
  type Turn,
} from './domain.ts';

export type { Store } from './domain.ts';

/** The index lists this many Threads; an older one stays on disk and out of the list. */
const MAX_THREADS = 50;
const EVENTS_PER_SEGMENT = 100;
const ACTIVE_RUNS = new Set<Run['state']>(['queued', 'running', 'awaiting_user']);

// A Thread id is a uuid so it can never be another document's name (`ledger`, `runs`).
const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PART = /^[A-Za-z0-9_-]{1,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type IndexDoc = { threads: ThreadSummary[] };
type SegmentDoc = { events: Event[] };
type AuditDoc = { rows: AuditRow[] };

const indexDocs = documentStore<IndexDoc>({ prefix: 'chat/' });
const threadDocs = documentStore<Thread>({ prefix: 'chat/' });
const runDocs = documentStore<Run>({ prefix: 'chat/' });
const quoteDocs = documentStore<Quote>({ prefix: 'chat/' });
const auditDocs = documentStore<AuditDoc>({ prefix: 'chat/' });
const segmentDocs = documentStore<SegmentDoc>({ prefix: 'chat-events/' });

const fail = (message: string) => Object.assign(new Error(message), { status: 400, expose: true });

/** An owner, run or quote id as a path part; anything that could climb or rename a path is refused. */
function part(value: string, what: string): string {
  if (!PART.test(value)) throw fail(`Invalid ${what}.`);
  return value;
}

function threadId(value: string): string {
  if (!THREAD_ID.test(value)) throw fail('Invalid thread id.');
  return value;
}

const indexKey = (owner: string) => `${part(owner, 'owner')}.json`;
const threadKey = (owner: string, id: string) => `${part(owner, 'owner')}/${threadId(id)}.json`;
const runKey = (owner: string, id: string) => `${part(owner, 'owner')}/runs/${part(id, 'run id')}.json`;
const quoteKey = (owner: string, id: string) => `${part(owner, 'owner')}/quotes/${part(id, 'quote id')}.json`;
const auditKey = (owner: string, day: string) => `${part(owner, 'owner')}/audit/${day}.json`;

const segmentOf = (seq: number) => Math.floor((seq - 1) / EVENTS_PER_SEGMENT);
const segmentName = (n: number) => String(n).padStart(4, '0');
const segmentKey = (owner: string, id: string, n: number) =>
  `${part(owner, 'owner')}/${threadId(id)}/${segmentName(n)}.json`;

const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);

const summaryOf = (t: Thread): ThreadSummary => ({ id: t.id, title: t.title, createdAt: t.createdAt, updatedAt: t.updatedAt });

/** The Thread an update works on, or an error the caller can show. */
function existing(current: Thread | undefined): Thread {
  if (!current) throw Object.assign(new Error('That chat no longer exists.'), { status: 404, expose: true });
  return current;
}

/** Bay keeps the newest messages; the desktop keeps every one. Read per call so a test can switch. */
const capMessages = (messages: Message[]) =>
  process.env['BAY_ENV'] === 'desktop' ? messages : messages.slice(-MAX_MESSAGES_BAY);

/** Puts a Thread at the front of its owner's index, once, and drops the oldest past the cap. */
async function touchIndex(owner: string, summary: ThreadSummary): Promise<void> {
  await indexDocs.update(indexKey(owner), (current) => ({
    threads: [summary, ...(current?.threads ?? []).filter((t) => t.id !== summary.id)].slice(0, MAX_THREADS),
  }));
}

/** Every document under `<owner>/<folder>/`, read in listing order. */
async function documentsIn<T>(
  store: { get(key: string): Promise<{ value: T } | null> },
  owner: string,
  folder: string
): Promise<T[]> {
  const prefix = `chat/${part(owner, 'owner')}/${folder}/`;
  const { objects } = await list(prefix);
  const found = await Promise.all(
    objects.filter((o) => o.key.endsWith('.json')).map((o) => store.get(o.key.slice('chat/'.length)))
  );
  return found.flatMap((doc) => (doc ? [doc.value] : []));
}

export function createStore(): Store {
  return {
    async threads(owner) {
      return (await indexDocs.get(indexKey(owner)))?.value.threads ?? [];
    },

    async thread(owner, id) {
      if (!THREAD_ID.test(id)) return null;
      return (await threadDocs.get(threadKey(owner, id)))?.value ?? null;
    },

    async createThread(owner, title) {
      const at = Date.now();
      const thread: Thread = {
        id: randomUUID(),
        owner,
        title,
        createdAt: at,
        updatedAt: at,
        lastSeq: 0,
        messages: [],
        turns: [],
        runIds: [],
        assets: [],
      };
      await threadDocs.update(threadKey(owner, thread.id), () => thread);
      await touchIndex(owner, summaryOf(thread));
      return thread;
    },

    async appendMessage(owner, id, msg) {
      const at = Date.now();
      const next = await threadDocs.update(threadKey(owner, id), (current) => {
        const thread = existing(current);
        const seq = thread.lastSeq + 1;
        return { ...thread, lastSeq: seq, updatedAt: at, messages: capMessages([...thread.messages, { ...msg, seq }]) };
      });
      await touchIndex(owner, summaryOf(next));
      return next.lastSeq;
    },

    async updateTurn(owner, id, turnId, patch) {
      const at = Date.now();
      return threadDocs.update(threadKey(owner, id), (current) => {
        const thread = existing(current);
        const known = thread.turns.some((t) => t.id === turnId);
        if (!known && !patch.trigger) throw fail('A new turn needs a trigger.');
        const turns = known
          ? thread.turns.map((t) => (t.id === turnId ? { ...t, ...patch, id: turnId } : t))
          : [...thread.turns, { state: 'queued', startedAt: at, iterations: 0, ...patch, id: turnId } as Turn];
        return { ...thread, turns, updatedAt: at };
      });
    },

    async addAsset(owner, id, asset: Asset) {
      return threadDocs.update(threadKey(owner, id), (current) => {
        const thread = existing(current);
        if (thread.assets.some((a) => a.key === asset.key)) return thread;
        return { ...thread, assets: [...thread.assets, asset] };
      });
    },

    async linkRun(owner, id, runId) {
      return threadDocs.update(threadKey(owner, id), (current) => {
        const thread = existing(current);
        if (thread.runIds.includes(runId)) return thread;
        return { ...thread, runIds: [...thread.runIds, runId] };
      });
    },

    async appendEvent(owner, id, ev) {
      const at = Date.now();
      // The Thread document hands out the seq (Bay retries `update`, so it is read from what was written).
      const { lastSeq: seq } = await threadDocs.update(threadKey(owner, id), (current) => {
        const thread = existing(current);
        return { ...thread, lastSeq: thread.lastSeq + 1 };
      });
      const event: Event = { seq, type: ev.type, payload: ev.payload, at };
      await segmentDocs.update(segmentKey(owner, id, segmentOf(seq)), (current) => ({
        events: [...(current?.events ?? []).filter((e) => e.seq !== seq), event].sort((a, b) => a.seq - b.seq),
      }));
      return event;
    },

    async eventsSince(owner, id, seq) {
      if (!THREAD_ID.test(id)) return [];
      const after = Math.max(0, Math.floor(Number.isFinite(seq) ? seq : 0));
      const first = segmentOf(after + 1);
      const { objects } = await list(`chat-events/${part(owner, 'owner')}/${id}/`);
      const wanted = objects
        .map((o) => /\/(\d{4})\.json$/.exec(o.key)?.[1])
        .flatMap((n) => (n !== undefined && Number(n) >= first ? [Number(n)] : []))
        .sort((a, b) => a - b);
      const docs = await Promise.all(wanted.map((n) => segmentDocs.get(segmentKey(owner, id, n))));
      return docs
        .flatMap((doc) => doc?.value.events ?? [])
        .filter((e) => e.seq > after)
        .sort((a, b) => a.seq - b.seq);
    },

    async run(owner, id) {
      if (!PART.test(id)) return null;
      return (await runDocs.get(runKey(owner, id)))?.value ?? null;
    },

    async saveRun(owner, run) {
      await runDocs.update(runKey(owner, run.id), () => run);
    },

    async runs(owner, filter?: RunFilter) {
      const all = await documentsIn(runDocs, owner, 'runs');
      return all
        .filter((r) => !filter?.threadId || r.threadId === filter.threadId)
        .filter((r) => !filter?.active || ACTIVE_RUNS.has(r.state))
        .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1));
    },

    async quote(owner, id) {
      if (!PART.test(id)) return null;
      return (await quoteDocs.get(quoteKey(owner, id)))?.value ?? null;
    },

    async saveQuote(owner, q) {
      await quoteDocs.update(quoteKey(owner, q.id), () => q);
    },

    async appendAudit(owner, row) {
      await auditDocs.update(auditKey(owner, dayOf(row.at)), (current) => ({ rows: [...(current?.rows ?? []), row] }));
    },

    async audit(owner, day = dayOf(Date.now())) {
      if (!DAY.test(day)) throw fail('A day looks like 2026-10-31.');
      return (await auditDocs.get(auditKey(owner, day)))?.value.rows ?? [];
    },
  };
}
