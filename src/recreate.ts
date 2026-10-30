/**
 * Recreate in 4K (the Video tab's second tab, src/recreate-api.ts): the routes
 * on offer, the length and price guide, the one prompt both routes send and
 * the captions of the clips it makes. Pure, so the server, the client and
 * .router/recreate-prompt.ts all read the same numbers.
 */
import type { VideoModelId } from './models.ts';

export const RECREATE_ROUTES = [
  {
    id: 'kling-upscale',
    name: 'Kling 4.0, then 4K upscale',
    hint: 'Two steps: a 1080p shot that follows the reference, then a 4K upscale. About 24 credits for 5 seconds.',
    model: 'kling-4-0',
    resolution: '1080p',
    steps: 2,
  },
  {
    id: 'seedance-4k',
    name: 'Seedance 2.0 native 4K',
    hint: 'One step, shot at 4K. About 110 credits for 5 seconds.',
    model: 'seedance-2',
    resolution: '4k',
    steps: 1,
  },
] as const satisfies readonly {
  id: string;
  name: string;
  hint: string;
  model: VideoModelId;
  resolution: string;
  steps: 1 | 2;
}[];

export type RecreateRouteId = (typeof RECREATE_ROUTES)[number]['id'];

export const RECREATE_ROUTE_IDS = RECREATE_ROUTES.map((r) => r.id) as [
  RecreateRouteId,
  ...RecreateRouteId[],
];

/**
 * The routes a new recreation may take: native 4K only. The user ruled out
 * any upscale (2026-10-29), so `kling-upscale` stays defined only so older
 * clips still read and finish.
 */
export const OFFERED_RECREATE_ROUTES = RECREATE_ROUTES.filter((r) => r.steps === 1);

export const DEFAULT_RECREATE_ROUTE: RecreateRouteId = 'seedance-4k';

export function recreateRoute(id: RecreateRouteId): (typeof RECREATE_ROUTES)[number] {
  return RECREATE_ROUTES.find((r) => r.id === id) ?? recreateRoute(DEFAULT_RECREATE_ROUTE);
}

/** Longest director's note, in characters. */
export const RECREATE_NOTE_MAX = 600;

/**
 * Whole seconds the route accepts for a reference of `referenceSeconds`:
 * unknown or not positive reads as 5; else rounded and clamped to what the
 * route's model takes (Kling 4.0 3..15, Seedance 2.0 4..15).
 */
export function recreateSeconds(
  route: RecreateRouteId,
  referenceSeconds: number | undefined
): number {
  if (referenceSeconds === undefined || !Number.isFinite(referenceSeconds) || referenceSeconds <= 0) return 5;
  const min = route === 'kling-upscale' ? 3 : 4;
  return Math.min(15, Math.max(min, Math.round(referenceSeconds)));
}

/** Today's Higgsfield quotes: Kling 4.0 at 1080p is 4 credits a second, plus 4 for the 4K upscale; Seedance 2.0 at 4K is 22 a second. A guide only: Runway's own price differs. */
export function estimateRecreateCredits(route: RecreateRouteId, seconds: number): number {
  return route === 'kling-upscale' ? 4 * seconds + 4 : 22 * seconds;
}

/** One paragraph for both routes: the reference video is the direction, the first image is the scene. */
export const RECREATE_PROMPT = [
  'Recreate the attached reference video shot for shot, as one continuous take of the same length.',
  'Repeat its camera move exactly: the same path, direction, speed, timing and framing changes, from the first frame to the last.',
  'Repeat the same action and blocking: whatever moves in the reference moves here in the same way and at the same moment; whatever is still stays still.',
  'The first attached image is the first frame and the whole truth of the scene: its look, light, colour, materials, planting and people, at full 4K detail, and every frame keeps that scene and that detail.',
  'Nothing is added, nothing is removed, no cuts, no text, no titles, no watermark.',
].join(' ');

/** The recreate prompt, with the person's optional note after it. */
export function buildRecreatePrompt(note: string): string {
  const n = note.trim();
  return n ? `${RECREATE_PROMPT} Director's note: ${n}` : RECREATE_PROMPT;
}

/** Caption for a recreate clip (used by VideoPage.clipLabel, LibraryPage.clipTitle, edit-api clipLabel). */
export function recreateTitle(r: { route: RecreateRouteId; step: 1 | 2 }): string {
  if (r.route === 'seedance-4k') return 'Recreated in 4K from a reference clip, Seedance 2.0';
  return r.step === 2
    ? 'Recreated in 4K from a reference clip, Kling 4.0 upscaled'
    : 'Recreated from a reference clip, Kling 4.0 at 1080p';
}
