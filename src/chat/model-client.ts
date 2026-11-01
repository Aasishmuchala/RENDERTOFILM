// The real ModelClient: one streaming Messages request through the Anthropic
// SDK, mapped to ModelEvents. RTF_ANTHROPIC_BASE_URL points it at the fake
// server in tests. A key appears only in the SDK client and its headers, never
// in an event or a log line.
import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';

import type { FinalMessage, ModelClient, ModelEvent, ModelRequest, StopReason, ToolDef, Usage } from './domain.ts';

/** Sent only to Anthropic itself: a custom base URL gets what the request names and no more. */
const DIRECT_BETAS = ['thinking-display-updates-2026-08-18', 'server-side-fallback-2026-07-01'];
const CACHE_1H = { type: 'ephemeral', ttl: '1h' } as const;
const REQUEST_TIMEOUT_MS = 5 * 60_000;

const byName = (a: ToolDef, b: ToolDef) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** One cache breakpoint, at the end of the list; everything before it is cached with it. */
function cacheLast<T extends object>(blocks: T[]): T[] {
  return blocks.map((block, index) => (index === blocks.length - 1 ? { ...block, cache_control: CACHE_1H } : block));
}

function requestBody(req: ModelRequest, direct: boolean): BetaMessageStreamParams {
  const betas = [...new Set([...(direct ? DIRECT_BETAS : []), ...req.betas])];
  const tools = [...req.tools]
    .sort(byName)
    .map(({ name, description, input_schema }) => ({ name, description, input_schema, strict: true }));
  return {
    model: req.model,
    max_tokens: req.maxTokens,
    system: cacheLast(req.system),
    tools: cacheLast(tools) as BetaMessageStreamParams['tools'],
    tool_choice: { type: 'auto' },
    messages: req.messages.map(({ role, content }) => ({ role, content })) as BetaMessageStreamParams['messages'],
    thinking: { type: 'adaptive', display: 'updates' },
    output_config: { effort: req.effort },
    ...(betas.length > 0 ? { betas } : {}),
    ...(direct ? { fallbacks: 'default' as const } : {}),
  };
}

function toModelEvent(event: BetaRawMessageStreamEvent): ModelEvent | null {
  if (event.type === 'content_block_delta') {
    if (event.delta.type === 'text_delta') return { type: 'text_delta', text: event.delta.text };
    if (event.delta.type === 'thinking_delta') return { type: 'thinking_update', text: event.delta.thinking };
  }
  if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
    return { type: 'tool_use_start', id: event.content_block.id, name: event.content_block.name };
  }
  return null;
}

/** Belt and braces, as in src/ai-text/providers.ts: an SDK or network error never carries the key out. */
const redact = (message: string, apiKey: string) =>
  apiKey.length >= 4 ? message.split(apiKey).join('[key]') : message;

/** The API's own sentence when it sent one: the SDK's message wraps the whole JSON body. */
function errorEvent(err: unknown, apiKey: string): ModelEvent {
  const api = err instanceof Anthropic.APIError ? err : undefined;
  const sentence = (api?.error as { error?: { message?: unknown } } | undefined)?.error?.message;
  const message = typeof sentence === 'string' ? sentence : err instanceof Error ? err.message : String(err);
  return {
    type: 'error',
    error: {
      ...(api?.status ? { status: api.status } : {}),
      // The SDK copies this from the body unchecked: behind a custom base URL it can be anything.
      type: redact(typeof api?.type === 'string' ? api.type : 'api_error', apiKey),
      message: redact(message, apiKey),
    },
  };
}

/** `stream` never throws: a failure is one `error` event, and an abort just ends the iterable. */
export function createAnthropicClient(opts: { apiKey: string; baseURL?: string }): ModelClient {
  const baseURL = opts.baseURL || process.env['RTF_ANTHROPIC_BASE_URL'] || undefined;
  const client = new Anthropic({
    apiKey: opts.apiKey,
    // The SDK sends only `Authorization: Bearer`; the fake server, like OmegaPlus, reads `x-api-key`.
    defaultHeaders: { 'x-api-key': opts.apiKey },
    maxRetries: 2,
    timeout: REQUEST_TIMEOUT_MS,
    // ANTHROPIC_LOG=debug would print request bodies; a failure reaches the caller as an event anyway.
    logLevel: 'off',
    ...(baseURL ? { baseURL } : {}),
  });
  return {
    async *stream(req, signal) {
      try {
        const stream = client.beta.messages.stream(requestBody(req, !baseURL), { signal });
        for await (const event of stream) {
          const mapped = toModelEvent(event);
          if (mapped) yield mapped;
        }
        const final = await stream.finalMessage();
        const message: FinalMessage = {
          content: final.content,
          stop_reason: final.stop_reason as StopReason | null,
          usage: final.usage as unknown as Usage,
          ...(stream.request_id ? { requestId: stream.request_id } : {}),
        };
        yield { type: 'message', message };
      } catch (err) {
        // The caller holds the signal, so it knows why the stream ended.
        if (!signal.aborted) yield errorEvent(err, opts.apiKey);
      }
    },
  };
}
