import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { createTextTask, textTaskSnapshot } from './ai-text.ts';
import { artifactOf } from './edit-api.ts';
import { ownerKey, readLibrary, type Still, updateLibrary } from './library.ts';
import {
  defaultImageResolution,
  IMAGE_MODEL_IDS,
  type ImageModelId,
  imageModelPromptLimit,
  imageResolutions,
} from './models.ts';
import { submitStill } from './still-submit.ts';
import { documentStore } from './storage.ts';
import { finishedUrl, logRejection, type RunwayCtx, snapError, toTrpcError } from './task-helpers.ts';
import { router, signedInProcedure } from './trpc.ts';

/**
 * The Close-ups tab: find the best cinematic close-ups in a clip, a still or
 * an uploaded image, then shoot each one as its own film still.
 *
 * A search is a small state machine, driven by the page so every paid step
 * starts from a click or an automatic call whose error the page can show:
 *
 *   clip:          capturing → captured → finding → picked → rendering → done
 *   still, upload:                        finding → picked → rendering → done
 *
 * `find` starts it, `job` polls (and records finished captures and answers,
 * which costs nothing), `analyze` asks Claude for the shots, `render`
 * submits one still per shot. Those stills land in the library as pending,
 * and the library query settles them like any other still.
 */

export const MAX_CLOSEUPS = 6;
const FRAME_COUNT = 6;
const FINDER_MODEL = 'claude-sonnet-5-5';

export type CloseupStatus = 'capturing' | 'captured' | 'finding' | 'picked' | 'rendering' | 'done' | 'failed';

export type CloseupPick = {
  /** Which looked-at frame it is in, from 0. Always 0 for a still or an upload. */
  frame: number;
  subject: string;
  framing: string;
  why: string;
};

export type CloseupShot = CloseupPick & { stillId?: string | undefined; error?: string | undefined };

export type CloseupJob = {
  id: string;
  createdAt: string;
  source: { kind: 'clip' | 'still' | 'upload'; id?: string | undefined; url?: string | undefined };
  /** The source's own size; each close-up keeps its shape. */
  width: number;
  height: number;
  count: number;
  imageModel: ImageModelId;
  resolution: string;
  direction: string;
  status: CloseupStatus;
  error?: string | undefined;
  captureTaskId?: string | undefined;
  /** Seconds into the clip of each captured frame. */
  frameTimes?: number[] | undefined;
  findTaskId?: string | undefined;
  picks?: CloseupPick[] | undefined;
  shots?: CloseupShot[] | undefined;
  /** When the status last changed, so a step a restarted pod abandoned can be closed. */
  updatedAt?: string | undefined;
};

type CloseupDoc = { jobs: CloseupJob[] };

/** One document per person under `closeups/`, beside their library. */
const store = documentStore<CloseupDoc>({ prefix: 'closeups/' });

async function readJobs(owner: string): Promise<CloseupJob[]> {
  return (await store.get(`${owner}.json`))?.value.jobs ?? [];
}

function updateJobs(owner: string, mutate: (jobs: CloseupJob[]) => CloseupJob[]) {
  return store.update(`${owner}.json`, (current) => ({ jobs: mutate(current?.jobs ?? []).slice(0, 20) }));
}

function patchJob(owner: string, id: string, patch: Partial<CloseupJob>) {
  return updateJobs(owner, (jobs) =>
    jobs.map((j) => (j.id === id ? { ...j, ...patch, ...(patch.status ? { updatedAt: new Date().toISOString() } : {}) } : j))
  );
}

/**
 * Apply `patch` only while the stored job still passes `still`. A poll that
 * read the job a moment ago can't put it back a step another tab (or pod) has
 * already taken it past. Returns the stored job, patched or not.
 */
async function transition(
  owner: string,
  id: string,
  still: (j: CloseupJob) => boolean,
  patch: Partial<CloseupJob>
): Promise<CloseupJob | null> {
  let stored: CloseupJob | null = null;
  await updateJobs(owner, (jobs) => {
    stored = null;
    return jobs.map((j) => {
      if (j.id !== id) return j;
      stored = still(j) ? { ...j, ...patch, updatedAt: new Date().toISOString() } : j;
      return stored;
    });
  });
  return stored;
}

/** A step left this long with nothing to watch was abandoned (a restarted pod). */
const STALE_MS = 10 * 60 * 1000;

/**
 * Move a job from one status to the next, only if it is still in `from`.
 * Two tabs (or two pods) racing the same step: one wins, the other is told
 * no, so nothing is submitted twice.
 */
async function claim(owner: string, id: string, from: CloseupStatus, to: CloseupStatus): Promise<CloseupJob | null> {
  let won: CloseupJob | null = null;
  await updateJobs(owner, (jobs) => {
    won = null;
    return jobs.map((j) => {
      if (j.id !== id || j.status !== from) return j;
      won = { ...j, status: to, error: undefined, updatedAt: new Date().toISOString() };
      return won;
    });
  });
  return won;
}

function notFound(): TRPCError {
  return new TRPCError({ code: 'NOT_FOUND', message: 'That close-up search is no longer saved. Start a new one.' });
}

/** Evenly spread capture times, kept clear of the clip's very last frame. */
function frameTimes(duration: number): number[] {
  const d = Math.max(0.5, duration);
  return Array.from({ length: FRAME_COUNT }, (_, i) => Math.round(Math.min(d - 0.1, (d * (i + 0.5)) / FRAME_COUNT) * 100) / 100);
}

/** Fresh, signed URLs of the frames a capture produced, in time order. */
async function capturedFrames(ctx: RunwayCtx, taskId: string): Promise<string[]> {
  const task = await ctx.runway.getTask(taskId);
  return task.artifacts.filter((a) => !a.isDirectory && a.url).map((a) => a.url);
}

/** A fresh URL for a still or upload source (stills are signed each time). */
async function imageSourceUrl(ctx: RunwayCtx, owner: string, job: CloseupJob): Promise<string> {
  if (job.source.kind === 'upload') {
    if (!job.source.url) throw notFound();
    return job.source.url;
  }
  const lib = await readLibrary(owner);
  const still = lib.stills.find((s) => s.id === job.source.id);
  if (!still) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'That still is no longer in your library. Pick another one.' });
  }
  // An upscaled still can be far larger than a model takes; its source has the same picture.
  const refId = still.upscaleOf && lib.stills.some((s) => s.id === still.upscaleOf) ? still.upscaleOf : still.id;
  return finishedUrl(ctx, refId, owner);
}

const FINDER_SYSTEM =
  'You are a cinematographer and stills photographer on an architecture and landscape shoot. You look at frames from a finished shot and find the close-ups worth shooting: the details that would cut beautifully into a film or a brochure.';

function finderPrompt(job: CloseupJob, frames: number): string {
  const times = job.frameTimes;
  return [
    frames > 1
      ? `These ${frames} images are frames from one video clip, in order${
          times ? ` (at ${times.slice(0, frames).map((t) => `${t}s`).join(', ')})` : ''
        }. Image 1 is frame 1.`
      : 'This is one film still.',
    `Find the ${job.count} best cinematic close-up shots in ${frames > 1 ? 'these frames' : 'this image'}.`,
    'A good close-up isolates one subject that is already clearly visible: a material or texture (stone, timber grain, a brass handle, water on a pool edge), a junction or detail of the architecture, a plant or tree against the light, a piece of furniture, light falling across a surface, or a person or a hand when people are in the frame.',
    'Prefer subjects that are well lit, in focus, large enough in the frame to be re-shot up close without guessing, and that have strong shape, texture or light. Avoid tiny, blurred or half-hidden things, the sky alone, and repeats of the same subject. Make the shots different from one another: vary scale (detail, close-up, medium close-up), subject and position in the frame.',
    job.direction ? `The person asked for: ${job.direction}. Follow that first.` : '',
    `For each shot give: "frame" (the image number it is best seen in${frames > 1 ? '' : ', always 1'}), "subject" (what the camera frames, with where it sits in the image, e.g. "the bronze door handle on the right of the entrance"), "framing" (shot size, lens and composition, e.g. "tight close-up, 100mm, handle in the left third, door grain filling the frame"), and "why" (one short sentence on what makes it cinematic).`,
    'Answer with one JSON object and nothing else, in exactly this shape:',
    '{"shots":[{"frame":1,"subject":"...","framing":"...","why":"..."}]}',
  ]
    .filter(Boolean)
    .join('\n\n');
}

const picksSchema = z.object({
  shots: z
    .array(
      z.object({
        frame: z.coerce.number().int(),
        subject: z.string().min(1).max(400),
        framing: z.string().max(400).default(''),
        why: z.string().max(400).default(''),
      })
    )
    .min(1),
});

/** Pull the shots out of the finder's answer, tolerating a code fence. */
function parsePicks(text: string, frames: number, count: number): CloseupPick[] | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = picksSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    if (!parsed.success) return null;
    return parsed.data.shots.slice(0, count).map((s) => ({
      frame: Math.min(Math.max(0, s.frame - 1), Math.max(0, frames - 1)),
      subject: s.subject.trim(),
      framing: s.framing.trim(),
      why: s.why.trim(),
    }));
  } catch {
    return null;
  }
}

function closeupPrompt(pick: CloseupPick, direction: string): string {
  return [
    `Re-shoot this reference image as a cinematic close-up of ${pick.subject}.`,
    pick.framing ? `Framing: ${pick.framing}.` : '',
    'The camera moves in close to that subject in the same place: keep its exact shape, proportions, materials, colours and details as they are in the reference image, and keep the same light, time of day, shadow direction, weather and colour grade.',
    'Only what is in the image: everything visible must already exist in the reference image. Invent no new objects, people, plants, signage, text or architecture; nearby things may only appear as they are in the reference, softly out of focus.',
    'Shot like a feature film still on a long lens (85–135mm): the subject tack sharp, shallow depth of field, the background falling into soft natural bokeh, true-to-life textures, gentle film grain, photoreal, no text or watermark.',
    direction ? `Also: ${direction}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Record a finished capture or answer on the job; never submits anything. */
async function advance(ctx: RunwayCtx, owner: string, job: CloseupJob): Promise<CloseupJob> {
  if (job.status === 'capturing' && job.captureTaskId) {
    const snap = await ctx.runway.taskSnapshot(job.captureTaskId);
    if (!snap.done) return job;
    const frames = snap.status === 'SUCCEEDED' ? await capturedFrames(ctx, job.captureTaskId) : [];
    const patch: Partial<CloseupJob> =
      frames.length > 0
        ? { status: 'captured' }
        : { status: 'failed', error: snapError(snap) ?? 'The frames could not be taken from that clip. Try again.' };
    const taskId = job.captureTaskId;
    return (
      (await transition(owner, job.id, (j) => j.status === 'capturing' && j.captureTaskId === taskId, patch)) ?? job
    );
  }
  if (job.status === 'finding' && job.findTaskId) {
    const snap = await textTaskSnapshot(ctx, owner, job.findTaskId);
    if (!snap.done) return job;
    const frames = job.source.kind === 'clip' ? (job.frameTimes?.length ?? FRAME_COUNT) : 1;
    const picks =
      snap.status === 'SUCCEEDED' && snap.text && !snap.truncated ? parsePicks(snap.text, frames, job.count) : null;
    const patch: Partial<CloseupJob> = picks
      ? { status: 'picked', picks }
      : {
          status: 'failed',
          error:
            snapError(snap) ??
            (snap.truncated
              ? 'The search ran out of room before it finished. Try again.'
              : 'The search came back in a form the app could not read. Try again.'),
        };
    const taskId = job.findTaskId;
    return (await transition(owner, job.id, (j) => j.status === 'finding' && j.findTaskId === taskId, patch)) ?? job;
  }
  // A step whose request died with its pod: close it rather than poll forever.
  const age = Date.now() - Date.parse(job.updatedAt ?? job.createdAt);
  if (age > STALE_MS && ((job.status === 'finding' && !job.findTaskId) || job.status === 'rendering')) {
    const patch: Partial<CloseupJob> =
      job.status === 'rendering' && job.shots?.some((s) => s.stillId)
        ? { status: 'done' }
        : { status: 'failed', error: 'This search stopped part way. Start it again.' };
    const from = job.status;
    return (await transition(owner, job.id, (j) => j.status === from, patch)) ?? job;
  }
  return job;
}

export const closeupsRouter = router({
  /** Start a search. A clip has its frames captured first; an image goes straight to the finder. */
  find: signedInProcedure
    .input(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('clip'), id: z.string().min(1).max(200) }),
        z.object({ kind: z.literal('still'), id: z.string().min(1).max(200) }),
        z.object({
          kind: z.literal('upload'),
          url: z.string().url(),
          width: z.number().int().min(16).max(16384),
          height: z.number().int().min(16).max(16384),
        }),
      ]).and(
        z.object({
          count: z.number().int().min(1).max(MAX_CLOSEUPS),
          imageModel: z.enum(IMAGE_MODEL_IDS),
          resolution: z.string().max(20).optional(),
          direction: z.string().max(400).default(''),
        })
      )
    )
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      const resolution =
        input.resolution && imageResolutions(input.imageModel).some((r) => r.id === input.resolution)
          ? input.resolution
          : defaultImageResolution(input.imageModel);
      const base = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        count: input.count,
        imageModel: input.imageModel,
        resolution,
        direction: input.direction.trim(),
      };
      let job: CloseupJob;
      if (input.kind === 'clip') {
        const lib = await readLibrary(owner);
        const clip = lib.clips.find((c) => c.id === input.id);
        if (!clip) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'That clip is no longer in your library. Pick another one.' });
        }
        const still = lib.stills.find((s) => s.id === clip.stillId);
        const art = await artifactOf(ctx, clip.id);
        const times = frameTimes(art.duration ?? 5);
        try {
          const { id } = await ctx.runway.createTask('media_processing_v2', {
            name: 'render-to-film close-up frames',
            operation: 'capture_frames',
            input: [art.assetId],
            parameters: { times },
          });
          job = {
            ...base,
            source: { kind: 'clip', id: clip.id },
            width: art.width ?? still?.width ?? 1920,
            height: art.height ?? still?.height ?? 1080,
            status: 'capturing',
            captureTaskId: id,
            frameTimes: times,
          };
        } catch (err) {
          logRejection('closeups', 'media_processing_v2', err);
          throw toTrpcError(err);
        }
      } else {
        let width: number;
        let height: number;
        if (input.kind === 'still') {
          const still = (await readLibrary(owner)).stills.find((s) => s.id === input.id);
          if (!still || still.status !== 'succeeded') {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'That still is not ready to use. Pick another one.' });
          }
          ({ width, height } = still);
        } else {
          ({ width, height } = input);
        }
        job = {
          ...base,
          source: input.kind === 'still' ? { kind: 'still', id: input.id } : { kind: 'upload', url: input.url },
          width,
          height,
          status: 'finding',
        };
        try {
          job.findTaskId = await submitFinder(ctx, owner, job, [await imageSourceUrl(ctx, owner, job)]);
        } catch (err) {
          throw toTrpcError(err);
        }
      }
      await updateJobs(owner, (jobs) => [job, ...jobs.filter((j) => j.id !== job.id)]);
      return { id: job.id };
    }),

  /** One poll of a search (the newest when no id is given); `null` when there is none. */
  job: signedInProcedure
    .input(z.object({ id: z.string().min(1).max(200).optional() }))
    .query(async ({ ctx, input }): Promise<CloseupJob | null> => {
      const owner = await ownerKey(ctx.req);
      const jobs = await readJobs(owner);
      const job = input.id ? jobs.find((j) => j.id === input.id) : jobs[0];
      if (!job) return null;
      try {
        return await advance(ctx, owner, job);
      } catch (err) {
        throw toTrpcError(err);
      }
    }),

  /** Ask the finder which close-ups to shoot, once a clip's frames are in. */
  analyze: signedInProcedure.input(z.object({ id: z.string().min(1).max(200) })).mutation(async ({ ctx, input }) => {
    const owner = await ownerKey(ctx.req);
    const job = await claim(owner, input.id, 'captured', 'finding');
    if (!job) return { started: false };
    let findTaskId: string;
    try {
      const frames = await capturedFrames(ctx, job.captureTaskId!);
      findTaskId = await submitFinder(ctx, owner, job, frames.slice(0, FRAME_COUNT));
    } catch (err) {
      // Nothing was submitted: back to where it was, so "Try again" starts this step afresh.
      await patchJob(owner, job.id, { status: 'captured' }).catch(() => {});
      throw toTrpcError(err);
    }
    // The search is paid for now; never put the job back to `captured` past here.
    await patchJob(owner, job.id, { findTaskId });
    return { started: true };
  }),

  /** Shoot each picked close-up as its own still in the library. */
  render: signedInProcedure.input(z.object({ id: z.string().min(1).max(200) })).mutation(async ({ ctx, input }) => {
    const owner = await ownerKey(ctx.req);
    const job = await claim(owner, input.id, 'picked', 'rendering');
    if (!job) return { started: false };
    const picks = job.picks ?? [];
    let frameUrls: string[];
    try {
      frameUrls =
        job.source.kind === 'clip'
          ? await capturedFrames(ctx, job.captureTaskId!)
          : [await imageSourceUrl(ctx, owner, job)];
    } catch (err) {
      await patchJob(owner, job.id, { status: 'picked' }).catch(() => {});
      throw toTrpcError(err);
    }
    const shots: CloseupShot[] = [];
    try {
      for (const pick of picks) {
        const imageUrl = frameUrls[pick.frame] ?? frameUrls[0]!;
        let id: string;
        try {
          ({ id } = await submitStill(
            ctx,
            {
              imageModel: job.imageModel,
              imageUrl,
              width: job.width,
              height: job.height,
              frame: { width: job.width, height: job.height },
              resolution: job.resolution,
            },
            closeupPrompt(pick, job.direction).slice(0, imageModelPromptLimit(job.imageModel) ?? 4000)
          ));
        } catch (err) {
          logRejection('closeups', job.imageModel, err);
          if (shots.length === 0) {
            // Nothing was submitted: the search stays ready, and the page shows why.
            await patchJob(owner, job.id, { status: 'picked' }).catch(() => {});
            throw toTrpcError(err);
          }
          shots.push({ ...pick, error: toTrpcError(err).message });
          continue;
        }
        shots.push({ ...pick, stillId: id });
        // Saved as soon as it is paid for, so nothing is lost if this request dies.
        const still: Still = {
          id,
          createdAt: new Date().toISOString(),
          status: 'pending',
          imageModel: job.imageModel,
          look: 'none',
          angle: 'as-rendered',
          crowd: 'none',
          people: '',
          direction: pick.subject,
          width: job.width,
          height: job.height,
          sourceUrl: imageUrl,
          resolution: job.resolution,
          closeup: { subject: pick.subject, jobId: job.id },
        };
        try {
          await updateLibrary(owner, (lib) => ({ ...lib, stills: [still, ...lib.stills.filter((s) => s.id !== id)] }));
          await patchJob(owner, job.id, { shots: [...shots] });
        } catch (err) {
          console.warn('[closeups] could not save a close-up', id, err);
        }
      }
    } finally {
      // Whatever happened past the first submit, the search ends with what it made.
      if (shots.length > 0) await patchJob(owner, job.id, { status: 'done', shots }).catch(() => {});
    }
    return { started: true };
  }),
});

async function submitFinder(ctx: RunwayCtx, owner: string, job: CloseupJob, imageUrls: string[]): Promise<string> {
  try {
    const { id } = await createTextTask(ctx, owner, {
      name: 'render-to-film close-up finder',
      model: FINDER_MODEL,
      system_prompt: FINDER_SYSTEM,
      prompt: finderPrompt(job, imageUrls.length),
      images: imageUrls.map((url) => ({ url })),
      temperature: 0.4,
      max_output_tokens: 10000,
    });
    return id;
  } catch (err) {
    logRejection('closeups', 'claude_api', err);
    throw err;
  }
}
