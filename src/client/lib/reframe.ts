/**
 * A window on the render: the part of it a still is made from, in normalised
 * coordinates (0–1 of the image's width and height). The window only ever
 * crops. It stays inside the picture, so what it holds is always something the
 * render really shows.
 */
export type Window = { x: number; y: number; w: number; h: number };

/** The tightest push-in the stage offers. */
export const MAX_ZOOM = 6;

/** How near an edge the window counts as touching it. */
const EDGE = 1e-6;

/** The shortest side a window cuts, in pixels (a smaller source gives what it has). */
const MIN_SIDE = 64;

/** Past this many pixels the frame is a JPEG: a PNG that size is too heavy to carry. */
const PNG_AREA = 4096 * 4096;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * The window of shape `aspect` (width / height; null is the source's own) at
 * `zoom` (1 to {@link MAX_ZOOM}), with its centre as near `cx`, `cy` as the
 * picture allows. At zoom 1 it is the largest window of that shape.
 */
export function fitWindow(srcW: number, srcH: number, aspect: number | null, zoom: number, cx: number, cy: number): Window {
  const z = clamp(zoom, 1, MAX_ZOOM);
  const shapeW = aspect === null ? srcW : aspect * srcH;
  const w = Math.min(1, shapeW / srcW) / z;
  const h = Math.min(1, srcW / shapeW) / z;
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
}

/** Which edges of the render the window touches: nothing exists beyond those. */
export function atEdge(win: Window): ('left' | 'right' | 'top' | 'bottom')[] {
  const near = (a: number, b: number) => Math.abs(a - b) <= EDGE;
  const edges: ('left' | 'right' | 'top' | 'bottom')[] = [];
  if (near(win.x, 0)) edges.push('left');
  if (near(win.x + win.w, 1)) edges.push('right');
  if (near(win.y, 0)) edges.push('top');
  if (near(win.y + win.h, 1)) edges.push('bottom');
  return edges;
}

/** One side of the crop: whole pixels, an even length, inside the source. */
function cut(start: number, length: number, size: number): [from: number, length: number] {
  const even = (n: number) => n - (n % 2);
  const side = Math.min(even(size), Math.max(MIN_SIDE, even(Math.round(length * size))));
  return [clamp(Math.round(start * size), 0, size - side), side];
}

/** The window in the source's own pixels, ready to cut. */
export function windowPixels(win: Window, srcW: number, srcH: number): { left: number; top: number; width: number; height: number } {
  const [left, width] = cut(win.x, win.w, srcW);
  const [top, height] = cut(win.y, win.h, srcH);
  return { left, top, width, height };
}

/** Cut `rect` out of the render: every pixel of the result is one the render already has. */
export async function cropToBlob(image: ImageBitmap, rect: ReturnType<typeof windowPixels>): Promise<Blob> {
  const { left, top, width, height } = rect;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The frame could not be cut. Try again.');
  const png = width * height <= PNG_AREA;
  if (!png) {
    // A JPEG has no alpha: white, as the upload treats a transparent render.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(image, left, top, width, height, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('The frame could not be cut. Try again.'))),
      png ? 'image/png' : 'image/jpeg',
      png ? undefined : 0.95
    )
  );
}
