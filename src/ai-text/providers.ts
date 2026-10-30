import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

import { safeFetch, UnsafeUrlError } from '../safe-fetch.ts';

/**
 * The owner's own Anthropic or OmegaPlus key behind the `claude_api` tasks
 * (src/ai-text.ts): one text-and-images request in, one answer out. Both
 * providers speak the Anthropic Messages API, so both go through the
 * Anthropic SDK; OmegaPlus (https://api.omegaplusapi.com) gets a second
 * client with its own `baseURL` and only the standard request fields.
 *
 * If a live call shows OmegaPlus rejecting the SDK's headers, swap
 * `callOmegaPlus` for a `fetch` POST to `/v1/messages` with `x-api-key` —
 * same `TextRequest` in, same `TextResult` out; nothing else moves.
 *
 * Pure and injectable (`ProviderDeps`): no tRPC, no storage. A key appears
 * only in the SDK client and in request headers — never in a message, a log
 * line or a returned object.
 */

export const ANTHROPIC_MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  { id: 'claude-fable-5-1', name: 'Claude Fable 5.1' },
] as const;
/** Both providers. Opus is the one the people check already asks for. */
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const OMEGA_BASE_URL = 'https://api.omegaplusapi.com';

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_IMAGES = 20;
const IMAGE_EDGE = 1568;
const IMAGE_FETCH_TIMEOUT_MS = 30_000;
const MODELS_TTL_MS = 10 * 60_000;
const MODELS_TIMEOUT_MS = 8_000;
const BILLING_TIMEOUT_MS = 15_000;
const VERIFY_TIMEOUT_MS = 15_000;
/** One attempt of a text call; with one retry a call can't outlive the job's dead-after window. */
const CALL_TIMEOUT_MS = 5 * 60_000;

export type OmegaModel = { id: string; name: string; owner: string; vision: boolean };

/** Every model OmegaPlus listed on 2026-10-29, all vision-capable. */
export const OMEGA_FALLBACK_MODELS: OmegaModel[] = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', owner: 'anthropic', vision: true },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', owner: 'anthropic', vision: true },
  { id: 'claude-opus-5', name: 'Claude Opus 5', owner: 'anthropic', vision: true },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', owner: 'anthropic', vision: true },
  { id: 'claude-fable-5', name: 'Fable 5', owner: 'anthropic', vision: true },
  { id: 'claude-fable-5-1', name: 'Fable 5.1', owner: 'anthropic', vision: true },
  { id: 'claude-omega-plus', name: 'Omega Plus', owner: 'singlebyte', vision: true },
  { id: 'claude-omega-ultra', name: 'Omega Ultra', owner: 'singlebyte', vision: true },
  { id: 'claude-quantum-lite-1', name: 'Quantum Lite 1', owner: 'singlebyte', vision: true },
  { id: 'claude-gpt-6', name: 'GPT-6', owner: 'openai', vision: true },
  { id: 'claude-gpt-6-sol', name: 'GPT-6 Sol', owner: 'openai', vision: true },
  { id: 'claude-gpt-6-1-sol', name: 'GPT-6.1 Sol', owner: 'openai', vision: true },
  { id: 'claude-gpt-6-astra', name: 'GPT-6 Astra', owner: 'openai', vision: true },
  { id: 'claude-deepseek-v4-pro', name: 'DeepSeek V4 Pro', owner: 'deepseek', vision: true },
  { id: 'claude-qwen-3-8', name: 'Qwen 3.8', owner: 'alibaba', vision: true },
  { id: 'claude-qwen-3-8-flash', name: 'Qwen 3.8 Flash', owner: 'alibaba', vision: true },
  { id: 'claude-glm-5-3', name: 'GLM 5.3', owner: 'z.ai', vision: true },
  { id: 'claude-glm-5-3-flash', name: 'GLM 5.3 Flash', owner: 'z.ai', vision: true },
  { id: 'claude-kimi-k3', name: 'Kimi K3', owner: 'moonshot', vision: true },
];

export type TextProvider = 'anthropic' | 'omegaplus';
export type TextRequest = {
  provider: TextProvider;
  apiKey: string;
  model: string;
  system?: string | undefined;
  prompt: string;
  imageUrls: readonly string[];
  maxTokens: number;
};
export type TextUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};
export type TextResult =
  | {
      ok: true;
      text: string;
      truncated: boolean;
      stopReason: string;
      usage: TextUsage;
      usd: number | null;
    }
  // A sentence for the person reading it; never contains the key.
  | { ok: false; error: string };
export type ImageBlock = {
  type: 'image';
  source: { type: 'base64'; media_type: 'image/jpeg'; data: string };
};
export type ProviderDeps = {
  fetch?: typeof fetch;
  /** An `Anthropic` instance (or a fake with the same `create` shapes) for tests. */
  client?: unknown;
  now?: () => number;
};

export class AiTextError extends Error {
  readonly expose = true;
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AiTextError';
    this.status = status;
  }
}

/** The slice of the SDK this file calls; real clients and test fakes both fit. */
type MessageLike = {
  stop_reason: string | null;
  stop_details?: { category?: string | null } | null;
  content: { type: string; text?: string }[];
  // A gateway may leave `usage` out; count it as zero rather than fail the answer.
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
};
type ClientLike = {
  messages: { create(body: Record<string, unknown>): Promise<MessageLike> };
  beta: { messages: { create(body: Record<string, unknown>): Promise<MessageLike> } };
  models: { list(params: { limit: number }, options?: { timeout: number }): Promise<unknown> };
};

const providerName = (provider: TextProvider) => (provider === 'anthropic' ? 'Anthropic' : 'OmegaPlus');

/** Belt and braces: an SDK or network message never carries the key out. */
const redact = (message: string, apiKey: string) =>
  apiKey.length >= 4 ? message.split(apiKey).join('[key]') : message;

function clientFor(provider: TextProvider, apiKey: string, deps: ProviderDeps): ClientLike {
  if (deps.client) return deps.client as ClientLike;
  // The SDK authenticates with `Authorization: Bearer`; OmegaPlus documents
  // `x-api-key`, so it gets both.
  // One call ends within ~11 min (5 min an attempt, one retry), well inside
  // the 15 min after which src/ai-text.ts may call a job dead.
  const limits = { timeout: CALL_TIMEOUT_MS, maxRetries: 1 };
  return new Anthropic(
    provider === 'omegaplus'
      ? { apiKey, baseURL: OMEGA_BASE_URL, defaultHeaders: { 'x-api-key': apiKey }, ...limits }
      : { apiKey, ...limits }
  ) as unknown as ClientLike;
}

/**
 * An http(s) image as a base64 JPEG block: auto-rotated, long edge at most
 * 1568 px (the size the model reads at), always JPEG so there is one media type.
 */
export async function encodeImage(url: string, deps: ProviderDeps = {}): Promise<ImageBlock> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AiTextError('Image URL must be http(s).', 400);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AiTextError('Image URL must be http(s).', 400);
  }
  // The address may be a visitor's upload: never one inside a network (src/safe-fetch.ts).
  const res = await (deps.fetch ?? safeFetch)(url, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) }).catch(
    (err: unknown) => {
      throw err instanceof UnsafeUrlError ? new AiTextError(err.message, 400) : err;
    }
  );
  if (!res.ok) throw new AiTextError(`Could not fetch an input image (${res.status}).`, 422);
  const jpeg = await sharp(Buffer.from(await res.arrayBuffer()))
    .rotate()
    .resize({ width: IMAGE_EDGE, height: IMAGE_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } };
}

/** USD for the one price we have verified: Anthropic's Opus 5.5. Everything else is tokens only. */
export function usdFor(provider: TextProvider, model: string, usage: TextUsage): number | null {
  // Anthropic first-party $ per MTok: input, output, cache read, cache write (1.25x input).
  // Source: the claude-api skill's model table (cached 2026-10-06): Opus 5.5 $4/$20, cache
  // reads $0.20; Sonnet 5.5 $2/$10, cache reads $0.20; Fable 5.1 $10/$50, cache reads $0.25.
  // Cache-read prices are set per model, not a fixed fraction of input.
  const RATES: Record<string, [number, number, number, number]> = {
    'claude-opus-5-5': [4, 20, 0.2, 5],
    'claude-sonnet-5-5': [2, 10, 0.2, 2.5],
    'claude-fable-5-1': [10, 50, 0.25, 12.5],
  };
  const rate = provider === 'anthropic' ? RATES[model] : undefined;
  if (!rate) return null;
  const usd =
    (usage.inputTokens * rate[0] +
      usage.outputTokens * rate[1] +
      usage.cacheReadTokens * rate[2] +
      usage.cacheWriteTokens * rate[3]) /
    1e6;
  return Math.round(usd * 1e6) / 1e6;
}

function describeError(err: unknown, provider: TextProvider): string {
  const who = providerName(provider);
  if (err instanceof Anthropic.AuthenticationError) {
    return `${who} rejected the API key (401). Replace it in Settings.`;
  }
  if (err instanceof Anthropic.RateLimitError) return `${who} rate limit (429). Try again in a minute.`;
  if (err instanceof Anthropic.BadRequestError) return `${who} rejected the request: ${err.message}`;
  if (err instanceof Anthropic.APIError) {
    // Connection failures and timeouts are APIErrors with no status.
    return err.status === undefined
      ? `${who} could not be reached: ${err.message}`
      : `${who} error ${err.status}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * One request, one answer. Never throws: an SDK or network failure comes back
 * as `{ ok: false, error }`. The SDK already retries 429 and 5xx twice, so no
 * retry loop here.
 */
export async function callText(req: TextRequest, deps: ProviderDeps = {}): Promise<TextResult> {
  try {
    if (req.imageUrls.length > MAX_IMAGES) throw new AiTextError('Too many images for one request.', 400);
    const images = await Promise.all(req.imageUrls.map((url) => encodeImage(url, deps)));
    const messages = [{ role: 'user', content: [...images, { type: 'text', text: req.prompt }] }];
    const max_tokens = Math.min(16000, Math.max(256, Math.floor(req.maxTokens)));
    const client = clientFor(req.provider, req.apiKey, deps);
    const base = { model: req.model, max_tokens, ...(req.system ? { system: req.system } : {}), messages };
    // No temperature / top_p / top_k / thinking on any model: the API rejects
    // sampling parameters and Opus 5.5 always thinks adaptively.
    const res =
      req.provider === 'anthropic'
        ? await client.beta.messages.create({
            ...base,
            ...(req.model === 'claude-opus-5-5' ? { output_config: { effort: 'high' } } : {}),
            betas: [FALLBACK_BETA],
            fallbacks: 'default',
          })
        : // OmegaPlus takes the standard fields only: no betas, output_config or fallbacks.
          await client.messages.create(base);
    if (res.stop_reason === 'refusal') {
      return {
        ok: false,
        error: `${providerName(req.provider)} declined this request (${res.stop_details?.category ?? 'refusal'}).`,
      };
    }
    const usage: TextUsage = {
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? 0,
      cacheReadTokens: res.usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: res.usage?.cache_creation_input_tokens ?? 0,
    };
    return {
      ok: true,
      // Thinking and fallback blocks are the model's working, not the answer.
      text: res.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join(''),
      truncated: res.stop_reason === 'max_tokens',
      stopReason: res.stop_reason ?? '',
      usage,
      usd: usdFor(req.provider, req.model, usage),
    };
  } catch (err) {
    return { ok: false, error: redact(describeError(err, req.provider), req.apiKey) };
  }
}

/** Throws `AiTextError` (400: the key is wrong; 422: try again) unless the provider accepts the key. */
export async function verifyKey(provider: TextProvider, key: string, deps: ProviderDeps = {}): Promise<void> {
  const who = providerName(provider);
  if (provider === 'anthropic') {
    try {
      await clientFor(provider, key, deps).models.list({ limit: 1 }, { timeout: VERIFY_TIMEOUT_MS });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new AiTextError(`${who} refused that API key. Check it and paste it again.`, 400);
      }
      if (err instanceof Anthropic.APIError && err.status !== undefined && err.status >= 500) {
        throw new AiTextError(`${who} answered ${err.status}. Try again in a moment.`, 422);
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new AiTextError(`${who} could not be reached: ${redact(message, key)}`, 422);
    }
    return;
  }
  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(`${OMEGA_BASE_URL}/v1/billing`, {
      headers: { 'x-api-key': key, accept: 'application/json' },
      signal: AbortSignal.timeout(BILLING_TIMEOUT_MS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AiTextError(`${who} could not be reached: ${redact(message, key)}`, 422);
  }
  await res.body?.cancel();
  if (res.status === 401 || res.status === 403) {
    throw new AiTextError(`${who} refused that API key. Check it and paste it again.`, 400);
  }
  if (!res.ok) throw new AiTextError(`${who} answered ${res.status}. Try again in a moment.`, 422);
}

let omegaCache: { at: number; models: OmegaModel[] } | null = null;

/** Anthropic's own first, then Singlebyte (the gateway's), then everyone else by owner; API order within a group. */
function orderModels(models: readonly OmegaModel[]): OmegaModel[] {
  const rank = (owner: string) => (owner === 'anthropic' ? 0 : owner === 'singlebyte' ? 1 : 2);
  return models
    .map((model, index) => ({ model, index }))
    .sort((a, b) => {
      const byRank = rank(a.model.owner) - rank(b.model.owner);
      if (byRank !== 0) return byRank;
      if (a.model.owner !== b.model.owner) return a.model.owner < b.model.owner ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ model }) => model);
}

/**
 * The vision-capable models OmegaPlus serves (its `/v1/models` is public),
 * cached 10 minutes. When it does not answer: the last good list, else the
 * built-in one.
 */
export async function listOmegaModels(
  deps: ProviderDeps = {}
): Promise<{ models: OmegaModel[]; source: 'live' | 'cache' | 'fallback' }> {
  const now = (deps.now ?? Date.now)();
  if (omegaCache && now - omegaCache.at < MODELS_TTL_MS) return { models: omegaCache.models, source: 'cache' };
  try {
    const res = await (deps.fetch ?? fetch)(`${OMEGA_BASE_URL}/v1/models`, {
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`OmegaPlus answered ${res.status}.`);
    const body = (await res.json()) as {
      data?: {
        id?: unknown;
        display_name?: unknown;
        owned_by?: unknown;
        capabilities?: { vision?: unknown };
      }[];
    };
    const models = orderModels(
      (body.data ?? [])
        .filter((m) => typeof m.id === 'string' && m.id !== '')
        .map((m) => ({
          id: m.id as string,
          name: typeof m.display_name === 'string' && m.display_name ? m.display_name : (m.id as string),
          owner: typeof m.owned_by === 'string' ? m.owned_by : '',
          vision: m.capabilities?.vision !== false,
        }))
        .filter((m) => m.vision)
    );
    if (models.length === 0) throw new Error('OmegaPlus listed no models.');
    omegaCache = { at: now, models };
    return { models, source: 'live' };
  } catch {
    if (omegaCache) return { models: omegaCache.models, source: 'cache' };
    return { models: orderModels(OMEGA_FALLBACK_MODELS), source: 'fallback' };
  }
}

/** Opus 5.5 where the provider has it; OmegaPlus falls back to the first model on its list. */
export function defaultModelFor(provider: TextProvider, models?: readonly OmegaModel[]): string {
  if (provider === 'anthropic') return DEFAULT_MODEL;
  if (models?.some((m) => m.id === DEFAULT_MODEL)) return DEFAULT_MODEL;
  return models?.[0]?.id ?? 'claude-omega-plus';
}
