import { type ColourSteps, colourSteps, type CutColour } from './colour.ts';

/**
 * The Edit grade as a 3D LUT (.cube), for a colourist's own tools. `gradePixel`
 * is the graded download's fragment shader (src/client/lib/gradedFilm.ts) for
 * one pixel, with the same clamps in the same order, so the LUT and the film
 * agree. A neutral grade writes the identity.
 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

type Rgb = [number, number, number];

export function gradePixel(steps: ColourSteps, rgb: readonly [number, number, number]): Rgb {
  const c: Rgb = [clamp01(rgb[0] * steps.gain), clamp01(rgb[1] * steps.gain), clamp01(rgb[2] * steps.gain)];
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return c.map((v, i) => {
    let x = clamp01(l + (v - l) * steps.saturate);
    x = clamp01((x - 0.5) * steps.contrast + 0.5);
    x = clamp01(x * steps.highlight);
    x *= steps.balance[i]!;
    return x * (1 - steps.lift) + steps.tint[i]! * steps.lift;
  }) as Rgb;
}

/** A `.cube` of `size`³ samples, red fastest, then green, then blue. */
export function cubeLut(colour: CutColour, title: string, size = 33): string {
  const steps = colourSteps(colour);
  const lines = [
    `TITLE "${title.replace(/"/g, "'")}"`,
    `LUT_3D_SIZE ${size}`,
    'DOMAIN_MIN 0.0 0.0 0.0',
    'DOMAIN_MAX 1.0 1.0 1.0',
  ];
  const last = size - 1;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const input: Rgb = [r / last, g / last, b / last];
        const out = steps ? gradePixel(steps, input) : input;
        lines.push(out.map((v) => v.toFixed(6)).join(' '));
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

/** `render-to-film-<title as a slug>.cube`. */
export function lutFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `render-to-film-${slug || 'grade'}.cube`;
}
