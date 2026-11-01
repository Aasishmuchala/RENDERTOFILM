// The chat agent's seven action tools (PLAN-13 section 5): plan_lifestyle, plan_film,
// direct_shot, crop_create, timeline_edit, propose_run, run_cancel. Each is a thin adapter
// from a checked tool input onto one seam the loop hands it, mostly an existing router
// through createCaller, so the prompts and the request bodies stay the routers' own. None
// spends: a plan is a text task, a crop and a cut are local, and propose_run asks the Gate
// for a Quote and goes no further. A failed call is one sentence and is never retried.
import { randomUUID } from 'node:crypto';

import { RunwayCreditError } from '@runway/bay/runway';
import { TRPCError } from '@trpc/server';

import type { DirectorLensId } from '../../direction.ts';
import { ownsAsset } from '../../edits.ts';
import { imageSlot, MAX_INPUT_PIXELS, readCapped, sharp } from '../../imaging.ts';
import type { EthnicityId } from '../../looks.ts';
import type { ImageModelId, MotionId } from '../../models.ts';
import { safeFetch } from '../../safe-fetch.ts';
import { putObject } from '../../storage.ts';
import type { StorylineId } from '../../storyboard.ts';
import { toTrpcError } from '../../task-helpers.ts';
import type { TimelineItem } from '../../timeline.ts';
import { parseToolInput, TOOLS, type ToolInputs, type ToolName } from '../contracts.ts';
import type { ToolImpl, ToolRunCtx } from '../domain.ts';

type Result = { content: unknown[]; isError?: boolean };

/** What a plan is shot on unless the provider does not offer it (the Lifestyle page's own default). */
const PLAN_IMAGE_MODEL: ImageModelId = 'gpt-image-2-5-sunburst';
/** Runway's upload occasionally stalls; a Turn must not wait on it for ever. */
const UPLOAD_MS = 40_000;
const CROP_JPEG_QUALITY = 92;

// ---------------------------------------------------------------------------
// Answers

const fail = (message: string): Result => ({ content: [{ type: 'text', text: message }], isError: true });
const answer = (value: unknown): Result => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

/** A failure in the routers' own words; a refusal over credits says so, for the model to tell the user. */
function reasonOf(err: unknown): string {
  const e = toTrpcError(err);
  if (e.code === 'FORBIDDEN' && e.cause instanceof RunwayCreditError) return `${e.message} Out of credits.`;
  // A router's input check: tRPC's message is every issue as JSON. The first says which field and what it takes.
  const issue = (e.cause as { issues?: { path: PropertyKey[]; message: string }[] } | undefined)?.issues?.[0];
  return issue ? `${issue.path.join('.')}: ${issue.message}.` : e.message;
}

/** A tool: its contract definition, input validated, anything thrown turned into one sentence. */
function tool<N extends ToolName>(name: N, body: (input: ToolInputs[N], ctx: ToolRunCtx) => Promise<unknown>): ToolImpl {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) throw new Error(`contracts.ts has no tool ${name}`);
  return {
    def,
    async run(input, ctx) {
      const parsed = parseToolInput(name, input);
      if (!parsed.ok) return fail(parsed.message);
      try {
        return answer(await body(parsed.value, ctx));
      } catch (err) {
        return fail(reasonOf(err));
      }
    },
  };
}

const refuse = (code: TRPCError['code'], message: string) => new TRPCError({ code, message });

// ---------------------------------------------------------------------------
// Assets

/** Keys are the model's words: only one file directly in this owner's folder is an asset. */
function requireOwnAsset(key: string, ctx: ToolRunCtx): void {
  const prefix = `chat-assets/${ctx.owner}/`;
  if (!key.startsWith(prefix) || !/^[A-Za-z0-9][\w.-]*$/.test(key.slice(prefix.length))) {
    throw refuse('NOT_FOUND', 'That is not one of the renders uploaded to this chat.');
  }
}

/** Checked now, by the master's own rule and for the file itself: by the master step a Run has paid for its stills and clips. */
async function requireMusic(key: string, ctx: ToolRunCtx): Promise<void> {
  const bytes = ownsAsset(ctx.owner, key) ? await ctx.readAsset(key).catch(() => null) : null;
  if (!bytes) throw refuse('BAD_REQUEST', 'That music is not one of your uploads.');
  const thread = await ctx.store.thread(ctx.owner, ctx.threadId);
  const asset = thread?.assets.find((a) => a.key === key);
  if (asset && asset.kind !== 'audio') throw refuse('BAD_REQUEST', `${asset.name} is a picture, not music.`);
}

/** The upright size of a picture, from its header. */
async function sizeOf(bytes: Buffer): Promise<{ width: number; height: number }> {
  try {
    return (await sharp(bytes).metadata()).autoOrient;
  } catch (cause) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'That file is not a picture that can be read.', cause });
  }
}

type Uploads = { uploadAsset(bytes: Buffer, opts: { filename: string; signal?: AbortSignal }): Promise<{ url: string }> };

/** `ToolRunCtx.hostAsset`: hands an asset's bytes to the provider, for the planners that read uploads by URL. */
export function assetHost(runway: Uploads, readAsset: ToolRunCtx['readAsset']): ToolRunCtx['hostAsset'] {
  return async (key) => {
    const bytes = await readAsset(key);
    const { width, height } = await sizeOf(bytes);
    const name = key.slice(key.lastIndexOf('/') + 1);
    const { url } = await runway.uploadAsset(bytes, { filename: name, signal: AbortSignal.timeout(UPLOAD_MS) });
    return { url, width, height, name };
  };
}

/** The renders as a planner takes them, under the names the user gave them. */
async function hosted(keys: string[], ctx: ToolRunCtx) {
  for (const key of keys) requireOwnAsset(key, ctx);
  const thread = await ctx.store.thread(ctx.owner, ctx.threadId);
  const images = [];
  // One at a time: a plan can hold 24 renders of 25 MB each.
  for (const key of keys) {
    const image = await ctx.hostAsset(key);
    images.push({ ...image, key, name: thread?.assets.find((a) => a.key === key)?.name ?? image.name });
  }
  return images;
}

// ---------------------------------------------------------------------------
// Planners

function imageModelFor(ctx: ToolRunCtx): ImageModelId {
  const { imageModels, providerName } = ctx.capabilities();
  const model = imageModels.includes(PLAN_IMAGE_MODEL) ? PLAN_IMAGE_MODEL : imageModels[0];
  if (!model) throw refuse('PRECONDITION_FAILED', `${providerName} offers no image model.`);
  return model;
}

/** Puts a planner job on this Turn, so the thread can follow it. */
async function noteJob(id: string, ctx: ToolRunCtx): Promise<void> {
  const thread = await ctx.store.thread(ctx.owner, ctx.threadId);
  const jobIds = thread?.turns.find((t) => t.id === ctx.turnId)?.jobIds ?? [];
  await ctx.store.updateTurn(ctx.owner, ctx.threadId, ctx.turnId, { jobIds: [...jobIds, id] });
}

const planLifestyle = tool('plan_lifestyle', async (input, ctx) => {
  const { id } = await ctx.trpc.lifestyle.plan({
    images: await hosted(input.assetKeys, ctx),
    imageModel: imageModelFor(ctx),
    // Ids the router's own enums check: one it does not know comes back as a refusal.
    heritage: input.heritage as EthnicityId | undefined,
    household: input.household,
    directorStyle: input.directorStyle as DirectorLensId | undefined,
  });
  await noteJob(id, ctx);
  return { lifestyleJobId: id, status: 'planning' };
});

const planFilm = tool('plan_film', async (input, ctx) => {
  const { id } = await ctx.trpc.storyboard.plan({
    images: await hosted(input.assetKeys, ctx),
    storyline: input.storyline as StorylineId,
    story: input.story,
    imageModel: imageModelFor(ctx),
  });
  await noteJob(id, ctx);
  return { storyboardJobId: id, status: 'planning' };
});

const directShot = tool('direct_shot', async (input, ctx) => {
  const { videoModels, providerName } = ctx.capabilities();
  const videoModel = videoModels[0];
  if (!videoModel) throw refuse('PRECONDITION_FAILED', `${providerName} offers no video model.`);
  return ctx.trpc.shot.plan({
    first: { stillId: input.stillId },
    seconds: input.seconds,
    motion: input.motion as MotionId | undefined,
    videoModel,
    direction: input.direction,
    directorStyle: 'none',
  });
});

// ---------------------------------------------------------------------------
// crop_create

/** The bytes and the name of the picture the input points at. */
async function pictureOf(input: ToolInputs['crop_create'], ctx: ToolRunCtx): Promise<{ bytes: Buffer; name: string }> {
  if (input.assetKey !== undefined) {
    const key = input.assetKey;
    requireOwnAsset(key, ctx);
    const thread = await ctx.store.thread(ctx.owner, ctx.threadId);
    const name = thread?.assets.find((a) => a.key === key)?.name ?? key.slice(key.lastIndexOf('/') + 1);
    return { bytes: await ctx.readAsset(key), name };
  }
  const id = input.stillId!;
  // The same poll the Still tab shows: a marked edit answers as its composite, never the raw result.
  const { url, error } = await ctx.trpc.shotStatus({ id });
  if (!url) throw refuse('PRECONDITION_FAILED', error ?? 'That still has no picture yet.');
  return { bytes: await readCapped(url, 'still', safeFetch), name: `still ${id.slice(0, 8)}` };
}

/** The pixels a region covers, stopping at the picture's edges; a region with nothing in it is refused. */
function cropRect(r: ToolInputs['crop_create']['region'], size: { width: number; height: number }) {
  const right = Math.min(1, r.x + r.w);
  const bottom = Math.min(1, r.y + r.h);
  if (right <= r.x || bottom <= r.y) throw refuse('BAD_REQUEST', 'That region is empty.');
  const left = Math.min(Math.round(r.x * size.width), size.width - 1);
  const top = Math.min(Math.round(r.y * size.height), size.height - 1);
  return {
    left,
    top,
    width: Math.max(1, Math.min(Math.round((right - r.x) * size.width), size.width - left)),
    height: Math.max(1, Math.min(Math.round((bottom - r.y) * size.height), size.height - top)),
  };
}

const cropCreate = tool('crop_create', async (input, ctx) => {
  const { bytes, name } = await pictureOf(input, ctx);
  const rect = cropRect(input.region, await sizeOf(bytes));
  const jpeg = await imageSlot(() =>
    sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
      .autoOrient()
      .extract(rect)
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: CROP_JPEG_QUALITY })
      .toBuffer()
  );
  const key = `chat-assets/${ctx.owner}/${randomUUID()}.jpg`;
  await putObject(key, jpeg, { contentType: 'image/jpeg' });
  await ctx.store.addAsset(ctx.owner, ctx.threadId, {
    key,
    kind: 'image',
    name: `Crop of ${name}`,
    width: rect.width,
    height: rect.height,
    bytes: jpeg.length,
    addedAt: Date.now(),
  });
  return { assetKey: key };
});

// ---------------------------------------------------------------------------
// timeline_edit

type Cut = ToolInputs['timeline_edit']['items'][number];

/** saveTimeline skips a clip it cannot play and saves the rest, so a bad id stops here, with the cut untouched. */
async function requireFinishedClips(items: Cut[], ctx: ToolRunCtx): Promise<void> {
  const { clips } = await ctx.trpc.library();
  const finished = new Set(clips.filter((c) => c.status === 'succeeded').map((c) => c.id));
  const bad = [...new Set(items.map((item) => item.clipId))].filter((id) => !finished.has(id));
  if (bad.length) throw refuse('BAD_REQUEST', `Nothing was saved. These are not finished clips: ${bad.join(', ')}.`);
}

/**
 * The items as saveTimeline takes them. A cut holds on to its grades by key and the model
 * never sees keys, so an item takes the key and colour of the cut it repeats, else of one
 * left over from the same clip (a trim). Any other item is a new cut.
 */
function withKeys(items: Cut[], timeline: TimelineItem[]) {
  const left = [...timeline];
  const take = (found: (cut: TimelineItem) => boolean) => {
    const i = left.findIndex(found);
    return i < 0 ? undefined : left.splice(i, 1)[0];
  };
  const same = items.map((item) => take((cut) => cut.clipId === item.clipId && cut.sourceStart === item.sourceStart));
  return items.map((item, i) => {
    const cut = same[i] ?? take((c) => c.clipId === item.clipId);
    return { ...item, key: cut?.key ?? randomUUID(), ...(cut?.colour ? { colour: cut.colour } : {}) };
  });
}

/** A save refused as stale, with what the model has to build on: no read tool carries the edit. */
async function staleEdit(message: string, ctx: ToolRunCtx): Promise<TRPCError> {
  const { rev, transition, fadeSeconds, timeline } = await ctx.trpc.edit.project();
  const cuts = timeline.map(({ clipId, sourceStart, duration }) => ({ clipId, sourceStart, duration }));
  const edit = JSON.stringify({ rev, transition, fadeSeconds, cuts });
  return refuse('CONFLICT', `${message} Build on the edit as it stands and send its rev as baseRev: ${edit}`);
}

const timelineEdit = tool('timeline_edit', async (input, ctx) => {
  await requireFinishedClips(input.items, ctx);
  const { timeline } = await ctx.trpc.edit.project();
  try {
    const { rev } = await ctx.trpc.edit.saveTimeline({
      items: withKeys(input.items, timeline),
      transition: input.transition,
      fadeSeconds: input.fadeSeconds,
      baseRev: input.baseRev,
    });
    return { rev };
  } catch (err) {
    const e = toTrpcError(err);
    throw e.code === 'CONFLICT' ? await staleEdit(e.message, ctx) : e;
  }
});

// ---------------------------------------------------------------------------
// The rest

const proposeRun = tool('propose_run', async (input, ctx) => {
  if (input.musicAssetKey) await requireMusic(input.musicAssetKey, ctx);
  return ctx.gate.propose(ctx.owner, ctx.threadId, ctx.turnId, input);
});

const runCancel = tool('run_cancel', (input, ctx) => ctx.runs.cancel(ctx.owner, input.runId));

/** The seven action tools, in the order the contract lists them. */
export const actionTools: ToolImpl[] = [
  planLifestyle,
  planFilm,
  directShot,
  cropCreate,
  timelineEdit,
  proposeRun,
  runCancel,
];
