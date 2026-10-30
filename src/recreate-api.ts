import { randomUUID } from 'node:crypto';

import { snapAspectRatio } from '@runway/bay/runway';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { artifactOf } from './edit-api.ts';
import {
  type Clip,
  type ClipRecreate,
  ownerKey,
  patchClip,
  readLibrary,
  type RecreateUpscale,
  recordClip,
  updateLibrary,
} from './library.ts';
import { clampPrompt, clipSeconds } from './models.ts';
import {
  buildRecreatePrompt,
  RECREATE_NOTE_MAX,
  DEFAULT_RECREATE_ROUTE,
  OFFERED_RECREATE_ROUTES,
  RECREATE_ROUTE_IDS,
  recreateRoute,
  type RecreateRouteId,
  recreateSeconds,
} from './recreate.ts';
import { buildRecreateDirectedPrompt, resolveShotPlan } from './shot-director.ts';
import { clipShot, shotPlanRawSchema } from './shot-director-api.ts';
import {
  finishedUrl,
  logRejection,
  type RunwayCtx,
  settled,
  snapError,
  toTrpcError,
} from './task-helpers.ts';
import { ensureClipPoster } from './thumbs.ts';
import { router, signedInProcedure } from './trpc.ts';

/**
 * Recreate in 4K, the Video tab's second tab: a reference clip (from the
 * library or uploaded) says how the shot moves, a 4K still is the scene, and
 * the new clip repeats the reference's camera move, action and timing, shot
 * from the still (src/recreate.ts holds the routes and the prompt).
 *
 *   kling-upscale:  step 1, Kling 4.0 at 1080p  →  step 2, its 4K upscale
 *   seedance-4k:    step 1, Seedance 2.0 at 4K (the only step)
 *
 * Each step is a library clip of its own, like a clip upscale today, so the
 * final video is simply the clip whose task holds it. Step 2 starts on a
 * `status` poll under a claim on the step-1 clip (`ClipRecreate.upscale`), so
 * two tabs polling still pay for it once; a start that failed waits for the
 * person's "Try again" (`retryUpscale`).
 */

/** A claim on starting the upscale older than this is taken to have died with its request. */
const STALE_MS = 10 * 60_000;

/** The Runway task each route's shot is sent as. */
const ALIAS: Record<RecreateRouteId, string> = {
  'kling-upscale': 'kling_4_0',
  'seedance-4k': 'seedance_2',
};

/** The 4K source: a library still, or an uploaded image with its real pixel size (read by the browser). */
const sourceRef = z.union([
  z.object({ stillId: z.string().min(1).max(200) }),
  z.object({
    uploadUrl: z.url().max(4000),
    width: z.number().int().min(1).max(20000),
    height: z.number().int().min(1).max(20000),
  }),
]);

/** The motion reference: a library clip, or an uploaded clip with the length the browser read. */
const referenceRef = z.union([
  z.object({ clipId: z.string().min(1).max(200) }),
  z.object({ uploadUrl: z.url().max(4000), seconds: z.number().min(0).max(600).optional() }),
]);

export type RecreateStatus = {
  /** Which task the fields below describe: 1 the shot, 2 its 4K upscale. */
  step: 1 | 2;
  /** The whole job is over: the final clip finished, or a step failed. */
  done: boolean;
  status: string;
  progress?: number | undefined;
  url?: string | undefined;
  error?: string | undefined;
  /** The clip that holds (or will hold) the 4K result: the upscale's id once started, or `id` itself on the seedance route. */
  finalId?: string | undefined;
  /** Step 2 could not start (`upscale.state === 'failed'`): the UI offers Try again (retryUpscale). */
  upscaleFailed?: boolean | undefined;
};

type Recreation = Clip & { recreate: ClipRecreate };

/** The owner's recreate clip `id`, or NOT_FOUND. */
async function recreation(owner: string, id: string): Promise<Recreation> {
  const clip = (await readLibrary(owner)).clips.find((c) => c.id === id);
  if (!clip?.recreate) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'That recreation is no longer in your library.',
    });
  }
  return { ...clip, recreate: clip.recreate };
}

/** Whether a poll (or, with `retry`, a retry) may take the claim on starting the upscale. */
function claimable(upscale: RecreateUpscale | undefined, mode: 'poll' | 'retry', now: number): boolean {
  if (!upscale) return true;
  if (upscale.state === 'starting') return now - Date.parse(upscale.at) > STALE_MS;
  return mode === 'retry' && upscale.state === 'failed';
}

/**
 * Start the 4K upscale of a finished Kling-route shot, at most once. One
 * read-modify-write of the library takes the claim (`starting`, with this
 * call's own `by`) when no one holds it: never claimed, a claim gone stale,
 * or (a retry only) a start that failed. A call that does not hold the claim
 * gets the stored state back and sends nothing. The holder sends
 * `media_upscale` of the shot's artifact, records the new clip, then marks
 * the shot `started`, each in its own try, so what was paid for is never
 * sent again; a refusal is marked `failed` for `retryUpscale`.
 */
async function ensureUpscale(
  ctx: RunwayCtx,
  owner: string,
  clip: Recreation,
  mode: 'poll' | 'retry'
): Promise<RecreateUpscale> {
  // What this call may not claim, it does not write for (a poll every few seconds).
  const known = clip.recreate.upscale;
  if (known && !claimable(known, mode, Date.now())) return known;
  const by = randomUUID();
  const claim: RecreateUpscale = { state: 'starting', at: new Date().toISOString(), by };
  const lib = await updateLibrary(owner, (l) => ({
    ...l,
    clips: l.clips.map((c) =>
      c.id === clip.id &&
      c.recreate?.route === 'kling-upscale' &&
      c.recreate.step === 1 &&
      claimable(c.recreate.upscale, mode, Date.now())
        ? { ...c, recreate: { ...c.recreate, upscale: claim } }
        : c
    ),
  }));
  const shot = lib.clips.find((c) => c.id === clip.id);
  const rec = shot?.recreate;
  const held = rec?.upscale;
  if (!shot || !rec || !held) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'That recreation is no longer in your library.',
    });
  }
  // Someone else holds it, or it has started or failed: never send it here.
  if (held.state !== 'starting' || held.by !== by) return held;

  const holds = (c: Clip) => {
    const u = c.recreate?.upscale;
    return u?.state === 'starting' && u.by === by;
  };
  const mark = (upscale: RecreateUpscale, when: (c: Clip) => boolean) =>
    patchClip(owner, clip.id, (c) => (c.recreate && when(c) ? { recreate: { ...c.recreate, upscale } } : {}));

  // A step 2 already in the library for this shot (its `started` mark lost)
  // is taken up rather than sent again.
  const sent = lib.clips.find(
    (c) => c.upscaleOf === clip.id && c.recreate?.step === 2 && c.status !== 'failed'
  );
  if (sent) {
    const started: RecreateUpscale = { state: 'started', id: sent.id };
    await mark(started, () => true).catch((e) => console.warn('[recreate] could not mark the upscale started', sent.id, e));
    return started;
  }

  let upId: string;
  try {
    const task = await ctx.runway.getTask(clip.id);
    const artifactId = task.artifacts[0]?.id;
    if (task.status !== 'SUCCEEDED' || !artifactId) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'That shot has not finished, so there is nothing to upscale yet.',
      });
    }
    ({ id: upId } = await ctx.runway.createTask('media_upscale', {
      name: 'render-to-film recreate upscale',
      task_artifact_id: artifactId,
    }));
  } catch (err) {
    logRejection('recreate upscale', 'media_upscale', err);
    const failed: RecreateUpscale = {
      state: 'failed',
      at: new Date().toISOString(),
      error: toTrpcError(err).message,
    };
    await mark(failed, holds).catch((e) => console.warn('[recreate] could not record a failed upscale', clip.id, e));
    return failed;
  }

  try {
    await recordClip(owner, {
      ...shot,
      id: upId,
      createdAt: new Date().toISOString(),
      status: 'pending',
      error: undefined,
      upscaleOf: clip.id,
      upscaler: 'runway',
      scale: 4,
      recreate: { ...rec, step: 2, upscale: undefined },
    });
  } catch (err) {
    // The shot's `started` mark below still says it was sent.
    console.warn('[recreate] could not record the upscale', upId, err);
  }
  const started: RecreateUpscale = { state: 'started', id: upId };
  try {
    await mark(started, () => true);
  } catch (err) {
    // The recorded step 2 is taken up by the next claim instead of sending again.
    console.warn('[recreate] could not mark the upscale started', upId, err);
  }
  return started;
}

export const recreateRouter = router({
  /**
   * Shoot the reference clip again from the 4K still, on the chosen route.
   * Returns at once with the step-1 clip id; poll `status` with it.
   */
  start: signedInProcedure
    .input(
      z.object({
        reference: referenceRef,
        source: sourceRef,
        route: z.enum(RECREATE_ROUTE_IDS).default(DEFAULT_RECREATE_ROUTE),
        note: z.string().max(RECREATE_NOTE_MAX).default(''),
        /** The shot director's plan of the source (src/shot-director-api.ts); only its inventory lock is used. */
        shot: shotPlanRawSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }): Promise<{ id: string; seconds: number; route: RecreateRouteId }> => {
      const owner = await ownerKey(ctx.req);
      const lib = await readLibrary(owner);
      const route = recreateRoute(input.route);
      if (!OFFERED_RECREATE_ROUTES.some((r) => r.id === route.id)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Recreate in 4K renders natively at 4K; the upscale route is off.' });
      }
      const alias = ALIAS[route.id];
      const { reference, source } = input;
      let shape: { width: number; height: number };
      if ('stillId' in source) {
        const still = lib.stills.find((s) => s.id === source.stillId);
        if (still?.status !== 'succeeded') {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'That still is no longer in your library. Pick another one.',
          });
        }
        shape = { width: still.width, height: still.height };
      } else {
        shape = { width: source.width, height: source.height };
      }
      let refClip: Clip | undefined;
      if ('clipId' in reference) {
        refClip = lib.clips.find((c) => c.id === reference.clipId);
        if (refClip?.status !== 'succeeded') {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'That clip is no longer in your library. Pick another one.',
          });
        }
      }
      let sourceUrl: string;
      let referenceUrl: string;
      let refSeconds: number | undefined;
      try {
        // The still as it is: an upscaled 4K still stays 4K (never swapped for its source).
        sourceUrl = 'stillId' in source ? await finishedUrl(ctx, source.stillId, owner) : source.uploadUrl;
        if ('uploadUrl' in reference) {
          referenceUrl = reference.uploadUrl;
          refSeconds = reference.seconds;
        } else {
          const art = await artifactOf(ctx, reference.clipId);
          referenceUrl = art.url;
          refSeconds = art.duration ?? (refClip && clipSeconds(refClip.videoModel, refClip.length, refClip.seconds));
        }
      } catch (err) {
        throw toTrpcError(err);
      }
      const seconds = recreateSeconds(route.id, refSeconds);
      // The reference clip sets the camera, so a directed recreation adds
      // only "these exist, these move"; any move the plan names is kept as is.
      const directed = input.shot
        ? resolveShotPlan(input.shot, {
            videoModel: route.model,
            width: shape.width,
            height: shape.height,
            people: true,
            userKeyframes: true,
            canEndFrame: false,
          })
        : undefined;
      const prompt = directed
        ? clampPrompt(buildRecreateDirectedPrompt(input.note, directed), 3500)
        : clampPrompt(buildRecreatePrompt(input.note), 3500);
      const aspectRatio = snapAspectRatio(shape.width, shape.height, alias) ?? '16:9';
      const name = 'render-to-film recreate';
      let id: string;
      try {
        ({ id } =
          route.id === 'kling-upscale'
            ? await ctx.runway.createTask('kling_4_0', {
                name,
                textPrompt: prompt,
                mode: 'reference-to-video',
                referenceImages: [{ url: sourceUrl }],
                referenceVideos: [{ url: referenceUrl }],
                resolution: '1080p',
                duration: seconds,
                aspectRatio,
                providerSettings: { sound: false },
              })
            : await ctx.runway.createTask('seedance_2', {
                name,
                textPrompt: prompt,
                referenceImages: [{ url: sourceUrl, type: 'first_frame' }],
                referenceVideos: [{ url: referenceUrl }],
                resolution: '4k',
                aspectRatio,
                duration: seconds,
                generateAudio: false,
              }));
      } catch (err) {
        logRejection('recreate', alias, err);
        throw toTrpcError(err);
      }
      const clip: Clip = {
        id,
        stillId: 'stillId' in source ? source.stillId : '',
        ...('uploadUrl' in source ? { firstFrameUrl: source.uploadUrl } : {}),
        createdAt: new Date().toISOString(),
        status: 'pending',
        videoModel: route.model,
        motion: 'still-life',
        moveStyle: 'steady',
        speed: 'slow',
        seconds,
        direction: input.note,
        resolution: route.resolution,
        recreate: {
          route: route.id,
          step: 1,
          note: input.note || undefined,
          reference:
            'clipId' in reference
              ? { clipId: reference.clipId }
              : { url: reference.uploadUrl, seconds: refSeconds },
          source:
            'stillId' in source
              ? { stillId: source.stillId }
              : { url: source.uploadUrl, width: source.width, height: source.height },
        },
        ...(directed ? { shot: clipShot(directed, false) } : {}),
      };
      await recordClip(owner, clip);
      // An uploaded source is its poster, kept while the clip renders.
      void ensureClipPoster(owner, clip);
      return { id, seconds, route: route.id };
    }),

  /**
   * One poll of a recreation, by its step-1 clip id. On the Kling route a
   * finished shot moves on to its 4K upscale here (started once, under the
   * claim), and the poll then reports step 2.
   */
  status: signedInProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<RecreateStatus> => {
      const owner = await ownerKey(ctx.req);
      const clip = await recreation(owner, input.id);
      const { route, step } = clip.recreate;
      try {
        const snap1 = await ctx.runway.taskSnapshot(clip.id);
        if (snap1.done && clip.status === 'pending') {
          await patchClip(owner, clip.id, () => settled(snap1)).catch(() => {});
          // The poster started with the clip may have been lost with its pod.
          await ensureClipPoster(owner, clip);
        }
        // One task to report: the Seedance shot, a Kling shot not yet
        // finished (or failed), or a step 2 asked for by its own id.
        if (route === 'seedance-4k' || step === 2 || !snap1.done || snap1.status !== 'SUCCEEDED') {
          return {
            step,
            done: snap1.done,
            status: snap1.status,
            progress: snap1.progress,
            url: snap1.url,
            error: snapError(snap1),
            finalId: step === 2 || (route === 'seedance-4k' && snap1.done && snap1.url) ? clip.id : undefined,
          };
        }
        const up = await ensureUpscale(ctx, owner, clip, 'poll');
        if (up.state === 'started') {
          const snap2 = await ctx.runway.taskSnapshot(up.id);
          if (snap2.done) {
            await patchClip(owner, up.id, () => settled(snap2)).catch(() => {});
          }
          return {
            step: 2,
            done: snap2.done,
            status: snap2.status,
            progress: snap2.progress,
            url: snap2.url,
            error: snapError(snap2),
            finalId: up.id,
          };
        }
        if (up.state === 'failed') {
          return { step: 2, done: true, status: 'FAILED', error: up.error, upscaleFailed: true };
        }
        // Another request holds a fresh claim and is starting it.
        return { step: 2, done: false, status: 'PENDING', progress: 0 };
      } catch (err) {
        throw toTrpcError(err);
      }
    }),

  /** Start the 4K upscale again after it failed to start; returns the new upscale clip id. */
  retryUpscale: signedInProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
      const owner = await ownerKey(ctx.req);
      const clip = await recreation(owner, input.id);
      if (clip.recreate.route !== 'kling-upscale' || clip.recreate.step !== 1) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only a Kling 4.0 shot is upscaled to 4K afterwards.',
        });
      }
      let up: RecreateUpscale;
      try {
        const snap = await ctx.runway.taskSnapshot(clip.id);
        if (snap.status !== 'SUCCEEDED') {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'That shot has not finished, so there is nothing to upscale yet.',
          });
        }
        up = await ensureUpscale(ctx, owner, clip, 'retry');
      } catch (err) {
        throw toTrpcError(err);
      }
      if (up.state === 'started') return { id: up.id };
      if (up.state === 'failed') {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: up.error });
      }
      throw new TRPCError({ code: 'CONFLICT', message: 'The upscale is already starting.' });
    }),
});
