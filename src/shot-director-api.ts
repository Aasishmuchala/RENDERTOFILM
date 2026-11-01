import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { createTextTask, textTaskSnapshot } from './ai-text.ts';
import { DIRECTOR_LENS_IDS } from './direction.ts';
import { firstFrameRef, type FrameRef, frameRef } from './frame-refs.ts';
import { type ClipShot, ownerKey, readLibrary } from './library.ts';
import {
  MOTION_IDS,
  snapVideoSeconds,
  VIDEO_MODEL_IDS,
  videoExtrasExcludeEnd,
  videoKeyframeLimit,
} from './models.ts';
import {
  parseShotPlan,
  type ResolvedShot,
  SHOT_DIRECTOR_MODEL,
  SHOT_DIRECTOR_SYSTEM,
  shotDirectorPrompt,
  shotSummary,
} from './shot-director.ts';
import { assertFetchable, UnsafeUrlError } from './safe-fetch.ts';
import { finishedUrl, logRejection, snapError, toTrpcError } from './task-helpers.ts';
import { router, signedInProcedure } from './trpc.ts';

/**
 * The shot director's two calls (the grammar, the checks and the prompts are
 * in src/shot-director.ts). `plan` sends one vision text task that reads the
 * clip's first frame (and any frames it must pass through) and answers a
 * plan; `status` polls it and returns the plan once it fits the schema. No
 * plan is stored here: the page shows it, the visitor edits it, and
 * `createVideo` (src/api.ts) or `recreate.start` (src/recreate-api.ts)
 * receives it back and resolves it again against the clip it makes. This
 * file only ever starts a text task; the video is billed when it is made.
 */

/** The planner's answer as the server accepts it, and what the page sends back. The only schema for the plan. */
export const shotPlanRawSchema = z.object({
  inventory: z
    .array(
      z.object({
        id: z.string().max(32),
        name: z.string().max(80),
        where: z.string().max(60).default(''),
        kind: z.string().max(16).default('object'),
        moves: z.boolean().default(false),
      })
    )
    .min(1)
    .max(24),
  people: z
    .object({
      present: z.boolean().default(false),
      count: z.coerce.number().int().min(0).max(30).default(0),
      action: z.string().max(400).default(''),
    })
    .prefault({}),
  camera: z.object({
    move: z.string().max(32).default('still-life'),
    from: z.string().max(32).default(''),
    to: z.string().max(32).default(''),
    why: z.string().max(300).default(''),
  }),
  moving: z
    .array(z.object({ id: z.string().max(32), how: z.string().max(300).default('') }))
    .max(12)
    .default([]),
  beats: z
    .array(z.object({ at: z.coerce.number(), what: z.string().max(300).default('') }))
    .max(8)
    .default([]),
  focus: z.object({ start: z.string().max(32), end: z.string().max(32) }).nullable().default(null),
  end: z.string().max(400).default(''),
  rationale: z.string().max(400).default(''),
});

/** A plan as the schema leaves it: `ShotPlanRaw` with any string for an inventory `kind` until it is resolved. */
export type ShotPlanInput = z.infer<typeof shotPlanRawSchema>;

/** One `shot.status` poll: still planning, the plan (schema checked, not yet resolved), or why there is none. */
export type ShotPlanStatus =
  | { status: 'running' }
  | { status: 'done'; raw: ShotPlanInput }
  | { status: 'failed'; error: string };

/** What a clip's record keeps of the shot it was directed with. */
export function clipShot(shot: ResolvedShot, cropped: boolean): ClipShot {
  return {
    move: shot.camera.move,
    ...(shot.camera.downgradedFrom ? { downgradedFrom: shot.camera.downgradedFrom } : {}),
    cropped,
    summary: shotSummary(shot),
  };
}

export const shotRouter = router({
  /**
   * Plan one clip from what its first frame shows. The frames are signed as
   * `createVideo` signs them (an upscaled still's source is the same
   * picture), and the planner is told the camera grammar this clip allows.
   * Returns the text task's id at once; poll `status` with it.
   */
  plan: signedInProcedure
    .input(
      z.object({
        first: firstFrameRef,
        last: frameRef.optional(),
        middle: z.array(frameRef).max(8).default([]),
        /** How many extra reference images the clip will carry (they are not sent here). */
        refs: z.number().int().min(0).max(29).default(0),
        videoModel: z.enum(VIDEO_MODEL_IDS),
        seconds: z.number().int().min(1).max(60),
        /** The camera preset picked by hand: a hint the planner keeps unless the picture argues otherwise. */
        motion: z.enum(MOTION_IDS).default('still-life'),
        direction: z.string().max(600).default(''),
        directorStyle: z.enum(DIRECTOR_LENS_IDS).optional(),
        /** The Director page's clips also follow SHOT_CRAFT. */
        craft: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }): Promise<{ taskId: string }> => {
      const owner = await ownerKey(ctx.req);
      const lib = await readLibrary(owner);
      const { first } = input;
      const still = 'stillId' in first ? lib.stills.find((s) => s.id === first.stillId) : undefined;
      if ('stillId' in first && !still) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'That still is no longer in your library. Pick another one.',
        });
      }
      // As createVideo: an upload's contents aren't known, so it may show people.
      const people = still ? still.crowd !== 'none' : true;
      const userKeyframes = input.last !== undefined || input.middle.length > 0;
      const canEndFrame =
        videoKeyframeLimit(input.videoModel) >= 2 &&
        !(input.refs > 0 && videoExtrasExcludeEnd(input.videoModel));
      let images: string[];
      try {
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
        // An upload's address is the visitor's: one inside a network is
        // refused here, before any text task, whichever provider reads it.
        const resolve = async (ref: FrameRef) => {
          if ('stillId' in ref) return sign(ref.stillId);
          await assertFetchable(ref.uploadUrl);
          return ref.uploadUrl;
        };
        const [firstUrl, middle, last] = await Promise.all([
          resolve(first),
          Promise.all(input.middle.map((m) => resolve(m))),
          input.last ? resolve(input.last) : Promise.resolve(undefined),
        ]);
        // In the order the clip meets them: first, in between, last.
        images = [firstUrl, ...middle, ...(last ? [last] : [])];
      } catch (err) {
        if (err instanceof UnsafeUrlError) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: err.message, cause: err });
        }
        throw toTrpcError(err);
      }
      try {
        const { id } = await createTextTask(ctx, owner, {
          name: 'render-to-film shot director',
          model: SHOT_DIRECTOR_MODEL,
          system_prompt: SHOT_DIRECTOR_SYSTEM,
          prompt: shotDirectorPrompt({
            seconds: snapVideoSeconds(input.videoModel, input.seconds),
            videoModel: input.videoModel,
            canEndFrame,
            userKeyframes,
            frames: images.length,
            presetMove: input.motion,
            direction: input.direction,
            directorStyle: input.directorStyle,
            craft: input.craft,
            people,
          }),
          images: images.map((url) => ({ url })),
          temperature: 0.3,
          max_output_tokens: 4000,
        });
        return { taskId: id };
      } catch (err) {
        logRejection('shot', 'claude_api', err);
        throw toTrpcError(err);
      }
    }),

  /** One poll of a `plan` task: running, the schema-checked plan, or why it could not be read. */
  status: signedInProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<ShotPlanStatus> => {
      const owner = await ownerKey(ctx.req);
      try {
        const snap = await textTaskSnapshot(ctx, owner, input.taskId);
        if (!snap.done) return { status: 'running' };
        if (snap.status === 'SUCCEEDED' && snap.text && !snap.truncated) {
          const parsed = shotPlanRawSchema.safeParse(parseShotPlan(snap.text));
          if (parsed.success) return { status: 'done', raw: parsed.data };
        }
        return {
          status: 'failed',
          error:
            snapError(snap) ??
            (snap.truncated
              ? 'The director ran out of room before finishing. Try again.'
              : 'The director answered in a form the app could not read. Try again, or make the video as set.'),
        };
      } catch (err) {
        throw toTrpcError(err);
      }
    }),
});
