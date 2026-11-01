import { randomUUID } from 'node:crypto';

import type { TaskSnapshot } from '@runway/bay/runway';

import {
  ANTHROPIC_MODELS,
  callText,
  defaultModelFor,
  listOmegaModels,
  type TextProvider,
  type TextResult,
  type TextUsage,
} from './ai-text/providers.ts';
import { recordUsage } from './ai-text/usage.ts';
import { capabilitiesOf } from './capabilities.ts';
import { readConnections } from './connections.ts';
import { documentStore } from './storage.ts';
import type { RunwayCtx } from './task-helpers.ts';

/**
 * Who answers the app's text-and-vision tasks: the Storyboard and Lifestyle
 * planners, the people check, the close-up finder and the editor. Provider
 * Runway (the default) is the `claude_api` task as it always was, sent with
 * the caller's own options object. With the owner's own Anthropic or
 * OmegaPlus key (Settings, src/connections.ts) the call runs here instead, as
 * a pseudo-task: an `ai_<uuid>` id at once, a job document at
 * `ai-text/<owner>/<id>.json` the answer is written into, and a
 * `TaskSnapshot` read back from it. So the callers' polls, claims and parsing
 * stay as they are, and a poll that lands on another pod still finds the
 * answer. A poll only ever reads: the paid call runs once, from the request
 * that created the task, and is never started again.
 */

export type TextTaskOptions = {
  name: string;
  model: string;
  system_prompt: string;
  prompt: string;
  images?: readonly { url: string }[] | undefined;
  temperature?: number | undefined;
  max_output_tokens?: number | undefined;
};

export type Resolved = { provider: 'runway' } | { provider: TextProvider; apiKey: string; model: string };

/** Test seams; the app passes none. */
export type TextDeps = {
  resolve?: ((owner: string) => Promise<Resolved>) | undefined;
  call?: typeof callText | undefined;
  now?: (() => number) | undefined;
};

type TextJob = {
  id: string;
  owner: string;
  provider: TextProvider;
  /** The model that answers (the Settings choice). */
  model: string;
  /** The model the caller named, which a provider other than Runway ignores. */
  requestedModel: string;
  /** The task's `name`: which planner, check or editor turn. */
  purpose: string;
  status: 'running' | 'succeeded' | 'failed';
  createdAt: string;
  finishedAt?: string | undefined;
  text?: string | undefined;
  truncated?: boolean | undefined;
  usage?: TextUsage | undefined;
  usd?: number | null | undefined;
  error?: string | undefined;
};

/**
 * A job still running this long after it started, and not running in this
 * process, died with its server; it is failed, never sent again. A live call
 * ends within ~11 min (providers.ts bounds it), so it is never cut off here.
 */
const STALE_MS = 15 * 60_000;
/** A job this process is still running is only given up on past this (a hung promise). */
const LIVE_CEILING_MS = 45 * 60_000;
/** Reported as PENDING for its first moments, as a Runway task is. */
const PENDING_MS = 500;
const DEFAULT_MAX_TOKENS = 4096;
/** The Runway task type behind every caller; this file is the only place that sends it. */
const RUNWAY_TEXT_TASK = 'claude_api';
const INTERRUPTED = 'The AI call was interrupted (the server restarted). Run it again.';

const store = documentStore<TextJob>({ prefix: 'ai-text/' });
const keyFor = (owner: string, id: string) => `${owner}/${id}.json`;

/** Calls running in this process, for `pendingTextTasks()`. */
const running = new Set<Promise<void>>();
/** Job ids whose paid call is still in flight in this process. */
const liveJobs = new Set<string>();

export function isTextTaskId(id: string): boolean {
  return /^ai_[0-9a-f-]{36}$/.test(id);
}

/** What the chat agent runs on. */
export type ChatTarget = { provider: TextProvider; apiKey: string; model: string };

/**
 * The chat needs a key, not a Settings choice: the provider chosen for AI text
 * when it has one, else whichever key is saved, Anthropic first. Null with none.
 */
export async function resolveChatTarget(owner: string): Promise<ChatTarget | null> {
  const chosen = await resolveTextProvider(owner);
  if (chosen.provider !== 'runway') return chosen;
  const { anthropic, omegaplus } = (await readConnections(owner)).apiKeys;
  if (anthropic) return { provider: 'anthropic', apiKey: anthropic.key, model: defaultModelFor('anthropic') };
  if (!omegaplus) return null;
  return { provider: 'omegaplus', apiKey: omegaplus.key, model: defaultModelFor('omegaplus', (await listOmegaModels()).models) };
}

/**
 * The owner's Settings choice with the model a call will actually use: the
 * saved one while the provider still lists it (any, when OmegaPlus did not
 * answer and the built-in list stands in), else the provider's default. A
 * provider whose key has gone falls back to Runway, so settings drift never
 * breaks a planner.
 */
export async function resolveTextProvider(owner: string): Promise<Resolved> {
  const doc = await readConnections(owner);
  const provider = doc.aiText?.provider ?? 'runway';
  if (provider === 'runway') return { provider };
  const apiKey = doc.apiKeys[provider]?.key;
  if (!apiKey) {
    console.warn(`[ai-text] ${provider} selected but no key saved; using Runway`);
    return { provider: 'runway' };
  }
  const saved = doc.aiText?.model;
  if (provider === 'anthropic') {
    const listed = ANTHROPIC_MODELS.some((m) => m.id === saved);
    return { provider, apiKey, model: saved && listed ? saved : defaultModelFor(provider) };
  }
  const omega = await listOmegaModels();
  const listed = omega.source === 'fallback' || omega.models.some((m) => m.id === saved);
  return { provider, apiKey, model: saved && listed ? saved : defaultModelFor(provider, omega.models) };
}

/**
 * Start a text task and return its id at once. Runway: the `claude_api` task
 * with the very object the caller built, so the request is byte for byte
 * what it was. Otherwise the job is saved first (a poll on any pod finds it,
 * and a failed write bills nothing), then the call starts in this process.
 */
export async function createTextTask(
  ctx: RunwayCtx,
  owner: string,
  options: TextTaskOptions,
  deps: TextDeps = {}
): Promise<{ id: string }> {
  // The simulator answers text itself, whichever provider Settings names: a pretend run never reaches a real key.
  const target = capabilitiesOf(ctx.runway).provider === 'simulator' ? null : await (deps.resolve ?? resolveTextProvider)(owner);
  if (!target || target.provider === 'runway') {
    return ctx.runway.createTask(RUNWAY_TEXT_TASK, options as Record<string, unknown>, { internal: true });
  }
  const now = deps.now ?? Date.now;
  const id = `ai_${randomUUID()}`;
  const job: TextJob = {
    id,
    owner,
    provider: target.provider,
    model: target.model,
    requestedModel: options.model,
    purpose: options.name,
    status: 'running',
    createdAt: new Date(now()).toISOString(),
  };
  await store.update(keyFor(owner, id), () => job);
  // Which call and which model, never the prompt.
  console.log(
    `[ai-text] ${options.name}: app asked for ${options.model}, calling ${target.provider}/${target.model} with ${options.images?.length ?? 0} images`
  );
  liveJobs.add(id);
  const run: Promise<void> = runJob(job, target.apiKey, options, deps).finally(() => {
    running.delete(run);
    liveJobs.delete(id);
  });
  running.add(run);
  return { id };
}

/** The one paid call for a job: its answer (or failure) into the job, its tokens into usage. Never rejects. */
async function runJob(job: TextJob, apiKey: string, options: TextTaskOptions, deps: TextDeps): Promise<void> {
  const now = deps.now ?? Date.now;
  let result: TextResult;
  try {
    // No temperature: the providers take no sampling parameters.
    result = await (deps.call ?? callText)({
      provider: job.provider,
      apiKey,
      model: job.model,
      system: options.system_prompt,
      prompt: options.prompt,
      imageUrls: (options.images ?? []).map((i) => i.url),
      maxTokens: options.max_output_tokens ?? DEFAULT_MAX_TOKENS,
    });
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const finishedAt = new Date(now()).toISOString();
  const patch: Partial<TextJob> = result.ok
    ? { status: 'succeeded', text: result.text, truncated: result.truncated, usage: result.usage, usd: result.usd, finishedAt }
    : { status: 'failed', error: result.error, finishedAt };
  await Promise.all([
    settle(job, patch).catch((err: unknown) => console.warn('[ai-text] could not save the answer', job.id, err)),
    recordUsage(job.owner, {
      at: finishedAt,
      provider: job.provider,
      model: job.model,
      requestedModel: job.requestedModel,
      purpose: job.purpose,
      inputTokens: result.ok ? result.usage.inputTokens : 0,
      outputTokens: result.ok ? result.usage.outputTokens : 0,
      usd: result.ok ? result.usd : null,
      ok: result.ok,
    }).catch((err: unknown) => console.warn('[ai-text] could not record usage', job.id, err)),
  ]);
}

/** Apply a terminal patch only while the job is still running: the first ending (answer or interruption) stands. */
function settle(job: TextJob, patch: Partial<TextJob>): Promise<TextJob> {
  return store.update(keyFor(job.owner, job.id), (current) =>
    !current || current.status === 'running' ? { ...(current ?? job), ...patch } : current
  );
}

/**
 * A task's state as the callers read it. Runway ids go to Runway (with the
 * text); `ai_` ids are read from their job document, and nothing here calls
 * a provider.
 */
export async function textTaskSnapshot(
  ctx: RunwayCtx,
  owner: string,
  id: string,
  deps: TextDeps = {}
): Promise<TaskSnapshot> {
  if (!isTextTaskId(id)) return ctx.runway.taskSnapshot(id, { includeText: true });
  const now = (deps.now ?? Date.now)();
  const found = (await store.get(keyFor(owner, id)))?.value;
  if (!found) return { id, done: true, status: 'FAILED', error: 'That AI task is no longer available. Run it again.' };
  let job = found;
  const age = now - Date.parse(job.createdAt);
  if (job.status === 'running' && age > (liveJobs.has(id) ? LIVE_CEILING_MS : STALE_MS)) {
    job = await settle(job, { status: 'failed', error: INTERRUPTED, finishedAt: new Date(now).toISOString() });
  }
  if (job.status === 'running') {
    return { id, done: false, status: age < PENDING_MS ? 'PENDING' : 'RUNNING', progress: 0.5 };
  }
  if (job.status === 'succeeded') {
    return { id, done: true, status: 'SUCCEEDED', progress: 1, text: job.text ?? '', truncated: job.truncated ?? false };
  }
  return { id, done: true, status: 'FAILED', progress: 1, error: job.error ?? 'The AI call failed. Run it again.' };
}

/** Test seam: settles once every call started in this process has finished. */
export async function pendingTextTasks(): Promise<void> {
  while (running.size > 0) await Promise.allSettled([...running]);
}
