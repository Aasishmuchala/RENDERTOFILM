import type Koa from 'koa';

const DEFAULT_LIMIT_BYTES = 1024 * 1024;

/**
 * Reads and parses one JSON request body from the raw stream.
 *
 * This app mounts no body-parsing middleware on purpose: the tRPC adapter
 * hands `ctx.req` to `nodeHTTPRequestHandler` unread, so a global parser
 * would drain the stream before tRPC ever sees it. Raw routes call this
 * instead. Throws (415, 413, 400) rather than returning a sentinel, so a
 * handler can `await readJsonBody(ctx)` and only deal with the happy path.
 */
export async function readJsonBody<T = unknown>(
  ctx: Koa.Context,
  opts: { limit?: number | undefined } = {}
): Promise<T> {
  // `ctx.is('json')` reports no match when the request carries no body at
  // all, so a bodyless POST with a correct header would get 415 blaming the
  // header. Read the declared media type straight off the header instead, and
  // let the empty-body check below produce the 400. Koa's `request.type` is a
  // bare `split(';')[0]`, so normalize it here — media types and their
  // parameters are case-insensitive, and `application/json ; charset=utf-8`
  // is a legal header.
  const mediaType = ctx.request.type.trim().toLowerCase();
  if (mediaType !== 'application/json' && !mediaType.endsWith('+json')) {
    ctx.throw(415, 'expected Content-Type: application/json');
  }

  const limit = opts.limit ?? DEFAULT_LIMIT_BYTES;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of ctx.req) {
    const buf: Buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buf.length;
    if (total > limit) ctx.throw(413, 'request body too large');
    chunks.push(buf);
  }

  const raw = Buffer.concat(chunks).toString('utf-8');
  if (raw.trim() === '') ctx.throw(400, 'expected a JSON request body');

  try {
    return JSON.parse(raw) as T;
  } catch {
    return ctx.throw(400, 'malformed JSON body');
  }
}
