import { VERTICAL_SIZE, type TitleCard } from '../../master.ts';

/**
 * A title card is a black picture with white text, drawn here with the browser's
 * own canvas so it uses the app's typeface. The server only ever receives the
 * PNG, and cuts it into the master like any other cut.
 */

/** A first clip this wide or wider is a 4K film, so its cards are too. */
const UHD_FROM_WIDTH = 3000;

/** Text wraps at this share of the width. */
const WRAP_SHARE = 0.8;

/** Nothing is drawn nearer the edge than this share of the height. */
const SAFE_MARGIN = 0.04;

/** Line pitch, in ems of the line's own size. */
const LINE_HEIGHT = 1.25;

/** How many times a block too tall for the picture is shrunk and rewrapped. */
const FIT_TRIES = 4;

const FALLBACK_FAMILY = 'system-ui, sans-serif';

/** The shapes a card is drawn at: the film's own, and the 9:16 file's. */
export function cardSizes(firstClipWidth: number | undefined): {
  landscape: { width: number; height: number };
  vertical: { width: number; height: number };
} {
  const uhd = firstClipWidth !== undefined && firstClipWidth >= UHD_FROM_WIDTH;
  return {
    landscape: uhd ? { width: 3840, height: 2160 } : { width: 1920, height: 1080 },
    vertical: { width: VERTICAL_SIZE.width, height: VERTICAL_SIZE.height },
  };
}

/** Whole characters (a letter with its accents, an emoji), so a cut never splits one. */
function characters(word: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return Array.from(new Intl.Segmenter().segment(word), (part) => part.segment);
  }
  return Array.from(word);
}

/**
 * Breaks `text` into lines no wider than `maxWidth` by `measure`, between words.
 * A word wider than the line (a URL, a hyphenated slogan, Chinese with no spaces)
 * is cut by characters instead, so no line runs past the picture's edge; only a
 * single character wider than the line is left over it.
 */
export function wrapLines(measure: (s: string) => number, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= maxWidth) {
      line = next;
    } else if (measure(word) <= maxWidth) {
      lines.push(line);
      line = word;
    } else {
      if (line) lines.push(line);
      line = '';
      for (const char of characters(word)) {
        if (line && measure(line + char) > maxWidth) {
          lines.push(line);
          line = '';
        }
        line += char;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

type Context = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** Where each line's middle falls when the block of `count` lines is centred on `anchor`. */
function lineCentres(count: number, anchor: number, size: number): number[] {
  return Array.from({ length: count }, (_, i) => anchor + (i - (count - 1) / 2) * LINE_HEIGHT * size);
}

/** Draws `card` on a black picture of `width` x `height` and answers it as a PNG. */
export async function renderTitleCard(card: TitleCard, width: number, height: number): Promise<Blob> {
  const offscreen = typeof OffscreenCanvas !== 'undefined';
  const canvas = offscreen ? new OffscreenCanvas(width, height) : document.createElement('canvas');
  if (!offscreen) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d') as Context | null;
  if (!ctx) throw new Error('This browser cannot draw the title card.');

  const family =
    (typeof document !== 'undefined' && getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim()) ||
    FALLBACK_FAMILY;
  const subtitle = card.subtitle?.trim() ?? '';

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  /** Sets the face for one block; the spacing is set first, because it changes every measure. */
  const setFace = (weight: number, size: number) => {
    ctx.font = `${weight} ${size}px ${family}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${size * 0.02}px`;
  };
  const wrap = (text: string) => wrapLines((s) => ctx.measureText(s).width, text, width * WRAP_SHARE);

  /** Wraps both blocks at these sizes and works out where every line's middle falls. */
  const place = (titleSize: number, subtitleSize: number) => {
    setFace(600, titleSize);
    const titleLines = wrap(card.text);
    setFace(400, subtitleSize);
    const subtitleLines = wrap(subtitle);
    const titleAt = lineCentres(titleLines.length, height * (subtitle ? 0.46 : 0.5), titleSize);
    let subtitleAt = lineCentres(subtitleLines.length, height * 0.58, subtitleSize);

    // A long title can reach down to the subtitle: the subtitle then moves down to clear it.
    if (titleAt.length && subtitleAt.length) {
      const titleBottom = titleAt[titleAt.length - 1]! + (LINE_HEIGHT * titleSize) / 2;
      const subtitleTop = subtitleAt[0]! - (LINE_HEIGHT * subtitleSize) / 2;
      const clear = titleBottom + titleSize * 0.5 - subtitleTop;
      if (clear > 0) subtitleAt = subtitleAt.map((y) => y + clear);
    }

    const top = (titleAt[0] ?? subtitleAt[0] ?? 0) - (titleAt.length ? titleSize : subtitleSize) * (LINE_HEIGHT / 2);
    const lastSubtitle = subtitleAt[subtitleAt.length - 1];
    const bottom =
      lastSubtitle !== undefined
        ? lastSubtitle + (LINE_HEIGHT * subtitleSize) / 2
        : (titleAt[titleAt.length - 1] ?? 0) + (LINE_HEIGHT * titleSize) / 2;
    return { titleSize, subtitleSize, titleLines, subtitleLines, titleAt, subtitleAt, top, bottom };
  };

  const pinnedTitle = Math.round(height * 0.056);
  const pinnedSubtitle = Math.round(height * 0.026);
  let block = place(pinnedTitle, pinnedSubtitle);

  // Text too tall for the safe area is drawn smaller, both blocks by one ratio; a card that fits keeps its sizes.
  const room = height * (1 - 2 * SAFE_MARGIN);
  let scale = 1;
  for (let tries = 0; tries < FIT_TRIES && block.bottom - block.top > room; tries++) {
    scale *= room / (block.bottom - block.top);
    block = place(Math.max(1, Math.floor(pinnedTitle * scale)), Math.max(1, Math.floor(pinnedSubtitle * scale)));
  }

  // The block fits the safe area by now, so it only has to be moved inside it.
  let shift = 0;
  if (block.bottom > height * (1 - SAFE_MARGIN)) shift = height * (1 - SAFE_MARGIN) - block.bottom;
  if (block.top + shift < height * SAFE_MARGIN) shift = height * SAFE_MARGIN - block.top;

  const draw = (lines: string[], ys: number[], fill: string, weight: number, size: number) => {
    setFace(weight, size);
    ctx.fillStyle = fill;
    lines.forEach((line, i) => ctx.fillText(line, width / 2, ys[i]! + shift));
  };
  draw(block.titleLines, block.titleAt, '#fff', 600, block.titleSize);
  draw(block.subtitleLines, block.subtitleAt, '#e6e6e6', 400, block.subtitleSize);

  if (offscreen) return (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' });
  return new Promise((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The title card could not be saved.'))), 'image/png');
  });
}
