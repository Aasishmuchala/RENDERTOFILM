/**
 * The marked area on a source render, kept as a list of strokes in
 * normalised coordinates (0–1 of the image's width and height) so the same
 * mark draws at any size: the small preview, the zoomable editor and the
 * exported mask.
 */
export type MaskStroke =
  | {
      type: 'brush';
      erase: boolean;
      /** Brush diameter as a fraction of the image width. */
      size: number;
      points: [number, number][];
    }
  | { type: 'box'; erase: boolean; x0: number; y0: number; x1: number; y1: number }
  | { type: 'clear' };

/** Longest edge of the exported mask; the server scales it to the render. */
const MASK_EDGE = 2048;

export function maskSize(width: number, height: number) {
  const scale = Math.min(1, MASK_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Draw `strokes` onto a canvas of any size, marked area in `color`. */
export function paintStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: readonly MaskStroke[],
  color: string
) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const s of strokes) paintStroke(ctx, s, color);
}

/** Draw one stroke on top of what the canvas already holds. */
export function paintStroke(ctx: CanvasRenderingContext2D, s: MaskStroke, color: string) {
  const { width: w, height: h } = ctx.canvas;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.type === 'clear') {
    ctx.clearRect(0, 0, w, h);
  } else if (s.type === 'box') {
    ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
    const x = Math.min(s.x0, s.x1) * w;
    const y = Math.min(s.y0, s.y1) * h;
    ctx.fillRect(x, y, Math.abs(s.x1 - s.x0) * w, Math.abs(s.y1 - s.y0) * h);
  } else {
    ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
    const r = (s.size * w) / 2;
    const [first, ...rest] = s.points;
    if (first && rest.length === 0) {
      ctx.beginPath();
      ctx.arc(first[0] * w, first[1] * h, r, 0, Math.PI * 2);
      ctx.fill();
    } else if (first) {
      ctx.lineWidth = r * 2;
      ctx.beginPath();
      ctx.moveTo(first[0] * w, first[1] * h);
      for (const [x, y] of rest) ctx.lineTo(x * w, y * h);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Share of the image the mark covers, 0–1, measured on a small copy. */
export function maskCoverage(
  strokes: readonly MaskStroke[],
  width: number,
  height: number
): number {
  if (strokes.length === 0) return 0;
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = Math.max(1, Math.round((160 * height) / width));
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  paintStrokes(ctx, strokes, '#fff');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let on = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]! >= 128) on++;
  return on / (canvas.width * canvas.height);
}

/**
 * The mark as a black-and-white PNG — white is the area that may change —
 * at the render's shape, for `POST /api/mask`.
 */
export async function exportMaskPng(
  strokes: readonly MaskStroke[],
  width: number,
  height: number
): Promise<Blob> {
  const size = maskSize(width, height);
  const marks = document.createElement('canvas');
  marks.width = size.width;
  marks.height = size.height;
  paintStrokes(marks.getContext('2d')!, strokes, '#fff');
  const out = document.createElement('canvas');
  out.width = size.width;
  out.height = size.height;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.drawImage(marks, 0, 0);
  return new Promise((resolve, reject) =>
    out.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('The mark could not be saved. Try again.'))),
      'image/png'
    )
  );
}
