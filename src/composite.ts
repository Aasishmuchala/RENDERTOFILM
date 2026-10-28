
import { presignGet } from '@runway/bay/storage';
import { imageSlot, MAX_COMPOSITE_PIXELS, MAX_INPUT_PIXELS, readCapped, sharp } from './imaging.ts';
import { patchStill, type Still } from './library.ts';
import { getObject, putObject } from './storage.ts';

/**
 * Marked edits. The visitor paints the part of the render that may change;
 * the mask (white = may change) is stored under `masks/<owner>/`. The model
 * is asked to change only that area, and then — whatever it did — the still
 * is rebuilt here from the render's own pixels everywhere outside the mark,
 * so the rest of the frame is the render byte for byte. The soft edge that
 * blends the two lies wholly inside the mark.
 */

export function maskPrefix(owner: string): string {
  return `masks/${owner}/`;
}

function compositeKey(owner: string, stillId: string): string {
  return `composites/${owner}/${stillId}.png`;
}

/**
 * A stored copy of the render a marked edit was made from. The Runway upload
 * behind `Still.sourceUrl` expires in a day or two; the composite must be
 * rebuildable for as long as the still is in the library.
 */
export function renderKeyFor(owner: string, id: string, ext: string): string {
  return `renders/${owner}/${id}.${ext}`;
}

/** A stored mask, as a hard 0/255 single-channel bitmap at `width`×`height`. */
async function hardMask(maskKey: string, width: number, height: number) {
  const png = await getObject(maskKey);
  if (!png) {
    throw new Error('The marked area for this still is missing. Mark it again and make a new take.');
  }
  const { data, info } = await sharp(png)
    .resize(width, height, { fit: 'fill', kernel: 'nearest' })
    .removeAlpha()
    .extractChannel(0)
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return singleChannel(data, info.channels);
}

function singleChannel(data: Buffer, channels: number): Buffer {
  if (channels === 1) return data;
  const out = Buffer.alloc(data.length / channels);
  for (let i = 0; i < out.length; i++) out[i] = data[i * channels]!;
  return out;
}

/**
 * Where the mark sits, in words the model can use ("the lower left of the
 * frame, about 12% of it"), or `null` when the mask is empty.
 */
export async function describeMask(maskKey: string): Promise<{ region: string; coverage: number } | null> {
  const size = 200;
  const mask = await hardMask(maskKey, size, size);
  let on = 0;
  let x0 = size;
  let y0 = size;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (mask[y * size + x]! < 128) continue;
      on++;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (on === 0) return null;
  const coverage = on / (size * size);
  const cx = (x0 + x1) / 2 / size;
  const cy = (y0 + y1) / 2 / size;
  const v = cy < 0.36 ? 'upper' : cy > 0.64 ? 'lower' : '';
  const h = cx < 0.36 ? 'left' : cx > 0.64 ? 'right' : '';
  const where = v || h ? `${[v, h].filter(Boolean).join(' ')} part` : 'centre';
  const pct = (n: number) => Math.round(n * 100);
  const region = `the ${where} of the frame, spanning from ${pct(x0 / size)}% to ${pct((x1 + 1) / size)}% across and ${pct(y0 / size)}% to ${pct((y1 + 1) / size)}% down, about ${Math.max(1, pct(coverage))}% of the image`;
  return { region, coverage };
}

/**
 * Blend weight per pixel, 0–1: 0 everywhere outside the mark, rising to 1
 * over `feather` pixels inside its edge (a chamfer distance to the nearest
 * unmarked pixel), so the seam is soft but sits wholly inside the mark.
 * A frame edge counts as inside: a mark touching it stays full strength.
 */
function innerFeather(hard: Buffer, width: number, height: number, feather: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(width * height);
  for (let i = 0; i < d.length; i++) d[i] = hard[i]! >= 128 ? INF : 0;
  const D = 1;
  const DD = Math.SQRT2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (d[i] === 0) continue;
      let v = d[i]!;
      if (x > 0) v = Math.min(v, d[i - 1]! + D);
      if (y > 0) {
        v = Math.min(v, d[i - width]! + D);
        if (x > 0) v = Math.min(v, d[i - width - 1]! + DD);
        if (x < width - 1) v = Math.min(v, d[i - width + 1]! + DD);
      }
      d[i] = v;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (d[i] === 0) continue;
      let v = d[i]!;
      if (x < width - 1) v = Math.min(v, d[i + 1]! + D);
      if (y < height - 1) {
        v = Math.min(v, d[i + width]! + D);
        if (x < width - 1) v = Math.min(v, d[i + width + 1]! + DD);
        if (x > 0) v = Math.min(v, d[i + width - 1]! + DD);
      }
      d[i] = v;
    }
  }
  for (let i = 0; i < d.length; i++) {
    const t = Math.min(1, d[i]! / feather);
    // Smoothstep, so the ramp has no visible start or end.
    d[i] = t * t * (3 - 2 * t);
  }
  return d;
}

/** The render's bytes: our stored copy, else the (expiring) upload. */
async function loadRender(still: Still): Promise<Buffer> {
  if (still.renderKey) {
    const stored = await getObject(still.renderKey);
    if (stored) return Buffer.from(stored);
  }
  return readCapped(still.sourceUrl, 'original render');
}

/**
 * The render with the model's result showing through the mark only, as a
 * PNG at the render's own size.
 */
async function composite(still: Still, resultUrl: string, maskKey: string): Promise<Buffer> {
  const [renderBytes, resultBytes] = await Promise.all([
    loadRender(still),
    readCapped(resultUrl, 'generated still'),
  ]);
  const render = await sharp(renderBytes, { limitInputPixels: MAX_COMPOSITE_PIXELS })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = render.info;
  const result = await sharp(resultBytes, { limitInputPixels: MAX_INPUT_PIXELS })
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (result.info.channels !== channels) {
    throw new Error('The generated still came back in an unexpected format.');
  }
  const hard = await hardMask(maskKey, width, height);
  const feather = Math.max(3, Math.round(Math.max(width, height) / 320));
  const alpha = innerFeather(hard, width, height, feather);

  const out = Buffer.from(render.data);
  const px = width * height;
  for (let i = 0; i < px; i++) {
    // Outside the mark (weight 0): the render's own bytes, untouched.
    const a = alpha[i]!;
    if (a === 0) continue;
    const o = i * channels;
    for (let c = 0; c < channels; c++) {
      out[o + c] = Math.round(render.data[o + c]! * (1 - a) + result.data[o + c]! * a);
    }
  }
  return sharp(out, { raw: { width, height, channels } }).png({ compressionLevel: 6 }).toBuffer();
}

/**
 * The stored key of a marked still's composite, building it the first time.
 * `resultUrl` is the finished task's artifact. Idempotent: two polls racing
 * write the same bytes to the same key.
 */
export function ensureComposite(owner: string, still: Still, resultUrl: string): Promise<string> {
  if (still.compositeKey) return Promise.resolve(still.compositeKey);
  if (!still.maskKey) return Promise.reject(new Error('This still has no marked area.'));
  // Many requests for one still share a single build.
  const running = inFlight.get(still.id);
  if (running) return running;
  const build = buildComposite(owner, still, resultUrl).finally(() => {
    inFlight.delete(still.id);
  });
  inFlight.set(still.id, build);
  return build;
}

const inFlight = new Map<string, Promise<string>>();

async function buildComposite(owner: string, still: Still, resultUrl: string): Promise<string> {
  const key = compositeKey(owner, still.id);
  // Full-size raw pixels: one composite at a time, sharing the image slot.
  const png = await imageSlot(() => composite(still, resultUrl, still.maskKey!));
  await putObject(key, png, { contentType: 'image/png' });
  await patchStill(owner, still.id, () => ({ compositeKey: key }));
  return key;
}

/** A short-lived browser URL for a stored composite. */
export function compositeUrl(key: string): Promise<string> {
  return presignGet(key, { expiresIn: 3000, contentType: 'image/png' });
}

/** Readable copy for a composite that could not be built. */
export function compositeError(err: unknown): string {
  const detail = err instanceof Error ? err.message : '';
  return `The take finished, but the untouched area could not be restored from your render${detail ? ` (${detail.replace(/\.$/, '')})` : ''}. Make another take; the unmasked result is never shown on its own.`;
}
