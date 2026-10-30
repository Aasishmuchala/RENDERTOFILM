import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { createTextTask, textTaskSnapshot } from './ai-text.ts';
import {
  DEFAULT_DIRECTOR_LENS,
  DIRECTION_DOCTRINE,
  DIRECTOR_LENS_IDS,
  type DirectorLensId,
  lensBlock,
} from './direction.ts';
import { type Library, ownerKey, readLibrary, type Still, type TaskState, updateLibrary } from './library.ts';
import {
  buildCastSheetPrompt,
  buildDevelopPrompt,
  buildLifestylePrompt,
  buildPass2Prompt,
  CAST_ROLE_IDS,
  CAST_ROLES,
  CAST_SHEET_MODEL,
  type CastRoleId,
  type Chapter,
  CHAPTER_IDS,
  chapterById,
  CHAPTERS,
  type ChapterId,
  DEFAULT_HERITAGE,
  DEPTH_IDS,
  DEPTH_PRESETS,
  type DepthId,
  FOCUS_IDS,
  FOCUS_TARGETS,
  type FocusId,
  type FrameCamera,
  frameCamera,
  type FrameLighting,
  frameLighting,
  GRAMMAR_IDS,
  grammarById,
  GRAMMARS,
  type GrammarId,
  LIGHTING_PRESET_IDS,
  LIGHTING_PRESETS,
  lightingPresetById,
  type LightingPresetId,
  MOMENT_IDS,
  type MomentId,
  MOMENTS,
  SUN_POSITION_IDS,
  SUN_POSITIONS,
  type SunPositionId,
} from './lifestyle.ts';
import { ETHNICITIES, ETHNICITY_IDS, type EthnicityId } from './looks.ts';
import {
  defaultImageResolution,
  IMAGE_MODEL_IDS,
  type ImageModelId,
  imageModelName,
  imageModelPromptLimit,
  imageModelTakesCastSheet,
  imageResolutionName,
  imageResolutions,
} from './models.ts';
import { submitStill } from './still-submit.ts';
import { documentStore } from './storage.ts';
import { finishedUrl, logRejection, type RunwayCtx, settled, snapError, toTrpcError } from './task-helpers.ts';
import { router, signedInProcedure } from './trpc.ts';

/**
 * The Lifestyle tab: upload every render of a project, and Claude plans each
 * one as a frame of a residential lifestyle film (src/lifestyle.ts): its
 * chapter, its shot (wide, mid, close-up, detail or empty), what must stay
 * exactly as it is, and who of the household is there. The person edits the
 * plan, the household's cast is made once per chapter (lit in that chapter's
 * light, on one of its own renders) or uploaded, and each frame is then
 * re-photographed from its render with the numbered recipe and saved as a
 * library still.
 *
 *   planning → planned        (or failed; "Plan again" starts a new one)
 *
 * Planning runs like the Director's (src/storyboard-api.ts): Claude takes at
 * most six images per call, so a larger set goes in batches of six, one after
 * another, each told what the earlier ones planned so every frame lands in the
 * same film. A batch that fails leaves its images on the board as empty
 * frames; the other batches' plans, already paid for, are kept. Like the
 * Director's, the planner directs by src/direction.ts and by one director
 * lens when the job has one (`directorStyle`); the answer's shape is the same.
 *
 * A two-pass plan (`pass2`, the default) shoots every take twice. Pass 1 is
 * the filmic photograph, on the plan's own model; once it has succeeded, the
 * next poll of `job` hands it, with the render beside it, to the pass-2
 * model, which re-photographs it at full detail (`buildPass2Prompt`). Each
 * take holds its own claim on that second still (`LifestyleShot.pass2`), so
 * polls, reloads and retries send it once, and one that failed, was skipped
 * or was deleted waits for the person's "Retry pass 2" (`retryPass2`).
 */

const PLANNER_MODEL = 'claude-sonnet-5-5';
const BATCH = 6;
/** A claim on sending the next batch, the cast or a take's pass 2 older than this is taken to have died with its request. */
export const SUBMIT_STALE_MS = 3 * 60_000;

/** How many renders one lifestyle plan takes (four planner calls). */
export const MAX_LIFESTYLE_IMAGES = 24;

/** What a plan's first pass is shot on when the page doesn't say: the model the filmic pilot read right on. */
const DEFAULT_MODEL: ImageModelId = 'gpt-image-2-5-sunburst';

/** What finishes each take when the page doesn't say: it keeps pass 1 and returns it at full detail. */
export const DEFAULT_PASS2: LifestylePass2 = { imageModel: 'nano-banana-2-1', resolution: '4k' };

// Higgsfield's pilot ran GPT Image 2.5 at xhigh; whether Runway's
// gpt_image_2_5_sunburst accepts 'xhigh' is unverified (PLAN.md Phase 2 open
// question 1), so this stays 'high' until a one-frame paid check says
// otherwise.
const PASS1_QUALITY: 'high' | 'xhigh' = 'high';

/** At most this many second passes are sent per poll; the next poll sends the rest. */
const PASS2_PER_POLL = 3;

export type LifestyleFrame = {
  /** Index into the job's images. */
  image: number;
  /** Where it falls in the whole film, 1–100; the chapters run in order. */
  position: number;
  setting: 'exterior' | 'interior';
  /** The place, in a few words ("pool deck"). */
  space: string;
  chapter: ChapterId;
  title: string;
  grammar: GrammarId;
  /** The signature moment it was planned from, if any. */
  moment?: MomentId | undefined;
  /** The largest things visible, named with their colour or material: they stay exactly as they are. */
  keep: string;
  /** What a close-up or detail moves in on; empty for the whole-frame shots. */
  crop: string;
  /** Who is there, where and doing what; "No people." and the subject for detail and empty. */
  people: string;
  /** The household roles in the frame (friends and staff are never roles). */
  cast: CastRoleId[];
  /** Where the sun is (the window side indoors), the planner's lighting design; absent on frames planned before 2026-10-29. */
  sun?: SunPositionId | undefined;
  /** The frame's lighting brief, ≤ 300 chars: pools and shade, who stands where in it, what falls dark. */
  light?: string | undefined;
  /** The lighting preset the planner chose (Phase 7); absent on frames planned before it. */
  lighting?: LightingPresetId | undefined;
  /** The shot's depth of field and focus plane (Phase 7); absent = the shot's own. */
  depth?: DepthId | undefined;
  focus?: FocusId | undefined;
  /** Why this chapter and shot, in one sentence. */
  why: string;
};

/** What the person set for a frame, over the plan's picks. */
export type LifestyleChoice = {
  chapter?: ChapterId | undefined;
  grammar?: GrammarId | undefined;
  keep?: string | undefined;
  crop?: string | undefined;
  people?: string | undefined;
  note?: string | undefined;
  /** Where the sun is; `null` = the person cleared it: back to the chapter's fixed light. */
  sun?: SunPositionId | null | undefined;
  light?: string | undefined;
  /** A lighting preset, depth of field or focus plane; `null` = the person cleared it: back to the chapter's light / the shot's own. */
  lighting?: LightingPresetId | null | undefined;
  depth?: DepthId | null | undefined;
  focus?: FocusId | null | undefined;
  /** In the film (the default); a frame left out is neither cast nor shot. */
  include?: boolean | undefined;
  /** The take used for this frame, when not its newest (a still id). */
  take?: string | undefined;
};

/**
 * One chapter's cast sheet: a library still, and the roles on it, left to
 * right. `imageModel`/`resolution`: what it was shot on; unset on sheets made
 * before CAST_SHEET_MODEL, which were shot on the plan's own model.
 */
export type CastSheet = {
  chapter: ChapterId;
  stillId: string;
  roles: CastRoleId[];
  imageModel?: ImageModelId | undefined;
  resolution?: string | undefined;
};

export type LifestyleCast = {
  mode: 'generated' | 'uploaded' | 'none';
  /** `generated`: one sheet per chapter whose frames have residents. */
  sheets?: CastSheet[] | undefined;
  /** `uploaded`: the person's own sheet, an ephemeral upload like the renders. */
  uploadedUrl?: string | undefined;
  /** The person has seen the cast; the page shoots only after this. */
  approved: boolean;
};

/** A two-pass plan's second pass: the model that finishes each take, and at what resolution. */
export type LifestylePass2 = { imageModel: ImageModelId; resolution: string };

/**
 * Where a take's second pass is. A poll or a retry claims it (`starting`)
 * before submitting, so it is sent once; nothing but the person's Retry
 * sends one that `failed`, was `skipped` or was `deleted`.
 */
export type Pass2State =
  | { state: 'starting'; at: string; by: string; attempt: number } // one poll/retry holds the claim
  | { state: 'started'; stillId: string; createdAt: string; attempt: number } // the pass-2 still; its status is the library's
  | { state: 'failed'; error: string; at: string; attempt: number } // could not be submitted; Retry
  | { state: 'skipped'; reason: string } // pass 1 failed, or the take was superseded; Retry allowed
  | { state: 'deleted'; attempt: number }; // its still was deleted from the library; Retry

/**
 * One take of a frame: `stillId` is its (first-pass) library still; `pass2` only on a two-pass plan.
 * `plate`: its first pass was shot as an x-ray plate (two-pass plans from 2026-10-29) and is
 * developed, not finished; unset on older takes and on single-pass plans.
 */
export type LifestyleShot = {
  image: number;
  stillId: string;
  createdAt: string;
  pass2?: Pass2State | undefined;
  plate?: true | undefined;
  /** The lighting the first pass was shot with (Phase 5); the develop relights to it. Unset on older takes and unlit frames. */
  lighting?: FrameLighting | undefined;
  /** The depth and focus the first pass was shot with (Phase 7); the develop keeps them. Unset on older takes and frames without a camera design. */
  camera?: FrameCamera | undefined;
};

export type LifestyleImage = { url: string; width: number; height: number; name: string };

export type LifestyleJob = {
  id: string;
  createdAt: string;
  updatedAt?: string | undefined;
  /** The first pass's model and resolution (a single-pass plan's only one). Cast sheets use CAST_SHEET_MODEL. */
  imageModel: ImageModelId;
  resolution: string;
  /** The second pass that finishes each take; unset on a single-pass plan (and every plan made before two passes). */
  pass2?: LifestylePass2 | undefined;
  /** The household's heritage, said in every frame with people. */
  heritage: EthnicityId;
  /** The person's own note about who lives there. */
  household: string;
  /** The director lens the planner directs with (src/direction.ts); unset on plans made before it, read as 'none'. */
  directorStyle?: DirectorLensId | undefined;
  /** Optional light, colour and planting reference (ephemeral upload), the last image of every take. */
  lightRefUrl?: string | undefined;
  images: LifestyleImage[];
  status: 'planning' | 'planned' | 'failed';
  error?: string | undefined;
  planTaskIds: string[];
  /**
   * A poll's claim on sending the next batch, or a request's on creating the
   * cast: when, and by whom (a random id — two polls can share a
   * millisecond), so nothing is sent or billed twice.
   */
  submitting?: { at: string; by: string } | undefined;
  /** One per image, in film order: chapter, then position. */
  plan?: LifestyleFrame[] | undefined;
  /** On a planned job: which images Claude couldn't plan, and why. They are on the board as empty frames. */
  warning?: string | undefined;
  choices?: Record<string, LifestyleChoice> | undefined;
  cast?: LifestyleCast | undefined;
  /** Every take, newest first; a frame shows its newest. */
  shots?: LifestyleShot[] | undefined;
};

export type TwoPassJob = LifestyleJob & { pass2: LifestylePass2 };

function isTwoPass(job: LifestyleJob): job is TwoPassJob {
  return job.pass2 !== undefined;
}

type LifestyleDoc = { jobs: LifestyleJob[] };

/** One document per person under `lifestyle/`, beside their library. */
const store = documentStore<LifestyleDoc>({ prefix: 'lifestyle/' });

async function readJobs(owner: string): Promise<LifestyleJob[]> {
  return (await store.get(`${owner}.json`))?.value.jobs ?? [];
}

function updateJobs(owner: string, mutate: (jobs: LifestyleJob[]) => LifestyleJob[]) {
  return store.update(`${owner}.json`, (current) => ({ jobs: mutate(current?.jobs ?? []).slice(0, 10) }));
}

/** Apply `patch` only while the stored job still passes `still`; returns the stored job. */
async function transition(
  owner: string,
  id: string,
  still: (j: LifestyleJob) => boolean,
  patch: (j: LifestyleJob) => Partial<LifestyleJob>
): Promise<LifestyleJob | null> {
  let stored: LifestyleJob | null = null;
  await updateJobs(owner, (jobs) => {
    stored = null;
    return jobs.map((j) => {
      if (j.id !== id) return j;
      stored = still(j) ? { ...j, ...patch(j), updatedAt: new Date().toISOString() } : j;
      return stored;
    });
  });
  return stored;
}

function notFound(): TRPCError {
  return new TRPCError({ code: 'NOT_FOUND', message: 'That lifestyle plan is no longer saved. Plan a new one.' });
}

function notPlanned(): TRPCError {
  return new TRPCError({ code: 'PRECONDITION_FAILED', message: 'This plan is not ready yet.' });
}

function claimIsFree(j: LifestyleJob): boolean {
  return !j.submitting || Date.now() - Date.parse(j.submitting.at) > SUBMIT_STALE_MS;
}

/** Film order: chapter, then position, then image. */
function byFilmOrder(
  a: { chapter: ChapterId; position: number; image: number },
  b: { chapter: ChapterId; position: number; image: number }
): number {
  return CHAPTER_IDS.indexOf(a.chapter) - CHAPTER_IDS.indexOf(b.chapter) || a.position - b.position || a.image - b.image;
}

/** The asked resolution when the model has it, else its 4K (the Lifestyle default), else its own default. */
function resolutionFor(model: ImageModelId, asked: string | undefined): string {
  const offered = imageResolutions(model);
  if (asked && offered.some((r) => r.id === asked)) return asked;
  return offered.find((r) => r.name === '4K')?.id ?? defaultImageResolution(model);
}

export const PLANNER_SYSTEM = [
  'You are the director and director of photography of a premium residential lifestyle film, planning how each render of one project is re-photographed as a real photograph of the residents living there. You only choose from the presets you are given and never ask for anything not already in the images.',
  DIRECTION_DOCTRINE,
].join('\n\n');

function presetList<T extends { id: string; name: string; hint: string }>(list: readonly T[]): string {
  return list.map((x) => `- "${x.id}": ${x.name} (${x.hint})`).join('\n');
}

/** What the shots without people show, for the planner (the others carry their `scale`). */
const EMPTY_SHOT: Record<GrammarId, string> = {
  wide: '',
  mid: '',
  close: '',
  detail: 'No people: a macro push-in on one small thing already in the image, such as water, stone, planting or a laid table.',
  empty: 'No people: the whole render re-photographed as it is.',
};

export function plannerPrompt(job: LifestyleJob, from: number, count: number, planned: readonly LifestyleFrame[]): string {
  const total = job.images.length;
  const heritage = (ETHNICITIES.find((e) => e.id === job.heritage) ?? ETHNICITIES[0]).name;
  return [
    total > count
      ? `These ${count} images are renders ${from + 1} to ${from + count} of ${total} of the same project. Image 1 here is image ${from + 1} of the set.`
      : `These ${count} images are renders of the same project. Image 1 is the first.`,
    'Each render becomes one frame of a lifestyle film about the people who live there: the same place, photographed for real, with the household going about an ordinary, unhurried day.',
    `The residents are one household; their heritage is "${heritage}". The shoot says it in every frame, so never describe heritage in "people".`,
    job.household ? `The person's own note about the household, which comes first: ${job.household}` : '',
    planned.length
      ? [
          'Earlier frames of this set are already planned, as listed below. Place these frames in the same film among them, with positions that fit before, between or after theirs, keep the chapters balanced and the same household recurring.',
          ...[...planned]
            .sort(byFilmOrder)
            .map(
              (f) =>
                `- Image ${f.image + 1} of the set: chapter "${f.chapter}", position ${f.position}, "${f.grammar}", "${f.title}". Cast: ${f.cast.length ? f.cast.join(', ') : 'none'}.`
            ),
        ].join('\n')
      : '',
    'Look carefully at each image first: whether it is an exterior or an interior, what is in it and how large, and where people could naturally be.',
    'The film runs in four chapters, in this order. Put each frame in the chapter whose light and mood suit it, and spread the set across all four:',
    presetList(CHAPTERS),
    'The shots ("grammar"), each with how big the people are:',
    GRAMMARS.map((g) => `- "${g.id}": ${g.name} (${g.hint}). ${g.people ? g.scale : EMPTY_SHOT[g.id]}`).join('\n'),
    'Rules:',
    '- Every image gets a frame; never drop or merge images.',
    '- "position" places the frame in the whole film from 1 (the very first shot) to 100 (the last), in chapter order: every "morning" frame before every "play" frame, then "together", then "golden". Give different frames different positions.',
    `- The mix for the whole set of ${total}${planned.length ? ', counting the frames already planned' : ''}: about half "wide", about a quarter "mid", ${total >= 6 ? 'at least one "close" and one "detail", ' : ''}and "empty" for pure architecture or views with no believable place for people.`,
    '- People in wides are small and far, their faces unreadable, seen through a soft out-of-focus foreground layer made of things already in the scene (planting, a railing, a lounger). Faces are seen only in close-ups. The close-ups and details carry the intimacy: a hand trailing in water, tea being poured, a child with a dessert, a paintbrush on paper, petals on a path.',
    '- The camera never moves to a new angle: "wide", "mid" and "empty" keep the render’s own viewpoint and framing, and "close" and "detail" move straight in along the same line of sight, so they can only frame what is already visible in the image.',
    '- Nothing new may be added except the people and what they carry or lead (a book, a cup of tea, a basket, a dog the household note mentions): never new objects, furniture, buildings, plants, vehicles, animals or light sources, and never describe a frame in terms of things that are not visible.',
    '- "keep": four to eight of the largest things actually visible, named with their colour or material, e.g. "the free-form pool, the timber cocoon pavilions, the palms, the sun loungers and the pink paving".',
    '- "crop", required for "close" and "detail": the part of the image the camera moves in on, e.g. "the nearest lounger at bottom left". Leave it empty for the other shots.',
    '- "people", at most 400 characters: who of the household is there by role, where in the frame (beside things already in it) and what they are doing, ordinary and unposed; never how big they are, which the shot sets. For "empty" and "detail" it begins "No people." and then says what the subject is, e.g. "No people. Petals fallen on the stone path by the bench."',
    '- "cast": the household roles in the frame, from the roles below; the same household recurs across the film. "friends" and "staff" may be named in "people" but are never roles. Leave it [] for "empty" and "detail".',
    '- "moment": one of the signature moments below when a frame suits it (fit its people to the image), otherwise "".',
    '- "sun": where the sun stands relative to the camera, one of the positions below (for an interior, the side the main window is on, in the same words). The take is relit from scratch, so the sun need not follow the render\'s own shadows: choose a back or side sun the geometry allows (open sky on that side, not a tower that would put the whole frame in shade unless that shade is the point). Prefer back and side light for people, and keep the chapter\'s time of day.',
    '- "light", at most 300 characters, in your own words, concrete and motivated: where the sun lands in pools and what sits in shade (and what casts that shade: a tower, a canopy, a tree), where the people stand so they separate from what is behind them (in a pool of sun against shade, in shade against a sunlit background, or rim-lit), and what is allowed to fall to near-darkness. Say where light falls, not how it looks: no words about glow, haze, grain or colour grade. For example: "The tower on the left keeps the near walkway in cool shade; sun breaks through the jacaranda in pools down the middle. The mother walks out of shade into the first pool, rim-lit against the shaded façade; the bench corner falls dark."',
    '- "lighting": one of the lighting presets below for the frame\'s setting (the outside list for an exterior, the inside list for an interior), or "" to leave the chapter\'s light. The take is relit from scratch, so the render\'s own shadows need not be kept: choose the light the geometry allows at the chapter\'s time of day. Prefer the backlight and side-light presets for people (long shadows toward the camera, rims on hair and leaves, texture in every surface); "dappled-canopy" where trees stand over paving and people; "soft-overcast" rarely, for a quiet frame that wants no sun; "blue-hour" and "evening-lamps" only when the render already shows lamps or lit windows. With a preset, "sun" gives only its side, left or right, where the preset needs one.',
    '- "depth": one of the depth presets below, or "" for the shot\'s own: "deep" for a wide of architecture, "natural" for most frames with people at mid distance, "portrait" for a close-up, "dreamy" rarely, for a detail or a close-up where one thing alone matters.',
    '- "focus": where the focus plane sits, one of the focus targets below, or "" for the people (or the subject).',
    'Sun positions:',
    presetList(SUN_POSITIONS),
    'Lighting presets, outside:',
    presetList(LIGHTING_PRESETS.filter((p) => p.setting === 'exterior')),
    'Lighting presets, inside:',
    presetList(LIGHTING_PRESETS.filter((p) => p.setting === 'interior')),
    'Depth presets:',
    presetList(DEPTH_PRESETS),
    'Focus targets:',
    presetList(FOCUS_TARGETS),
    'Household roles:',
    CAST_ROLES.map((r) => `- "${r.id}": ${r.description}`).join('\n'),
    'Signature moments:',
    presetList(MOMENTS),
    lensBlock(job.directorStyle),
    'For each image give: "image" (its number here), "setting" ("exterior" or "interior"), "space" (a few words naming the place, e.g. "pool deck"), "chapter", "position", "title" (two to five words, e.g. "Morning by the pool"), "grammar", "moment", "keep", "crop", "people", "cast", "sun", "light", "lighting", "depth", "focus", "why" (one short sentence: why this chapter and shot).',
    'Answer with one JSON object and nothing else, in exactly this shape:',
    '{"frames":[{"image":1,"setting":"exterior","space":"...","chapter":"morning","position":12,"title":"...","grammar":"wide","moment":"","keep":"...","crop":"","people":"...","cast":["mother"],"sun":"behind-left","light":"...","lighting":"morning-backlight-trees","depth":"natural","focus":"subject","why":"..."}]}',
  ]
    .filter(Boolean)
    .join('\n');
}

// Lenient: a null, a number, a missing key or an over-long answer for one
// field never throws away the whole batch of frames.
const text = (max: number) =>
  z
    .unknown()
    .optional()
    .transform((v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').trim().slice(0, max));

const planSchema = z.object({
  frames: z.array(
    z.object({
      // 0 is never an image here, so an unusable number skips just this frame.
      image: z.coerce.number().int().catch(0),
      setting: z.enum(['exterior', 'interior']).catch('exterior'),
      space: text(80),
      chapter: z.enum(CHAPTER_IDS).catch('together'),
      position: z.coerce.number().catch(50),
      title: text(80),
      grammar: z.enum(GRAMMAR_IDS).catch('wide'),
      moment: z
        .unknown()
        .optional()
        .transform((v): MomentId | '' => ((MOMENT_IDS as readonly unknown[]).includes(v) ? (v as MomentId) : '')),
      keep: text(300),
      crop: text(200),
      people: text(400),
      cast: z
        .unknown()
        .optional()
        .transform((v): CastRoleId[] => (Array.isArray(v) ? CAST_ROLE_IDS.filter((r) => v.includes(r)) : [])),
      sun: z
        .unknown()
        .optional()
        .transform((v): SunPositionId | undefined => ((SUN_POSITION_IDS as readonly unknown[]).includes(v) ? (v as SunPositionId) : undefined)),
      light: text(300),
      lighting: z
        .unknown()
        .optional()
        .transform((v): LightingPresetId | undefined => ((LIGHTING_PRESET_IDS as readonly unknown[]).includes(v) ? (v as LightingPresetId) : undefined)),
      depth: z
        .unknown()
        .optional()
        .transform((v): DepthId | undefined => ((DEPTH_IDS as readonly unknown[]).includes(v) ? (v as DepthId) : undefined)),
      focus: z
        .unknown()
        .optional()
        .transform((v): FocusId | undefined => ((FOCUS_IDS as readonly unknown[]).includes(v) ? (v as FocusId) : undefined)),
      why: text(300),
    })
  ),
});

const NO_PEOPLE_LEAD = /^no people\b/i;

/** A brief for a shot without people always opens "No people." (src/lifestyle.ts relies on it). */
function noPeople(brief: string): string {
  const t = brief.trim();
  if (!t) return 'No people.';
  return (t.toLowerCase().startsWith('no people.') ? `No people.${t.slice(10)}` : `No people. ${t}`).slice(0, 400);
}

/** A frame for an image the planner didn't plan: re-photographed whole, no one in it. */
function unplanned(image: number, position: number): LifestyleFrame {
  return {
    image,
    position,
    setting: 'exterior',
    space: '',
    chapter: 'together',
    title: `Frame ${image + 1}`,
    grammar: 'empty',
    keep: '',
    crop: '',
    people: 'No people.',
    cast: [],
    why: '',
  };
}

/**
 * Pull one batch's frames out of the planner's answer, tolerating a code
 * fence, in film order. `from` is the batch's first image, `count` its size.
 * `null` when nothing in it could be planned, so the batch is reported.
 */
export function parsePlan(answer: string, from: number, count: number): LifestyleFrame[] | null {
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = planSchema.safeParse(JSON.parse(answer.slice(start, end + 1)));
    if (!parsed.success) return null;
    // A later batch sometimes numbers its images as the set does (7–12, not
    // 1–6), led by the earlier frames' list; read those as its own.
    const numbered = parsed.data.frames.filter((f) => f.image >= 1);
    const shift =
      from > 0 && numbered.length > 0 && numbered.every((f) => f.image > from && f.image <= from + count) ? from : 0;
    const out: LifestyleFrame[] = [];
    for (const raw of parsed.data.frames) {
      const f = { ...raw, image: raw.image - shift };
      const image = from + f.image - 1;
      if (f.image < 1 || f.image > count || out.some((o) => o.image === image)) continue;
      let grammar = f.grammar;
      // A shot with people that names no one is shot without them.
      if (grammarById(grammar).people && (!f.people || NO_PEOPLE_LEAD.test(f.people))) {
        grammar = grammar === 'close' ? 'detail' : 'empty';
      }
      // A close-up or detail needs something to move in on; without it the frame is shot whole.
      if (!f.crop) grammar = grammar === 'close' ? 'mid' : grammar === 'detail' ? 'empty' : grammar;
      const withPeople = grammarById(grammar).people;
      out.push({
        image,
        position: Math.min(100, Math.max(1, f.position)),
        setting: f.setting,
        space: f.space,
        chapter: f.chapter,
        title: f.title || `Frame ${image + 1}`,
        grammar,
        moment: f.moment || undefined,
        keep: f.keep,
        crop: f.crop,
        people: withPeople ? f.people : noPeople(f.people),
        cast: withPeople ? f.cast : [],
        sun: f.sun,
        light: f.light || undefined,
        ...(f.lighting && lightingPresetById(f.lighting)?.setting === f.setting ? { lighting: f.lighting } : {}),
        ...(f.depth ? { depth: f.depth } : {}),
        ...(f.focus ? { focus: f.focus } : {}),
        why: f.why,
      });
    }
    if (out.length === 0) return null;
    // An image the answer skipped still gets a frame, shot whole and empty.
    for (let i = 0; i < count; i++) {
      if (out.some((o) => o.image === from + i)) continue;
      out.push(unplanned(from + i, 50));
    }
    return out.sort(byFilmOrder);
  } catch {
    return null;
  }
}

async function submitPlanner(
  ctx: RunwayCtx,
  owner: string,
  job: LifestyleJob,
  from: number,
  planned: readonly LifestyleFrame[] = []
): Promise<string> {
  const batch = job.images.slice(from, from + BATCH);
  try {
    const { id } = await createTextTask(ctx, owner, {
      name: 'render-to-film lifestyle plan',
      model: PLANNER_MODEL,
      system_prompt: PLANNER_SYSTEM,
      prompt: plannerPrompt(job, from, batch.length, planned),
      images: batch.map((img) => ({ url: img.url })),
      temperature: 0.4,
      max_output_tokens: 10000,
    });
    return id;
  } catch (err) {
    logRejection('lifestyle', 'claude_api', err);
    throw err;
  }
}

/** "Image 3", "Images 7–12", or "Images 2, 5". */
function imagesLabel(images: readonly number[]): string {
  if (images.length === 1) return `Image ${images[0]! + 1}`;
  const first = images[0]! + 1;
  const last = images[images.length - 1]! + 1;
  return last - first + 1 === images.length
    ? `Images ${first}–${last}`
    : `Images ${images.map((i) => i + 1).join(', ')}`;
}

/**
 * Move planning along on each poll. Once every batch sent so far is answered,
 * send the next one, told what the earlier ones planned; once the last is in,
 * record the plan. A batch that failed leaves its images as empty frames, and
 * the job fails only when no batch was planned at all.
 */
async function advance(ctx: RunwayCtx, owner: string, job: LifestyleJob): Promise<LifestyleJob> {
  if (job.status !== 'planning') return job;
  const plan: LifestyleFrame[] = [];
  const failed: { from: number; count: number; reason: string }[] = [];
  for (const [i, taskId] of job.planTaskIds.entries()) {
    const snap = await textTaskSnapshot(ctx, owner, taskId);
    if (!snap.done) return job;
    const from = i * BATCH;
    const count = Math.min(BATCH, job.images.length - from);
    const frames =
      snap.status === 'SUCCEEDED' && snap.text && !snap.truncated ? parsePlan(snap.text, from, count) : null;
    if (frames) {
      plan.push(...frames);
      continue;
    }
    failed.push({
      from,
      count,
      reason:
        snapError(snap) ??
        (snap.truncated
          ? 'The plan ran out of room before it finished. Plan again, or use fewer renders.'
          : 'The plan came back in a form the app could not read. Plan again.'),
    });
  }
  const ids = job.planTaskIds.join();
  const unchanged = (j: LifestyleJob) => j.status === 'planning' && j.planTaskIds.join() === ids;

  const next = job.planTaskIds.length * BATCH;
  if (next < job.images.length) {
    // Claim the next batch before sending it, so two polls never bill it twice.
    const claim = { at: new Date().toISOString(), by: randomUUID() };
    const claimed = await transition(owner, job.id, (j) => unchanged(j) && claimIsFree(j), () => ({ submitting: claim }));
    if (claimed?.submitting?.by !== claim.by) return claimed ?? job;
    try {
      const taskId = await submitPlanner(ctx, owner, job, next, plan);
      return (
        (await transition(
          owner,
          job.id,
          (j) => j.submitting?.by === claim.by,
          (j) => ({ planTaskIds: [...j.planTaskIds, taskId], submitting: undefined })
        )) ?? job
      );
    } catch (err) {
      // Nothing more can be sent: keep what was planned; the rest stays empty.
      failed.push({ from: next, count: job.images.length - next, reason: toTrpcError(err).message });
    }
  }

  const missing = failed.flatMap((f) => Array.from({ length: f.count }, (_, k) => f.from + k));
  const reason = failed[0]?.reason ?? 'Plan the film again.';
  const finished = (): Partial<LifestyleJob> => {
    if (plan.length === 0) return { status: 'failed', error: reason, submitting: undefined };
    const frames = [...plan, ...missing.map((image) => unplanned(image, 100))].sort(byFilmOrder);
    const one = missing.length === 1;
    return {
      status: 'planned',
      plan: frames,
      submitting: undefined,
      warning: missing.length
        ? `${imagesLabel(missing)} couldn't be planned. ${reason} Until then ${one ? 'it is an empty frame' : 'they are empty frames'} in Together, and you can set ${one ? 'its' : 'their'} chapter, shot and people yourself.`
        : undefined,
    };
  };
  return (await transition(owner, job.id, unchanged, finished)) ?? job;
}

/** A frame as it is cast and shot: the plan with the person's changes over it. */
type BoardFrame = LifestyleFrame & { note: string; include: boolean };

/** Whether a brief names a household role ("mother" never matches "grandmother"). */
function namesRole(brief: string, role: CastRoleId): boolean {
  return new RegExp(`\\b${role}s?\\b`, 'i').test(brief);
}

/**
 * The roles in a people frame: what the person's own brief names, when it
 * names any (the roles they removed are gone); else the planned roles, plus
 * any the brief names.
 */
function castRoles(frame: LifestyleFrame, fits: boolean, own: boolean, people: string): CastRoleId[] {
  const named = CAST_ROLE_IDS.filter((r) => namesRole(people, r));
  if (own && named.length > 0) return named;
  return CAST_ROLE_IDS.filter((r) => (fits && frame.cast.includes(r)) || named.includes(r));
}

export function boardFrame(frame: LifestyleFrame, choice: LifestyleChoice | undefined): BoardFrame {
  const c = choice ?? {};
  const grammar = c.grammar ?? frame.grammar;
  const withPeople = grammarById(grammar).people;
  // The planner's brief was written for its own shot: a brief with people
  // never fits a shot without them, nor the other way round.
  const fits = withPeople === grammarById(frame.grammar).people;
  const brief = (c.people ?? (fits ? frame.people : '')).trim();
  const people = withPeople ? brief : noPeople(brief);
  return {
    ...frame,
    chapter: c.chapter ?? frame.chapter,
    grammar,
    keep: c.keep ?? frame.keep,
    crop: c.crop ?? frame.crop,
    people,
    cast: withPeople ? castRoles(frame, fits, c.people !== undefined, people) : [],
    sun: c.sun === null ? undefined : (c.sun ?? frame.sun),
    light: (c.light ?? frame.light ?? '').trim() || undefined,
    lighting: c.lighting === null ? undefined : (c.lighting ?? frame.lighting),
    depth: c.depth === null ? undefined : (c.depth ?? frame.depth),
    focus: c.focus === null ? undefined : (c.focus ?? frame.focus),
    note: c.note?.trim() ?? '',
    include: c.include ?? true,
  };
}

/** Every planned frame with its choices, in film order (a frame's `order` is its place here, from 1). */
function boardFrames(job: LifestyleJob): BoardFrame[] {
  return (job.plan ?? []).map((f) => boardFrame(f, job.choices?.[f.image])).sort(byFilmOrder);
}

/**
 * The cast sheets a film needs: one per chapter whose included frames have
 * household roles in them, with every role they use, shot on the chapter's
 * first included render (an exterior when it has one) so the residents are
 * lit in that chapter's light.
 */
function castPlan(job: LifestyleJob): { chapter: Chapter; roles: CastRoleId[]; frame: BoardFrame }[] {
  const frames = boardFrames(job).filter((f) => f.include);
  return CHAPTERS.flatMap((chapter) => {
    const own = frames.filter((f) => f.chapter === chapter.id);
    const roles = CAST_ROLE_IDS.filter((r) => own.some((f) => f.cast.includes(r)));
    const frame = own.find((f) => f.setting === 'exterior') ?? own[0];
    return roles.length && frame ? [{ chapter, roles, frame }] : [];
  });
}

/** A frame's take as the library keeps it. */
function frameStill(
  job: LifestyleJob,
  frame: BoardFrame,
  order: number,
  img: LifestyleImage,
  take: { id: string; createdAt: string; castSheetUrl?: string | undefined }
): Still {
  const grammar = grammarById(frame.grammar);
  const brief = frame.people.trim();
  return {
    id: take.id,
    createdAt: take.createdAt,
    status: 'pending',
    imageModel: job.imageModel,
    look: 'lodha-light',
    angle: 'as-rendered',
    crowd: grammar.people ? 'few' : 'none',
    people: frame.people,
    // The people check judges the residents against the household's heritage.
    ...(grammar.people ? { ethnicity: job.heritage } : {}),
    castSheetUrl: take.castSheetUrl,
    lightRefUrl: job.lightRefUrl,
    direction: frame.note,
    width: img.width,
    height: img.height,
    sourceUrl: img.url,
    resolution: job.resolution,
    moment: frame.moment,
    lifestyle: {
      jobId: job.id,
      kind: 'frame',
      order,
      title: frame.title,
      chapter: frame.chapter,
      grammar: frame.grammar,
      // With how big the shoot made the people, so the check doesn't ask a
      // wide for faces it was told to keep unreadable.
      people: grammar.people
        ? [brief && !/[.!?]$/.test(brief) ? `${brief}.` : brief, grammar.scale].filter(Boolean).join(' ')
        : frame.people,
      // A two-pass take's first pass, so the library tells it from the finals.
      ...(job.pass2 ? { pass: 1 as const } : {}),
    },
  };
}

/** A chapter's cast sheet as the library keeps it. */
function sheetStill(
  job: LifestyleJob,
  chapter: Chapter,
  img: LifestyleImage,
  id: string,
  createdAt: string,
  model: { imageModel: ImageModelId; resolution: string }
): Still {
  return {
    id,
    createdAt,
    status: 'pending',
    imageModel: model.imageModel,
    look: 'lodha-light',
    angle: 'as-rendered',
    crowd: 'few',
    people: '',
    ethnicity: job.heritage,
    ...(job.lightRefUrl ? { lightRefUrl: job.lightRefUrl } : {}),
    direction: '',
    width: img.width,
    height: img.height,
    sourceUrl: img.url,
    resolution: model.resolution,
    lifestyle: { jobId: job.id, kind: 'cast', title: `Cast: ${chapter.name}`, chapter: chapter.id },
  };
}

/**
 * A take's second pass as the library keeps it: its first pass's record
 * (same render, size, people and direction), on the pass-2 model. Neither
 * the cast sheet nor the light reference is recorded on it; a develop does
 * send the light reference as its third image (`pass2Request`), but the still
 * record itself is unchanged.
 */
function pass2Still(job: TwoPassJob, pass1: Still, id: string, createdAt: string): Still {
  return {
    ...pass1,
    id,
    createdAt,
    status: 'pending',
    error: undefined,
    imageModel: job.pass2.imageModel,
    resolution: job.pass2.resolution,
    castSheetUrl: undefined,
    lightRefUrl: undefined,
    check: undefined,
    tags: undefined,
    lifestyle: pass1.lifestyle && { ...pass1.lifestyle, pass: 2, fromStillId: pass1.id },
  };
}

/** The take each frame uses: the one picked for it, else its newest. */
function usedShots(job: LifestyleJob): Map<number, LifestyleShot> {
  const used = new Map<number, LifestyleShot>();
  for (const shot of job.shots ?? []) {
    const picked = job.choices?.[shot.image]?.take;
    if (picked ? shot.stillId === picked : !used.has(shot.image)) used.set(shot.image, shot);
  }
  return used;
}

function usedIds(job: LifestyleJob): Set<string> {
  return new Set([...usedShots(job).values()].map((s) => s.stillId));
}

/** No one holds the take's second pass: it was never claimed, or its claim died with its request. */
function unclaimed(pass2: Pass2State | undefined, now: number): boolean {
  return !pass2 || (pass2.state === 'starting' && now - Date.parse(pass2.at) > SUBMIT_STALE_MS);
}

function attemptOf(pass2: Pass2State | undefined): number {
  return pass2 && 'attempt' in pass2 ? pass2.attempt : 0;
}

function withPass2(shots: LifestyleShot[] | undefined, stillId: string, pass2: Pass2State): LifestyleShot[] | undefined {
  return shots?.map((s) => (s.stillId === stillId ? { ...s, pass2 } : s));
}

/**
 * What a poll does about one take's second pass. `used`: the frame uses
 * this take; `pass1Status`: its first pass's library status (`undefined`
 * while it is missing from the library). Only an unclaimed take is acted on,
 * so a second pass that is starting, started, failed, skipped or deleted is
 * never sent again from here.
 */
export function pass2Action(
  shot: LifestyleShot,
  pass1Status: TaskState | undefined,
  used: boolean,
  now: number
): 'start' | 'wait' | 'skip-failed' | 'skip-superseded' | 'none' {
  if (!unclaimed(shot.pass2, now)) return 'none';
  if (!used) return 'skip-superseded';
  if (pass1Status === undefined || pass1Status === 'pending') return 'wait';
  return pass1Status === 'failed' ? 'skip-failed' : 'start';
}

const SKIPPED_FAILED = 'The first pass failed, so there was nothing to finish.';
const SKIPPED_SUPERSEDED = 'A newer take replaced this one before it was finished.';

/**
 * The stills' statuses by id, asking Runway about any the library still has
 * as pending (the board polls only the job, so the library's own poll may
 * not have run) and saving the ones that have settled. A still missing from
 * the library has none.
 */
async function liveStatuses(
  ctx: RunwayCtx,
  owner: string,
  lib: Library,
  ids: readonly string[]
): Promise<Map<string, TaskState>> {
  const stills = lib.stills.filter((s) => ids.includes(s.id));
  const out = new Map(stills.map((s) => [s.id, s.status]));
  const snaps = await Promise.all(
    stills
      .filter((s) => s.status === 'pending')
      .map(async (s) => ({ id: s.id, snap: await ctx.runway.taskSnapshot(s.id).catch(() => null) }))
  );
  const done = new Map(snaps.flatMap(({ id, snap }) => (snap?.done ? [[id, settled(snap)] as const] : [])));
  if (done.size === 0) return out;
  for (const [id, s] of done) out.set(id, s.status);
  await updateLibrary(owner, (l) => ({
    ...l,
    stills: l.stills.map((s) => ({ ...s, ...done.get(s.id) })),
  })).catch((err: unknown) => console.warn('[lifestyle] could not save', [...done.keys()], err));
  return out;
}

/**
 * The first pass's own size, for the reference pass 2 is told about (the
 * GPT models send each reference's size): Runway's, when its artifact says,
 * else the render's, whose shape pass 1 was shot in.
 */
async function pass1Size(
  ctx: RunwayCtx,
  stillId: string,
  img: LifestyleImage
): Promise<{ width: number; height: number }> {
  try {
    const size = (await ctx.runway.getTask(stillId)).artifacts[0]?.metadata?.size;
    if (size?.width && size.height) return { width: size.width, height: size.height };
  } catch {
    // The render's size, as below.
  }
  return { width: img.width, height: img.height };
}

/**
 * What a take's second pass sends. A take shot as an x-ray plate
 * (`shot.plate`) is developed: the plate (image 1), the render (image 2) and,
 * when the plan has one, the light reference (image 3), with the develop
 * prompt cut to the pass-2 model's cap. Any other take gets today's request:
 * the first pass and the render, re-photographed at full detail. A plate's
 * develop relights to the lighting the take recorded (`shot.lighting`), not
 * the board's current fields, and keeps the lighting preset and the camera
 * (depth and focus) the take recorded. The frame's own words (keep-list,
 * place, title, people brief) only switch on the develop's realism clauses.
 * Pure.
 */
export function pass2Request(
  job: TwoPassJob,
  shot: LifestyleShot,
  pass1: Still,
  frame: (Pick<LifestyleFrame, 'setting' | 'chapter' | 'grammar'> & Partial<Pick<LifestyleFrame, 'keep' | 'space' | 'title' | 'people'>>) | undefined,
  urls: { pass1: string; render: string }
): { references: { tag: string; url: string }[]; prompt: string } {
  const grammar = grammarById(pass1.lifestyle?.grammar ?? frame?.grammar);
  const resolutionName = imageResolutionName(job.pass2.imageModel, job.pass2.resolution) ?? '4K';
  const references = [
    { tag: 'pass1', url: urls.pass1 },
    { tag: 'render', url: urls.render },
  ];
  if (shot.plate !== true) {
    return { references, prompt: buildPass2Prompt({ people: grammar.people, resolutionName }) };
  }
  const lightRefUrl = job.lightRefUrl;
  return {
    references: lightRefUrl !== undefined ? [...references, { tag: 'light', url: lightRefUrl }] : references,
    prompt: buildDevelopPrompt({
      setting: frame?.setting ?? 'exterior',
      chapter: pass1.lifestyle?.chapter ?? frame?.chapter ?? 'morning',
      grammar: grammar.id,
      lightReference: lightRefUrl !== undefined,
      resolutionName,
      maxLength: imageModelPromptLimit(job.pass2.imageModel),
      sun: shot.lighting?.sun, light: shot.lighting?.light,
      lighting: shot.lighting?.preset, depth: shot.camera?.depth, focus: shot.camera?.focus,
      scene: [frame?.keep, frame?.space, frame?.title, frame?.people].filter(Boolean).join('. '),
    }),
  };
}

/**
 * Send one take's second pass, from a poll or a retry: claim it on the job,
 * then send the first pass (image 1) and the render (image 2), and the light
 * reference (image 3) on a plate's develop, to the pass-2 model, and record
 * the new still on the job **before** the library. The job is what says it
 * was sent, so a crash between the two never sends it again
 * (`restoreTakes` puts the library row back), and a pass-2 still already in
 * the library for this first pass (its job record lost) is taken up rather
 * than sent again. `may` says which stored states this call may claim: a
 * poll's only an unclaimed take its frame still uses, a retry's also a
 * failed, skipped or deleted one. A refusal is recorded as `failed` and
 * handed back as `error`.
 */
async function startPass2(
  ctx: RunwayCtx,
  owner: string,
  job: LifestyleJob,
  shot: LifestyleShot,
  attempt: number,
  may: (pass2: Pass2State | undefined, stored: LifestyleJob) => boolean = (p, j) =>
    unclaimed(p, Date.now()) && usedIds(j).has(shot.stillId)
): Promise<{ job: LifestyleJob; error?: TRPCError }> {
  const by = randomUUID();
  const own = (j: LifestyleJob) => j.shots?.find((s) => s.stillId === shot.stillId);
  // The still a retry replaces, which is never taken up again below.
  let replaced: string | undefined;
  const claimed = await transition(
    owner,
    job.id,
    (j) => j.status === 'planned' && isTwoPass(j) && own(j) !== undefined && may(own(j)?.pass2, j),
    (j) => {
      const before = own(j)?.pass2;
      replaced = before?.state === 'started' ? before.stillId : undefined;
      return { shots: withPass2(j.shots, shot.stillId, { state: 'starting', at: new Date().toISOString(), by, attempt }) };
    }
  );
  const held = claimed ? own(claimed)?.pass2 : undefined;
  // Someone else holds it, or it is no longer there to send: never submit.
  if (!claimed || !isTwoPass(claimed) || held?.state !== 'starting' || held.by !== by) return { job: claimed ?? job };
  const holds = (j: LifestyleJob) => {
    const p = own(j)?.pass2;
    return p?.state === 'starting' && p.by === by;
  };
  const settle = (pass2: Pass2State) =>
    transition(owner, job.id, holds, (j) => ({ shots: withPass2(j.shots, shot.stillId, pass2) }));
  const model = claimed.pass2.imageModel;
  let pass1: Still | undefined;
  let id: string;
  try {
    const lib = await readLibrary(owner);
    pass1 = lib.stills.find((s) => s.id === shot.stillId);
    const img = claimed.images[shot.image];
    if (!pass1 || !img) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'The first pass is no longer in your library.' });
    }
    const sent = lib.stills.find(
      (s) =>
        s.lifestyle?.pass === 2 &&
        s.lifestyle.fromStillId === shot.stillId &&
        s.status !== 'failed' &&
        s.id !== replaced
    );
    if (sent) {
      return {
        job: (await settle({ state: 'started', stillId: sent.id, createdAt: sent.createdAt, attempt })) ?? claimed,
      };
    }
    const url = await finishedUrl(ctx, shot.stillId, owner);
    // Pass 2 snaps its canvas from pass 1's real shape, not the render's.
    const size = await pass1Size(ctx, shot.stillId, img);
    const frame = boardFrames(claimed).find((f) => f.image === shot.image);
    const { references, prompt } = pass2Request(claimed, shot, pass1, frame, { pass1: url, render: img.url });
    ({ id } = await submitStill(
      ctx,
      {
        imageModel: model,
        imageUrl: url,
        references,
        ...size,
        frame: size,
        resolution: claimed.pass2.resolution,
      },
      prompt
    ));
  } catch (err) {
    logRejection('lifestyle pass 2', model, err);
    const error = toTrpcError(err);
    const stored = await settle({ state: 'failed', error: error.message, at: new Date().toISOString(), attempt });
    return { job: stored ?? claimed, error };
  }
  const createdAt = new Date().toISOString();
  let stored: LifestyleJob | null = null;
  try {
    stored = await settle({ state: 'started', stillId: id, createdAt, attempt });
  } catch (err) {
    console.warn('[lifestyle] could not record pass 2', id, err);
  }
  const recorded = stored ? own(stored)?.pass2 : undefined;
  if (recorded?.state !== 'started' || recorded.stillId !== id) {
    // Sent, but the take's claim went meanwhile (its first pass deleted, or
    // the claim gone stale): the still is kept in the library all the same,
    // so what was paid for is never lost.
    console.warn('[lifestyle] pass 2 sent without its claim', id);
  }
  try {
    const still = pass2Still(claimed, pass1, id, createdAt);
    await updateLibrary(owner, (lib) => ({ ...lib, stills: [still, ...lib.stills.filter((s) => s.id !== id)] }));
  } catch (err) {
    // The job has it: `restoreTakes` puts it back on the next poll.
    console.warn('[lifestyle] could not save pass 2', id, err);
  }
  return { job: stored ?? claimed };
}

/**
 * A two-pass plan's second passes, moved along on each poll: each take a
 * frame uses whose first pass has succeeded is sent (at most
 * `PASS2_PER_POLL` a poll; the next poll sends the rest), and one whose first
 * pass failed, or that a newer take replaced before it was finished, is
 * marked skipped, so no frame is ever finished twice. A take already
 * claimed, sent, failed, skipped or deleted is left alone.
 */
async function advancePasses(ctx: RunwayCtx, owner: string, job: LifestyleJob): Promise<LifestyleJob> {
  if (job.status !== 'planned' || !isTwoPass(job)) return job;
  const now = Date.now();
  const open = (job.shots ?? []).filter((s) => unclaimed(s.pass2, now));
  if (open.length === 0) return job;
  const used = usedIds(job);
  // Only a take the frame uses needs its first pass's status.
  const status = await liveStatuses(
    ctx,
    owner,
    await readLibrary(owner),
    open.filter((s) => used.has(s.stillId)).map((s) => s.stillId)
  );
  const starts: LifestyleShot[] = [];
  const skips = new Map<string, string>();
  // Newest first, as `shots` is kept.
  for (const shot of open) {
    const action = pass2Action(shot, status.get(shot.stillId), used.has(shot.stillId), now);
    if (action === 'start' && starts.length < PASS2_PER_POLL) starts.push(shot);
    if (action === 'skip-failed') skips.set(shot.stillId, SKIPPED_FAILED);
    if (action === 'skip-superseded') skips.set(shot.stillId, SKIPPED_SUPERSEDED);
  }
  if (starts.length === 0 && skips.size === 0) return job;
  if (skips.size > 0) {
    await transition(
      owner,
      job.id,
      (j) => j.status === 'planned' && isTwoPass(j),
      (j) => {
        // Checked again on the stored job: a take claimed, or picked again, since is left alone.
        const stillUsed = usedIds(j);
        const at = Date.now();
        return {
          shots: j.shots?.map((s) => {
            const reason = skips.get(s.stillId);
            if (!reason || !unclaimed(s.pass2, at) || (reason === SKIPPED_SUPERSEDED && stillUsed.has(s.stillId))) return s;
            return { ...s, pass2: { state: 'skipped', reason } };
          }),
        };
      }
    );
  }
  const sent = await Promise.allSettled(
    starts.map((shot) => startPass2(ctx, owner, job, shot, attemptOf(shot.pass2) + 1))
  );
  const failed = sent.find((r) => r.status === 'rejected');
  if (failed) throw failed.reason;
  return (await readJobs(owner)).find((j) => j.id === job.id) ?? job;
}

/**
 * A take or cast sheet deleted from the library leaves its plan too, so the
 * board doesn't show it: the frame falls back to its previous take, and a
 * chapter whose sheet went needs the cast made again. A deleted second pass
 * leaves its take in place, marked `deleted`, so nothing sends it again
 * until the person retries it; a deleted first pass takes its take with it
 * (its second pass stays in the library as an ordinary still).
 */
export async function forgetTake(owner: string, jobId: string, stillId: string): Promise<void> {
  const finishedBy = (s: LifestyleShot) => s.pass2?.state === 'started' && s.pass2.stillId === stillId;
  await updateJobs(owner, (jobs) =>
    jobs.map((j) => {
      const shot = j.shots?.some((s) => s.stillId === stillId);
      const finish = j.shots?.some(finishedBy);
      const sheet = j.cast?.sheets?.some((s) => s.stillId === stillId);
      if (j.id !== jobId || (!shot && !finish && !sheet)) return j;
      const choices = Object.fromEntries(
        Object.entries(j.choices ?? {}).map(([k, c]) => [k, c.take === stillId ? { ...c, take: undefined } : c])
      );
      return {
        ...j,
        shots: j.shots
          ?.filter((s) => s.stillId !== stillId)
          .map((s) => (finishedBy(s) ? { ...s, pass2: { state: 'deleted' as const, attempt: attemptOf(s.pass2) } } : s)),
        choices,
        cast: j.cast && sheet ? { ...j.cast, sheets: j.cast.sheets?.filter((s) => s.stillId !== stillId) } : j.cast,
      };
    })
  );
}

/**
 * Each frame's take (both passes of a two-pass one) and each cast sheet, put
 * back in the library when it has fallen out (the library keeps only its
 * newest 600 items, a delete's `forgetTake` can fail, and pass 2 is recorded
 * on the job before the library), as the Director does. Restored as pending,
 * so the library's own poll fetches the finished image from Runway again.
 */
async function restoreTakes(owner: string, job: LifestyleJob): Promise<void> {
  if (job.status !== 'planned') return;
  const used = usedShots(job);
  const sheets = job.cast?.mode === 'generated' ? (job.cast.sheets ?? []) : [];
  if (used.size === 0 && sheets.length === 0) return;
  const lib = await readLibrary(owner);
  const have = new Set(lib.stills.map((s) => s.id));
  const lostShots = [...used.values()].filter((shot) => !have.has(shot.stillId));
  const lostFinishes = isTwoPass(job)
    ? [...used.values()].flatMap((shot) =>
        shot.pass2?.state === 'started' && !have.has(shot.pass2.stillId) ? [{ shot, pass2: shot.pass2 }] : []
      )
    : [];
  const lostSheets = sheets.filter((sheet) => !have.has(sheet.stillId));
  if (lostShots.length === 0 && lostFinishes.length === 0 && lostSheets.length === 0) return;
  const board = boardFrames(job);
  const wanted = castPlan(job);
  // The cast sheet's signed URL isn't kept, so a restored take doesn't name it.
  const takeStill = (shot: LifestyleShot): Still | undefined => {
    const order = board.findIndex((f) => f.image === shot.image) + 1;
    const frame = board[order - 1];
    const img = job.images[shot.image];
    return frame && img ? frameStill(job, frame, order, img, { id: shot.stillId, createdAt: shot.createdAt }) : undefined;
  };
  const restored = [
    ...lostShots.flatMap((shot): Still[] => {
      const still = takeStill(shot);
      return still ? [still] : [];
    }),
    // A second pass is its first pass's record on the pass-2 model.
    ...lostFinishes.flatMap(({ shot, pass2 }): Still[] => {
      const pass1 = lib.stills.find((s) => s.id === shot.stillId) ?? takeStill(shot);
      return pass1 && isTwoPass(job) ? [pass2Still(job, pass1, pass2.stillId, pass2.createdAt)] : [];
    }),
    ...lostSheets.flatMap((sheet): Still[] => {
      // Which render a sheet was shot on isn't kept: the chapter's cast
      // render as the board stands, else one of its frames, else the first.
      const frame =
        wanted.find((w) => w.chapter.id === sheet.chapter)?.frame ?? board.find((f) => f.chapter === sheet.chapter);
      const img = job.images[frame?.image ?? 0];
      const model = sheet.imageModel
        ? { imageModel: sheet.imageModel, resolution: sheet.resolution ?? CAST_SHEET_MODEL.resolution }
        : { imageModel: job.imageModel, resolution: job.resolution };
      return img ? [sheetStill(job, chapterById(sheet.chapter), img, sheet.stillId, job.createdAt, model)] : [];
    }),
  ];
  if (restored.length === 0) return;
  await updateLibrary(owner, (l) => {
    const ids = new Set(l.stills.map((s) => s.id));
    const add = restored.filter((s) => !ids.has(s.id));
    if (add.length === 0) return l;
    // At the front, so the cap trims something else rather than these again.
    return { ...l, stills: [...add, ...l.stills] };
  });
}

/** The library could not record a task that is already running (and billed) on Runway. */
function unsaved(what: string, err: unknown): TRPCError {
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: `${what} started on Runway, but your library could not save it, so this page cannot follow it. Look for it in your Runway account, and try again in a moment.`,
    cause: err,
  });
}

const jobIdInput = z.string().min(1).max(200);

const frameInput = z.object({
  id: jobIdInput,
  image: z.number().int().min(0).max(MAX_LIFESTYLE_IMAGES - 1),
});

const choiceInput = frameInput.extend({
  chapter: z.enum(CHAPTER_IDS).optional(),
  grammar: z.enum(GRAMMAR_IDS).optional(),
  keep: z.string().max(300, 'What to keep is over 300 characters. Shorten it and try again.').optional(),
  crop: z.string().max(200, 'What the camera moves in on is over 200 characters. Shorten it and try again.').optional(),
  people: z.string().max(400, 'Who is there is over 400 characters. Shorten it and try again.').optional(),
  note: z.string().max(400, 'The direction is over 400 characters. Shorten it and try again.').optional(),
  sun: z.enum(SUN_POSITION_IDS).nullable().optional(),
  light: z.string().max(300, 'The lighting brief is over 300 characters. Shorten it and try again.').optional(),
  lighting: z.enum(LIGHTING_PRESET_IDS).nullable().optional(),
  depth: z.enum(DEPTH_IDS).nullable().optional(),
  focus: z.enum(FOCUS_IDS).nullable().optional(),
  include: z.boolean().optional(),
  take: z.string().max(200).optional(),
});

export const lifestyleRouter = router({
  /** Start planning: Claude looks at the renders (in batches of six, one after another). */
  plan: signedInProcedure
    .input(
      z.object({
        images: z
          .array(
            z.object({
              url: z.string().url(),
              width: z.number().int().min(16).max(16384),
              height: z.number().int().min(16).max(16384),
              name: z.string().max(200).default(''),
            })
          )
          .min(1, 'Add at least one render.')
          .max(MAX_LIFESTYLE_IMAGES, `A lifestyle plan takes up to ${MAX_LIFESTYLE_IMAGES} renders.`),
        imageModel: z.enum(IMAGE_MODEL_IDS).default(DEFAULT_MODEL),
        resolution: z.string().max(20).optional(),
        heritage: z.enum(ETHNICITY_IDS).default(DEFAULT_HERITAGE),
        household: z
          .string()
          .max(400, 'The note about the household is over 400 characters. Shorten it and try again.')
          .default(''),
        /** One director lens for the whole plan (src/direction.ts); older pages send none. */
        directorStyle: z.enum(DIRECTOR_LENS_IDS).default(DEFAULT_DIRECTOR_LENS),
        /** Optional light, colour and planting reference: an ephemeral `/api/upload` URL. */
        lightRefUrl: z.string().url().optional(),
        /** The second pass that finishes each take; `null` shoots one pass. */
        pass2: z
          .object({ imageModel: z.enum(IMAGE_MODEL_IDS), resolution: z.string().max(20).optional() })
          .nullable()
          .default(DEFAULT_PASS2),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      // Pass 2 sends the first pass and the render, so its model takes two images.
      if (input.pass2 && !imageModelTakesCastSheet(input.pass2.imageModel)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `${imageModelName(input.pass2.imageModel)} takes only one reference image, so it cannot finish a frame from the first pass and the render. Choose another model for pass 2, or one pass.`,
        });
      }
      const job: LifestyleJob = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        imageModel: input.imageModel,
        resolution: resolutionFor(input.imageModel, input.resolution),
        pass2: input.pass2
          ? {
              imageModel: input.pass2.imageModel,
              resolution: resolutionFor(input.pass2.imageModel, input.pass2.resolution),
            }
          : undefined,
        heritage: input.heritage,
        household: input.household.trim(),
        directorStyle: input.directorStyle,
        lightRefUrl: input.lightRefUrl,
        images: input.images,
        status: 'planning',
        planTaskIds: [],
      };
      // Only the first batch is sent here; `advance` sends each later one once
      // the batch before it is answered, so it can be told the plan so far.
      try {
        job.planTaskIds.push(await submitPlanner(ctx, owner, job, 0));
      } catch (err) {
        throw toTrpcError(err);
      }
      await updateJobs(owner, (jobs) => [job, ...jobs.filter((j) => j.id !== job.id)]);
      return { id: job.id };
    }),

  /**
   * One poll of a plan (the newest when no id is given); `null` when there is
   * none. On a two-pass plan it also sends each finished first pass on to
   * its second (`advancePasses`).
   */
  job: signedInProcedure
    .input(z.object({ id: jobIdInput.optional() }))
    .query(async ({ ctx, input }): Promise<LifestyleJob | null> => {
      const owner = await ownerKey(ctx.req);
      const jobs = await readJobs(owner);
      const job = input.id ? jobs.find((j) => j.id === input.id) : jobs[0];
      if (!job) return null;
      let out: LifestyleJob;
      try {
        out = await advance(ctx, owner, job);
        out = await advancePasses(ctx, owner, out);
      } catch (err) {
        throw toTrpcError(err);
      }
      await restoreTakes(owner, out).catch((err: unknown) => console.warn('[lifestyle] restore', err));
      return out;
    }),

  /** Save a frame's chapter, shot, keep-list, crop, people, note, sun, light, lighting, depth, focus, inclusion or take as the person changes them. */
  choose: signedInProcedure.input(choiceInput).mutation(async ({ ctx, input }) => {
    const owner = await ownerKey(ctx.req);
    const { id, image, ...choice } = input;
    const stored = await transition(
      owner,
      id,
      (j) => image < j.images.length,
      (j) => ({ choices: { ...j.choices, [image]: { ...j.choices?.[image], ...choice } } })
    );
    // `transition` hands back the unchanged job when the check fails.
    if (!stored || image >= stored.images.length) throw notFound();
    return { saved: true };
  }),

  /**
   * Set the household's cast. `generated` makes one sheet per chapter that
   * has residents (a paid CAST_SHEET_MODEL still each, every call a new
   * set), shot on one of the chapter's renders; the page shows them and
   * calls `approveCast`.
   * `uploaded` uses the person's own sheet, `none` shoots without one; both
   * are approved at once.
   */
  cast: signedInProcedure
    .input(
      z.object({
        id: jobIdInput,
        mode: z.enum(['generated', 'uploaded', 'none']),
        /** `uploaded`: an ephemeral `/api/upload` URL. */
        uploadedUrl: z.string().url().optional(),
      })
    )
    .mutation(async ({ ctx, input }): Promise<{ cast: LifestyleCast }> => {
      const owner = await ownerKey(ctx.req);
      const job = (await readJobs(owner)).find((j) => j.id === input.id);
      if (!job) throw notFound();
      if (job.status !== 'planned') throw notPlanned();
      if (input.mode !== 'none' && !imageModelTakesCastSheet(job.imageModel)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This model takes only one reference image, so it cannot use a cast sheet. Choose No cast, or plan again on another model.',
        });
      }
      if (input.mode !== 'generated') {
        if (input.mode === 'uploaded' && !input.uploadedUrl) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Upload a cast sheet first.' });
        }
        const cast: LifestyleCast =
          input.mode === 'uploaded'
            ? { mode: 'uploaded', uploadedUrl: input.uploadedUrl, approved: true }
            : { mode: 'none', approved: true };
        const stored = await transition(owner, job.id, (j) => j.status === 'planned', () => ({ cast }));
        if (!stored) throw notFound();
        return { cast };
      }

      // Claim the cast before sending it, so a second click never bills it twice.
      const claim = { at: new Date().toISOString(), by: randomUUID() };
      const claimed = await transition(
        owner,
        job.id,
        (j) => j.status === 'planned' && claimIsFree(j),
        () => ({ submitting: claim })
      );
      if (!claimed) throw notFound();
      if (claimed.submitting?.by !== claim.by) {
        throw new TRPCError({ code: 'CONFLICT', message: 'The cast is already being created. Wait a moment for it.' });
      }
      const release = (patch: Partial<LifestyleJob> = {}) =>
        transition(owner, job.id, (j) => j.submitting?.by === claim.by, () => ({ ...patch, submitting: undefined }));
      const wanted = castPlan(claimed);
      if (wanted.length === 0) {
        await release();
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'No frame in the film has residents in it, so there is no cast to create. Choose No cast.',
        });
      }
      const sheets: CastSheet[] = [];
      const stills: Still[] = [];
      let failure: unknown;
      const model = CAST_SHEET_MODEL;
      for (const { chapter, roles, frame } of wanted) {
        const img = claimed.images[frame.image];
        if (!img) continue;
        try {
          const { id } = await submitStill(
            ctx,
            {
              imageModel: model.imageModel,
              imageUrl: img.url,
              width: img.width,
              height: img.height,
              frame: { width: img.width, height: img.height },
              resolution: model.resolution,
              lightRefUrl: claimed.lightRefUrl,
            },
            buildCastSheetPrompt(roles, chapter.id, frame.setting, claimed.heritage, claimed.lightRefUrl !== undefined)
          );
          sheets.push({ chapter: chapter.id, stillId: id, roles, ...model });
          stills.push(sheetStill(claimed, chapter, img, id, new Date().toISOString(), model));
        } catch (err) {
          // The sheets already sent are kept; the rest can be made again.
          logRejection('lifestyle cast', model.imageModel, err);
          failure = err;
          break;
        }
      }
      const cast: LifestyleCast = { mode: 'generated', sheets, approved: false };
      if (stills.length === 0) {
        await release().catch(() => {});
        throw failure ? toTrpcError(failure) : notPlanned();
      }
      try {
        await updateLibrary(owner, (lib) => {
          const ids = new Set(stills.map((s) => s.id));
          return { ...lib, stills: [...stills, ...lib.stills.filter((s) => !ids.has(s.id))] };
        });
        await release({ cast });
      } catch (err) {
        console.warn('[lifestyle] could not save the cast', sheets.map((s) => s.stillId), err);
        // Free the claim, so the cast can be tried again now, not in three minutes.
        await release().catch(() => {});
        throw unsaved('The cast', err);
      }
      if (failure) throw toTrpcError(failure);
      return { cast };
    }),

  /** The person has seen the generated cast: frames may be shot with it. */
  approveCast: signedInProcedure.input(z.object({ id: jobIdInput })).mutation(async ({ ctx, input }) => {
    const owner = await ownerKey(ctx.req);
    const stored = await transition(
      owner,
      input.id,
      (j) => j.cast !== undefined,
      (j) => (j.cast ? { cast: { ...j.cast, approved: true } } : {})
    );
    if (!stored) throw notFound();
    if (!stored.cast) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Create the cast first.' });
    return { approved: true };
  }),

  /**
   * Shoot one frame from its render with the plan and the person's changes,
   * the chapter's cast sheet (when the frame has residents) and the light
   * reference. The page sends its current choices too, so a change made a
   * moment before the click is never lost to a save still on its way;
   * `fixes` are a people check's corrections for a re-take. On a two-pass
   * plan this is the take's first pass; a poll of `job` sends its second.
   */
  shoot: signedInProcedure
    .input(
      choiceInput.extend({
        fixes: z
          .string()
          .max(2000, 'The corrections for the re-take are too long. Run the people check again, or make a new take.')
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      const { id: jobId, image: frameImage, fixes = '', ...latest } = input;
      const job = await transition(
        owner,
        jobId,
        (j) => frameImage < j.images.length,
        (j) => ({ choices: { ...j.choices, [frameImage]: { ...j.choices?.[frameImage], ...latest } } })
      );
      if (!job || frameImage >= job.images.length) throw notFound();
      const board = boardFrames(job);
      const order = board.findIndex((f) => f.image === frameImage) + 1;
      const frame = board[order - 1];
      const img = job.images[frameImage];
      if (job.status !== 'planned' || !frame || !img) throw notPlanned();
      if (!frame.include) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'This frame is left out of the film. Put it back in to shoot it.',
        });
      }
      const grammar = grammarById(frame.grammar);
      const chapter = chapterById(frame.chapter);
      const lighting = frameLighting(frame);
      const camera = frameCamera(frame);
      if (grammar.people && (!frame.people || NO_PEOPLE_LEAD.test(frame.people))) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Say who is there and where before shooting this frame as a ${grammar.name.toLowerCase()}, or shoot it as Empty.`,
        });
      }
      // The household's sheet rides along only for a frame they are in, and
      // only on a model that takes a second reference image.
      let castSheetUrl: string | undefined;
      const cast = job.cast;
      if (grammar.people && frame.cast.length > 0 && cast && imageModelTakesCastSheet(job.imageModel)) {
        if (cast.mode === 'uploaded') castSheetUrl = cast.uploadedUrl;
        if (cast.mode === 'generated') {
          const sheet = cast.sheets?.find((s) => s.chapter === frame.chapter);
          const made = sheet && (await readLibrary(owner)).stills.find((s) => s.id === sheet.stillId);
          if (!sheet || !made || made.status === 'failed') {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: `The cast for ${chapter.name} ${sheet && made ? 'could not be made' : 'has no sheet'}. Create the cast again, or shoot without a cast.`,
            });
          }
          if (made.status !== 'succeeded') {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: `The cast for ${chapter.name} is not ready yet. Wait for it or shoot without a cast.`,
            });
          }
          try {
            castSheetUrl = await finishedUrl(ctx, sheet.stillId, owner);
          } catch (err) {
            throw toTrpcError(err);
          }
        }
      }
      const prompt = buildLifestylePrompt(
        {
          setting: frame.setting,
          chapter: frame.chapter,
          grammar: frame.grammar,
          keep: frame.keep,
          crop: frame.crop,
          people: frame.people,
          castRoles: frame.cast,
          note: frame.note,
          fixes,
          sun: frame.sun, light: frame.light,
          lighting: frame.lighting, depth: frame.depth, focus: frame.focus,
        },
        {
          heritage: job.heritage,
          castSheet: castSheetUrl !== undefined,
          lightReference: job.lightRefUrl !== undefined,
          plate: isTwoPass(job),
          maxLength: imageModelPromptLimit(job.imageModel),
        }
      );
      let id: string;
      try {
        ({ id } = await submitStill(
          ctx,
          {
            imageModel: job.imageModel,
            imageUrl: img.url,
            castSheetUrl,
            lightRefUrl: job.lightRefUrl,
            width: img.width,
            height: img.height,
            frame: { width: img.width, height: img.height },
            resolution: job.resolution,
            quality: PASS1_QUALITY,
          },
          prompt
        ));
      } catch (err) {
        logRejection('lifestyle', job.imageModel, err);
        throw toTrpcError(err);
      }
      const still = frameStill(job, frame, order, img, { id, createdAt: new Date().toISOString(), castSheetUrl });
      try {
        await updateLibrary(owner, (lib) => ({ ...lib, stills: [still, ...lib.stills.filter((s) => s.id !== id)] }));
        await transition(
          owner,
          job.id,
          () => true,
          (j) => ({
            shots: [
              {
                image: frameImage,
                stillId: id,
                createdAt: still.createdAt,
                ...(isTwoPass(job) ? { plate: true as const } : {}),
                ...(lighting ? { lighting } : {}),
                ...(camera ? { camera } : {}),
              },
              ...(j.shots ?? []),
            ].slice(0, 200),
            // A new take is the one the frame uses.
            choices: { ...j.choices, [frameImage]: { ...j.choices?.[frameImage], take: undefined } },
          })
        );
      } catch (err) {
        console.warn('[lifestyle] could not save', id, err);
        throw unsaved('This frame', err);
      }
      return { id };
    }),

  /**
   * Send a take's second pass again: one that failed, was skipped or was
   * deleted (nothing sends those on its own), or whose still failed. Claimed
   * as the poll claims it, so a second click sends nothing more. Returns the
   * take's pass-2 state; a submission Runway refuses is recorded on the take
   * and thrown, so the page can say why.
   */
  retryPass2: signedInProcedure
    .input(z.object({ id: jobIdInput, stillId: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }): Promise<{ pass2: Pass2State | undefined }> => {
      const owner = await ownerKey(ctx.req);
      const job = (await readJobs(owner)).find((j) => j.id === input.id);
      if (!job) throw notFound();
      if (job.status !== 'planned') throw notPlanned();
      if (!isTwoPass(job)) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'This plan is one pass, so there is no second pass to retry.',
        });
      }
      const shot = job.shots?.find((s) => s.stillId === input.stillId);
      if (!shot) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That take is no longer in this plan. Shoot the frame again.' });
      }
      const pass2 = shot.pass2;
      const finishId = pass2?.state === 'started' ? pass2.stillId : undefined;
      let status: Map<string, TaskState>;
      try {
        status = await liveStatuses(ctx, owner, await readLibrary(owner), [shot.stillId, ...(finishId ? [finishId] : [])]);
      } catch (err) {
        throw toTrpcError(err);
      }
      const first = status.get(shot.stillId);
      if (first !== 'succeeded') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: first === 'pending' ? 'The first pass has not finished yet.' : 'The first pass failed. Shoot the frame again.',
        });
      }
      const running = () => new TRPCError({ code: 'CONFLICT', message: 'Pass 2 is already running.' });
      if (pass2?.state === 'starting' && !unclaimed(pass2, Date.now())) throw running();
      if (finishId) {
        // A started still missing from the library (`restoreTakes` puts it
        // back) may be running or done on Runway: only a failed one is sent
        // again, and one Runway can't say about counts as running (the
        // library's own poll closes it once it is long gone).
        const finish =
          status.get(finishId) ??
          (await ctx.runway
            .taskSnapshot(finishId)
            .then((snap) => settled(snap).status)
            .catch((): TaskState => 'pending'));
        if (finish === 'pending') throw running();
        if (finish === 'succeeded') throw new TRPCError({ code: 'CONFLICT', message: 'Pass 2 has already finished.' });
      }
      let out: { job: LifestyleJob; error?: TRPCError };
      try {
        // The stored state must still be one this retry may take over (the
        // claim re-checks it, so a poll or another click that got there
        // first wins); used by its frame or not, as the person asked for it.
        out = await startPass2(
          ctx,
          owner,
          job,
          shot,
          attemptOf(pass2) + 1,
          (p) =>
            unclaimed(p, Date.now()) ||
            p?.state === 'failed' ||
            p?.state === 'skipped' ||
            p?.state === 'deleted' ||
            (p?.state === 'started' && p.stillId === finishId)
        );
      } catch (err) {
        throw toTrpcError(err);
      }
      if (out.error) throw out.error;
      return { pass2: out.job.shots?.find((s) => s.stillId === shot.stillId)?.pass2 };
    }),
});
