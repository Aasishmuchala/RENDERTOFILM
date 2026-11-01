// The Tick and the Driver (PLAN-13 decision 4), and where the chat's seams are
// put together. One Tick advances every poll-driven machine of an owner under the
// claims they already keep, then the RunEngine, then wakes the threads an Event is
// waiting in. The same code runs from two clocks: the page's `chat.tick` poll on
// Bay and, on the desktop, the Driver's timer here. This file is the one place that
// joins concrete adapters, and the one place a Run starts: a Turn can only propose,
// and what releases a Quote is decided here (a click or a typed yes through the
// router, an Allowance or a price of 0 at the moment it is proposed).
//
// `chat/<owner>/wake.json` is this file's document: how far each thread has been
// woken, and the planner jobs a Turn started that nobody has announced yet.
import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';

import { AppRouter } from '../api.ts';
import { type ChatTarget, resolveChatTarget } from '../ai-text.ts';
import { OMEGA_BASE_URL } from '../ai-text/providers.ts';
import { capabilitiesOf } from '../capabilities.ts';
import type { CloseupJob } from '../closeups-api.ts';
import { readChatSettings } from '../connections.ts';
import { readEdit } from '../edits.ts';
import { readLibrary } from '../library.ts';
import { type LifestyleJob, type LifestyleShot, SUBMIT_STALE_MS } from '../lifestyle-api.ts';
import { CAST_SHEET_MODEL } from '../lifestyle.ts';
import { ANIMATE_VIDEO_MODELS, type ImageModelId, VIDEO_MODELS, videoDurations, type VideoModelId } from '../models.ts';
import { submitStill } from '../still-submit.ts';
import { documentStore, getObject } from '../storage.ts';
import type { StoryboardJob } from '../storyboard-api.ts';
import type { RunwayCtx } from '../task-helpers.ts';
import type { Context } from '../trpc.ts';
import type {
  ApprovalSource,
  Gate,
  LoopDeps,
  ModelClient,
  Pricer,
  Quote,
  QuoteItem,
  ReleaseRefused,
  Run,
  RunEngine,
  RunSpec,
  SpecPrice,
  Store,
  ToolCtx,
  ToolRunCtx,
  Trigger,
  Turn,
  TurnState,
  Unit,
} from './domain.ts';
import { specHash } from './domain.ts';
import { createGate, threadQuoteIds } from './gate.ts';
import { runTurn } from './loop.ts';
import { createAnthropicClient } from './model-client.ts';
import { type FilmShape, QUOTE_LINES, runView, shapeOf, shortNote } from './pipeline.ts';
import { createRunEngine, directorFrames, filmFrames, sheetsOf } from './runs.ts';
import { createStore } from './store.ts';
import { actionTools, assetHost } from './tools/actions.ts';
import { createRegistry } from './tools/index.ts';
import { readTools } from './tools/read.ts';

const TICK_MS = 3_000;
/**
 * A Turn no process here holds is taken for dead once its thread has been quiet
 * this long: one model call can run 15 minutes (three tries of five), and a pod
 * that was replaced leaves its Turn saying it is still running.
 */
const TURN_STALE_MS = 20 * 60_000;
const BUSY = 'The assistant is still answering.';
/** Shown beside the take's Retry on the Lifestyle page. */
const RUN_ENDED = 'The run ended before this take was finished.';
const REPEAT = 'This exact run was already approved in this chat. Say what should change, or start a new chat to run it again.';

const LIVE_TURNS = new Set<TurnState>(['queued', 'streaming', 'tools_running']);
/**
 * A Run in one of these never delivered: the same spec may be priced again (it then
 * always needs a yes), and nothing more is paid for on its behalf.
 */
const RUN_AGAIN = new Set<Run['state']>(['failed', 'stopped', 'submit_unknown']);
/**
 * What wakes the model. Not `run.step`: a Run writes one on every tick of every
 * step, every 3 s, and each wake is a paid model call. The Run card shows steps.
 */
const WAKES = new Set(['run.done', 'run.failed', 'job.planned']);
/** The Close-ups states a poll moves; the others wait for a person. */
const CLOSEUPS_MOVING = new Set<CloseupJob['status']>(['capturing', 'finding', 'rendering']);

const log = (line: string) => console.log(line);
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const store = createStore();

/** localContext() does not load the owner, so the provider is read here before anything asks for its capabilities. */
async function ready(ctx: Context): Promise<void> {
  await (ctx.runway as { ready?: () => Promise<void> } | undefined)?.ready?.();
}

// ---------------------------------------------------------------------------
// The price of a Run

type Priced = { unit: Unit; amount: number | null; note?: string };
/** The provider's own price seam: desktop only. A client without it is Bay, where nothing has a price. */
type Quoting = { quote?: (type: string, options: Record<string, unknown>) => Promise<Priced> };
/** One line of a Quote: what it counts and the task that prices one of them. No task, and it cannot be priced. */
type Line = {
  label: string;
  count: number;
  seconds?: number;
  free?: true;
  task?: { type: string; options: Record<string, unknown> } | undefined;
};

const taskOf = (type: string | undefined, options: Record<string, unknown>) => (type ? { type, options } : undefined);

/**
 * The task a still goes out as. Each model names its options its own way and a rate
 * card reads the tier from those names, so `submitStill` builds it here too, into a
 * recorder: the price cannot drift from what a shoot sends. Only the model and the
 * tier decide a price, so the picture and its size are stand-ins.
 */
function imageTask(imageModel: ImageModelId, resolution: string): Line['task'] {
  let task: Line['task'];
  const createTask = (type: string, options: Record<string, unknown>) => {
    task = { type, options };
    return Promise.resolve({ id: '' });
  };
  const frame = { width: 1920, height: 1080 };
  const still = { imageModel, imageUrl: 'render', ...frame, frame, resolution };
  void submitStill({ runway: { createTask } } as unknown as RunwayCtx, still, '');
  return task;
}

const refusal = (code: TRPCError['code'], message: string) => new TRPCError({ code, message });

/** The plan a Run shoots from, once it is there to count. */
async function plannedJob(owner: string, spec: RunSpec): Promise<LifestyleJob> {
  const job = (await lifestyleJobs(owner)).find((j) => j.id === spec.lifestyleJobId);
  if (!job) throw refusal('BAD_REQUEST', 'There is no Lifestyle plan with that id in this chat.');
  if (job.status === 'planning') throw refusal('PRECONDITION_FAILED', 'That plan is still being made. Price it once it is ready.');
  if (job.status !== 'planned') throw refusal('PRECONDITION_FAILED', job.error ?? 'That plan failed.');
  return job;
}

/** A model a Run can use: every video model but the ones kept for Recreate in 4K. */
const animates = (model: string) => ANIMATE_VIDEO_MODELS.some((m) => m.id === model);

/**
 * The clip task a frame goes out as, as far as a price reads it: the alias and the
 * length, and for Veo which of its two rates, since both Veo ids share one alias and
 * `createVideo` names the model in the options.
 */
function clipLine(model: string, shape: FilmShape): Line {
  const alias = ANIMATE_VIDEO_MODELS.find((m) => m.id === model)?.alias;
  const veo = alias === 'veo3_1' ? { model: model === 'veo-3-1-fast' ? 'veo-3.1-fast' : 'veo-3.1' } : {};
  const task = taskOf(alias, { duration: shape.clipSeconds, ...veo });
  return { label: QUOTE_LINES.clips, count: shape.clips, seconds: shape.clipSeconds, task };
}

function stillLines(job: LifestyleJob, frames: number): Line[] {
  const second = job.pass2;
  return [
    { label: QUOTE_LINES.stills, count: frames, task: imageTask(job.imageModel, job.resolution) },
    ...(second ? [{ label: QUOTE_LINES.pass2, count: frames, task: imageTask(second.imageModel, second.resolution) }] : []),
  ];
}

/** A Quote's lines, and what it says of a film that falls short of what was asked. */
async function linesOf(ctx: Context, owner: string, spec: RunSpec): Promise<{ lines: Line[]; note?: string }> {
  const named = VIDEO_MODELS.find((m) => m.id === spec.videoModel);
  if (named && !animates(named.id)) {
    throw refusal('BAD_REQUEST', `${named.name} is used by Recreate in 4K. Pick another video model for this run.`);
  }
  const video = () => spec.videoModel ?? capabilitiesOf(ctx.runway).videoModels.find(animates) ?? 'seedance-2';
  const durations = () => videoDurations(video() as VideoModelId);
  switch (spec.kind) {
    case 'lifestyle_film': {
      const job = await plannedJob(owner, spec);
      const shape = shapeOf(spec, filmFrames(job).length, durations());
      const note = shortNote(spec, shape, durations());
      return {
        lines: [
          ...stillLines(job, shape.clips),
          { label: QUOTE_LINES.cast, count: sheetsOf(job), task: imageTask(CAST_SHEET_MODEL.imageModel, CAST_SHEET_MODEL.resolution) },
          clipLine(video(), shape),
        ],
        ...(note ? { note } : {}),
      };
    }
    case 'director_film': {
      const job = (await storyboardJobs(owner)).find((j) => j.id === spec.storyboardJobId);
      if (!job) throw refusal('BAD_REQUEST', 'There is no Director plan with that id in this chat.');
      if (job.status === 'planning') throw refusal('PRECONDITION_FAILED', 'That plan is still being made. Price it once it is ready.');
      if (job.status !== 'planned') throw refusal('PRECONDITION_FAILED', job.error ?? 'That plan failed.');
      const shape = shapeOf(spec, directorFrames(job).length, durations());
      const note = shortNote(spec, shape, durations());
      return {
        lines: [{ label: QUOTE_LINES.stills, count: shape.clips, task: imageTask(job.imageModel, job.resolution) }, clipLine(video(), shape)],
        ...(note ? { note } : {}),
      };
    }
    case 'stills': {
      const job = await plannedJob(owner, spec);
      return { lines: stillLines(job, shapeOf(spec, filmFrames(job).length, durations()).clips) };
    }
    case 'clips':
      return { lines: [clipLine(video(), shapeOf(spec, spec.stillIds?.length ?? 0, durations()))] };
    case 'cut':
      return { lines: [{ label: QUOTE_LINES.cut, count: 1, free: true }] };
    case 'master':
      // ffmpeg on the owner's machine, which no rate card has a line for. Bay cannot master, and nothing there has a price.
      if (capabilitiesOf(ctx.runway).master) return { lines: [{ label: QUOTE_LINES.master, count: 1, free: true }] };
      return { lines: [{ label: QUOTE_LINES.master, count: 1, task: { type: 'media_processing_v2', options: {} } }] };
  }
}

/**
 * Prices a spec item by item through the provider's own `quote`, with the tasks the
 * routers send: a model id is not a task type, and the simulator reads a type it does
 * not know as a still. A line nobody can price leaves the total unknown, and such a
 * Quote needs a click. Text is free and has no line.
 */
export function createPricer(ctx: Context): Pricer {
  const client = ctx.runway as Quoting | undefined;
  const priceOf = async (line: Line): Promise<Priced | null> => {
    if (line.free) return { unit: 'credits', amount: 0 };
    if (!line.task) return null;
    return (await client?.quote?.(line.task.type, line.task.options).catch(() => null)) ?? null;
  };
  return {
    async price(owner, spec) {
      await ready(ctx);
      const { lines: all, note: short } = await linesOf(ctx, owner, spec);
      const lines = all.filter((line) => line.count > 0);
      const answers = await Promise.all(lines.map(priceOf));
      const items: QuoteItem[] = lines.map(({ label, count, seconds }, i) => {
        const unitAmount = answers[i]?.amount ?? null;
        return { label, count, unitAmount, amount: unitAmount === null ? null : unitAmount * count, ...(seconds ? { seconds } : {}) };
      });
      const amount = items.every((i) => i.amount !== null) ? items.reduce((sum, i) => sum + i.amount!, 0) : null;
      const billing = amount === null ? answers.find((a) => a?.note)?.note : undefined;
      const note = [billing, short].filter(Boolean).join(' ');
      return { unit: answers.find((a) => a)?.unit ?? 'credits', amount, items, ...(note ? { note } : {}) };
    },
  };
}

// ---------------------------------------------------------------------------
// The spend gate as the chat uses it

// One release at a time per owner: a Quote is approved and its Run started as one
// step, so a propose can never find the Quote approved and its Run not there yet.
// Nothing in here waits on a price: every price is read ahead of this section (the
// Gate's `price` and `priceAgain`, each with the Gate's limit) and handed in, so a
// pricer that hangs holds up its own proposal or click and no other of the owner's,
// not even one that needs no price.
const decisions = new Map<string, Promise<unknown>>();

function oneDecision<T>(owner: string, work: () => Promise<T>): Promise<T> {
  const run = (decisions.get(owner) ?? Promise.resolve()).catch(() => {}).then(work);
  decisions.set(owner, run);
  void run
    .finally(() => {
      if (decisions.get(owner) === run) decisions.delete(owner);
    })
    .catch(() => {});
  return run;
}

export type Services = {
  store: Store;
  gate: Gate;
  pricer: Pricer;
  engine: RunEngine;
  /** A fresh Quote of a repriced one's spec, for a person to decide: an Allowance never takes it. `priced`: the price it got dearer to. */
  quoteAgain(owner: string, quote: Quote, priced?: SpecPrice): Promise<Quote>;
};

type Started = { quote: Quote; run: Run };

/**
 * Tells the thread a Quote's Run is going, and answers with the Quote as it now
 * stands. As best it can: the Quote is spent and the Run is spending, so nothing
 * here may tell the person it failed.
 */
async function announced(owner: string, quote: Quote, run: Run): Promise<Started> {
  try {
    await store.appendEvent(owner, quote.threadId, {
      type: 'quote.approved',
      payload: { quoteId: quote.id, source: quote.source, runId: run.id },
    });
  } catch (err) {
    log(`[chat] ${run.id}: the quote.approved event could not be written: ${errorText(err)}`);
  }
  return { quote: (await store.quote(owner, quote.id).catch(() => null)) ?? quote, run };
}

/** Starts the Run an approved Quote pays for. The engine refuses a second start of one Quote. */
async function startRun(ctx: Context, owner: string, engine: RunEngine, quote: Quote): Promise<Started> {
  return announced(owner, quote, await engine.start(ctx, owner, quote));
}

/** A Quote a person approved whose start never landed a Run: a failed start, or a pod replaced in between. */
const unstarted = (q: Quote) => q.state === 'approved' && !q.consumedBy;

async function indexedQuotes(owner: string, threadId: string): Promise<Quote[]> {
  const quotes = await Promise.all((await threadQuoteIds(owner, threadId)).map((id) => store.quote(owner, id)));
  return quotes.flatMap((q) => (q ? [q] : []));
}

/** The thread's Runs of this spec that are live or delivered. */
const liveRuns = (runs: Run[], hash: string) => runs.filter((r) => r.specHash === hash && !RUN_AGAIN.has(r.state));

/**
 * What a propose may not do, and why a Quote then needs a person, in this thread
 * only: a spec whose Run is live or delivered is refused, and so is one a person
 * approved whose Run is not there yet (its card's click finishes that start); one
 * whose Run failed or was stopped can be priced again but never releases itself, so
 * an Allowance cannot pay for it twice.
 */
async function earlierRun(owner: string, threadId: string, spec: RunSpec): Promise<Run | undefined> {
  const hash = specHash(spec);
  const earlier = (await store.runs(owner, { threadId })).filter((r) => r.specHash === hash);
  if (liveRuns(earlier, hash).length > 0) throw refusal('CONFLICT', REPEAT);
  if ((await indexedQuotes(owner, threadId)).some((q) => q.specHash === hash && unstarted(q))) throw refusal('CONFLICT', REPEAT);
  return earlier[0];
}

/**
 * Finishes the start of a Quote left approved with no Run on it. A Run that names
 * the Quote is that start, landed before the Quote could say so, and the engine
 * tells the Quote; a live Run of the same spec from another Quote means this one may
 * not start; otherwise it starts here, once.
 */
async function finishStart(ctx: Context, owner: string, engine: RunEngine, quote: Quote): Promise<Started> {
  const runs = await store.runs(owner, { threadId: quote.threadId });
  const own = runs.some((r) => r.quoteId === quote.id);
  if (!own && liveRuns(runs, quote.specHash).length > 0) throw refusal('CONFLICT', REPEAT);
  return startRun(ctx, owner, engine, quote);
}

/**
 * The Gate a Turn gets. A Quote that needs no person goes all the way here, so it
 * starts exactly once: free work at once, and an Allowance that covers the price.
 * The answer is the Quote as it now stands, which is what the model is told.
 */
function spendGate(ctx: Context, base: Gate, engine: RunEngine): Gate {
  return {
    ...base,
    propose: async (owner, threadId, turnId, spec) => {
      // Priced out here: a slow pricer holds up this proposal and none of the owner's clicks.
      const priced = await base.price(owner, spec);
      return oneDecision(owner, async () => {
        const earlier = await earlierRun(owner, threadId, spec);
        const quote = await base.propose(owner, threadId, turnId, spec, priced);
        if (quote.state === 'approved') return (await startRun(ctx, owner, engine, quote)).quote;
        if (earlier || quote.forPerson || quote.state !== 'open' || (await base.allowanceLeft(owner)) === null) return quote;
        // Released at the price just read, which is the Quote's own: it was made at it, or handed back for matching it.
        const released = await base.release(owner, quote.id, 'allowance', { fresh: priced });
        if (released.ok) return (await startRun(ctx, owner, engine, released.quote)).quote;
        return quote;
      });
    },
  };
}

/** The engine as the chat holds it: a Run that ends early closes its takes at once, ahead of the next poll. */
function closingEngine(engine: RunEngine): RunEngine {
  const closing =
    (work: RunEngine['advance']): RunEngine['advance'] =>
    async (ctx, owner, runId) => {
      const run = await work(ctx, owner, runId);
      if (RUN_AGAIN.has(run.state)) {
        // The Run has ended either way; what this could not close, the next Tick does.
        await attempt('takes', async () => {
          await closeEndedTakes(owner);
          return 0;
        });
      }
      return run;
    };
  return { ...engine, advance: closing(engine.advance), cancel: closing(engine.cancel) };
}

export function servicesFor(ctx: Context): Services {
  const pricer = createPricer(ctx);
  const settings = async (owner: string) => {
    const { allowancePerDay, unit } = await readChatSettings(owner);
    return { allowancePerDay, unit };
  };
  const base = createGate({ store, pricer, now: Date.now, settings });
  const engine = closingEngine(createRunEngine({ store, gate: base, now: Date.now, log }));
  const quoteAgain: Services['quoteAgain'] = async (owner, quote, priced) => {
    const fresh: Quote = { ...(await base.propose(owner, quote.threadId, quote.turnId, quote.spec, priced)), forPerson: true };
    await store.saveQuote(owner, fresh);
    // No Turn proposed this one, and the Event is how the thread's feed and `project_get` find a Quote.
    await store.appendEvent(owner, quote.threadId, { type: 'quote.repriced', payload: { quoteId: fresh.id, replaces: quote.id } });
    return fresh;
  };
  return { store, gate: spendGate(ctx, base, engine), pricer, engine, quoteAgain };
}

/**
 * A person's yes to a Quote. A Quote already decided is `decided` however long ago
 * that was, which the Gate's own clock check would call `expired`; one that ran out
 * of time is `expired` however often it is clicked, since nobody decided it. One left
 * approved by a start that failed starts now, so a second click can finish the first
 * (never a second time: `finishStart`). A Quote of unknown cost takes a click and
 * never a typed word (PLAN-13 section 6), while it is still in time: the Gate lets
 * either through, because what it guards against is an Allowance paying for it, and
 * out of time it is the Gate that marks it and says so. A Quote the Gate found dearer
 * than it was approved at answers with the fresh Quote, for the person to decide.
 * Every refusal is written to the audit, the ones made here like the Gate's own.
 */
export async function approveQuote(
  ctx: Context,
  owner: string,
  services: Services,
  quoteId: string,
  source: Extract<ApprovalSource, 'click' | 'text'>
): Promise<
  | ({ ok: true } & Started)
  | { ok: false; reason: Exclude<ReleaseRefused, 'repriced'> }
  | { ok: false; reason: 'repriced'; quote: Quote }
> {
  // The price first, out here: a pricer that hangs holds up this click and no other.
  const fresh = await services.gate.priceAgain(owner, quoteId);
  return oneDecision(owner, async () => {
    const quote = await store.quote(owner, quoteId);
    if (!quote) return { ok: false as const, reason: 'not_found' as const };
    if (unstarted(quote)) return { ok: true as const, ...(await finishStart(ctx, owner, services.engine, quote)) };
    if (quote.state === 'expired') return refused(owner, services, quote, source, 'expired');
    if (quote.state !== 'open') return refused(owner, services, quote, source, 'decided');
    if (source === 'text' && quote.amount === null && Date.now() < quote.expiresAt) {
      return refused(owner, services, quote, source, 'unknown_cost');
    }
    const released = await services.gate.release(owner, quoteId, source, { fresh });
    if (released.ok) return { ok: true as const, ...(await startRun(ctx, owner, services.engine, released.quote)) };
    if (released.reason === 'repriced') {
      // `fresh` is the dearer price the Gate compared, so the fresh Quote carries it with no second read.
      return { ok: false as const, reason: released.reason, quote: await services.quoteAgain(owner, quote, fresh ?? undefined) };
    }
    return { ok: false as const, reason: released.reason };
  });
}

/** Writes down a release this door refused before the Gate saw it, as the Gate does for its own, and answers it. */
async function refused<R extends ReleaseRefused>(owner: string, services: Services, q: Quote, source: ApprovalSource, reason: R) {
  await services.gate.audit(owner, {
    threadId: q.threadId,
    turnId: q.turnId,
    decision: 'deny',
    reason,
    source,
    quoteId: q.id,
    amount: q.amount,
    unit: q.unit,
  });
  return { ok: false as const, reason };
}

// ---------------------------------------------------------------------------
// wake.json

type WakeDoc = {
  /** Thread id to the seq of the last Event a Turn was woken for (the thread's lastWakeSeq). */
  seqs: Record<string, number>;
  /** Planner job id to the thread to tell when it is ready. */
  jobs: Record<string, string>;
};

const wakeDocs = documentStore<WakeDoc>({ prefix: 'chat/' });
const wakeKey = (owner: string) => `${owner}/wake.json`;

async function readWake(owner: string): Promise<WakeDoc> {
  return (await wakeDocs.get(wakeKey(owner)))?.value ?? { seqs: {}, jobs: {} };
}

async function watchJobs(owner: string, threadId: string, jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;
  await wakeDocs.update(wakeKey(owner), (current) => ({
    seqs: current?.seqs ?? {},
    jobs: { ...current?.jobs, ...Object.fromEntries(jobIds.map((id) => [id, threadId])) },
  }));
}

async function forgetJob(owner: string, jobId: string): Promise<void> {
  await wakeDocs.update(wakeKey(owner), (current) => {
    const { [jobId]: _told, ...jobs } = current?.jobs ?? {};
    return { seqs: current?.seqs ?? {}, jobs };
  });
}

/** Moves a thread's cursor to `seq`; true for the one caller that moved it, so two pods wake it once. */
async function claimWake(owner: string, threadId: string, seq: number): Promise<boolean> {
  let won = false;
  await wakeDocs.update(wakeKey(owner), (current) => {
    const doc = current ?? { seqs: {}, jobs: {} };
    won = (doc.seqs[threadId] ?? 0) < seq;
    return won ? { ...doc, seqs: { ...doc.seqs, [threadId]: seq } } : doc;
  });
  return won;
}

// ---------------------------------------------------------------------------
// Turns

/** The Turn running in this process, per thread. Taken before the first await, so two starts cannot both win. */
const held = new Map<string, AbortController>();
const heldKey = (owner: string, threadId: string) => `${owner}/${threadId}`;

function tryHold(owner: string, threadId: string): AbortController | null {
  if (held.has(heldKey(owner, threadId))) return null;
  const controller = new AbortController();
  held.set(heldKey(owner, threadId), controller);
  return controller;
}

const busy = () => refusal('CONFLICT', BUSY);

/** Takes the thread for one Turn; a CONFLICT while one runs here. */
export function holdThread(owner: string, threadId: string): AbortController {
  const controller = tryHold(owner, threadId);
  if (!controller) throw busy();
  return controller;
}

export function letGo(owner: string, threadId: string, controller: AbortController): void {
  if (held.get(heldKey(owner, threadId)) === controller) held.delete(heldKey(owner, threadId));
}

/** Aborts the Turn this process runs in the thread; it stops at its next step. */
export function stopTurn(owner: string, threadId: string): void {
  held.get(heldKey(owner, threadId))?.abort();
}

async function interruptTurns(owner: string, threadId: string, turns: Turn[]): Promise<void> {
  for (const turn of turns) {
    await store.updateTurn(owner, threadId, turn.id, { state: 'interrupted', endedAt: Date.now(), draft: '' });
    await store.appendEvent(owner, threadId, { type: 'turn.interrupted', payload: { turnId: turn.id } });
    await watchJobs(owner, threadId, turn.jobIds ?? []);
  }
}

/** Whether the document says another process is in the thread. A Turn that has gone quiet for good is closed here. */
export async function liveElsewhere(owner: string, thread: { id: string; turns: Turn[]; updatedAt: number }): Promise<boolean> {
  const left = thread.turns.filter((t) => LIVE_TURNS.has(t.state));
  if (left.length === 0) return false;
  if (Date.now() - thread.updatedAt < TURN_STALE_MS) return true;
  await interruptTurns(owner, thread.id, left);
  return false;
}

function bindTools(ctx: Context, services: Services) {
  return async (call: ToolCtx): Promise<ToolRunCtx> => {
    await ready(ctx);
    const readAsset = async (key: string) => {
      const bytes = await getObject(key);
      if (!bytes) throw new Error('That file is no longer there.');
      return Buffer.from(bytes);
    };
    return {
      ...call,
      trpc: AppRouter.createCaller(ctx),
      store,
      runs: {
        snapshot: services.engine.snapshot,
        cancel: async (owner, runId) => runView(await services.engine.cancel(ctx, owner, runId)),
      },
      capabilities: () => capabilitiesOf(ctx.runway),
      readAsset,
      gate: services.gate,
      pricer: services.pricer,
      hostAsset: assetHost(ctx.runway!, readAsset),
    };
  };
}

/** The loop's seams for one Turn. The model comes from Settings: the loop names a default and this replaces it. */
async function loopDeps(ctx: Context, owner: string, target: ChatTarget): Promise<LoopDeps> {
  const { model, effort } = await readChatSettings(owner);
  const omega = target.provider === 'omegaplus';
  const client = createAnthropicClient({ apiKey: target.apiKey, ...(omega ? { baseURL: OMEGA_BASE_URL, plain: true } : {}) });
  const tuned: ModelClient = { stream: (req, signal) => client.stream({ ...req, model: omega ? target.model : model, effort }, signal) };
  const services = servicesFor(ctx);
  return {
    model: tuned,
    tools: createRegistry([...readTools, ...actionTools], bindTools(ctx, services)),
    store,
    gate: services.gate,
    now: Date.now,
    log,
  };
}

/**
 * Starts a Turn in the background and answers with its id; the Turn is on the
 * thread before this returns, so the next poll finds it. The hold ends with the
 * Turn, and any plan it started is watched from then on.
 */
export async function startTurn(
  ctx: Context,
  owner: string,
  threadId: string,
  trigger: Trigger,
  controller: AbortController,
  target: ChatTarget
): Promise<string> {
  const deps = await loopDeps(ctx, owner, target);
  const turnId = randomUUID();
  await store.updateTurn(owner, threadId, turnId, { state: 'queued', trigger, startedAt: Date.now(), iterations: 0 });
  void runTurn(deps, owner, threadId, trigger, controller.signal, turnId)
    .then((turn) => watchJobs(owner, threadId, turn.jobIds ?? []))
    .catch((err: unknown) => log(`chat turn ${turnId}: ${errorText(err)}`))
    .finally(() => letGo(owner, threadId, controller));
  return turnId;
}

// ---------------------------------------------------------------------------
// The Tick

type Jobs<J> = { jobs: J[] };

const lifestyleDocs = documentStore<Jobs<LifestyleJob>>({ prefix: 'lifestyle/' });
const storyboardDocs = documentStore<Jobs<StoryboardJob>>({ prefix: 'storyboards/' });
const closeupDocs = documentStore<Jobs<CloseupJob>>({ prefix: 'closeups/' });

const lifestyleJobs = async (owner: string) => (await lifestyleDocs.get(`${owner}.json`))?.value.jobs ?? [];
const storyboardJobs = async (owner: string) => (await storyboardDocs.get(`${owner}.json`))?.value.jobs ?? [];
const closeupJobs = async (owner: string) => (await closeupDocs.get(`${owner}.json`))?.value.jobs ?? [];

/** A plan still being made, or a take of a two-pass plan whose second pass nobody has sent. */
function lifestyleOpen(job: LifestyleJob): boolean {
  if (job.status === 'planning') return true;
  if (job.status !== 'planned' || !job.pass2) return false;
  return (job.shots ?? []).some((s) => !s.pass2 || s.pass2.state === 'starting');
}

/** A second pass a poll of its job would send: nobody has claimed it, or its claim died with its request. */
function unsent({ pass2 }: LifestyleShot, now: number): boolean {
  return !pass2 || (pass2.state === 'starting' && now - Date.parse(pass2.at) > SUBMIT_STALE_MS);
}

/**
 * A Run leaves its takes' second passes to the poll of their job, and any poll, this
 * Tick's or the Lifestyle page's, goes on sending them. So the takes of a Run that
 * ended early are closed here while they are unsent, as `advancePasses` closes a
 * superseded take: only a person's Retry sends one now. Takes no Run shot are left
 * alone. The document is Lifestyle's; this is the one thing the chat writes to it.
 */
async function closeEndedTakes(owner: string): Promise<void> {
  const open = (await lifestyleJobs(owner)).filter(lifestyleOpen);
  if (open.length === 0) return;
  const ended = (await store.runs(owner)).filter((r) => RUN_AGAIN.has(r.state));
  const takes = new Set(ended.flatMap((r) => r.steps.find((s) => s.id === 'stills')?.ids ?? []));
  const closes = (shot: LifestyleShot, now: number) => takes.has(shot.stillId) && unsent(shot, now);
  const at = Date.now();
  if (!open.some((job) => job.shots?.some((s) => closes(s, at)))) return;
  await lifestyleDocs.update(`${owner}.json`, (current) => ({
    jobs: (current?.jobs ?? []).map((job) => {
      // Checked again on the stored job: a take claimed since is left to its claim.
      const now = Date.now();
      if (!job.pass2 || !job.shots?.some((s) => closes(s, now))) return job;
      const skipped = { state: 'skipped', reason: RUN_ENDED } as const;
      const shots = job.shots.map((s) => (closes(s, now) ? { ...s, pass2: skipped } : s));
      return { ...job, shots, updatedAt: new Date(now).toISOString() };
    }),
  }));
}

/** One step of a Tick: a failure is that machine's, and never stops the others. Answers how many things moved. */
async function attempt(what: string, work: () => Promise<number>): Promise<number> {
  try {
    return await work();
  } catch (err) {
    log(`[tick] ${what}: ${errorText(err)}`);
    return 0;
  }
}

async function pollEach(what: string, ids: string[], poll: (id: string) => Promise<unknown>): Promise<number> {
  let moved = 0;
  for (const id of ids) {
    moved += await attempt(`${what} ${id}`, async () => {
      await poll(id);
      return 1;
    });
  }
  return moved;
}

async function pollJobs(ctx: Context, owner: string): Promise<number> {
  // First, and able to stop this step: a poll must never get in ahead of a Run that ended.
  await closeEndedTakes(owner);
  const trpc = AppRouter.createCaller(ctx);
  const [lifestyle, storyboard, closeups] = await Promise.all([
    lifestyleJobs(owner),
    storyboardJobs(owner),
    closeupJobs(owner),
  ]);
  const ids = <J extends { id: string }>(jobs: J[], open: (job: J) => boolean) => jobs.filter(open).map((j) => j.id);
  return (
    (await pollEach('lifestyle', ids(lifestyle, lifestyleOpen), (id) => trpc.lifestyle.job({ id }))) +
    (await pollEach('storyboard', ids(storyboard, (j) => j.status === 'planning'), (id) => trpc.storyboard.job({ id }))) +
    (await pollEach('closeups', ids(closeups, (j) => CLOSEUPS_MOVING.has(j.status)), (id) => trpc.closeups.job({ id })))
  );
}

async function pollEdit(ctx: Context, owner: string): Promise<number> {
  const doc = await readEdit(owner);
  const open = doc.agent || [...doc.exports, ...doc.derived].some((item) => item.status === 'pending');
  if (!open) return 0;
  await AppRouter.createCaller(ctx).edit.project();
  return 1;
}

async function pollLibrary(ctx: Context, owner: string): Promise<number> {
  const { stills, clips } = await readLibrary(owner);
  if (![...stills, ...clips].some((item) => item.status === 'pending')) return 0;
  await AppRouter.createCaller(ctx).library();
  return 1;
}

async function advanceRuns(ctx: Context, owner: string): Promise<number> {
  const runs = (await store.runs(owner, { active: true })).filter((r) => r.state === 'queued' || r.state === 'running');
  const { engine } = servicesFor(ctx);
  return pollEach('run', runs.map((r) => r.id), (id) => engine.advance(ctx, owner, id));
}

/** Tells each watched plan's thread that it is ready, or that it failed: nothing else would ever wake the model for it. */
async function announceJobs(owner: string): Promise<number> {
  const watched = Object.entries((await readWake(owner)).jobs);
  if (watched.length === 0) return 0;
  const [lifestyle, storyboard] = await Promise.all([lifestyleJobs(owner), storyboardJobs(owner)]);
  let told = 0;
  for (const [jobId, threadId] of watched) {
    const plan = lifestyle.find((j) => j.id === jobId);
    const job = plan ?? storyboard.find((j) => j.id === jobId);
    if (job?.status === 'planning') continue;
    const error = job ? job.error : 'That plan is no longer there.';
    await store.appendEvent(owner, threadId, {
      type: 'job.planned',
      payload: { jobId, kind: plan ? 'lifestyle' : 'storyboard', status: job?.status ?? 'failed', ...(error ? { error } : {}) },
    });
    await forgetJob(owner, jobId);
    told++;
  }
  return told;
}

/** Wakes a thread for its oldest Event nobody has answered, once the thread is free. One wake per thread per Tick. */
async function wakeThreads(ctx: Context, owner: string): Promise<number> {
  const { seqs } = await readWake(owner);
  let woken = 0;
  for (const { id } of await store.threads(owner)) {
    if (held.has(heldKey(owner, id))) continue;
    const event = (await store.eventsSince(owner, id, seqs[id] ?? 0)).find((e) => WAKES.has(e.type));
    if (!event) continue;
    const target = await resolveChatTarget(owner);
    // Without a key the Events wait: the model hears them once there is one.
    if (!target) return woken;
    const controller = tryHold(owner, id);
    if (!controller) continue;
    try {
      const thread = await store.thread(owner, id);
      if (!thread || (await liveElsewhere(owner, thread)) || !(await claimWake(owner, id, event.seq))) {
        letGo(owner, id, controller);
        continue;
      }
      await startTurn(ctx, owner, id, { kind: 'event', eventSeq: event.seq }, controller, target);
      woken++;
    } catch (err) {
      letGo(owner, id, controller);
      throw err;
    }
  }
  return woken;
}

/** The owners a Tick is running for in this process. */
const ticking = new Set<string>();

/**
 * One advance of everything an owner has running; a Tick already running is left to
 * finish and this one does nothing. Answers how many things it moved.
 */
export async function tick(ctx: Context, owner: string): Promise<{ advanced: number }> {
  if (!ctx.runway || ticking.has(owner)) return { advanced: 0 };
  ticking.add(owner);
  try {
    await ready(ctx);
    let advanced = await attempt('jobs', () => pollJobs(ctx, owner));
    advanced += await attempt('edit', () => pollEdit(ctx, owner));
    advanced += await attempt('library', () => pollLibrary(ctx, owner));
    advanced += await attempt('runs', () => advanceRuns(ctx, owner));
    advanced += await attempt('plans', () => announceJobs(owner));
    advanced += await attempt('wakes', () => wakeThreads(ctx, owner));
    return { advanced };
  } finally {
    ticking.delete(owner);
  }
}

// ---------------------------------------------------------------------------
// The Driver

export type DriverDeps = {
  /** Only the desktop stand-in has a context with no request behind it, so src/ never imports it by name. */
  localContext(): Context;
  owner: string;
  /** Settles once the server can open the owner's documents. */
  boot(): Promise<unknown>;
  everyMs?: number;
};

let timer: ReturnType<typeof setInterval> | undefined;
let driving = false;
let listening = false;

/**
 * The stand-in, loaded only on the desktop. runwayAuth() has already called
 * bootTasks(), which the package does not export; `ready()` reads the owner's sealed
 * documents, so it waits for the same key boot hands over.
 */
async function desktopDeps(): Promise<DriverDeps> {
  const { localContext, LOCAL_OWNER } = (await import('@runway/bay/runway')) as unknown as {
    localContext(): Context;
    LOCAL_OWNER: string;
  };
  return { localContext, owner: LOCAL_OWNER, boot: () => ready(localContext()) };
}

function stopOnShutdown(): void {
  if (listening) return;
  listening = true;
  const onMessage = (message: unknown) => {
    if ((message as { type?: unknown } | null)?.type === 'shutdown') stopDriver();
  };
  process.once('SIGTERM', stopDriver);
  process.on('message', onMessage);
  const { parentPort } = process as unknown as { parentPort?: { on(ev: 'message', fn: (e: { data: unknown }) => void): void } };
  parentPort?.on('message', ({ data }) => onMessage(data));
}

/** Closes every Turn the last process left running: nothing is running it now. */
async function interruptLeftTurns(owner: string): Promise<void> {
  for (const { id } of await store.threads(owner)) {
    const thread = await store.thread(owner, id);
    if (thread) await interruptTurns(owner, id, thread.turns.filter((t) => LIVE_TURNS.has(t.state)));
  }
}

/** The desktop's clock: after boot, picks up what the last process left, then Ticks the one owner every 3 s. */
export async function startDriver(deps?: DriverDeps): Promise<void> {
  if (process.env['BAY_ENV'] !== 'desktop' || driving) return;
  driving = true;
  stopOnShutdown();
  try {
    const { localContext, owner, boot, everyMs = TICK_MS } = deps ?? (await desktopDeps());
    await boot();
    if (!driving) return;
    const ctx = localContext();
    await ready(ctx);
    // Neither may stop the clock: what they could not settle, a Tick still can.
    await attempt('resume', async () => {
      await servicesFor(ctx).engine.resumeAll(ctx, owner);
      return 0;
    });
    await attempt('left turns', async () => {
      await interruptLeftTurns(owner);
      return 0;
    });
    if (!driving) return;
    timer = setInterval(() => {
      tick(localContext(), owner).catch((err: unknown) => log(`[tick] ${errorText(err)}`));
    }, everyMs);
    timer.unref();
  } catch (err) {
    driving = false;
    log(`[driver] could not start: ${errorText(err)}`);
  }
}

export function stopDriver(): void {
  driving = false;
  if (timer) clearInterval(timer);
  timer = undefined;
}
