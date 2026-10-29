import {
  describeRunwayFailure,
  getRunwayToken,
  listTaskTypes,
  parseRunwayApiErrorReason,
  RunwayAuthError,
  RunwayCreditError,
  RunwayTaskError,
  snapAspectRatio,
  type RunwayProfile,
  type TaskSnapshot,
} from '@runway/bay/runway';
import { decodeJwtPayload } from '@runway/bay/runway/cookie';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { createTextTask, textTaskSnapshot } from './ai-text.ts';
import {
  buildCheckPrompt,
  CHECK_SYSTEM_PROMPT,
  parseCheckReport,
} from './checks.ts';
import {
  type Clip,
  ownerKey,
  patchClip,
  patchStill,
  readLibrary,
  type Still,
  type StillCheck,
  type TaskState,
  updateLibrary,
} from './library.ts';
import {
  ACTIVITY_IDS,
  AGE_IDS,
  ANGLE_IDS,
  buildCinematicPrompt,
  CROWD_IDS,
  DEFAULT_PEOPLE_OPTIONS,
  ETHNICITY_IDS,
  LOOK_IDS,
  WARDROBE_IDS,
} from './looks.ts';
import {
  compositeError,
  compositeUrl,
  describeMask,
  ensureComposite,
  maskPrefix,
  renderKeyFor,
} from './composite.ts';
import { MAX_TAGS, normalizeTags } from './tags.ts';
import {
  finishedUrl,
  logRejection,
  type RunwayCtx,
  settled,
  snapError,
  toTrpcError,
} from './task-helpers.ts';
import { editRouter } from './edit-api.ts';
import { closeupsRouter } from './closeups-api.ts';
import { locationRouter } from './location-api.ts';
import { forgetTake as forgetLifestyleTake, lifestyleRouter } from './lifestyle-api.ts';
import { forgetTake, storyboardRouter } from './storyboard-api.ts';
import { settingsRouter } from './settings-api.ts';
import { pick, submitStill } from './still-submit.ts';
import { deleteObject, getObject, putObject } from './storage.ts';
import { thumbKey, viewKey } from './thumbs.ts';
import {
  buildVideoPrompt,
  clampPrompt,
  PEOPLE_NEGATIVE_PROMPT,
  STRICT_NEGATIVE_PROMPT,
  CLIP_UPSCALER_IDS,
  clipSeconds,
  FLUX_UPSCALE_MAX_BYTES,
  fluxUpscaleBlock,
  defaultImageResolution,
  defaultVideoResolution,
  IMAGE_MODEL_IDS,
  type ImageModelId,
  imageModelPromptLimit,
  imageModelTakesCastSheet,
  imageResolutions,
  aspectDims,
  gen4ImageSize,
  imageModelHasAspect,
  maskedEditFit,
  snapMatchFrame,
  type Orientation,
  orientationOf,
  snapVideoSeconds,
  defaultVideoSeconds,
  extraImageHandles,
  rewriteExtraImageHandles,
  videoExtraImageLimit,
  videoExtrasExcludeEnd,
  videoKeyframeLimit,
  videoModelName,
  videoModelsWith,
  MATCH_RENDER,
  MOTION_IDS,
  MOTIONS,
  MOVE_STYLE_IDS,
  type MotionId,
  type MoveStyleId,
  SPEED_IDS,
  type SpeedId,
  STILL_UPSCALER_IDS,
  type StillUpscalerId,
  VIDEO_MODEL_IDS,
  type VideoModelId,
  videoResolutions,
} from './models.ts';

import { type AppProfile, resolveProfileIdentity } from './profile.ts';
import {
  publicProcedure,
  router,
  signedInProcedure,
  type Context,
} from './trpc.ts';

export type { AppProfile } from './profile.ts';
export type { CheckReport } from './checks.ts';
export type { Clip, Library, Still, StillCheck } from './library.ts';

/**
 * Trimmed view of a catalog entry for the browse-only model list. `type` is
 * plain `string`, not the full ~100-member `TaskType` union `listTaskTypes`
 * returns — keeping that union off the tRPC client boundary is what fixes a
 * `TS2339` on `trpc.generate.useMutation()` in src/client/App.tsx: past a
 * certain size, `@trpc/react-query`'s type-level router mapping can degrade
 * silently instead of erroring, collapsing every procedure's inferred type.
 */
export interface ModelSummary {
  type: string;
  label: string;
  provider: string;
  description: string;
}

/**
 * Gather what the request knows about the visitor and hand the decision to
 * `resolveProfileIdentity` (src/profile.ts): gateway headers, the Runway
 * profile if the session has one and the call succeeds, and the session
 * JWT's own email as the fallback when it doesn't. A visitor with neither a
 * session nor a gateway identity is anonymous (`null`) before any call.
 */
async function resolveProfile(ctx: Context): Promise<AppProfile | null> {
  const headerEmail = ctx.user?.email;
  if (!ctx.runway && !headerEmail) return null;

  let runwayProfile: RunwayProfile | undefined;
  if (ctx.runway) {
    try {
      runwayProfile = await ctx.runway.getProfile();
    } catch {
      runwayProfile = undefined;
    }
  }
  const token = getRunwayToken(ctx.req);
  return resolveProfileIdentity({
    headerEmail,
    headerName: ctx.user?.name,
    hasRunwayClient: ctx.runway !== undefined,
    runwayProfile,
    tokenEmail: token ? decodeJwtPayload(token)?.email : undefined,
  });
}

/**
 * A frame or reference image for a clip: one of the visitor's own library
 * stills (signed server-side, never a client URL) or an image they uploaded
 * through `POST /api/upload`.
 */
/** Longest extra direction a clip takes, in characters. */
const VIDEO_DIRECTION_MAX = 600;

const frameRef = z.union([
  z.object({ stillId: z.string().min(1).max(200) }),
  z.object({ uploadUrl: z.url().max(4000) }),
]);
type FrameRef = z.infer<typeof frameRef>;

/**
 * The first frame of a clip. An upload carries its real pixel size (read by
 * the browser from the file), because the clip's shape follows the frame it
 * starts on, not the still picked in step 1.
 */
const firstFrameRef = z.union([
  z.object({ stillId: z.string().min(1).max(200) }),
  z.object({
    uploadUrl: z.url().max(4000),
    width: z.number().int().min(1).max(20000),
    height: z.number().int().min(1).max(20000),
  }),
]);

/** A frame between first and last; `at` is how far into the clip (0 to 1). */
const middleFrameRef = z.union([
  z.object({ stillId: z.string().min(1).max(200), at: z.number().min(0.05).max(0.95) }),
  z.object({ uploadUrl: z.url().max(4000), at: z.number().min(0.05).max(0.95) }),
]);

/** What a video model can't take, said in words, before anything is billed. */
function checkFrameInput(input: {
  videoModel: VideoModelId;
  direction: string;
  lastFrame?: FrameRef | undefined;
  middleFrames: readonly { at: number }[];
  refs: readonly unknown[];
}) {
  const name = videoModelName(input.videoModel);
  const bad = (message: string) => new TRPCError({ code: 'BAD_REQUEST', message });
  const limit = videoKeyframeLimit(input.videoModel);
  if (input.lastFrame && limit < 2) {
    throw bad(
      `${name} can't take a last frame. Pick ${videoModelsWith('end').slice(0, 3).join(', ')} or another model that can.`
    );
  }
  if (input.middleFrames.length > 0 && limit < 3) {
    throw bad(
      `${name} takes a first and a last frame only.${
        videoModelsWith('middle').length > 0
          ? ` Frames in between work with ${videoModelsWith('middle').join(', ')}.`
          : ' Remove the frames in between and try again.'
      }`
    );
  }
  if (input.middleFrames.some((m, i, all) => i > 0 && m.at - all[i - 1]!.at < 0.04)) {
    throw bad('Two in-between frames sit at the same point in the clip. Move one of them.');
  }
  if (1 + input.middleFrames.length + (input.lastFrame ? 1 : 0) > limit) {
    throw bad(`${name} takes at most ${limit} frames in total. Remove one and try again.`);
  }
  const extra = videoExtraImageLimit(input.videoModel);
  if (input.refs.length > 0 && extra === 0) {
    throw bad(
      `${name} can't take extra images. Pick ${videoModelsWith('extra').join(', ')} to use them.`
    );
  }
  if (input.refs.length > extra) {
    throw bad(`${name} takes at most ${extra} extra images. Remove ${input.refs.length - extra} and try again.`);
  }
  if (input.refs.length > 0 && input.lastFrame && videoExtrasExcludeEnd(input.videoModel)) {
    throw bad(
      `${name} can't use a last frame and extra images in the same clip. Remove one of them.`
    );
  }
  for (const n of extraImageHandles(input.direction)) {
    if (n < 1 || n > input.refs.length) {
      throw bad(
        input.refs.length === 0
          ? `Your direction mentions @img${n} but no extra images are added.`
          : `Your direction mentions @img${n} but only @img1 to @img${input.refs.length} exist.`
      );
    }
  }
}

/** A clip's size in bytes from a HEAD request; 0 when it can't be told. */
async function clipBytes(url: string): Promise<number> {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    return Number(res.headers.get('content-length')) || 0;
  } catch {
    return 0;
  }
}

/**
 * Save a new clip's record. A clip with no record would 404 on every poll and
 * never show in Your clips, so one failure is retried and a second is said
 * out loud instead of returning an id the app can't follow.
 */
async function recordClip(owner: string, clip: Clip): Promise<void> {
  const save = () =>
    updateLibrary(owner, (lib) => ({
      ...lib,
      clips: [clip, ...lib.clips.filter((c) => c.id !== clip.id)],
    }));
  try {
    await save();
    return;
  } catch (first) {
    console.warn('[library] could not record clip, retrying', clip.id, first);
  }
  try {
    await save();
  } catch (err) {
    console.warn('[library] could not record clip', clip.id, err);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message:
        'Your video started on Runway, but saving it to your library failed, so this page cannot follow it. Look for it in your Runway account, and try again in a moment.',
      cause: err,
    });
  }
}

/**
 * Save a new still's record, retrying once. A paid take with no record would
 * read as "deleted" on its first poll, so a second failure is said out loud
 * with a 4xx code (which the error formatter passes through unmasked).
 */
async function recordStillWithRetry(
  update: Parameters<typeof updateLibrary>[1],
  owner: string,
  id: string,
  message: string
): Promise<void> {
  try {
    await updateLibrary(owner, update);
    return;
  } catch (first) {
    console.warn('[library] could not record still, retrying', id, first);
  }
  try {
    await updateLibrary(owner, update);
  } catch (err) {
    console.warn('[library] could not record still', id, err);
    throw new TRPCError({ code: 'CONFLICT', message, cause: err });
  }
}

/**
 * `@imgN` into the words the model reads. The picked frame is image 1 and
 * the extras follow, so @img1 is "image 2" (Seedance and MiniMax read plain
 * reference images in order).
 */
function rewriteHandles(model: VideoModelId, direction: string, refCount: number): string {
  if (refCount === 0 || videoExtraImageLimit(model) === 0) return direction;
  return rewriteExtraImageHandles(direction, (n) => `image ${n + 1}`);
}

export const AppRouter = router({
  /** The Edit tab: timeline, grades, AI editor, memory, export (src/edit-api.ts). */
  edit: editRouter,
  closeups: closeupsRouter,
  /** The Location tab: a Google Earth screenshot turned into an aerial photograph (src/location-api.ts). */
  location: locationRouter,
  /** The Director tab: a storyboard planned by Claude, shot frame by frame (src/storyboard-api.ts). */
  storyboard: storyboardRouter,
  /** The Lifestyle tab: every render planned as a frame of a lifestyle film, cast and shot (src/lifestyle-api.ts). */
  lifestyle: lifestyleRouter,
  /** The Settings tab: Runway, Higgsfield and other MCP servers, Seevio key (src/settings-api.ts). */
  settings: settingsRouter,

  profile: publicProcedure.query(({ ctx }) => resolveProfile(ctx)),

  /** Image-generation models for the example generate page's picker. */
  models: publicProcedure.query((): ModelSummary[] =>
    listTaskTypes({ modality: 'image', kind: 'generation' })
  ),

  /**
   * Submit a render for a photoreal, cinematic re-shoot on the chosen image
   * model and return the task id at once — the client polls `shotStatus`.
   * Never awaits the generation: it runs past the gateway's request timeout.
   *
   * `imageUrl` is the render uploaded through `POST /api/upload`
   * (src/api-routes.ts). `fixes` carries a people check's corrections into a
   * re-take. Billed to the visitor's own Runway credits. The still is recorded
   * in their library so the Video tab can pick it later.
   */
  createShot: signedInProcedure
    .input(
      z.object({
        imageUrl: z.string().url(),
        imageModel: z.enum(IMAGE_MODEL_IDS).default('nano-banana-pro'),
        look: z.enum(LOOK_IDS),
        direction: z
          .string()
          .max(
            VIDEO_DIRECTION_MAX,
            `Your extra direction is over ${VIDEO_DIRECTION_MAX} characters. Shorten it and try again.`
          )
          .default(''),
        crowd: z.enum(CROWD_IDS).default('none'),
        people: z
          .string()
          .max(400, 'The note about the people is over 400 characters. Shorten it and try again.')
          .default(''),
        ethnicity: z.enum(ETHNICITY_IDS).default(DEFAULT_PEOPLE_OPTIONS.ethnicity),
        age: z.enum(AGE_IDS).default(DEFAULT_PEOPLE_OPTIONS.age),
        wardrobe: z.enum(WARDROBE_IDS).default(DEFAULT_PEOPLE_OPTIONS.wardrobe),
        activity: z.enum(ACTIVITY_IDS).default(DEFAULT_PEOPLE_OPTIONS.activity),
        /** Optional cast sheet: an ephemeral `/api/upload` URL, sent as a second reference. */
        castSheetUrl: z.string().url().optional(),
        /** Optional lighting reference: only its light is used; the look is ignored. */
        lightRefUrl: z.string().url().optional(),
        /** Or: match the light of one of the visitor's finished stills (a series). */
        lightFromStillId: z.string().min(1).max(200).optional(),
        angle: z.enum(ANGLE_IDS).default('as-rendered'),
        /** "Only what's in the image": nothing new appears but the people asked for. */
        onlyInImage: z.boolean().default(true),
        fixes: z
          .string()
          .max(2000, 'The corrections for the re-take are too long. Run the people check again, or make a new take.')
          .default(''),
        resolution: z.string().max(16).optional(),
        /** "match" (the render's own shape) or one of the model's ratios. */
        aspectRatio: z.string().max(8).default(MATCH_RENDER),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        /**
         * A marked edit: the mask `POST /api/mask` stored. Only that area may
         * change; the rest of the still is rebuilt from the render itself.
         */
        maskKey: z.string().max(200).optional(),
        /** The browser's stored copy of the render (`POST /api/render-copy`). */
        renderKey: z.string().max(200).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      let masked: string | undefined;
      if (input.maskKey !== undefined) {
        if (
          !input.maskKey.startsWith(maskPrefix(owner)) ||
          input.maskKey.includes('..')
        ) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'That marked area is not yours. Mark the area again.',
          });
        }
        const mask = await describeMask(input.maskKey).catch((err: unknown) => {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              err instanceof Error && err.message.includes('missing')
                ? err.message
                : 'The marked area could not be read. Mark it again.',
          });
        });
        if (!mask) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Nothing is marked yet. Paint over the area to change, or turn marking off.',
          });
        }
        masked = mask.region;
        // The untouched area is pasted back from the render, so the model's
        // output must have the render's shape; refuse a model that cannot.
        const fit = maskedEditFit(input.imageModel, input.width, input.height);
        if (!fit.ok) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: fit.reason });
        }
      }
      // An unknown ratio for this model falls back to the render's own shape.
      // A marked edit always keeps the render's frame and viewpoint: the
      // untouched area is pasted back from it pixel for pixel.
      if (masked) {
        input.aspectRatio = MATCH_RENDER;
        input.angle = 'as-rendered';
      }
      const aspectRatio =
        input.aspectRatio !== MATCH_RENDER &&
        imageModelHasAspect(input.imageModel, input.aspectRatio)
          ? input.aspectRatio
          : undefined;
      // A marked edit asks the model for exactly the frame `maskedEditFit`
      // approved (the model's own ratio nearest the render's).
      const frame = masked
        ? snapMatchFrame(input.imageModel, input.width, input.height)
        : (aspectDims(aspectRatio) ?? { width: input.width, height: input.height });
      const reframe =
        aspectRatio &&
        Math.abs(frame.width / frame.height / (input.width / input.height) - 1) > 0.04
          ? aspectRatio
          : undefined;
      const resolution =
        input.resolution &&
        imageResolutions(input.imageModel).some((r) => r.id === input.resolution)
          ? input.resolution
          : defaultImageResolution(input.imageModel);
      // A cast sheet only means something with people, and only on a model
      // that takes a second reference image; otherwise it is ignored.
      const castSheetUrl =
        input.crowd !== 'none' && imageModelTakesCastSheet(input.imageModel)
          ? input.castSheetUrl
          : undefined;
      // A marked edit keeps the render's own light everywhere it doesn't change.
      let lightRefUrl = masked ? undefined : input.lightRefUrl;
      // A series: the other still's own finished image is the reference, signed
      // fresh now, so it never expires the way an upload does.
      let series: { from: string; seriesId: string } | undefined;
      if (!masked && input.lightFromStillId !== undefined) {
        const lib = await readLibrary(owner);
        const key = lib.stills.find((s) => s.id === input.lightFromStillId);
        if (!key || key.status === 'failed') {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message:
              'The still you matched the light to is no longer in your library. Pick another lighting reference.',
          });
        }
        // An upscaled still can be far larger than a model takes as a
        // reference; its source still has the same light.
        const refId =
          key.upscaleOf && lib.stills.some((s) => s.id === key.upscaleOf) ? key.upscaleOf : key.id;
        try {
          lightRefUrl = await finishedUrl(ctx, refId, owner);
        } catch (err) {
          throw err instanceof TRPCError
            ? new TRPCError({
                code: err.code,
                message: `The still you matched the light to can't be used: ${err.message}`,
                cause: err,
              })
            : toTrpcError(err);
        }
        series = { from: key.id, seriesId: key.seriesId ?? key.id };
      }
      const prompt = buildCinematicPrompt(
        input.look,
        input.direction,
        input.crowd,
        input.people,
        input.angle,
        input.fixes,
        {
          options: {
            ethnicity: input.ethnicity,
            age: input.age,
            wardrobe: input.wardrobe,
            activity: input.activity,
          },
          castSheet: castSheetUrl !== undefined,
          maxLength: imageModelPromptLimit(input.imageModel),
          reframe,
          masked,
          lightReference: series ? 'series' : lightRefUrl !== undefined,
          strict: input.onlyInImage,
        }
      );
      // The render's upload expires in a day or two; a marked edit's composite
      // is rebuilt from this stored copy whenever it is asked for.
      let renderKey: string | undefined;
      if (masked) {
        // Never fetch a caller-supplied URL to build the composite: the browser
        // stores its own copy first (`POST /api/render-copy`) and names it here.
        const renderPrefix = renderKeyFor(owner, '', '').replace(/\.$/, '');
        if (
          input.renderKey === undefined ||
          !input.renderKey.startsWith(renderPrefix) ||
          input.renderKey.includes('..')
        ) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              input.renderKey === undefined
                ? 'The render for this marked edit was not saved. Upload the render again and try again.'
                : 'That render copy is not yours. Upload the render again.',
          });
        }
        renderKey = input.renderKey;
      }
      let id: string;
      try {
        ({ id } = await submitStill(
          ctx,
          { ...input, castSheetUrl, lightRefUrl, resolution, frame },
          prompt
        ));
      } catch (err) {
        throw toTrpcError(err);
      }
      const still: Still = {
        id,
        createdAt: new Date().toISOString(),
        status: 'pending',
        imageModel: input.imageModel,
        look: input.look,
        angle: input.angle,
        crowd: input.crowd,
        people: input.people,
        ...(input.crowd !== 'none'
          ? {
              ethnicity: input.ethnicity,
              age: input.age,
              wardrobe: input.wardrobe,
              activity: input.activity,
              castSheetUrl,
            }
          : {}),
        ...(series
          ? { lightFromStillId: series.from, seriesId: series.seriesId }
          : lightRefUrl
            ? { lightRefUrl }
            : {}),
        direction: input.direction,
        // The still's own shape: the video tab frames clips from it.
        width: masked ? input.width : frame.width,
        height: masked ? input.height : frame.height,
        ...(aspectRatio ? { aspectRatio } : {}),
        sourceUrl: input.imageUrl,
        resolution,
        ...(masked ? { maskKey: input.maskKey, renderKey } : {}),
      };
      await recordStillWithRetry(
        (lib) => ({
          ...lib,
          // The key still of a new series joins it too.
          stills: [
            still,
            ...lib.stills
              .filter((s) => s.id !== id)
              .map((s) =>
                series && s.id === series.from && !s.seriesId ? { ...s, seriesId: series.seriesId } : s
              ),
          ],
        }),
        owner,
        id,
        masked
          ? 'Your marked edit started on Runway, but your library could not save it, so this page cannot follow it. Look for it in your Runway account, and try again in a moment.'
          : 'Your take started on Runway, but your library could not save it, so this page cannot follow it. Look for it in your Runway account, and try again in a moment.'
      );
      return { id };
    }),

  /** One poll of a `createShot` task: status, progress, result or failure. */
  shotStatus: signedInProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<ShotPoll> => {
      const owner = await ownerKey(ctx.req);
      try {
        const snap = await ctx.runway.taskSnapshot(input.id);
        if (!snap.done) {
          return {
            done: false,
            status: snap.status,
            progress: snap.progress,
            url: snap.url,
            masked: false,
            error: snapError(snap),
          };
        }
        const still = (await readLibrary(owner)).stills.find((s) => s.id === input.id);
        if (!still) {
          // Fail closed: no record means no way to know the still is a marked
          // edit, so no URL goes out at all.
          return {
            done: true,
            status: 'FAILED',
            progress: snap.progress,
            masked: false,
            error: 'This take was deleted from your library.',
          };
        }
        if (still.maskKey && snap.status === 'SUCCEEDED' && snap.url) {
          // A marked edit is only ever shown as the composite: the render
          // everywhere outside the mark, the result inside it.
          try {
            const key = await ensureComposite(owner, still, snap.url);
            if (still.status !== 'succeeded') {
              await patchStill(owner, input.id, () => settled(snap)).catch(() => {});
            }
            return {
              done: true,
              status: snap.status,
              progress: snap.progress,
              url: await compositeUrl(key),
              masked: true,
              error: undefined,
            };
          } catch (err) {
            // Transient: the take stays succeeded and the next poll retries.
            // Only the raw result must never leak.
            console.warn('[composite]', input.id, err);
            if (still.status !== 'succeeded') {
              await patchStill(owner, input.id, () => settled(snap)).catch(() => {});
            }
            return {
              done: true,
              status: snap.status,
              progress: snap.progress,
              masked: true,
              compositePending: true,
              error: compositeError(err),
            };
          }
        }
        await patchStill(owner, input.id, () => settled(snap)).catch(() => {});
        return {
          done: true,
          status: snap.status,
          progress: snap.progress,
          // A failed marked edit has no image to show either.
          url: still.maskKey ? undefined : snap.url,
          masked: Boolean(still.maskKey),
          error: snapError(snap),
        };
      } catch (err) {
        throw toTrpcError(err);
      }
    }),

  /**
   * The visitor's stills and clips, newest first. Anything still marked
   * pending (a tab closed mid-generation) is re-checked here, a few at a
   * time. Media is served by `/api/library/<kind>/<id>`.
   */
  library: signedInProcedure.query(async ({ ctx }) => {
    const owner = await ownerKey(ctx.req);
    let lib = await readLibrary(owner);
    const pending = [
      ...lib.stills.filter((s) => s.status === 'pending').map((s) => s.id),
      ...lib.clips.filter((c) => c.status === 'pending').map((c) => c.id),
    ].slice(0, 16);
    if (pending.length > 0) {
      const snaps = await Promise.all(
        pending.map((id) => ctx.runway.taskSnapshot(id).catch(() => null))
      );
      const done = new Map(
        snaps.flatMap((snap) => (snap?.done ? [[snap.id, settled(snap)]] : []))
      );
      // A take Runway can no longer report on, long after it started, is
      // closed as failed, so it stops holding up the rest and the polling.
      const stale = Date.now() - 2 * 60 * 60 * 1000;
      const items = [...lib.stills, ...lib.clips];
      pending.forEach((id, i) => {
        const item = items.find((x) => x.id === id);
        if (!snaps[i] && item && Date.parse(item.createdAt) < stale) {
          done.set(id, { status: 'failed', error: 'This take could not be found any more. Make it again.' });
        }
      });
      if (done.size > 0) {
        lib = await updateLibrary(owner, (l) => ({
          stills: l.stills.map((s) => ({ ...s, ...done.get(s.id) })),
          clips: l.clips.map((c) => ({ ...c, ...done.get(c.id) })),
        })).catch(() => lib);
        // A marked edit that finished while the tab was closed gets its
        // composite built now (best effort; the library route retries).
        await Promise.all(
          snaps.flatMap((snap) => {
            const still = snap?.done && snap.status === 'SUCCEEDED' && snap.url
              ? lib.stills.find((s) => s.id === snap.id)
              : undefined;
            return still?.maskKey && !still.compositeKey && snap?.url
              ? [
                  ensureComposite(owner, still, snap.url)
                    .then((key) => {
                      lib = {
                        ...lib,
                        stills: lib.stills.map((s) =>
                          s.id === still.id ? { ...s, compositeKey: key } : s
                        ),
                      };
                    })
                    .catch((err: unknown) => {
                      console.warn('[composite]', still.id, err);
                    }),
                ]
              : [];
          })
        );
      }
    }
    return lib;
  }),

  /**
   * Replace the visitor's own @tags on one still or clip. Tags are
   * normalized (src/tags.ts); automatic tags are derived, never stored.
   */
  setTags: signedInProcedure
    .input(
      z.object({
        kind: z.enum(['still', 'clip']),
        id: z.string().min(1),
        tags: z.array(z.string().max(64)).max(MAX_TAGS * 2),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      const tags = normalizeTags(input.tags);
      let found = false;
      await updateLibrary(owner, (lib) =>
        input.kind === 'still'
          ? {
              ...lib,
              stills: lib.stills.map((s) =>
                s.id === input.id ? ((found = true), { ...s, tags }) : s
              ),
            }
          : {
              ...lib,
              clips: lib.clips.map((c) =>
                c.id === input.id ? ((found = true), { ...c, tags }) : c
              ),
            }
      );
      if (!found) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'That item is no longer in your library.',
        });
      }
      return { tags };
    }),

  /**
   * Take a still or clip out of the visitor's library, with its upscaled
   * copies. Videos made from a deleted still stay. Only the library record
   * goes: the Runway task behind it stays in the visitor's Runway history.
   */
  deleteItem: signedInProcedure
    .input(z.object({ kind: z.enum(['still', 'clip']), id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      let removed = 0;
      let dropped: Still[] = [];
      let kept: Still[] = [];
      await updateLibrary(owner, (lib) => {
        const gone = (x: { id: string; upscaleOf?: string | undefined }) =>
          x.id === input.id || x.upscaleOf === input.id;
        if (input.kind === 'still') {
          const stills = lib.stills.filter((s) => !gone(s));
          removed = lib.stills.length - stills.length;
          dropped = lib.stills.filter(gone);
          kept = stills;
          return { ...lib, stills };
        }
        const clips = lib.clips.filter((c) => !gone(c));
        removed = lib.clips.length - clips.length;
        return { ...lib, clips };
      });
      // The marked edit's stored files go with it; a mask shared with a
      // remaining take stays.
      const stillUsed = new Set(kept.flatMap((s) => [s.maskKey, s.renderKey]).filter(Boolean));
      const files = dropped.flatMap((s) => [
        s.maskKey && !stillUsed.has(s.maskKey) ? s.maskKey : undefined,
        s.compositeKey,
        s.renderKey && !stillUsed.has(s.renderKey) ? s.renderKey : undefined,
        thumbKey(owner, s.id),
        viewKey(owner, s.id),
      ]);
      await Promise.all(
        [...new Set(files)].flatMap((key) =>
          key ? [deleteObject(key).catch((err: unknown) => console.warn('[delete]', key, err))] : []
        )
      );
      // A deleted Director or Lifestyle take (or cast sheet) leaves its plan,
      // so the board doesn't put it back in the library.
      await Promise.all(
        dropped.flatMap((st) => [
          ...(st.storyboard
            ? [forgetTake(owner, st.storyboard.jobId, st.id).catch((err: unknown) => console.warn('[delete] storyboard', st.id, err))]
            : []),
          ...(st.lifestyle
            ? [forgetLifestyleTake(owner, st.lifestyle.jobId, st.id).catch((err: unknown) => console.warn('[delete] lifestyle', st.id, err))]
            : []),
        ])
      );
      if (removed === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'That item is no longer in your library.',
        });
      }
      return { removed };
    }),

  /**
   * Ask Claude to inspect a finished still with people in it: height against
   * the scene, grounding and physics, light and shadows, faces and hands,
   * blend, and that nothing else changed. Returns at once; poll
   * `checkStatus`. Billed to the visitor (Claude Opus 5.5).
   */
  checkShot: signedInProcedure
    .input(z.object({ stillId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      const still = (await readLibrary(owner)).stills.find(
        (s) => s.id === input.stillId
      );
      if (!still) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'That still is no longer in your library.',
        });
      }
      try {
        const resultUrl = await finishedUrl(ctx, still.id, owner);
        const { id } = await createTextTask(ctx, owner, {
          name: 'render-to-film people check',
          model: 'claude-opus-5-5',
          system_prompt: CHECK_SYSTEM_PROMPT,
          prompt: buildCheckPrompt(
            {
              ethnicity: still.ethnicity,
              age: still.age,
              wardrobe: still.wardrobe,
              activity: still.activity,
            },
            still.people,
            still.castSheetUrl !== undefined,
            still.lifestyle?.people
          ),
          images: [{ url: still.sourceUrl }, { url: resultUrl }],
          temperature: 0.2,
          max_output_tokens: 10000,
        });
        await patchStill(owner, still.id, () => ({
          check: { status: 'running', taskId: id },
        }));
        return { taskId: id };
      } catch (err) {
        throw toTrpcError(err);
      }
    }),

  /** One poll of a still's people check; `null` when none was run. */
  checkStatus: signedInProcedure
    .input(z.object({ stillId: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<StillCheck | null> => {
      const owner = await ownerKey(ctx.req);
      const check = (await readLibrary(owner)).stills.find(
        (s) => s.id === input.stillId
      )?.check;
      if (!check || check.status !== 'running') return check ?? null;
      try {
        const snap = await textTaskSnapshot(ctx, owner, check.taskId);
        if (!snap.done) return check;
        let next: StillCheck;
        const report =
          snap.status === 'SUCCEEDED' && snap.text && !snap.truncated
            ? parseCheckReport(snap.text)
            : null;
        if (report) {
          next = { status: 'done', taskId: check.taskId, report };
        } else {
          next = {
            status: 'failed',
            taskId: check.taskId,
            error:
              snapError(snap) ??
              (snap.truncated
                ? 'The review ran out of room before it finished. Run the check again.'
                : 'The review came back in a form the app could not read. Run the check again.'),
          };
        }
        await patchStill(owner, input.stillId, () => ({ check: next })).catch(
          () => {}
        );
        return next;
      } catch (err) {
        throw toTrpcError(err);
      }
    }),

  /**
   * Animate one of the visitor's finished stills on the chosen video model.
   * The still is the first frame; the prompt keeps the scene as it is and
   * moves only what moves in life. Returns at once; poll `videoStatus`.
   */
  createVideo: signedInProcedure
    .input(
      z.object({
        stillId: z.string().min(1),
        videoModel: z.enum(VIDEO_MODEL_IDS).default('seedance-2'),
        motion: z.enum(MOTION_IDS).default('still-life'),
        moveStyle: z.enum(MOVE_STYLE_IDS).default('steady'),
        speed: z.enum(SPEED_IDS).default('slow'),
        seconds: z.number().int().min(1).max(60).optional(),
        direction: z.string().max(600).default(''),
        resolution: z.string().max(16).optional(),
        /** Optional first frame other than the picked still. */
        firstFrame: firstFrameRef.optional(),
        /** Optional last frame, for models that take one. */
        lastFrame: frameRef.optional(),
        /** Optional frames between first and last (models with timestamped keyframes). */
        middleFrames: z.array(middleFrameRef).max(8).default([]),
        /** Extra reference images, named @img1, @img2 … in order. */
        refs: z.array(frameRef).max(29).default([]),
        /** Nothing may appear that the image doesn't already show. */
        onlyInImage: z.boolean().default(true),
        /** Shoot it as an architectural film: true verticals, slow motion-control moves. */
        archviz: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      const resolution =
        input.resolution &&
        videoResolutions(input.videoModel).some((r) => r.id === input.resolution)
          ? input.resolution
          : defaultVideoResolution(input.videoModel);
      const seconds = snapVideoSeconds(
        input.videoModel,
        input.seconds ?? defaultVideoSeconds(input.videoModel)
      );
      const lib = await readLibrary(owner);
      const picked = lib.stills.find((s) => s.id === input.stillId);
      if (!picked) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'That still is no longer in your library. Pick another one.',
        });
      }
      // A library still chosen as the first frame is the clip's still.
      const firstId =
        input.firstFrame && 'stillId' in input.firstFrame ? input.firstFrame.stillId : undefined;
      const still = (firstId ? lib.stills.find((s) => s.id === firstId) : undefined) ?? picked;
      // The shape of the clip is the shape of the frame it starts on: that
      // still, or the uploaded image's own size. An upload's contents aren't
      // known here, so it is treated as possibly showing people.
      const shape =
        input.firstFrame && 'uploadUrl' in input.firstFrame
          ? { width: input.firstFrame.width, height: input.firstFrame.height, people: true }
          : { width: still.width, height: still.height, people: still.crowd !== 'none' };
      // In clip order, so the keyframes go out first to last.
      const middleSorted = [...input.middleFrames].sort((a, b) => a.at - b.at);
      checkFrameInput({ ...input, middleFrames: middleSorted });
      let id: string;
      let lastFrameUrl: string | undefined;
      try {
        // An upscaled still can be many times larger than any video model
        // accepts as a first frame; its source still is the same picture.
        const sign = (stillId: string) => {
          const s = lib.stills.find((x) => x.id === stillId);
          if (!s) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: 'A still you chose is no longer in your library. Pick another one.',
            });
          }
          const frameId =
            s.upscaleOf && lib.stills.some((x) => x.id === s.upscaleOf) ? s.upscaleOf : s.id;
          return finishedUrl(ctx, frameId, owner);
        };
        const resolve = (ref: FrameRef) =>
          'stillId' in ref ? sign(ref.stillId) : Promise.resolve(ref.uploadUrl);
        const [frameUrl, last, middle, refs] = await Promise.all([
          input.firstFrame ? resolve(input.firstFrame) : sign(still.id),
          input.lastFrame ? resolve(input.lastFrame) : Promise.resolve(undefined),
          Promise.all(middleSorted.map((m) => resolve(m))),
          Promise.all(input.refs.map((r) => resolve(r))),
        ]);
        lastFrameUrl = last;
        ({ id } = await submitVideo(
          ctx,
          {
            ...input,
            direction: rewriteHandles(input.videoModel, input.direction, refs.length),
            resolution,
            seconds,
          },
          shape,
          frameUrl,
          {
            last,
            middle: middle.map((url, i) => ({ url, at: middleSorted[i]?.at })),
            refs,
          }
        ));
      } catch (err) {
        logRejection('createVideo', input.videoModel, err);
        throw toTrpcError(err);
      }
      const frameCount =
        1 + middleSorted.length + (lastFrameUrl && input.lastFrame ? 1 : 0);
      const clip: Clip = {
        id,
        stillId: still.id,
        createdAt: new Date().toISOString(),
        status: 'pending',
        videoModel: input.videoModel,
        motion: input.motion,
        moveStyle: input.moveStyle,
        speed: input.speed,
        seconds,
        direction: input.direction,
        resolution,
        ...(frameCount > 1 ? { frameCount } : {}),
        ...(input.lastFrame && 'stillId' in input.lastFrame
          ? { lastFrameStillId: input.lastFrame.stillId }
          : {}),
        ...(input.refs.length ? { refCount: input.refs.length } : {}),
      };
      await recordClip(owner, clip);
      return { id };
    }),

  /** One poll of a `createVideo` task. */
  videoStatus: signedInProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      try {
        const snap = await ctx.runway.taskSnapshot(input.id);
        if (snap.done) {
          await patchClip(owner, input.id, () => settled(snap)).catch(() => {});
        }
        return {
          done: snap.done,
          status: snap.status,
          progress: snap.progress,
          url: snap.url,
          error: snapError(snap),
        };
      } catch (err) {
        throw toTrpcError(err);
      }
    }),

  /**
   * Upscale a finished still. The upscaled copy is recorded as its own still
   * (`upscaleOf` names the original) and polled with `shotStatus`, so it
   * shows up on the Video tab like any other take.
   */
  upscaleStill: signedInProcedure
    .input(
      z.object({
        stillId: z.string().min(1),
        upscaler: z.enum(STILL_UPSCALER_IDS).default('precision'),
        factor: z.union([z.literal(2), z.literal(4)]).default(2),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      const parent = (await readLibrary(owner)).stills.find(
        (s) => s.id === input.stillId
      );
      if (!parent) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'That still is no longer in your library.',
        });
      }
      let id: string;
      try {
        const url = await finishedUrl(ctx, parent.id, owner);
        ({ id } = await submitStillUpscale(ctx, input.upscaler, input.factor, url, Boolean(parent.location)));
      } catch (err) {
        throw toTrpcError(err);
      }
      const still: Still = {
        ...parent,
        id,
        createdAt: new Date().toISOString(),
        status: 'pending',
        error: undefined,
        check: undefined,
        upscaleOf: parent.id,
        upscaler: input.upscaler,
        scale: input.factor,
        // Upscaled from the marked edit's composite, so it is final as is.
        maskKey: undefined,
        compositeKey: undefined,
        renderKey: undefined,
      };
      await recordStillWithRetry(
        (lib) => ({
          ...lib,
          stills: [still, ...lib.stills.filter((s) => s.id !== id)],
        }),
        owner,
        id,
        'Your upscale started on Runway, but your library could not save it, so this page cannot follow it. Look for it in your Runway account, and try again in a moment.'
      );
      return { id };
    }),

  /**
   * Upscale a finished clip: Runway's Video Upscale (4×) or FLUX Video
   * Upscale (2×, precise). Recorded as its own clip and polled with
   * `videoStatus`.
   */
  upscaleClip: signedInProcedure
    .input(
      z.object({
        clipId: z.string().min(1),
        upscaler: z.enum(CLIP_UPSCALER_IDS).default('runway'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      const parent = (await readLibrary(owner)).clips.find(
        (c) => c.id === input.clipId
      );
      if (!parent) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'That clip is no longer in your library.',
        });
      }
      let id: string;
      let scale: number;
      try {
        if (input.upscaler === 'runway') {
          const task = await ctx.runway.getTask(parent.id);
          const artifactId = task.artifacts[0]?.id;
          if (task.status !== 'SUCCEEDED' || !artifactId) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message:
                'That clip has not finished, so there is nothing to upscale yet.',
            });
          }
          ({ id } = await ctx.runway.createTask('media_upscale', {
            name: 'render-to-film clip upscale',
            task_artifact_id: artifactId,
          }));
          scale = 4;
        } else {
          const blocked = fluxUpscaleBlock(parent);
          if (blocked) throw new TRPCError({ code: 'BAD_REQUEST', message: blocked });
          const url = await finishedUrl(ctx, parent.id);
          if ((await clipBytes(url)) > FLUX_UPSCALE_MAX_BYTES) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message:
                'This clip is over the 50 MB FLUX Video Upscale takes. Use Runway Video Upscale instead.',
            });
          }
          ({ id } = await ctx.runway.createTask('flux_video_upscale', {
            name: 'render-to-film clip upscale',
            video: {
              url,
              durationSeconds: clipSeconds(parent.videoModel, parent.length, parent.seconds),
            },
            upscaleFactor: 2,
            creativity: 'precise',
          }));
          scale = 2;
        }
      } catch (err) {
        throw toTrpcError(err);
      }
      const clip: Clip = {
        ...parent,
        id,
        createdAt: new Date().toISOString(),
        status: 'pending',
        error: undefined,
        upscaleOf: parent.id,
        upscaler: input.upscaler,
        scale,
      };
      await recordClip(owner, clip);
      return { id };
    }),
});



/** One `shotStatus` poll. `masked`: `url` is the marked edit's composite. */
type ShotPoll = {
  done: boolean;
  status: string;
  progress?: number | undefined;
  url?: string | undefined;
  masked: boolean;
  /**
   * Marked edit finished but its composite could not be built this time: the
   * take is still good, there is no `url`, and polling again retries.
   */
  compositePending?: boolean | undefined;
  error?: string | undefined;
};

/** Upscale a finished still with one of the Magnific upscalers. */
function submitStillUpscale(
  ctx: RunwayCtx,
  upscaler: StillUpscalerId,
  factor: 2 | 4,
  url: string,
  /** A Location-tab aerial: texture-rich settings and an aerial prompt. */
  aerial = false
) {
  const name = 'render-to-film upscale';
  const prompt = aerial
    ? 'A photorealistic high-resolution aerial photograph. Add true fine texture detail: roof tiles, foliage, asphalt, gravel, water. Keep every shape and position exactly as they are.'
    : 'A photorealistic cinematic film still of contemporary architecture. Keep every detail, material and person exactly as they are; only add true fine detail and sharpness.';
  const image = { url, tag: 'still' };
  return upscaler === 'creative'
    ? ctx.runway.createTask('magnific_creative_upscaler', {
        name,
        prompt,
        image,
        scaleFactor: factor,
        optimizedFor: aerial ? 'nature_n_landscapes' : 'films_n_photography',
        creativity: aerial ? 2 : 0,
        resemblance: aerial ? 4 : 6,
        ...(aerial ? { hdr: 1 } : {}),
      })
    : ctx.runway.createTask('magnific_precision_upscaler_v2', {
        name,
        prompt,
        image,
        scaleFactor: factor,
        flavor: 'photo',
        ...(aerial ? { ultraDetail: 40 } : {}),
      });
}

/** Width x height for an orientation, from a [landscape, portrait, square] triple. */
function bySide<T>(orientation: Orientation, sizes: readonly [T, T, T]): T {
  return orientation === 'landscape'
    ? sizes[0]
    : orientation === 'portrait'
      ? sizes[1]
      : sizes[2];
}

/** The video-model preset mapped onto that model's own task options. */
function submitVideo(
  ctx: RunwayCtx,
  input: {
    videoModel: VideoModelId;
    motion: MotionId;
    moveStyle: MoveStyleId;
    speed: SpeedId;
    seconds: number;
    direction: string;
    resolution: string;
    onlyInImage: boolean;
    archviz?: boolean | undefined;
  },
  /** The first frame's real size, and whether it may show people. */
  shape: { width: number; height: number; people: boolean },
  frameUrl: string,
  extra: { last?: string | undefined; middle: { url: string; at?: number | undefined }[]; refs: string[] } = {
    middle: [],
    refs: [],
  }
) {
  const { last, middle, refs } = extra;
  const prompt = clampPrompt(
    buildVideoPrompt(
      input.motion,
      input.direction,
      shape.people,
      input.moveStyle,
      input.speed,
      last || middle.length || refs.length
        ? { last: last !== undefined, middle: middle.length, refs: refs.length }
        : undefined,
      input.onlyInImage,
      input.archviz ?? false
    ),
    3500
  );
  // The strict list already carries the people terms; without it, a frame with people still gets them.
  const negative = input.onlyInImage
    ? { negative_prompt: STRICT_NEGATIVE_PROMPT }
    : shape.people
      ? { negative_prompt: PEOPLE_NEGATIVE_PROMPT }
      : {};
  // Seedance and MiniMax: typed first/end frames, or (with extra images) the
  // frame and the extras as plain references in order. The two can't mix.
  const frameRefs = (): { url: string; type?: 'first_frame' | 'end_frame' }[] =>
    refs.length > 0
      ? [{ url: frameUrl }, ...refs.map((url) => ({ url }))]
      : [
          { url: frameUrl, type: 'first_frame' },
          ...(last ? [{ url: last, type: 'end_frame' as const }] : []),
        ];
  const seconds = snapVideoSeconds(input.videoModel, input.seconds);
  const { width, height } = shape;
  const orientation = orientationOf(width, height);
  const res = input.resolution;
  const name = 'render-to-film clip';
  const seed = Math.floor(Math.random() * 4_294_967_295);
  switch (input.videoModel) {
    case 'seedance-2':
      return ctx.runway.createTask('seedance_2', {
        name,
        textPrompt: prompt,
        referenceImages: frameRefs(),
        resolution: pick(res, ['480p', '720p', '1080p', '4k'] as const, '1080p'),
        aspectRatio: snapAspectRatio(width, height, 'seedance_2') ?? '16:9',
        duration: seconds,
        generateAudio: false,
      });
    case 'seedance-2-fast':
      return ctx.runway.createTask('seedance_2_fast', {
        name,
        textPrompt: prompt,
        referenceImages: frameRefs(),
        resolution: pick(res, ['480p', '720p'] as const, '720p'),
        aspectRatio: snapAspectRatio(width, height, 'seedance_2_fast') ?? '16:9',
        duration: seconds,
        generateAudio: false,
      });
    case 'seedance-2-5':
      return ctx.runway.createTask('seedance_2_5', {
        name,
        textPrompt: prompt,
        referenceImages: frameRefs(),
        resolution: pick(res, ['480p', '720p', '1080p'] as const, '1080p'),
        aspectRatio: snapAspectRatio(width, height, 'seedance_2_5') ?? '16:9',
        duration: seconds,
        generateAudio: false,
      });
    case 'kling-3-pro':
      return ctx.runway.createTask('kling_3_0_pro', {
        name,
        textPrompt: prompt,
        referenceImages: [{ url: frameUrl }, ...(last ? [{ url: last }] : [])],
        // Kling sizes an image-to-video clip from the frame itself and
        // refuses an explicit resolution alongside it.
        duration: seconds,
        cfgScale: 0.5,
        providerSettings: { sound: false },
      });
    case 'kling-3-4k':
      return ctx.runway.createTask('kling_3_0_4k', {
        name,
        textPrompt: prompt,
        referenceImages: [{ url: frameUrl }, ...(last ? [{ url: last }] : [])],
        // Kling sizes an image-to-video clip from the frame itself and
        // refuses an explicit resolution alongside it.
        duration: seconds,
        cfgScale: 0.5,
        providerSettings: { sound: false },
      });
    case 'kling-o3-pro':
      return ctx.runway.createTask('kling_o3_pro', {
        name,
        textPrompt: prompt,
        referenceImages: [{ url: frameUrl }],
        // Kling sizes an image-to-video clip from the frame itself and
        // refuses an explicit resolution alongside it.
        duration: seconds,
        providerSettings: { sound: false },
      });
    case 'gen-4-5':
      return ctx.runway.createTask('gen4.5', {
        name,
        ...(last || middle.length > 0
          ? {
              route: 'k2v' as const,
              text_prompt: prompt,
              seconds,
              // First frame at 0, last at the end, the rest where the visitor put them.
              keyframes: [
                { image: frameUrl, timestamp: 0 },
                ...middle.map((m) => ({
                  image: m.url,
                  timestamp: Math.round((m.at ?? 0.5) * seconds * 10) / 10,
                })),
                ...(last ? [{ image: last, timestamp: seconds }] : []),
              ],
            }
          : {
              route: 't2v' as const,
              text_prompt: prompt,
              init_image: frameUrl,
              seconds,
            }),
        ...bySide(orientation, [
          { width: 1280, height: 720 },
          { width: 720, height: 1280 },
          { width: 960, height: 960 },
        ] as const),
        seed,
        ...negative,
      });
    case 'gen-4-turbo':
      return ctx.runway.createTask('gen4_turbo', {
        name,
        route: 'i2v',
        text_prompt: prompt,
        init_image: frameUrl,
        seconds,
        ...bySide(orientation, [
          { width: 1280, height: 720 },
          { width: 720, height: 1280 },
          { width: 960, height: 960 },
        ] as const),
        seed,
        ...negative,
      });
    case 'veo-3-1':
    case 'veo-3-1-fast':
      return ctx.runway.createTask('veo3_1', {
        name,
        route: 'i2v',
        model: input.videoModel === 'veo-3-1-fast' ? 'veo-3.1-fast' : 'veo-3.1',
        startFrame: { url: frameUrl },
        ...(last ? { endFrame: { url: last } } : {}),
        text_prompt: prompt,
        seconds: seconds === 4 || seconds === 6 ? seconds : 8,
        aspectRatio: orientation === 'portrait' ? '9:16' : '16:9',
        resolution: pick(res, ['720p', '1080p'] as const, '1080p'),
        ...negative,
      });
    case 'minimax-h3':
      return ctx.runway.createTask('minimax_hailuo_3_0', {
        name,
        textPrompt: prompt,
        referenceImages: frameRefs(),
        resolution: res === '768p' ? '768P' : '2K',
        duration: seconds,
        ratio: 'adaptive',
      });
    case 'ltx-2-5-pro': {
      const hd = res !== '720p';
      return ctx.runway.createTask('ltx_2_5_pro', {
        name,
        textPrompt: prompt,
        referenceImages: [
          { url: frameUrl, type: 'first_frame' },
          ...(last ? [{ url: last, type: 'end_frame' as const }] : []),
        ],
        // LTX has no square size; a square still goes out landscape.
        resolution: orientation === 'portrait'
          ? hd ? '1080x1920' : '720x1280'
          : hd ? '1920x1080' : '1280x720',
        duration: seconds === 6 || seconds === 8 ? seconds : 10,
        cameraMotion: (MOTIONS.find((m) => m.id === input.motion) ?? MOTIONS[0]).ltx,
        generateAudio: false,
      });
    }
    case 'wan-2-6': {
      const hd = res !== '720p';
      return ctx.runway.createTask('wan_2_6', {
        name,
        textPrompt: prompt,
        referenceImages: [{ url: frameUrl }],
        resolution: bySide(
          orientation,
          hd
            ? (['1920x1080', '1080x1920', '1440x1440'] as const)
            : (['1280x720', '720x1280', '960x960'] as const)
        ),
        duration: seconds === 15 ? 15 : seconds === 10 ? 10 : 5,
        generateAudio: false,
      });
    }
  }
}

export type AppRouterType = typeof AppRouter;
