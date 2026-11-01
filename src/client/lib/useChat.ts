import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  Asset,
  Event,
  MessageView,
  QuoteView,
  RunState,
  RunView,
  ThreadView,
  Turn,
  TurnState,
} from '../../chat/domain.ts';
import type { ResultKind } from '../chat/ResultCard.tsx';
import { trpc } from '../trpc.ts';
import { useChatEvents } from './useChatEvents.ts';

/** While a Turn streams, and while only a Run or a plan is going. Off otherwise: the stream wakes it. */
const TURN_POLL_MS = 2_000;
const RUN_POLL_MS = 6_000;
/** Bay's clock (PLAN-13 decision 4): the desktop has its own Driver. */
const TICK_MS = 3_000;
const STALE_CAPABILITIES_MS = 30_000;
/** How long an Event that wakes the model, and a plan nobody has announced, keep the page looking. */
const WAKE_WINDOW_MS = 2 * 60_000;
const PLAN_WINDOW_MS = 30 * 60_000;

const MAX_FILES = 24;
const IMAGE_LIMIT = 25 * 1024 * 1024;
const AUDIO_LIMIT = 50 * 1024 * 1024;
/** `POST /api/chat/asset`. */
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** `POST /api/upload-audio`. */
const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/flac']);
const NAME_LIMIT = 200;

const LIVE_TURNS = new Set<TurnState>(['queued', 'streaming', 'tools_running']);
const LIVE_RUNS = new Set<RunState>(['queued', 'running', 'awaiting_user']);
/** What wakes the model, as `src/chat/driver.ts` has it: a Turn follows each of these. */
const WAKES = new Set(['run.done', 'run.failed', 'job.planned']);

export const isTurnLive = (turn: Turn) => LIVE_TURNS.has(turn.state);
export const isRunLive = (run: RunView) => LIVE_RUNS.has(run.state);

/** The last item that passes. */
function lastWhere<T>(items: T[], passes: (item: T) => boolean): T | undefined {
  return items.filter(passes).at(-1);
}

// ---------------------------------------------------------------------------
// What the page works out from the server's views

export type Polled = { turns: Turn[]; runs: RunView[]; events: Event[]; now: number };

/** A plan a Turn started that no `job.planned` has answered: it ends in a new Turn nothing else would show. */
function planPending({ turns, events, now }: Polled) {
  const told = new Set(events.flatMap((e) => (e.type === 'job.planned' ? [e.payload['jobId']] : [])));
  return turns.some(
    (t) => now - (t.endedAt ?? t.startedAt) < PLAN_WINDOW_MS && (t.jobIds ?? []).some((id) => !told.has(id))
  );
}

/** The last Event that wakes the model has no Turn after it yet. */
function wakePending({ events, now }: Polled) {
  const last = lastWhere(events, (e) => WAKES.has(e.type) || e.type === 'turn.started');
  return !!last && last.type !== 'turn.started' && now - last.at < WAKE_WINDOW_MS;
}

/** How often to look again, or false to stop. */
export function pollEvery(polled: Polled): number | false {
  if (polled.turns.some(isTurnLive)) return TURN_POLL_MS;
  const going = polled.runs.some(isRunLive) || planPending(polled) || wakePending(polled);
  return going ? RUN_POLL_MS : false;
}

/** One Thread's feed as far as this page has read it. `chat.thread` sends only the newest part each time. */
export type Feed = { threadId: string | null; thread: ThreadView | null; events: Event[]; quotes: QuoteView[]; lastSeq: number };

export const emptyFeed: Feed = { threadId: null, thread: null, events: [], quotes: [], lastSeq: 0 };

function mergeEvents(known: Event[], incoming: Event[]) {
  const bySeq = new Map([...known, ...incoming].map((e) => [e.seq, e]));
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * The server lists only the Quotes the Gate still indexes, and a new Quote pushes
 * the older ones out. Those stay on screen while this page has them: a card seen
 * in this session is kept, and the hook remembers each thread's cards across a
 * switch. A reload shows only what the server lists, until `chat.thread` carries
 * the thread's Quote history. A Quote only leaves that list once it can no longer
 * be released, so one that left still open was replaced before this page saw it.
 */
function mergeQuotes(known: QuoteView[], incoming: QuoteView[]) {
  const ids = new Set(incoming.map((q) => q.id));
  const left = known
    .filter((q) => !ids.has(q.id))
    .map((q): QuoteView => (q.state === 'open' ? { ...q, state: 'declined', reason: 'superseded' } : q));
  const newer = new Map(incoming.map((q) => [q.id, q]));
  const kept = known.filter((q) => ids.has(q.id)).map((q) => newer.get(q.id) ?? q);
  const fresh = incoming.filter((q) => !known.some((k) => k.id === q.id));
  return [...left, ...kept, ...fresh];
}

/**
 * The feed with one more `chat.thread` answer read in: the windows overlap, so an
 * Event counts once by its seq. Another thread starts a clean feed, but for the
 * Quote cards it was last seen with (`remembered`), so a switch back loses none.
 */
export function absorb(
  feed: Feed,
  data: { thread: ThreadView; events: Event[]; quotes: QuoteView[] },
  remembered: QuoteView[] = []
): Feed {
  const same = feed.threadId === data.thread.id;
  const events = mergeEvents(same ? feed.events : [], data.events);
  return {
    threadId: data.thread.id,
    thread: data.thread,
    events,
    quotes: mergeQuotes(same ? feed.quotes : remembered, data.quotes),
    lastSeq: events.at(-1)?.seq ?? 0,
  };
}

/**
 * The feed with the Quote a decision answered, so its card shows the outcome
 * before the next `chat.thread` answer: the button must not offer a Run that has
 * already started. A new Quote (a repriced click) joins after the one it replaces.
 */
export function absorbQuote(feed: Feed, quote: QuoteView): Feed {
  if (feed.threadId !== quote.threadId) return feed;
  const known = feed.quotes.some((q) => q.id === quote.id);
  return { ...feed, quotes: known ? feed.quotes.map((q) => (q.id === quote.id ? quote : q)) : [...feed.quotes, quote] };
}

/**
 * The thread to show. `since` moves with every answer, so a poll that fails has no
 * answer of its own: the last good one stays on screen. A null answer is the server
 * saying there is no such thread, and nothing stands in for that.
 */
export function shownThread(
  answer: { thread: ThreadView } | null | undefined,
  feed: Feed,
  selected: string | null | undefined
): ThreadView | null {
  const shown = answer === undefined ? feed.thread : (answer?.thread ?? null);
  return shown && selected !== null && (!selected || shown.id === selected) ? shown : null;
}

export type ToolStep = { name: string; count: number; line: string; at: number };

type Entry0<K extends string, T> = { kind: K; key: string; at: number } & T;

/** One thing in the transcript, in the order it happened. */
export type Entry =
  | Entry0<'message', { message: MessageView; assets: Asset[] }>
  | Entry0<'steps', { steps: ToolStep[] }>
  | Entry0<'quote', { quote: QuoteView }>
  | Entry0<'run', { run: RunView }>
  | Entry0<'result', { run: RunView }>
  | Entry0<'ended', { text: string; failed: boolean }>;

const TOOL_LINES: Record<string, (count: number) => string> = {
  project_get: () => 'Read the project',
  library_search: () => 'Searched the library',
  image_inspect: (n) => (n === 1 ? 'Looked at 1 render' : `Looked at ${n} renders`),
  run_get: () => 'Checked the run',
  capabilities_get: () => 'Checked what can be made',
  plan_lifestyle: () => 'Planned the lifestyle film',
  plan_film: () => 'Planned the film',
  direct_shot: (n) => (n === 1 ? 'Directed 1 shot' : `Directed ${n} shots`),
  crop_create: (n) => (n === 1 ? 'Cropped 1 detail' : `Cropped ${n} details`),
  timeline_edit: () => 'Edited the cut',
  propose_run: () => 'Priced the work',
  run_cancel: () => 'Stopped following a run',
};

/** A row of steps with a row of the same call counted up, so six looks read as one line. */
function stepsOf(events: Event[]): ToolStep[] {
  const steps: ToolStep[] = [];
  for (const { payload, at } of events) {
    const name = String(payload['name']);
    const last = steps.at(-1);
    const count = last?.name === name ? last.count + 1 : 1;
    const line = TOOL_LINES[name]?.(count) ?? 'Used a tool';
    if (last?.name === name) steps[steps.length - 1] = { ...last, count, line };
    else steps.push({ name, count, line, at });
  }
  return steps;
}

/**
 * A message's files. A thread lists its Assets on their own, each stamped as it
 * was read, just before the message that brought it was saved. The agent's crops
 * are listed there too, stamped inside a Turn, so a person's files are only those
 * since the last message and since the last Turn ended. A Turn that stopped to
 * ask about a Quote has no end; the `turn.awaiting` Event it wrote closes it.
 */
function assetsByMessage(thread: ThreadView, events: Event[]): Map<number, Asset[]> {
  const out = new Map<number, Asset[]>();
  const ended = [
    ...thread.turns.flatMap((t) => t.endedAt ?? []),
    ...events.flatMap((e) => (e.type === 'turn.awaiting' ? [e.at] : [])),
  ];
  let after = -Infinity;
  for (const m of thread.messages) {
    if (m.role === 'user') {
      const since = Math.max(after, ...ended.filter((at) => at < m.at));
      out.set(
        m.seq,
        thread.assets.filter((a) => a.addedAt > since && a.addedAt <= m.at)
      );
    }
    after = m.at;
  }
  return out;
}

/** A person's words alone. The server adds a line that names a music file for the model; the bubble shows the file. */
function inOwnWords(message: MessageView, assets: Asset[]): MessageView {
  const added = new Set(assets.map((a) => `Music attached: ${a.name} (${a.key})`));
  if (added.size === 0) return message;
  return { ...message, text: message.text.split('\n').filter((line) => !added.has(line)).join('\n') };
}

/** Whatever a Run made, by kind, leaving out a kind it made none of: a card must never read "0 stills". */
export function resultsOf(run: RunView): { kind: ResultKind; ids: string[] }[] {
  const { stillIds, clipIds, exportId } = run.outputs;
  const made: { kind: ResultKind; ids: string[] }[] = [
    { kind: 'still', ids: stillIds },
    { kind: 'clip', ids: clipIds },
    { kind: 'edit', ids: exportId ? [exportId] : [] },
  ];
  return made.filter(({ ids }) => ids.length > 0);
}

function endedTurn(turn: Turn): Entry | null {
  if (turn.state !== 'failed' && turn.state !== 'interrupted') return null;
  const failed = turn.state === 'failed';
  const text = failed ? (turn.error ?? 'The assistant stopped on an error.') : 'Stopped.';
  return { kind: 'ended', key: `ended-${turn.id}`, at: turn.endedAt ?? turn.startedAt, text, failed };
}

/**
 * The transcript, oldest first. Messages and Events share one counter, so they
 * keep their seq order and everything else falls in by its time. Quotes come
 * from the server's own views, never from what the model wrote.
 */
export function transcript({
  thread,
  events,
  quotes,
  runs,
}: {
  thread: ThreadView;
  events: Event[];
  quotes: QuoteView[];
  runs: RunView[];
}): Entry[] {
  const assets = assetsByMessage(thread, events);
  const told = [
    ...thread.messages.map((message) => ({ seq: message.seq, message: inOwnWords(message, assets.get(message.seq) ?? []) })),
    ...events.filter((e) => e.type === 'turn.tool').map((event) => ({ seq: event.seq, event })),
  ].sort((a, b) => a.seq - b.seq);
  const ownRuns = runs.filter((r) => r.threadId === thread.id);

  const entries: (Entry | Entry0<'tool', { event: Event }>)[] = [
    ...told.map((item) =>
      'message' in item
        ? {
            kind: 'message' as const,
            key: `message-${item.seq}`,
            at: item.message.at,
            message: item.message,
            assets: assets.get(item.seq) ?? [],
          }
        : { kind: 'tool' as const, key: `steps-${item.seq}`, at: item.event.at, event: item.event }
    ),
    ...quotes.map((quote) => ({ kind: 'quote' as const, key: `quote-${quote.id}`, at: quote.createdAt, quote })),
    ...ownRuns.map((run) => ({ kind: 'run' as const, key: `run-${run.id}`, at: run.createdAt, run })),
    ...ownRuns
      .filter((run) => !isRunLive(run) && resultsOf(run).length > 0)
      .map((run) => ({ kind: 'result' as const, key: `result-${run.id}`, at: run.updatedAt, run })),
    ...thread.turns.flatMap((turn) => endedTurn(turn) ?? []),
  ];
  entries.sort((a, b) => a.at - b.at);

  const out: Entry[] = [];
  let row: { key: string; at: number; events: Event[] } | null = null;
  const closeRow = () => {
    if (row) out.push({ kind: 'steps', key: row.key, at: row.at, steps: stepsOf(row.events) });
    row = null;
  };
  for (const entry of entries) {
    if (entry.kind === 'tool') {
      row ??= { key: entry.key, at: entry.at, events: [] };
      row.events.push(entry.event);
      continue;
    }
    closeRow();
    out.push(entry);
  }
  closeRow();
  return out;
}

/**
 * What the live Turn has said so far, '' before its first words, null with no
 * Turn live. The answer is saved a moment before its draft is cleared; a poll
 * between the two would show the words twice.
 */
export function liveDraft(thread: ThreadView): string | null {
  const turn = lastWhere(thread.turns, isTurnLive);
  if (!turn) return null;
  const draft = turn.draft ?? '';
  const saved = lastWhere(thread.messages, (m) => m.role === 'assistant' && m.at >= turn.startedAt);
  return saved?.text.startsWith(draft) ? '' : draft;
}

/**
 * A plan's own renders among the thread's Assets. A plan made here keeps each
 * one's key. An older one has only the name, which can repeat, so it reads the
 * newest of that name first and each file once.
 */
export function inputKeys(images: { name: string; key?: string | undefined }[], assets: Asset[]): string[] {
  const left = assets.filter((a) => a.kind === 'image');
  return images.flatMap(({ name, key }) => {
    if (key) return [key];
    const at = left.map((a) => a.name).lastIndexOf(name);
    return at < 0 ? [] : left.splice(at, 1).map((a) => a.key);
  });
}

type FileLike = { name: string; type: string; size: number };

function fileProblem({ name, type, size }: FileLike): string | null {
  if (IMAGE_TYPES.has(type)) return size > IMAGE_LIMIT ? `${name} is over 25 MB.` : null;
  if (AUDIO_TYPES.has(type)) return size > AUDIO_LIMIT ? `${name} is over 50 MB.` : null;
  return `${name} is not a PNG, JPEG or WebP picture, or an MP3, WAV, M4A, AAC or FLAC file.`;
}

/** Which of these files a message with `count` files can take, and a sentence for each kind of refusal. */
export function addAttachments<F extends FileLike>(count: number, files: F[]): { accepted: F[]; refused: string[] } {
  const accepted: F[] = [];
  const refused: string[] = [];
  let full = false;
  for (const file of files) {
    const problem = fileProblem(file);
    if (problem) refused.push(problem);
    else if (count + accepted.length < MAX_FILES) accepted.push(file);
    else full = true;
  }
  if (full) refused.push(`A message takes ${MAX_FILES} files at most.`);
  return { accepted, refused };
}

// ---------------------------------------------------------------------------
// Uploads

/** One dropped file on its way into a message. */
export type Attachment = {
  id: string;
  name: string;
  kind: 'image' | 'audio';
  /** The picture on this machine, until the server has it. */
  preview: string | null;
  state: 'uploading' | 'ready' | 'failed';
  key?: string | undefined;
  width: number;
  height: number;
  error?: string | undefined;
};

type Uploaded = { key?: string; width?: number; height?: number; name?: string; message?: string; error?: string };

/** A refusal can be one plain sentence, not JSON. */
function parseAnswer(text: string): Uploaded | null {
  try {
    return JSON.parse(text) as Uploaded;
  } catch {
    return null;
  }
}

/** Keeps the file and answers what `chat.send` takes: pictures by `/api/chat/asset`, a music bed by `/api/upload-audio`. */
async function uploadFile(file: File): Promise<Uploaded & { key: string }> {
  const url = IMAGE_TYPES.has(file.type) ? '/api/chat/asset' : `/api/upload-audio?name=${encodeURIComponent(file.name)}`;
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
  } catch {
    throw new Error('The upload was cut off. Check your connection and try again.');
  }
  const text = await res.text().catch(() => '');
  const body = parseAnswer(text);
  // A short plain sentence is the server's own; a gateway's error page is not for reading out.
  const said = res.headers.get('content-type')?.startsWith('text/plain') && text.length <= 200 ? text : '';
  if (!res.ok || !body?.key) throw new Error(body?.message ?? body?.error ?? (said || `That upload failed (${res.status}). Try again.`));
  return { ...body, key: body.key };
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'That did not work. Try again.');

/** What the Stop following button says in the thread. The agent cancels by id, and a thread can have two Runs live. */
export const stopRunWords = (runId: string) => `Stop following ${runId}.`;
/** Why a Stop following press sent nothing: any message would turn the open Quote down. */
export const OPEN_QUOTE = 'Decide the open quote first: a message would turn it down. Then stop following the run.';

// ---------------------------------------------------------------------------
// The hook

/** The Thread on screen and everything that acts on it: polling, the Bay clock, uploads, send, decide, stop. */
export function useChat() {
  const utils = trpc.useUtils();
  /** undefined: the newest thread, once it is known. null: a new chat, nothing sent yet. */
  const [selected, setSelected] = useState<string | null | undefined>(undefined);
  const [feed, setFeed] = useState<Feed>(emptyFeed);
  /** Each thread's Quote cards as last seen, so a switch back shows them all. */
  const remembered = useRef(new Map<string, QuoteView[]>());
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  /** What the last decision came back with, for that Quote's card: a refusal, or a price that moved. */
  const [decideNote, setDecideNote] = useState<{ quoteId: string; message: string } | null>(null);
  const uploads = useRef<Promise<unknown>>(Promise.resolve());
  /** The file behind each tile, for its upload and for a retry. */
  const files = useRef(new Map<string, File>());
  const attachmentCount = useRef(0);
  attachmentCount.current = attachments.length;

  const threads = trpc.chat.threads.useQuery();
  const capabilities = trpc.settings.capabilities.useQuery(undefined, { staleTime: STALE_CAPABILITIES_MS });
  const bay = capabilities.data?.desktop === false;

  // Read fresh by the polls: an observer works its interval out again on every render and after every fetch.
  const polled = useRef<Omit<Polled, 'now'>>({ turns: [], runs: [], events: [] });
  const poll = useCallback(() => pollEvery({ ...polled.current, now: Date.now() }), []);
  const live = { refetchInterval: poll, refetchIntervalInBackground: true };

  const runsQuery = trpc.chat.runs.useQuery({}, live);
  const since = selected && feed.threadId === selected ? feed.lastSeq : 0;
  const threadQuery = trpc.chat.thread.useQuery(selected ? { id: selected, since } : { since: 0 }, {
    ...live,
    // A failed answer keeps being asked for even with nothing going: no Event will bring it back.
    refetchInterval: (query) => poll() || (query.state.status === 'error' ? RUN_POLL_MS : false),
    enabled: selected !== null,
    // A new `since` is a new query. Each answer is whole but for its Events, so the last one stands in.
    placeholderData: (previous) => previous,
    gcTime: 0,
  });
  const answer = threadQuery.data;
  const thread = shownThread(answer, feed, selected);
  const threadId = thread?.id ?? null;
  // A query with no answer of its own clears its error at each round of retries; these two times do not move.
  const lost = selected !== null && threadQuery.errorUpdatedAt > threadQuery.dataUpdatedAt;

  useEffect(() => {
    if (!answer) return;
    setFeed((current) => absorb(current, answer, remembered.current.get(answer.thread.id)));
    setSelected((current) => (current === undefined ? answer.thread.id : current));
  }, [answer]);

  useEffect(() => {
    if (feed.threadId) remembered.current.set(feed.threadId, feed.quotes);
  }, [feed]);

  // The feed is a commit behind the answer: it is on screen once it has read this thread in.
  const onScreen = feed.threadId === threadId;
  const events = useMemo(() => (onScreen ? feed.events : []), [feed.events, onScreen]);
  const quotes = useMemo(() => (onScreen ? feed.quotes : []), [feed.quotes, onScreen]);
  const lastSeq = onScreen ? feed.lastSeq : 0;
  const turns = useMemo(() => thread?.turns ?? [], [thread]);
  const runs = useMemo(() => runsQuery.data ?? [], [runsQuery.data]);
  polled.current = { turns, runs, events };

  // The Bay clock. It stops with the polls: with nothing going there is nothing to advance.
  const clock = bay && poll() !== false;
  trpc.chat.tick.useQuery(undefined, {
    enabled: clock,
    refetchInterval: clock ? TICK_MS : false,
    refetchIntervalInBackground: true,
    gcTime: 0,
  });

  const refresh = useCallback(() => {
    void utils.chat.thread.invalidate();
    void utils.chat.runs.invalidate();
  }, [utils]);

  // Opens once the feed has this thread, so the stream starts at its last seq and not at 0.
  useChatEvents(onScreen ? threadId : null, lastSeq, refresh);

  // The list shows the newest chat first, and a new message makes this one the newest.
  const messageCount = thread?.messages.length ?? 0;
  useEffect(() => {
    if (messageCount > 0) void utils.chat.threads.invalidate();
  }, [utils, messageCount]);

  // A Run the thread names, or one an Event just told of, may be newer than the list.
  const runCount = thread?.runIds.length ?? 0;
  useEffect(() => {
    void utils.chat.runs.invalidate();
  }, [utils, lastSeq, runCount]);

  // What a Quote's card shows beyond its own spec, and a film's file.
  const openQuote = quotes.some((q) => q.state === 'open');
  const allowanceQuery = trpc.chat.allowance.useQuery(undefined, { enabled: openQuote });
  // In its own unit: a Quote in another unit gets no Allowance from the Gate, and its card says nothing of it.
  const allowance =
    allowanceQuery.data && allowanceQuery.data.perDay > 0
      ? { unit: allowanceQuery.data.unit, left: Math.max(0, allowanceQuery.data.perDay - allowanceQuery.data.usedToday) }
      : null;

  const jobIds = useMemo(
    () => [...new Set(quotes.flatMap((q) => (q.spec.lifestyleJobId ? [q.spec.lifestyleJobId] : [])))],
    [quotes]
  );
  const jobs = trpc.useQueries((t) => jobIds.map((id) => t.lifestyle.job({ id }, { staleTime: Infinity })));
  const quoteInputs: Record<string, string[]> = {};
  for (const quote of quotes) {
    const job = jobs[jobIds.indexOf(quote.spec.lifestyleJobId ?? '')]?.data;
    if (job && thread) quoteInputs[quote.id] = inputKeys(job.images, thread.assets);
  }

  const exportIds = runs.flatMap((r) => (r.threadId === thread?.id && r.outputs.exportId ? [r.outputs.exportId] : []));
  const exportKey = exportIds.join();
  const project = trpc.edit.project.useQuery(undefined, { enabled: exportIds.length > 0 });
  useEffect(() => {
    if (exportKey) void utils.edit.project.invalidate();
  }, [utils, exportKey]);
  const films = Object.fromEntries((project.data?.exports ?? []).flatMap((e) => (e.finalId ? [[e.id, e.finalId]] : [])));

  const entries = useMemo(() => (thread ? transcript({ thread, events, quotes, runs }) : []), [thread, events, quotes, runs]);

  const patchAttachment = useCallback((id: string, change: Partial<Attachment>) => {
    setAttachments((list) => list.map((a) => (a.id === id ? { ...a, ...change } : a)));
  }, []);

  const upload = useCallback(
    (id: string) => {
      // One at a time: a message can hold 24 renders of 25 MB each.
      uploads.current = uploads.current.then(async () => {
        const file = files.current.get(id);
        if (!file) return;
        try {
          const { key, width = 0, height = 0, name } = await uploadFile(file);
          patchAttachment(id, { state: 'ready', key, width, height, ...(name ? { name } : {}) });
        } catch (err) {
          patchAttachment(id, { state: 'failed', error: errorText(err) });
        }
      });
    },
    [patchAttachment]
  );

  const addFiles = useCallback(
    (dropped: File[]) => {
      const { accepted, refused } = addAttachments(attachmentCount.current, dropped);
      setNotes(refused);
      const added = accepted.map((file): Attachment => {
        const id = crypto.randomUUID();
        files.current.set(id, file);
        return {
          id,
          name: file.name.slice(0, NAME_LIMIT),
          kind: IMAGE_TYPES.has(file.type) ? 'image' : 'audio',
          preview: IMAGE_TYPES.has(file.type) ? URL.createObjectURL(file) : null,
          state: 'uploading',
          width: 0,
          height: 0,
        };
      });
      attachmentCount.current += added.length;
      setAttachments((list) => [...list, ...added]);
      for (const { id } of added) upload(id);
    },
    [upload]
  );

  const retryAttachment = useCallback(
    (id: string) => {
      patchAttachment(id, { state: 'uploading', error: undefined });
      upload(id);
    },
    [patchAttachment, upload]
  );

  const removeAttachments = useCallback((ids: Set<string>) => {
    for (const id of ids) files.current.delete(id);
    setAttachments((list) => {
      for (const { id, preview } of list) if (preview && ids.has(id)) URL.revokeObjectURL(preview);
      return list.filter((a) => !ids.has(a.id));
    });
  }, []);

  const removeAttachment = useCallback((id: string) => removeAttachments(new Set([id])), [removeAttachments]);

  const sendMutation = trpc.chat.send.useMutation();
  const post = useCallback(
    async (text: string, assets: { key: string; width: number; height: number; name: string }[]): Promise<boolean> => {
      setSending(true);
      setSendError(null);
      try {
        const sent = await sendMutation.mutateAsync({ ...(selected ? { threadId: selected } : {}), text, assets });
        setSelected(sent.threadId);
        void utils.chat.threads.invalidate();
        refresh();
        return true;
      } catch (err) {
        setSendError(errorText(err));
        return false;
      } finally {
        setSending(false);
      }
    },
    [refresh, selected, sendMutation, utils]
  );

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      setNotes([]);
      const assets = attachments.flatMap(({ key, width, height, name }) => (key ? [{ key, width, height, name }] : []));
      const sent = await post(text, assets);
      // Only what went: a file dropped while it was going is for the next message.
      if (sent) removeAttachments(new Set(attachments.map((a) => a.id)));
      return sent;
    },
    [attachments, post, removeAttachments]
  );

  const decideMutation = trpc.chat.decide.useMutation();
  const decide = useCallback(
    async (quoteId: string, decision: 'approve' | 'decline') => {
      setDeciding(quoteId);
      setDecideNote(null);
      setSendError((note) => (note === OPEN_QUOTE ? null : note));
      try {
        const { quote, run, priceChanged } = await decideMutation.mutateAsync({ quoteId, decision });
        // On its card now, ahead of the next answer: a Run that has started must not be offered again.
        // Under a price change the Quote answered is the new one, at the new price.
        setFeed((current) => absorbQuote(current, quote));
        if (run) utils.chat.runs.setData({}, (known) => [...(known ?? []).filter((r) => r.id !== run.id), run]);
        if (priceChanged) setDecideNote({ quoteId: quote.id, message: priceChanged });
      } catch (err) {
        setDecideNote({ quoteId, message: errorText(err) });
      } finally {
        setDeciding(null);
        refresh();
      }
    },
    [decideMutation, refresh, utils]
  );

  const stopMutation = trpc.chat.stop.useMutation();
  const stop = useCallback(() => {
    if (!threadId) return;
    stopMutation.mutate({ threadId }, { onSettled: refresh });
  }, [refresh, stopMutation, threadId]);

  /**
   * "Stop following" a Run. The router has no way to stop a Run yet (it wants a
   * `chat.cancelRun` on `engine.cancel`), only the agent's own `run_cancel`, so this
   * asks it in the thread, where it also shows. Words sent are refused during a live
   * Turn and would turn down an open Quote, so with one open nothing is sent: a
   * press must never decide money it was not about.
   */
  const stopRun = useCallback(
    (runId: string) => {
      const now = Date.now();
      if (quotes.some((q) => q.state === 'open' && now < q.expiresAt)) {
        setSendError(OPEN_QUOTE);
        return;
      }
      void post(stopRunWords(runId), []);
    },
    [post, quotes]
  );

  const select = useCallback((id: string | null) => {
    setSelected(id);
    setSendError(null);
    setDecideNote(null);
  }, []);

  return {
    /** The conversation showing; null for a new chat, or before the first answer. */
    thread,
    threadId,
    loading: selected === undefined ? threadQuery.isPending && !lost : selected !== null && !thread,
    /** Nothing to show, and the server cannot be reached. */
    failed: lost && !thread,
    /** The conversation is on screen as it last stood, and the polls have not got through for a while. */
    reconnecting: !!thread && (lost || threadQuery.failureCount > 1),
    threads: threads.data ?? [],
    entries,
    draft: thread ? liveDraft(thread) : null,
    turnLive: turns.some(isTurnLive),
    runs,
    lastSeq,
    bay,
    /** What today's Allowance still covers, in its unit; null with none set. */
    allowance,
    quoteInputs,
    films,
    attachments,
    notes,
    addFiles,
    removeAttachment,
    retryAttachment,
    send,
    sending,
    sendError,
    decide,
    deciding,
    decideNote,
    stop,
    stopRun,
    select,
  };
}
