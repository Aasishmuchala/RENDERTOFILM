import { z } from 'zod';

import { GRADE_IDS, type GradeId } from './grades.ts';

/**
 * The Edit tab's built-in colour grade: instant and free, no re-render. The
 * page draws it live over the video on the graphics card (`colourCss`), and
 * a graded download runs the same steps in a shader. Aleph 2.0 grades
 * (src/grades.ts) are the re-render alternative.
 */

/** One cut's built-in grade: a preset at a strength, plus fine adjustments. */
export type CutColour = {
  gradeId: GradeId;
  /** 0–1: how much of the preset to apply. */
  strength: number;
  /** Each −1 to 1, added on top of the preset. */
  exposure: number;
  contrast: number;
  saturation: number;
  warmth: number;
};

export const colourSchema = z.object({
  gradeId: z.enum(GRADE_IDS),
  strength: z.number().min(0).max(1),
  exposure: z.number().min(-1).max(1),
  contrast: z.number().min(-1).max(1),
  saturation: z.number().min(-1).max(1),
  warmth: z.number().min(-1).max(1),
});

export const NEUTRAL_COLOUR: CutColour = {
  gradeId: 'none',
  strength: 1,
  exposure: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
};

type Preset = {
  exposure?: number;
  contrast?: number;
  saturation?: number;
  warmth?: number;
  /** Lifted blacks: how far the shadows lift, toward `tint` (r, g, b 0–1). */
  lift?: number;
  tint?: readonly [number, number, number];
};

/** Each preset in src/grades.ts as amounts on the steps below. */
const PRESETS: Record<GradeId, Preset> = {
  none: {},
  'clean-daylight': { exposure: 0.03, contrast: 0.06, saturation: -0.05, warmth: -0.12 },
  'warm-luxury': { exposure: 0.02, contrast: -0.04, saturation: 0.06, warmth: 0.45, lift: 0.04, tint: [0.45, 0.28, 0.15] },
  'nordic-minimal': { exposure: 0.05, contrast: -0.16, saturation: -0.35, warmth: -0.15, lift: 0.08, tint: [0.85, 0.9, 0.95] },
  'teal-amber': { contrast: 0.1, saturation: 0.1, warmth: 0.35, lift: 0.08, tint: [0.05, 0.42, 0.48] },
  'film-print': { contrast: 0.16, saturation: -0.08, warmth: 0.15, lift: 0.035, tint: [0.4, 0.3, 0.22] },
  'blue-hour-luxe': { exposure: -0.05, contrast: 0.1, saturation: 0.05, warmth: -0.5, lift: 0.06, tint: [0.1, 0.2, 0.55] },
  'golden-glow': { exposure: 0.06, contrast: -0.08, saturation: 0.1, warmth: 0.7, lift: 0.04, tint: [0.6, 0.42, 0.2] },
  'moody-contrast': { exposure: -0.12, contrast: 0.28, saturation: -0.15, warmth: 0.05 },
  'bleach-bypass': { exposure: 0.02, contrast: 0.36, saturation: -0.55 },
  'soft-pastel': { exposure: 0.05, contrast: -0.25, saturation: -0.15, warmth: 0.1, lift: 0.14, tint: [0.92, 0.84, 0.88] },
  monochrome: { contrast: 0.15, saturation: -1 },
};

/**
 * A grade as the steps the browser runs, in order: a CSS filter (exposure,
 * saturation, contrast, then a highlight gain), a multiply layer (white
 * balance) and a normal layer at `lift` opacity (lifted, tinted blacks).
 * The live preview stacks exactly these; the graded download runs the same
 * steps in a shader, so what plays is what downloads.
 */
export type ColourSteps = {
  gain: number;
  saturate: number;
  contrast: number;
  /** Applied after contrast, so the white balance below can stay at or under 1. */
  highlight: number;
  /** Per-channel multiply, each 0–1. */
  balance: readonly [number, number, number];
  lift: number;
  tint: readonly [number, number, number];
};

/** The steps for a grade, or null when it changes nothing. */
export function colourSteps(c: CutColour | null | undefined): ColourSteps | null {
  if (!c) return null;
  const p = PRESETS[c.gradeId] ?? {};
  const s = Math.min(1, Math.max(0, c.strength));
  const exposure = (p.exposure ?? 0) * s + c.exposure * 0.35;
  const contrast = Math.max(-0.9, (p.contrast ?? 0) * s + c.contrast * 0.5);
  const saturation = Math.max(-1, (p.saturation ?? 0) * s + c.saturation);
  const warmth = Math.max(-1, Math.min(1, (p.warmth ?? 0) * s + c.warmth * 0.6));
  const lift = (p.lift ?? 0) * s;
  if ([exposure, contrast, saturation, warmth, lift].every((v) => Math.abs(v) < 0.002)) return null;
  const wb = [1 + 0.2 * warmth, 1 + 0.03 * warmth, 1 - 0.2 * warmth];
  const top = Math.max(...wb);
  return {
    gain: 1 + exposure,
    saturate: 1 + saturation,
    contrast: 1 + contrast,
    highlight: top,
    balance: [wb[0]! / top, wb[1]! / top, wb[2]! / top],
    lift,
    tint: p.tint ?? [0.5, 0.5, 0.5],
  };
}

export function isNeutral(c: CutColour | null | undefined): boolean {
  return colourSteps(c) === null;
}

const n = (v: number) => Number(v.toFixed(3));
const rgb = (c: readonly number[]) => `rgb(${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(' ')})`;

/** The steps as CSS: the element's `filter`, and the two layers drawn over it. */
export function colourCss(steps: ColourSteps): {
  filter: string;
  balance: string | null;
  lift: { color: string; opacity: number } | null;
} {
  const fx = [
    steps.gain !== 1 && `brightness(${n(steps.gain)})`,
    steps.saturate !== 1 && `saturate(${n(steps.saturate)})`,
    steps.contrast !== 1 && `contrast(${n(steps.contrast)})`,
    steps.highlight !== 1 && `brightness(${n(steps.highlight)})`,
  ].filter(Boolean);
  return {
    filter: fx.length ? fx.join(' ') : 'none',
    balance: steps.balance.every((v) => v > 0.999) ? null : rgb(steps.balance),
    lift: steps.lift > 0 ? { color: rgb(steps.tint), opacity: n(steps.lift) } : null,
  };
}

/**
 * Where each cut sits in an exported film, as end times in seconds. Fades
 * overlap neighbouring cuts, so the grade switches halfway through a fade.
 * `actual` (the film's measured length) absorbs any rounding drift.
 */
export function cutEnds(
  seconds: readonly number[],
  transition: 'hard' | 'fade',
  fade: number,
  actual: number
): number[] {
  const sum = seconds.reduce((a, b) => a + b, 0);
  const overlapped = sum - Math.max(0, seconds.length - 1) * fade;
  const overlaps = transition === 'fade' && Math.abs(actual - overlapped) < Math.abs(actual - sum);
  const model = overlaps ? overlapped : sum;
  const k = model > 0 && actual > 0 ? actual / model : 1;
  let cum = 0;
  return seconds.map((s, i) => {
    cum += s;
    const shift = overlaps ? i * fade + (i < seconds.length - 1 ? fade / 2 : 0) : 0;
    return (cum - shift) * k;
  });
}
