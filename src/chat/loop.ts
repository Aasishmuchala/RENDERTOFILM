// The turn loop: one Turn from its Trigger to a stop. It streams the model, saves
// each answer exactly as it came before anything acts on it, runs the tools by
// class and moves the Turn through turnNext, saving every move. Everything it
// touches is injected through LoopDeps, so a scripted fake model drives every test
// and the real SDK is one adapter. No tool here spends: the most a Turn can do is
// leave a Quote open and stop.
import { randomUUID } from 'node:crypto';

import { parseToolInput } from './contracts.ts';
import {
  canonicalJson,
  MAX_ITERATIONS,
  turnNext,
  type FinalMessage,
  type LoopDeps,
  type Message,
  type ModelEvent,
  type ModelRequest,
  type QuoteView,
  type ToolDef,
  type Trigger,
  type Turn,
  type TurnEvent,
  type TurnPatch,
} from './domain.ts';
import { MODE_BRIEF, SYSTEM_PROMPT } from './system-prompt.ts';

const MODEL = 'claude-opus-5-5';
const MAX_TOKENS = 32000;
/** The most one answer may be given, once, after running out of room in a tool call. */
const MAX_TOKENS_CEILING = 64000;
const DRAFT_EVERY_MS = 500;
const INTERNAL_ERROR = 'The assistant stopped on an internal error.';
const TOO_LONG = 'This conversation is too long; start a new thread.';
const STOPPED_BEFORE_RUN = 'Stopped before this ran.';
const NEVER_ANSWERED =
  'This call was interrupted and may not have finished; check what it was meant to change before trying it again.';

type ToolUse = { id: string; name: string; input: unknown };

/** A tool_use checked against its contract: `def` and `input` when it may run, else why not. */
type ToolCall = { use: ToolUse } & ({ def: ToolDef; input: unknown } | { def?: undefined; refused: string });

/** The Turn being run and what its helpers need. */
type Live = { deps: LoopDeps; owner: string; threadId: string; signal: AbortSignal; turn: Turn };

// ---------------------------------------------------------------------------
// Blocks

function blocksOf(content: unknown[], type: string): Record<string, unknown>[] {
  return content.filter((b): b is Record<string, unknown> => (b as { type?: unknown } | null)?.type === type);
}

const textOf = (content: unknown[]) =>
  blocksOf(content, 'text')
    .map((b) => b['text'])
    .join('');

const toolUses = (content: unknown[]) => blocksOf(content, 'tool_use') as ToolUse[];

/** No words and no tool call: an answer only in form, which the API will not take back either. */
const isEmptyAnswer = (content: unknown[]) => !textOf(content).trim() && !toolUses(content).length;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function toolResult(id: string, content: unknown[] | string, isError?: boolean) {
  return { type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) };
}

/** Stand-in results for the tool_use blocks of `answer` that `next` leaves without one. */
function owedResults(answer: Message | undefined, next: Message | undefined): unknown[] {
  if (answer?.role !== 'assistant') return [];
  const results = next?.role === 'user' ? blocksOf(next.content, 'tool_result') : [];
  const answered = new Set(results.map((b) => b['tool_use_id']));
  return toolUses(answer.content)
    .filter((use) => !answered.has(use.id))
    .map((use) => toolResult(use.id, NEVER_ANSWERED, true));
}

/** A user message that needs nothing before it, as tool results need their tool_use. */
const standsAlone = (m: Message) => m.role === 'user' && !blocksOf(m.content, 'tool_result').length;

/**
 * The thread as the API will take it, empty when nothing in it can come first. Bay
 * keeps only a thread's newest messages, so what is saved can open on an answer or
 * on results whose tool_use fell off; the request opens at the first message that
 * stands alone. An empty answer cannot go back, and a tool_use that a stopped Turn
 * left unanswered needs a result right after it: a stand-in, because a tool never
 * runs twice on a guess, so the model hears and decides. Saved messages are never
 * edited; these are copies, the same every time, so the prefix does not move.
 */
function requestMessages(saved: Message[]): Message[] {
  const opening = saved.findIndex(standsAlone);
  const out: Message[] = [];
  for (const m of opening < 0 ? [] : saved.slice(opening)) {
    if (m.role === 'assistant' && isEmptyAnswer(m.content)) continue;
    const owed = owedResults(out.at(-1), m);
    if (!owed.length) out.push(m);
    else if (m.role === 'user') out.push({ ...m, content: [...owed, ...m.content] });
    else out.push({ ...m, role: 'user', content: owed }, m);
  }
  const last = out.at(-1);
  const owed = owedResults(last, undefined);
  if (last && owed.length) out.push({ ...last, role: 'user', content: owed });
  return out;
}

// ---------------------------------------------------------------------------
// The Turn document

async function save(t: Live, patch: TurnPatch): Promise<void> {
  const thread = await t.deps.store.updateTurn(t.owner, t.threadId, t.turn.id, patch);
  t.turn = thread.turns.find((turn) => turn.id === t.turn.id) ?? { ...t.turn, ...patch };
}

const move = (t: Live, ev: TurnEvent, patch: TurnPatch = {}) =>
  save(t, { ...patch, state: turnNext(t.turn.state, ev) });

const emit = (t: Live, type: string, payload: Record<string, unknown>) =>
  t.deps.store.appendEvent(t.owner, t.threadId, { type, payload });

const noDraft = (t: Live): TurnPatch => (t.turn.draft ? { draft: '' } : {});

async function finish(t: Live, ev: 'done' | 'fail' | 'interrupt', error?: string): Promise<void> {
  await move(t, ev, { endedAt: t.deps.now(), ...noDraft(t), ...(error ? { error } : {}) });
  await emit(t, `turn.${t.turn.state}`, { turnId: t.turn.id, ...(error ? { error } : {}) });
}

/** Adds a user message the Owner did not type. */
async function say(t: Live, text: string): Promise<void> {
  await t.deps.store.appendMessage(t.owner, t.threadId, {
    role: 'user',
    content: [{ type: 'text', text }],
    at: t.deps.now(),
  });
}

/** Saves an answer as it came, before anything acts on it. */
async function keep(t: Live, message: FinalMessage): Promise<void> {
  await t.deps.store.appendMessage(t.owner, t.threadId, {
    role: 'assistant',
    content: message.content,
    usage: message.usage,
    requestId: message.requestId,
    at: t.deps.now(),
  });
  await save(t, { ...noDraft(t), ...(message.requestId ? { lastRequestId: message.requestId } : {}) });
  const text = textOf(message.content);
  if (text) await emit(t, 'turn.text', { text });
}

// ---------------------------------------------------------------------------
// The model

async function threadMessages(t: Live): Promise<Message[]> {
  const thread = await t.deps.store.thread(t.owner, t.threadId);
  if (!thread) throw new Error(`thread ${t.threadId} is gone`);
  return requestMessages(thread.messages);
}

async function request(t: Live, maxTokens: number): Promise<ModelRequest> {
  const mode = (await t.deps.store.thread(t.owner, t.threadId))?.mode;
  return {
    model: MODEL,
    system: [{ type: 'text', text: SYSTEM_PROMPT }, ...(mode ? [{ type: 'text' as const, text: MODE_BRIEF[mode] }] : [])],
    tools: t.deps.tools.defs,
    messages: await threadMessages(t),
    maxTokens,
    effort: 'high',
    betas: [], // the adapter adds its own, and only when it talks to Anthropic itself
  };
}

type ModelError = Extract<ModelEvent, { type: 'error' }>['error'];

const modelErrorText = (e: ModelError) => (e.status === 429 ? 'Rate limited; try again in a minute.' : e.message);

/**
 * One model call. Answers with the final message, the one sentence the Turn fails
 * with, or neither when the signal ended it, however the adapter reported that.
 */
async function listen(t: Live, req: ModelRequest): Promise<{ message?: FinalMessage; error?: string }> {
  let draft = '';
  let wroteAt = -Infinity;
  try {
    for await (const ev of t.deps.model.stream(req, t.signal)) {
      if (t.signal.aborted) return {};
      if (ev.type === 'message') return { message: ev.message };
      if (ev.type === 'error') return { error: modelErrorText(ev.error) };
      if (ev.type !== 'text_delta') continue;
      draft += ev.text;
      const at = t.deps.now();
      if (at - wroteAt >= DRAFT_EVERY_MS) {
        wroteAt = at;
        // Only a courtesy to the page, so a failed write costs the draft and nothing else.
        await save(t, { draft }).catch((err: unknown) => t.deps.log(`chat turn ${t.turn.id}: ${errorText(err)}`));
      }
    }
  } catch (err) {
    if (!t.signal.aborted) return { error: errorText(err) };
  }
  return t.signal.aborted ? {} : { error: 'The model stopped without answering.' };
}

// ---------------------------------------------------------------------------
// Tools

function check(t: Live, use: ToolUse): ToolCall {
  const def = t.deps.tools.defs.find((d) => d.name === use.name);
  if (!def) return { use, refused: `There is no tool called ${use.name}.` };
  const parsed = parseToolInput(use.name, use.input);
  return parsed.ok ? { use, def, input: parsed.value } : { use, refused: parsed.message };
}

/** Adjacent reads run together; anything else runs alone. Block order always holds. */
function batches(calls: ToolCall[]): ToolCall[][] {
  const out: ToolCall[][] = [];
  for (const call of calls) {
    const last = out.at(-1);
    if (last && call.def?.class === 'read' && last[0]?.def?.class === 'read') last.push(call);
    else out.push([call]);
  }
  return out;
}

/** The id of the Quote in a propose result when it now needs the Owner: open and not free. */
function quoteToDecide(content: unknown[] | string): string | undefined {
  try {
    const q = JSON.parse(typeof content === 'string' ? content : textOf(content)) as Partial<QuoteView> | null;
    return q?.state === 'open' && q.amount !== 0 ? q.id : undefined;
  } catch {
    return undefined;
  }
}

/** One call's result block; `proposed` when a propose went through, with the Quote it left to decide. */
async function runCall(
  t: Live,
  call: ToolCall
): Promise<{ block: unknown; proposed?: boolean; quoteId?: string | undefined }> {
  const { id, name } = call.use;
  if (!call.def) return { block: toolResult(id, call.refused, true) };
  const ctx = { owner: t.owner, threadId: t.threadId, turnId: t.turn.id, toolUseId: id };
  try {
    const r = await t.deps.tools.run(name, call.input, ctx);
    const proposed = call.def.class === 'propose' && !r.isError;
    return {
      block: toolResult(id, r.content, r.isError),
      proposed,
      quoteId: proposed ? quoteToDecide(r.content) : undefined,
    };
  } catch (err) {
    return { block: toolResult(id, errorText(err), true) };
  }
}

/**
 * Runs one answer's tools and saves one result per tool_use, in block order, as
 * the next user message. A stop lets what is running end and runs nothing more.
 * Answers with the Quote left waiting on the Owner, if any. A propose that went
 * through supersedes any before it, even when it leaves nothing to decide; one that
 * failed changed nothing.
 */
async function runTools(t: Live, uses: ToolUse[]): Promise<string | undefined> {
  const results: unknown[] = [];
  let quoteId: string | undefined;
  for (const batch of batches(uses.map((use) => check(t, use)))) {
    if (t.signal.aborted) {
      results.push(...batch.map(({ use }) => toolResult(use.id, STOPPED_BEFORE_RUN, true)));
      continue;
    }
    for (const { def } of batch) if (def) await emit(t, 'turn.tool', { name: def.name, class: def.class });
    for (const done of await Promise.all(batch.map((call) => runCall(t, call)))) {
      results.push(done.block);
      if (done.proposed) quoteId = done.quoteId;
    }
  }
  await t.deps.store.appendMessage(t.owner, t.threadId, { role: 'user', content: results, at: t.deps.now() });
  return quoteId;
}

// ---------------------------------------------------------------------------
// The loop

/** The Event that woke this Turn, as the user message the model reads. */
async function sayEvent(t: Live, eventSeq: number): Promise<void> {
  const events = await t.deps.store.eventsSince(t.owner, t.threadId, eventSeq - 1);
  const ev = events.find((e) => e.seq === eventSeq);
  await say(t, ev ? `[event] ${ev.type} ${canonicalJson(ev.payload)}` : `[event] unknown ${eventSeq}`);
}

async function drive(t: Live, trigger: Trigger): Promise<void> {
  if (t.signal.aborted) return finish(t, 'interrupt');
  await move(t, 'stream');
  await emit(t, 'turn.started', { turnId: t.turn.id });
  if (trigger.kind === 'event') await sayEvent(t, trigger.eventSeq);
  if (trigger.kind === 'resume' && (await threadMessages(t)).at(-1)?.role !== 'user') return finish(t, 'done');

  const max = t.deps.maxIterations ?? MAX_ITERATIONS;
  let maxTokens = MAX_TOKENS;
  let widened = false;
  let paused = false;
  let nudged = false;
  for (;;) {
    if (t.signal.aborted) return finish(t, 'interrupt');
    if (t.turn.iterations >= max) return finish(t, 'fail', `Stopped after ${max} steps.`);
    const req = await request(t, maxTokens);
    if (!req.messages.length) return finish(t, 'fail', TOO_LONG);
    await save(t, { iterations: t.turn.iterations + 1 });

    const { message, error } = await listen(t, req);
    if (error !== undefined) return finish(t, 'fail', error);
    if (!message) return finish(t, 'interrupt');
    const uses = toolUses(message.content);

    // Cut off inside a call: it never runs, and half a tool_use cannot go back in
    // the prefix, so this one answer is not kept. The same request goes again.
    if (message.stop_reason === 'max_tokens' && uses.length) {
      t.deps.log(`chat turn ${t.turn.id}: out of room at ${maxTokens} tokens (${message.requestId})`);
      if (widened) return finish(t, 'fail', 'The answer ran out of room.');
      widened = true;
      maxTokens = Math.min(maxTokens * 2, MAX_TOKENS_CEILING);
      continue;
    }

    await keep(t, message);
    if (t.signal.aborted) return finish(t, 'interrupt');

    if (message.stop_reason === 'refusal') return finish(t, 'fail', 'The model declined this request.');
    if (message.stop_reason === 'model_context_window_exceeded') return finish(t, 'fail', TOO_LONG);
    if (message.stop_reason === 'pause_turn') {
      if (paused) return finish(t, 'fail', 'The model paused twice and did not finish.');
      paused = true;
      continue;
    }
    if (message.stop_reason === 'tool_use' && uses.length) {
      await move(t, 'tool');
      const quoteId = await runTools(t, uses);
      if (t.signal.aborted) return finish(t, 'interrupt');
      if (quoteId) {
        await move(t, 'ask');
        await emit(t, 'turn.awaiting', { quoteId });
        return;
      }
      await move(t, 'stream');
      continue;
    }
    if (isEmptyAnswer(message.content) && !nudged) {
      nudged = true;
      await say(t, 'Continue.');
      continue;
    }
    return finish(t, 'done');
  }
}

/**
 * Runs one Turn to a stop and answers with it. Never rejects, because the caller
 * does not wait for it. A caller that must name the Turn before it ends passes
 * `turnId`; the Turn's document is created here either way.
 */
export async function runTurn(
  deps: LoopDeps,
  owner: string,
  threadId: string,
  trigger: Trigger,
  signal: AbortSignal,
  turnId: string = randomUUID()
): Promise<Turn> {
  const queued = { state: 'queued', trigger, startedAt: deps.now(), iterations: 0 } as const;
  const t: Live = { deps, owner, threadId, signal, turn: { id: turnId, ...queued } };
  try {
    await save(t, queued);
    await drive(t, trigger);
  } catch (err) {
    deps.log(`chat turn ${turnId} broke: ${errorText(err)}`);
    // A queued Turn has no fail move; it ends interrupted and still says why.
    const stopped = signal.aborted
      ? finish(t, 'interrupt')
      : finish(t, t.turn.state === 'queued' ? 'interrupt' : 'fail', INTERNAL_ERROR);
    await stopped.catch((e: unknown) => deps.log(`chat turn ${turnId} left ${t.turn.state}: ${errorText(e)}`));
  }
  return t.turn;
}
