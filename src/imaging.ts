import sharp from 'sharp';

/**
 * Shared limits for every image the server decodes (thumbnails, big-screen
 * copies, marked-edit composites). A full render decodes to hundreds of MB of
 * raw pixels, so they take turns: one at a time, with libvips' own cache off,
 * keeps the pod well inside its memory instead of being killed mid-request.
 */
sharp.cache(false);
sharp.concurrency(1);

/** Pixels sharp will decode for a resize (a 4x upscale of a 2.5K still fits). */
export const MAX_INPUT_PIXELS = 100_000_000;
/** A composite holds several full-size copies at once, so its cap is lower (about 8K x 5K). */
export const MAX_COMPOSITE_PIXELS = 40_000_000;
/** A source past this is not worth pulling into the pod. */
const MAX_SOURCE_BYTES = 60 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_PARALLEL = 1;

let running = 0;
const queue: (() => void)[] = [];

/** Runs `work` when no other image job is running. */
export async function imageSlot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => queue.push(resolve));
  running++;
  try {
    return await work();
  } finally {
    running--;
    queue.shift()?.();
  }
}

/**
 * Downloads an image, refusing one that is too large or too slow. `get` is
 * `safeFetch` (src/safe-fetch.ts) for an address a visitor supplied.
 */
export async function readCapped(
  url: string,
  what = 'image',
  get: (url: string, init: { signal: AbortSignal }) => Promise<Response> = fetch
): Promise<Buffer> {
  const res = await get(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok || !res.body) throw new Error(`Could not load the ${what} (${res.status}).`);
  const tooLarge = () => new Error(`The ${what} is too large to process.`);
  if (Number(res.headers.get('content-length')) > MAX_SOURCE_BYTES) {
    void res.body.cancel();
    throw tooLarge();
  }
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SOURCE_BYTES) {
      void reader.cancel();
      throw tooLarge();
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export { sharp };
