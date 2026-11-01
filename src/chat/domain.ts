// The chat domain: the words of PLAN-13 section 2 as types, the two state
// machines, the spec hash and the Quote release rules. Pure. Every seam the
// chat modules share (Store, Gate, Pricer, ToolRegistry, RunEngine, ModelClient,
// LoopDeps) is declared here as a type only, so a module takes its seams from
// this file by injection and none imports a sibling's implementation. The page
// bundles this file for its values (QUOTE_TTL_MS, parseYes), so it imports
// nothing at run time: the hash below is pure, with no `node:crypto`.
import type { AppRouterType } from '../api.ts';
import type { Capabilities } from '../capabilities.ts';
import type { Context } from '../trpc.ts';

// ---------------------------------------------------------------------------
// Words

export type ToolClass = 'read' | 'text' | 'local' | 'propose' | 'cancel';
export type TurnState =
  | 'queued'
  | 'streaming'
  | 'tools_running'
  | 'awaiting_user'
  | 'completed'
  | 'failed'
  | 'interrupted';
export type RunState = 'queued' | 'running' | 'awaiting_user' | 'done' | 'failed' | 'stopped' | 'submit_unknown';
export type StepId = 'plan' | 'cast' | 'stills' | 'direct' | 'clips' | 'cut' | 'master' | 'qc';
export type StepState = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'submit_unknown';
export type RunKind = 'lifestyle_film' | 'stills' | 'clips' | 'cut' | 'master';
export type ApprovalSource = 'click' | 'text' | 'allowance' | 'free';
/** The provider's own unit: Runway and the simulator count credits, a USD-billed provider counts dollars. */
export type Unit = 'credits' | 'usd';
export type DeliverableId = 'h264' | 'hevc10' | 'prores';

export const QUOTE_TTL_MS = 30 * 60 * 1000;
export const MAX_ITERATIONS = 12;
/** Bay keeps the newest messages of a thread; the desktop keeps all of them (segmented). */
export const MAX_MESSAGES_BAY = 400;

// ---------------------------------------------------------------------------
// Documents

/** What a Run does, and the one thing a Quote is bound to through `specHash`. */
export type RunSpec = {
  kind: RunKind;
  lifestyleJobId?: string;
  storyboardJobId?: string;
  stillIds?: string[];
  seconds?: number;
  clipSeconds?: number;
  videoModel?: string;
  imageModel?: string;
  musicAssetKey?: string | null;
  deliverables?: DeliverableId[];
  transition?: 'hard' | 'fade';
  fadeSeconds?: number;
};

export type QuoteItem = {
  label: string;
  count: number;
  /** null when the provider cannot say what one costs (Bay shows no rates). */
  unitAmount: number | null;
  amount: number | null;
  /** How long each clip runs, on the clips line: what was priced is what may be made. */
  seconds?: number;
};

export type Quote = {
  id: string;
  threadId: string;
  turnId: string;
  specHash: string;
  spec: RunSpec;
  unit: Unit;
  /** null means the cost is unknown; such a Quote needs a click. */
  amount: number | null;
  items: QuoteItem[];
  note?: string;
  createdAt: number;
  expiresAt: number;
  state: 'open' | 'approved' | 'declined' | 'expired';
  decidedAt?: number;
  source?: ApprovalSource;
  /** Why a declined Quote was declined. */
  reason?: 'user' | 'superseded' | 'expired';
  /** Took the place of a Quote a person said yes to before it got dearer: that person decides, never an Allowance. */
  forPerson?: true;
  /** The id of the Run that consumed this Quote. */
  consumedBy?: string;
  /** When what its Run really cost was written down: a Quote is reconciled once. */
  reconciledAt?: number;
};

export type Step = {
  id: StepId;
  state: StepState;
  /** Written and saved before any paid call; a Step with an intent and no ids after a crash is submit_unknown. */
  intent?: { at: number };
  /** The ids this Step made: still, task, clip or export ids, in submission order. */
  ids: string[];
  jobId?: string;
  error?: string;
  startedAt?: number;
  endedAt?: number;
  /** What a later Step needs from this one (the shot director's raw plan per still, for example). */
  meta?: Record<string, unknown>;
};

export type Run = {
  id: string;
  threadId: string;
  turnId: string;
  kind: RunKind;
  spec: RunSpec;
  specHash: string;
  quoteId: string;
  state: RunState;
  steps: Step[];
  claim?: { at: number; by: string };
  createdAt: number;
  updatedAt: number;
  error?: string;
  outputs: { stillIds: string[]; clipIds: string[]; exportId?: string; qcReportKey?: string };
};

export type Trigger = { kind: 'user'; messageSeq: number } | { kind: 'event'; eventSeq: number } | { kind: 'resume' };

export type Turn = {
  id: string;
  state: TurnState;
  trigger: Trigger;
  startedAt: number;
  endedAt?: number;
  /** Model calls made so far; capped at MAX_ITERATIONS. */
  iterations: number;
  error?: string;
  lastRequestId?: string;
  /** The assistant text so far, written at most every 500 ms while the Turn streams. */
  draft?: string;
  /** Planner jobs this Turn started (Lifestyle, Director), so the thread can point at them. */
  jobIds?: string[];
};

/** Token counts as the API reports them; kept as received. */
export type Usage = { input_tokens?: number; output_tokens?: number; [key: string]: unknown };

/** One verbatim API message. Never edited after it is saved. */
export type Message = {
  seq: number;
  role: 'user' | 'assistant';
  content: unknown[];
  usage?: Usage;
  requestId?: string;
  at: number;
};

/** A user input kept durably: a render or a music bed under `chat-assets/<owner>/`. */
export type Asset = {
  key: string;
  kind: 'image' | 'audio';
  name: string;
  width?: number;
  height?: number;
  bytes: number;
  /** For a music bed: where the user says the licence comes from. */
  licence?: string;
  addedAt: number;
};

export type Thread = {
  id: string;
  owner: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** The last sequence number given to a Message or an Event; one counter per thread. */
  lastSeq: number;
  messages: Message[];
  turns: Turn[];
  runIds: string[];
  assets: Asset[];
};

export type ThreadSummary = { id: string; title: string; createdAt: number; updatedAt: number };

/** Append-only per thread: the UI's progress feed and the agent's wake-up. */
export type Event = { seq: number; type: string; payload: Record<string, unknown>; at: number };

/** Every decision the audit log records: the Gate's about a Quote, the RunEngine's about a Run. */
export type AuditDecision =
  | 'propose'
  | 'approve'
  | 'decline'
  | 'superseded'
  | 'expired'
  | 'deny'
  | 'reconcile'
  | 'start'
  | 'finish'
  | 'fail'
  | 'cancel'
  | 'submit_unknown';

export type AuditRow = {
  at: number;
  threadId: string;
  turnId?: string;
  toolUseId?: string;
  tool?: string;
  decision: AuditDecision;
  /** Why a release was denied. */
  reason?: ReleaseRefused;
  source?: ApprovalSource;
  quoteId?: string;
  amount?: number | null;
  unit?: Unit;
  actualAmount?: number | null;
  provider?: string;
  model?: string;
  remoteIds?: string[];
  outcomeIds?: string[];
};

// ---------------------------------------------------------------------------
// Views: what the client gets. Never a raw message block (a block can carry an
// image, a thinking signature or a tool input), never a URL.

export type MessageView = Omit<Message, 'content'> & { text: string };
export type ThreadView = Omit<Thread, 'messages'> & { messages: MessageView[] };
/** done steps over total steps, 0..100, and one line for a card ("Shooting stills 7 of 12"). */
export type RunView = Run & { percent: number; label: string };
export type QuoteView = Quote;

// ---------------------------------------------------------------------------
// Seams, types only. The implementations live in their own modules and are
// injected; nothing here imports one.

export type TurnPatch = Partial<Omit<Turn, 'id'>>;
export type RunFilter = { threadId?: string; active?: boolean };

export type Store = {
  threads(owner: string): Promise<ThreadSummary[]>; // newest first, cap 50
  thread(owner: string, id: string): Promise<Thread | null>;
  createThread(owner: string, title: string): Promise<Thread>;
  /** The store gives the Message its `seq`; the one passed in is not used. */
  appendMessage(owner: string, threadId: string, msg: Omit<Message, 'seq'>): Promise<number>; // returns seq
  /** Patches the Turn with this id; a Turn the thread does not have yet is created from the patch. */
  updateTurn(owner: string, threadId: string, turnId: string, patch: TurnPatch): Promise<Thread>;
  /** Adds to `Thread.assets`; the same key twice keeps one. */
  addAsset(owner: string, threadId: string, asset: Asset): Promise<Thread>;
  /** Adds to `Thread.runIds`; the same id twice keeps one. */
  linkRun(owner: string, threadId: string, runId: string): Promise<Thread>;
  appendEvent(owner: string, threadId: string, ev: Omit<Event, 'seq' | 'at'>): Promise<Event>;
  eventsSince(owner: string, threadId: string, seq: number): Promise<Event[]>;
  run(owner: string, id: string): Promise<Run | null>;
  saveRun(owner: string, run: Run): Promise<void>;
  runs(owner: string, filter?: RunFilter): Promise<Run[]>;
  quote(owner: string, id: string): Promise<Quote | null>;
  saveQuote(owner: string, q: Quote): Promise<void>;
  appendAudit(owner: string, row: AuditRow): Promise<void>;
  audit(owner: string, day?: string): Promise<AuditRow[]>;
};

/** What a spec costs, as the Pricer answers: a null amount is a cost nobody could read, and such a Quote needs a click. */
export type SpecPrice = { unit: Unit; amount: number | null; items: QuoteItem[]; note?: string };

export type Pricer = {
  price(owner: string, spec: RunSpec): Promise<SpecPrice>;
};

/**
 * A Quote's price read again for its release, by `Gate.priceAgain`: `null` when it
 * could not be read, `undefined` when there was nothing to read (a free Quote, or one
 * the door refuses anyway).
 */
export type Repriced = SpecPrice | null | undefined;

export type ReleaseDenied = 'expired' | 'decided' | 'over_allowance' | 'unknown_cost';
/**
 * Every way a release can be refused: what `canRelease` denies, plus what only the
 * Gate can find out. `repriced`: the work costs more now, and the Quote is superseded.
 * `unpriced`: its price could not be read again, and it stays open. `spec_changed`:
 * its spec is no longer the one its hash was taken of.
 */
export type ReleaseRefused = ReleaseDenied | 'not_found' | 'repriced' | 'unpriced' | 'spec_changed';

// The price is read ahead of the Gate's own turn, so a pricer that hangs holds up one
// proposal or one click and nothing else of the owner's. A caller that keeps a serial
// section of its own around the Gate (the Driver) reads it ahead of that too, with
// `price` and `priceAgain`, and hands it in; the Gate then reads nothing.
export type Gate = {
  /** `priced`: the spec's price, read already; without it the Gate reads it. */
  propose(owner: string, threadId: string, turnId: string, spec: RunSpec, priced?: SpecPrice): Promise<Quote>;
  /** The Pricer behind the Gate's limit on how long a price may take. */
  price(owner: string, spec: RunSpec): Promise<SpecPrice>;
  /** What a Quote about to be released costs now; see `Repriced`. Never reads for a Quote the door refuses anyway. */
  priceAgain(owner: string, quoteId: string): Promise<Repriced>;
  /** `read`: what `priceAgain` gave for this Quote; without it the Gate reads it. */
  release(
    owner: string,
    quoteId: string,
    source: ApprovalSource,
    read?: { fresh: Repriced }
  ): Promise<{ ok: true; quote: Quote } | { ok: false; reason: ReleaseRefused }>;
  decline(owner: string, quoteId: string, reason: 'user' | 'superseded' | 'expired'): Promise<Quote>;
  /** What the Allowance still covers today, in the Quote's unit; null when there is none (0 per day). */
  allowanceLeft(owner: string): Promise<number | null>;
  reserve(owner: string, quote: Quote): Promise<void>;
  reconcile(owner: string, quoteId: string, actual: number | null): Promise<void>;
  audit(owner: string, row: Omit<AuditRow, 'at'>): Promise<void>;
};

export type RunEngine = {
  start(ctx: Context, owner: string, quote: Quote): Promise<Run>; // writes the run doc first, consumes the quote
  advance(ctx: Context, owner: string, runId: string): Promise<Run>; // one step at most; idempotent under its claim {at, by}
  cancel(ctx: Context, owner: string, runId: string): Promise<Run>; // stops following; never cancels a provider task
  resumeAll(ctx: Context, owner: string): Promise<void>; // at boot: running steps with intent and no ids -> submit_unknown
  snapshot(owner: string, runId: string): Promise<RunView | null>;
};

/** A tool as the model sees it (the schemas are built in contracts.ts). */
export type ToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  class: ToolClass;
  strict: true;
};

/** What the loop hands a tool call. */
export type ToolCtx = { owner: string; threadId: string; turnId: string; toolUseId: string };

export type ToolResult = { content: unknown[] | string; isError?: boolean };

export type ToolRegistry = {
  defs: ToolDef[];
  run(name: string, input: unknown, ctx: ToolCtx): Promise<ToolResult>;
};

/** What one tool implementation works with. */
export type ToolRunCtx = ToolCtx & {
  trpc: ReturnType<AppRouterType['createCaller']>;
  store: Store;
  runs: Pick<RunEngine, 'snapshot'> & { cancel(owner: string, runId: string): Promise<RunView> };
  capabilities(): Capabilities;
  readAsset(key: string): Promise<Buffer>;
  gate: Gate;
  pricer: Pricer;
  hostAsset(key: string): Promise<{ url: string; width: number; height: number; name: string }>;
};

export type ToolImpl = {
  def: ToolDef;
  run(input: unknown, ctx: ToolRunCtx): Promise<{ content: unknown[]; isError?: boolean }>;
};

export type TextBlock = { type: 'text'; text: string; cache_control?: { type: 'ephemeral'; ttl?: '5m' | '1h' } };

export type StopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'stop_sequence'
  | 'refusal'
  | 'pause_turn'
  | 'model_context_window_exceeded';

/** The assistant's answer with every content block, in order, exactly as the API sent it. */
export type FinalMessage = {
  content: unknown[];
  stop_reason: StopReason | null;
  usage?: Usage;
  requestId?: string;
};

export type ModelRequest = {
  model: string;
  system: TextBlock[];
  tools: ToolDef[];
  messages: Message[];
  maxTokens: number;
  effort: 'high';
  betas: string[];
};

export type ModelEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_update'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'message'; message: FinalMessage }
  | { type: 'error'; error: { status?: number; type: string; message: string } };

export type ModelClient = { stream(req: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> };

export type LoopDeps = {
  model: ModelClient;
  tools: ToolRegistry;
  store: Store;
  gate: Gate;
  now(): number;
  log(line: string): void;
  maxIterations?: number; // 12
};

// ---------------------------------------------------------------------------
// Spec hash

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, sortKeys(v)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

/** JSON with every object's keys sorted and undefined values dropped; arrays keep their order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

// sha256 (FIPS 180-4): the round constants and the initial hash, as published.
const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
type Words = [number, number, number, number, number, number, number, number];
const H0: Words = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

/** sha256 of UTF-8 text as lowercase hex, in plain JavaScript so a browser can run it. */
function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((bytes.length * 8) / 2 ** 32));
  view.setUint32(padded.length - 4, (bytes.length * 8) >>> 0);

  let h: Words = [...H0];
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15] as number;
      const y = w[i - 2] as number;
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const big1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const big0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const t1 = (hh + big1 + ((e & f) ^ (~e & g)) + (K[i] as number) + (w[i] as number)) >>> 0;
      const t2 = (big0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      [hh, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    const next = [a, b, c, d, e, f, g, hh];
    h = h.map((x, i) => (x + (next[i] as number)) >>> 0) as Words;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
}

/** sha256 hex of the canonical JSON of the spec: what a Quote is bound to. */
export function specHash(spec: RunSpec): string {
  return sha256Hex(canonicalJson(spec));
}

// ---------------------------------------------------------------------------
// Typed approval

const YES = /^\s*(yes|y|ok|okay|go|go ahead|run it|do it|approve|approved)[.! ]*$/i;

/** A typed yes, by a fixed grammar: only a bare yes counts, never a sentence that contains one. */
export function parseYes(text: string): boolean {
  return YES.test(text);
}

// ---------------------------------------------------------------------------
// State machines

export type TurnEvent = 'stream' | 'tool' | 'ask' | 'done' | 'fail' | 'interrupt';
export type RunEvent = 'start' | 'ask' | 'resume' | 'done' | 'fail' | 'stop' | 'unknown';

const TURN_MOVES: Partial<Record<TurnState, Partial<Record<TurnEvent, TurnState>>>> = {
  queued: { stream: 'streaming', interrupt: 'interrupted' },
  streaming: { tool: 'tools_running', done: 'completed', fail: 'failed', interrupt: 'interrupted' },
  tools_running: { stream: 'streaming', ask: 'awaiting_user', fail: 'failed', interrupt: 'interrupted' },
  awaiting_user: { stream: 'streaming', interrupt: 'interrupted' },
};

const RUN_MOVES: Partial<Record<RunState, Partial<Record<RunEvent, RunState>>>> = {
  queued: { start: 'running', stop: 'stopped' },
  running: { ask: 'awaiting_user', done: 'done', fail: 'failed', stop: 'stopped', unknown: 'submit_unknown' },
  awaiting_user: { resume: 'running', stop: 'stopped' },
};

/** The next Turn state, or an Error for a move the machine does not have. */
export function turnNext(state: TurnState, ev: TurnEvent): TurnState {
  const moves = TURN_MOVES[state];
  const next = moves && Object.hasOwn(moves, ev) ? moves[ev] : undefined;
  if (!next) throw new Error(`turn ${state} cannot ${ev}`);
  return next;
}

/** The next Run state, or an Error for a move the machine does not have. */
export function runNext(state: RunState, ev: RunEvent): RunState {
  const moves = RUN_MOVES[state];
  const next = moves && Object.hasOwn(moves, ev) ? moves[ev] : undefined;
  if (!next) throw new Error(`run ${state} cannot ${ev}`);
  return next;
}

// ---------------------------------------------------------------------------
// Release

/**
 * Whether a Quote may be released by this approval at `now`. A click, a typed
 * yes and a free Quote need only an open Quote in time; an Allowance also needs
 * a known cost that today's remainder covers (`allowanceLeft` is null when the
 * owner has no Allowance). This is the last check before money moves, so every
 * comparison is written to fail when a number is missing or not a number: a
 * time that is not a time is expired, an amount that is not a cost is unknown
 * and an allowance that is not a number covers nothing. `free` is trusted here
 * to mean a cost of zero; the Gate refuses it for anything else.
 */
export function canRelease(
  q: Quote,
  now: number,
  allowanceLeft: number | null,
  source: ApprovalSource
): { ok: true } | { ok: false; reason: ReleaseDenied } {
  if (!(now < q.expiresAt)) return { ok: false, reason: 'expired' };
  if (q.state !== 'open') return { ok: false, reason: 'decided' };
  if (source === 'allowance') {
    const known = typeof q.amount === 'number' && Number.isFinite(q.amount) && q.amount >= 0;
    if (!known) return { ok: false, reason: 'unknown_cost' };
    if (typeof allowanceLeft !== 'number' || !(allowanceLeft >= (q.amount as number))) {
      return { ok: false, reason: 'over_allowance' };
    }
  }
  return { ok: true };
}
