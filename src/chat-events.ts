// A Thread's Events as Server-Sent Events: GET /api/chat/events?thread=<id>. This
// only shortens the latency: the page always works on `chat.thread` polling, so a
// gateway that buffers the stream costs nothing. The store is the truth, so there
// is no in-process bus; a connection polls it.
import type Koa from 'koa';

import { API_PREFIX } from './api-routes.ts';
import type { Event, Store } from './chat/domain.ts';
import { createStore } from './chat/store.ts';
import { ownerKey } from './library.ts';

const EVENTS_PATH = `${API_PREFIX}/chat/events`;
const POLL_MS = 1_000;
const HEARTBEAT_MS = 25_000;

const HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

// What a stream may carry. Model text, error sentences and a Run's label (a failed
// Run's is its error) are not among it: the page reads those from `chat.thread`.
const ID_FIELD = /(?:Id|Ids|Key|Keys)$/;
const STATUS_FIELDS = new Set(['state', 'status', 'kind', 'name', 'class', 'outputs']);

function streamValue(value: unknown): unknown {
  if (typeof value === 'string') return value.includes('://') ? undefined : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(streamValue).filter((v) => v !== undefined);
  if (value && typeof value === 'object') return streamPayload(value as Record<string, unknown>);
  return undefined;
}

/** Ids, keys and status, by an allow-list so a new payload field stays off the stream until named here. */
function streamPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const kept = Object.entries(payload)
    .filter(([field]) => ID_FIELD.test(field) || STATUS_FIELDS.has(field))
    .map(([field, value]) => [field, streamValue(value)]);
  return Object.fromEntries(kept.filter(([, value]) => value !== undefined));
}

const frame = (e: Event) =>
  `id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(streamPayload(e.payload))}\n\n`;

export function mountChatEvents(app: Koa, store: Store = createStore()) {
  // How to stop the one live connection of each Owner and Thread.
  const live = new Map<string, () => void>();

  app.use(async (ctx, next) => {
    if (ctx.method !== 'GET' || ctx.path !== EVENTS_PATH) {
      await next();
      return;
    }
    const owner = await ownerKey(ctx.req).catch(() => null);
    const threadId = String(ctx.query['thread'] ?? '');
    if (!owner || !(await store.thread(owner, threadId))) {
      ctx.status = 404;
      ctx.body = '';
      return;
    }
    // A client that left during those reads will send no `close` to stop on.
    if (ctx.res.destroyed) return;

    ctx.respond = false;
    const { res } = ctx;
    const slot = `${owner}/${threadId}`;
    let seq = Number(ctx.get('Last-Event-ID') || ctx.query['since']) || 0;
    let reading = false;
    let stopped = false;

    const poll = async () => {
      if (reading) return;
      reading = true;
      try {
        for (const event of await store.eventsSince(owner, threadId, seq)) {
          if (stopped) return;
          res.write(frame(event));
          seq = event.seq;
        }
      } catch {
        // A failed read is tried again on the next poll; the page's own polling carries on.
      } finally {
        reading = false;
      }
    };

    const poller = setInterval(() => void poll(), POLL_MS);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(poller);
      clearInterval(heartbeat);
      if (live.get(slot) === stop) live.delete(slot);
      res.end();
    };

    live.get(slot)?.();
    live.set(slot, stop);
    // `res`, not `req`: since Node 16 a request closes once its body is read, not when the client goes.
    res.once('close', stop);
    res.writeHead(200, HEADERS);
    res.write(': hello\n\n');
    await poll();
  });
}
