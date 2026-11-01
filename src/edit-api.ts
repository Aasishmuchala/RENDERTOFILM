import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';

import {
  parseRunwayApiErrorReason,
  RunwayApiError,
  RunwayAuthError,
  RunwayCreditError,
  RunwayTaskError,
} from '@runway/bay/runway';
import * as platformStorage from '@runway/bay/storage';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { createTextTask, isTextTaskId, textTaskSnapshot } from './ai-text.ts';
import {
  buildEditorPrompt,
  EDITOR_SYSTEM_PROMPT,
  type EditorClip,
  type EditorPlan,
  parseEditorPlan,
  round,
  videoEditInstruction,
} from './editor.ts';
import {
  type ChatMessage,
  type Derived,
  type EditDoc,
  type EditMusic,
  type ExportDeliverable,
  type ExportJob,
  MAX_MEMORY,
  MAX_TIMELINE,
  ownsAsset,
  readEdit,
  type TimelineItem,
  updateEdit,
} from './edits.ts';
import { capabilitiesOf } from './capabilities.ts';
import { colourSchema, isNeutral } from './colour.ts';
import { GRADE_IDS, gradeName, videoGradeInstruction } from './grades.ts';
import { type InterchangeInput, toEdl, toOtio } from './interchange.ts';
import { type Clip, type Library, ownerKey, readLibrary } from './library.ts';
import { lookLabel } from './looks.ts';
import { DELIVERABLE_IDS, type DeliverableId, type QcReport, TITLE_CARD, VERTICAL_SIZE, verticalFrame } from './master.ts';
import { clipSeconds, motionLabel } from './models.ts';
import { recreateTitle } from './recreate.ts';
import { SIDECAR_LABELS } from './sidecars.ts';
import { logRejection, type RunwayCtx, settled, snapError, toTrpcError } from './task-helpers.ts';
import { playId, rootClipId, versionChain, versionNotes } from './timeline.ts';
import { router, signedInProcedure } from './trpc.ts';

/**
 * The Edit tab: a timeline of cuts from the visitor's clips, colour grades
 * and plain-language edits on a cut (Aleph 2.0), an AI editor (Claude) that
 * plans changes from a chat message, standing preferences it remembers, and
 * the export of the finished film (media_processing_v2). In the desktop app the
 * export can be a master: one finished file per deliverable, with music and QC,
 * or the cut can leave as OTIO or EDL, or go through FilmCraft as one more export.
 *
 * Everything long runs as a Runway task: a procedure submits and returns,
 * and `project` (polled by the page) advances whatever has finished.
 */

const MIN_CUT = 0.5;
/** An editor turn older than this has stalled; the page may send again. */
const AGENT_STALE_MS = 6 * 60_000;

/**
 * Polls in a row that may fail to reach Runway before a copy or an export
 * gives up. Runway can briefly answer "not found" for a task it has only just
 * created, and the broker can hiccup; neither means the task failed.
 */
const MAX_POLL_ERRORS = 10;
/**
 * A grade or edit still pending after this long has stalled. Only on Bay, or for
 * a run nothing answers for: on desktop the provider follows a paid run to its
 * end however long that takes (a key that is missing only holds it), and closing
 * one it still answers for would invite paying twice.
 */
const DERIVED_STALE_MS = 60 * 60_000;
/** An export record that never got its tasks submitted has been abandoned. */
const EXPORT_SUBMIT_STALE_MS = 3 * 60_000;
/** How many trims of one export are submitted at once. */
const EXPORT_CONCURRENCY = 4;
/** How a music bed sits when it was named with no settings saved: where the Edit tab starts one. */
const MUSIC_DEFAULTS = { name: 'Music', inSeconds: 0, gain: 0, fadeIn: 1.5, fadeOut: 2 };
/** What a film is called in a file for another editor; a cut has no title of its own. */
const FILM_NAME = 'Render to Film';

type EditorAction = { actions: string[]; exportWaits?: boolean };

/** A `Derived` that also counts the polls in a row that failed to reach Runway. */
type PolledDerived = Derived & { pollErrors?: number | undefined };

/**
 * One finished library clip the Edit tab can cut from. `stillId` is the
 * still it was made from while that still is in the library ('' otherwise);
 * `posterKey` is set when the clip has a poster of its own.
 */
export type EditClip = {
  id: string;
  seconds: number;
  label: string;
  stillId: string;
  posterKey?: string | undefined;
};

function availableClips(lib: Library, doc: EditDoc): EditClip[] {
  const stills = new Set(lib.stills.map((s) => s.id));
  const done = lib.clips.filter((c) => c.status === 'succeeded');
  // A cut's clip stays listed after 60 newer clips push it off the recent
  // ones: unlisted, the page called it gone (no name, no picture) and its
  // length fell back to 5 s for trims, edits and grades.
  const onTimeline = new Set(doc.timeline.map((t) => t.clipId));
  return [...done.slice(0, 60), ...done.slice(60).filter((c) => onTimeline.has(c.id))]
    .map((c) => ({
      id: c.id,
      seconds: clipLength(c),
      label: clipLabel(c, lib),
      stillId: stills.has(c.stillId) ? c.stillId : '',
      ...(c.posterKey ? { posterKey: c.posterKey } : {}),
    }));
}

/** Every finished clip, however old, for checking what a saved cut points at. */
function succeededClips(lib: Library): EditClip[] {
  return lib.clips
    .filter((c) => c.status === 'succeeded')
    .map((c) => ({ id: c.id, seconds: clipLength(c), label: '', stillId: c.stillId }));
}

function clipLength(c: Clip): number {
  return clipSeconds(c.videoModel, c.length, c.seconds);
}

function clipLabel(c: Clip, lib: Library): string {
  const still = lib.stills.find((s) => s.id === c.stillId);
  const parts = [
    c.recreate ? recreateTitle(c.recreate) : motionLabel(c.motion, c.moveStyle, c.speed),
    still
      ? still.look === 'none' && !(still.lightRefUrl || still.lightFromStillId)
        ? "the render's own light"
        : `${lookLabel(still.look, !!(still.lightRefUrl || still.lightFromStillId))} light`
      : '',
    c.upscaleOf ? 'upscaled' : '',
    c.direction ? `"${c.direction.slice(0, 80)}"` : '',
    c.tags?.length ? c.tags.map((t) => `@${t}`).join(' ') : '',
  ];
  return parts.filter(Boolean).join(', ');
}

/** How long the media a cut plays runs, in seconds. */
function lengthOf(id: string, doc: EditDoc, clips: readonly EditClip[]): number {
  return doc.derived.find((d) => d.id === id)?.seconds ?? clips.find((c) => c.id === id)?.seconds ?? 5;
}

function clampCut(item: TimelineItem, length: number): TimelineItem {
  const sourceStart = Math.min(Math.max(0, round(item.sourceStart)), Math.max(0, length - MIN_CUT));
  const duration = Math.min(Math.max(MIN_CUT, round(item.duration)), round(length - sourceStart));
  return { ...item, sourceStart, duration };
}

/** The finished video of a task: its artifact (asset) id, URL and metadata. */
export async function artifactOf(ctx: RunwayCtx, id: string) {
  const task = await ctx.runway.getTask(id);
  const a = task.artifacts[0];
  if (task.status !== 'SUCCEEDED' || !a) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'That clip has not finished rendering, so it cannot be used yet.',
    });
  }
  return {
    assetId: a.id,
    url: a.url,
    duration: a.metadata?.duration,
    fps: a.metadata?.frameRate,
    width: a.metadata?.size?.width,
    height: a.metadata?.size?.height,
  };
}

/** Re-render one clip with Aleph 2.0; returns the new task id. */
async function submitAleph(ctx: RunwayCtx, sourceId: string, seconds: number, prompt: string) {
  const src = await artifactOf(ctx, sourceId);
  const length = src.duration ?? seconds;
  try {
    const { id } = await ctx.runway.createTask('workflow_aleph_2', {
      name: 'render-to-film edit',
      text_prompt: prompt,
      seconds: Math.min(30, Math.max(2, Math.round(length))),
      input_video: src.url,
      input_video_asset_id: src.assetId,
      source_video_duration_seconds: src.duration,
      source_video_fps: src.fps && src.fps <= 30 ? src.fps : undefined,
    });
    return { id, seconds: round(length) };
  } catch (err) {
    logRejection('edit', 'workflow_aleph_2', err);
    throw toTrpcError(err);
  }
}

/** The copy a new grade starts from: the cut minus any grade on top. */
function gradeBase(doc: EditDoc, item: TimelineItem): string {
  const chain = versionChain(doc.derived, item);
  for (let i = chain.length - 1; i >= 0; i--) {
    if (chain[i]!.kind === 'edit') return chain[i]!.id;
  }
  return item.clipId;
}

function now() {
  return new Date().toISOString();
}

/**
 * A mutation's write of the document: what `mutate` answers, one `rev` on. Handing
 * back `cur` untouched changes nothing, so the rev stays. Polls that settle a task
 * use `updateEdit`: a grade landing is not a newer cut, so it must not stale a draft.
 * So does an export until the provider has said yes: one it refuses throws, and a
 * throw can't hand back the new rev the page would need for its next save.
 */
function reviseEdit(owner: string, mutate: (doc: EditDoc) => EditDoc): Promise<EditDoc> {
  return updateEdit(owner, (cur) => {
    const next = mutate(cur);
    return next === cur ? cur : { ...next, rev: cur.rev + 1 };
  });
}

/**
 * Submit a grade on one cut. `none` takes it back to the ungraded copy at
 * once; anything else renders a new copy and marks the cut pending.
 */
async function startGrade(
  ctx: RunwayCtx,
  doc: EditDoc,
  clips: readonly EditClip[],
  item: TimelineItem,
  gradeId: string
): Promise<{ item: TimelineItem; derived?: Derived }> {
  const base = gradeBase(doc, item);
  if (gradeId === 'none') {
    return { item: { ...item, versionId: base === item.clipId ? undefined : base, lastError: undefined } };
  }
  const { id, seconds } = await submitAleph(ctx, base, lengthOf(base, doc, clips), videoGradeInstruction(gradeId));
  return {
    item: { ...item, pendingId: id, lastError: undefined },
    derived: { id, parentId: base, kind: 'grade', gradeId, seconds, status: 'pending', createdAt: now() },
  };
}

async function startEdit(
  ctx: RunwayCtx,
  doc: EditDoc,
  clips: readonly EditClip[],
  item: TimelineItem,
  instruction: string
): Promise<{ item: TimelineItem; derived: Derived }> {
  const base = playId(item);
  const { id, seconds } = await submitAleph(
    ctx,
    base,
    lengthOf(base, doc, clips),
    videoEditInstruction(instruction)
  );
  return {
    item: { ...item, pendingId: id, lastError: undefined },
    derived: {
      id,
      parentId: base,
      kind: 'edit',
      instruction: instruction.trim(),
      seconds,
      status: 'pending',
      createdAt: now(),
    },
  };
}

/** Put a new or updated copy into the doc and the cut into the timeline. */
function withCut(doc: EditDoc, item: TimelineItem, derived?: Derived): EditDoc {
  return {
    ...doc,
    timeline: doc.timeline.map((t) => (t.key === item.key ? item : t)),
    derived: derived ? [derived, ...doc.derived.filter((d) => d.id !== derived.id)] : doc.derived,
  };
}

/** Why the timeline cannot be exported right now, if it cannot. */
function exportBlocker(doc: EditDoc): string | undefined {
  if (doc.exports.some((e) => e.status === 'pending')) {
    return 'A film is already being exported. Wait for it to finish.';
  }
  if (doc.timeline.some((t) => t.pendingId)) return 'A cut is still re-rendering. Export once it has finished.';
  return undefined;
}

/** Run `fn` over `items`, at most `limit` at a time; stops launching after a failure. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed) {
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = await fn(items[i]!);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

type Artifact = Awaited<ReturnType<typeof artifactOf>>;

/** What every export starts from: the cuts, each one's finished file, and the job's record. */
async function exportPlan(ctx: RunwayCtx, doc: EditDoc) {
  const cuts = doc.timeline;
  if (!cuts.length) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Add a clip to the timeline before exporting.' });
  }
  const ids = [...new Set(cuts.map(playId))];
  const arts = new Map(await Promise.all(ids.map(async (id) => [id, await artifactOf(ctx, id)] as const)));
  const seconds = round(cuts.reduce((s, c) => s + c.duration, 0));
  const base: ExportJob = {
    id: randomUUID(),
    createdAt: now(),
    status: 'pending',
    transition: cuts.length > 1 ? doc.transition : 'hard',
    seconds,
    cuts: cuts.length,
    grades: cuts.map((c) => ({ key: c.key, seconds: c.duration, colour: c.colour })),
  };
  return { cuts, arts, base };
}

/** The cuts end to end, in the clip shape `timeline_export` and `master` read. */
function timelineClips(cuts: readonly TimelineItem[], arts: ReadonlyMap<string, Artifact>) {
  let start = 0;
  return cuts.map((c) => {
    const a = arts.get(playId(c))!;
    const available = a.duration ?? c.sourceStart + c.duration;
    const duration = round(Math.max(0.1, Math.min(c.duration, available - c.sourceStart)));
    const clip = {
      assetId: a.assetId,
      track: 0,
      start: round(start),
      duration,
      contentType: 'video',
      sourceStart: c.sourceStart,
      availableDuration: available,
    };
    start += duration;
    return clip;
  });
}

/** A side of the film, or `d` when the clip did not say: encoders want even numbers. */
function even(n: number | undefined, d: number) {
  return n ? Math.max(2, Math.round(n / 2) * 2) : d;
}

/** Save an export's record before any task is submitted, so a double click can't bill twice. */
async function claimExport(owner: string, job: ExportJob): Promise<void> {
  const claimed = await updateEdit(owner, (cur) =>
    exportBlocker(cur) ? cur : { ...cur, exports: [job, ...cur.exports] }
  );
  if (!claimed.exports.some((e) => e.id === job.id)) {
    throw new TRPCError({ code: 'CONFLICT', message: exportBlocker(claimed) ?? 'An export is already running.' });
  }
}

/** The document without this export's record, for when nothing reached the provider. */
function withoutExport(id: string) {
  return (cur: EditDoc): EditDoc => ({ ...cur, exports: cur.exports.filter((e) => e.id !== id) });
}

/**
 * Submit the export of the current timeline. Hard cuts are one
 * `timeline_export`; fades trim each cut that isn't a whole clip, and the
 * stitch follows in `advanceExports` once the trims are done. The export's
 * record is saved first (and refuses a second export while one is pending),
 * so a failure partway through still leaves something polling can settle.
 *
 * The desktop app's ffmpeg reads the clips itself, so both ways give the first
 * clip's exact size and rate, and a clip of unknown length is trimmed rather
 * than taken whole. On Bay, what it sends is unchanged.
 */
async function startExport(ctx: RunwayCtx, owner: string, doc: EditDoc): Promise<{ job: ExportJob; rev: number }> {
  const { cuts, arts, base } = await exportPlan(ctx, doc);
  const desktop = capabilitiesOf(ctx.runway).desktop;
  await claimExport(owner, base);
  const patched = (patch: Partial<ExportJob>) => (cur: EditDoc): EditDoc => ({
    ...cur,
    exports: cur.exports.map((e) => (e.id === base.id ? { ...e, ...patch } : e)),
  });
  let submitted = false;
  try {
    if (base.transition === 'hard') {
      const first = arts.get(playId(cuts[0]!))!;
      const clips = timelineClips(cuts, arts);
      const { id } = await ctx.runway.createTask('media_processing_v2', {
        name: 'render-to-film film export',
        operation: 'timeline_export',
        input: [...new Set(clips.map((c) => c.assetId))],
        parameters: {
          version: 1,
          clips,
          ...(desktop
            ? {}
            : {
                width: even(first.width, 1920),
                height: even(first.height, 1080),
                fps: first.fps && first.fps <= 60 ? Math.round(first.fps) : 24,
              }),
        },
      });
      submitted = true;
      const { rev } = await reviseEdit(owner, patched({ finalId: id }));
      return { job: { ...base, finalId: id }, rev };
    }
    const parts: NonNullable<ExportJob['parts']> = await mapLimit(cuts, EXPORT_CONCURRENCY, async (c) => {
      const a = arts.get(playId(c))!;
      const available = a.duration ?? c.sourceStart + c.duration;
      const measured = a.duration !== undefined || !desktop;
      const whole = measured && c.sourceStart < 0.05 && c.sourceStart + c.duration >= available - 0.05;
      const end = round(Math.min(available, c.sourceStart + c.duration));
      if (whole) return { assetId: a.assetId, seconds: round(available) };
      const { id } = await ctx.runway.createTask('media_processing_v2', {
        name: 'render-to-film cut',
        operation: 'trim',
        input: [a.assetId],
        parameters: { start: c.sourceStart, end },
      });
      submitted = true;
      return { trimId: id, seconds: round(end - c.sourceStart) };
    });
    const job: ExportJob = { ...base, parts, fadeSeconds: doc.fadeSeconds };
    if (parts.every((p) => p.assetId)) {
      const stitchAt = now();
      const finalId = await submitStitch(ctx, job, parts.map((p) => p.assetId!));
      submitted = true;
      const { rev } = await reviseEdit(owner, patched({ parts, fadeSeconds: doc.fadeSeconds, stitchAt, finalId }));
      return { job: { ...job, stitchAt, finalId }, rev };
    }
    const { rev } = await reviseEdit(owner, patched({ parts, fadeSeconds: doc.fadeSeconds }));
    return { job, rev };
  } catch (err) {
    logRejection('export', 'media_processing_v2', err);
    const failure = toTrpcError(err);
    // Nothing reached Runway: drop the record. Otherwise it stays, failed, with the reason.
    await updateEdit(owner, submitted ? patched({ status: 'failed', error: failure.message }) : withoutExport(base.id)).catch(() => undefined);
    throw failure;
  }
}

/** Only the desktop app's client answers `master: true`; a client with no `capabilities()` is Bay. */
function canMaster(runway: unknown): boolean {
  return (capabilitiesOf(runway) as { master?: boolean }).master === true;
}

/** The pictures the page drew for a title card: its film shape, and the 9:16 one when there is a vertical file. */
type DrawnCard = { key: string; verticalKey?: string | undefined };
type DrawnCards = { head?: DrawnCard | undefined; tail?: DrawnCard | undefined };
type MasterCard = DrawnCard & { seconds: number };
type MasterCards = { head?: MasterCard | undefined; tail?: MasterCard | undefined };

/**
 * The title cards a master cuts in: each side the document has, on the picture the
 * page drew for it. A side with no picture is the page behind the document, and a
 * card no longer than the fade would have nothing left to show between its fades.
 */
function masterCards(doc: EditDoc, drawn: DrawnCards | null | undefined): MasterCards {
  const cards: MasterCards = {};
  // A chat Run cannot draw (the page does, on its canvas) and says so: its film has none.
  if (drawn === null) return cards;
  for (const side of ['head', 'tail'] as const) {
    const title = doc.titles?.[side];
    if (!title) continue;
    const picture = drawn?.[side];
    if (!picture) throw new TRPCError({ code: 'CONFLICT', message: 'The title cards have not been drawn yet. Try again.' });
    cards[side] = { ...picture, seconds: title.seconds };
  }
  const present = Object.values(cards);
  if (doc.transition === 'fade' && doc.timeline.length + present.length > 1 && present.some((c) => c.seconds <= doc.fadeSeconds)) {
    throw new TRPCError({ code: 'CONFLICT', message: 'A title card must be longer than the fade.' });
  }
  return cards;
}

/**
 * Submit a master of the current timeline: one `master` task per deliverable, each
 * the whole film through the desktop app's ffmpeg, with `music` under it. Claimed
 * like an export. Every deliverable is tried: one that cannot be sent fails on its
 * own row and polling settles the rest; when none reached the provider the record
 * goes, as an export's does, and the first refusal is what the caller hears.
 *
 * Title cards are cuts of the film, so they count in its length and its fades, and
 * stand in `grades` with no grade so the cuts stay under theirs. Only a `vertical`
 * file is told a size and a frame; every other file is sent as it was before there
 * was one.
 */
async function startMaster(
  ctx: RunwayCtx,
  owner: string,
  doc: EditDoc,
  deliverables: readonly DeliverableId[],
  music: EditMusic | null,
  cards: MasterCards
): Promise<{ job: ExportJob; rev: number }> {
  const { cuts, arts, base } = await exportPlan(ctx, doc);
  const { head, tail } = cards;
  const cardRows = (card: MasterCard | undefined) => (card ? [{ seconds: card.seconds }] : []);
  const cardSeconds = (head?.seconds ?? 0) + (tail?.seconds ?? 0);
  const framed = cuts.map((c) => {
    const a = arts.get(playId(c))!;
    return { key: c.key, ...verticalFrame(a.width ?? 1920, a.height ?? 1080, c.frame) };
  });
  const job: ExportJob = {
    ...base,
    transition: cuts.length + Number(!!head) + Number(!!tail) > 1 ? doc.transition : 'hard',
    seconds: round(base.seconds + cardSeconds),
    grades: [...cardRows(head), ...(base.grades ?? []), ...cardRows(tail)],
    fadeSeconds: doc.fadeSeconds,
    deliverables: deliverables.map((id) => ({ id, status: 'pending' })),
    ...(deliverables.includes('vertical') ? { frames: framed } : {}),
    ...(head || tail ? { cards: { ...(head ? { head: head.seconds } : {}), ...(tail ? { tail: tail.seconds } : {}) } } : {}),
  };
  await claimExport(owner, job);
  const patchRow = (id: DeliverableId, patch: Partial<ExportDeliverable>) =>
    updateEdit(owner, (cur) => ({
      ...cur,
      exports: cur.exports.map((e) =>
        e.id === job.id ? { ...e, deliverables: e.deliverables?.map((d) => (d.id === id ? { ...d, ...patch } : d)) } : e
      ),
    }));
  const first = arts.get(playId(cuts[0]!))!;
  const clips = timelineClips(cuts, arts);
  const cardOn = (deliverable: DeliverableId, card: MasterCard) => ({
    assetKey: (deliverable === 'vertical' && card.verticalKey) || card.key,
    seconds: card.seconds,
  });
  const refusals: TRPCError[] = [];
  let submitted = false;
  for (const deliverable of deliverables) {
    const vertical = deliverable === 'vertical';
    try {
      const { id } = await ctx.runway.createTask('media_processing_v2', {
        name: 'render-to-film master',
        operation: 'master',
        input: [...new Set(clips.map((c) => c.assetId))],
        parameters: {
          clips: vertical ? clips.map((c, i) => ({ ...c, frame: { mode: framed[i]!.mode, x: framed[i]!.x } })) : clips,
          transition: job.transition,
          fadeSeconds: doc.fadeSeconds,
          deliverable,
          music,
          width: vertical ? VERTICAL_SIZE.width : even(first.width, 1920),
          height: vertical ? VERTICAL_SIZE.height : even(first.height, 1080),
          fps: first.fps && first.fps <= 60 ? first.fps : 24,
          ...(head || tail
            ? {
                cards: {
                  ...(head ? { head: cardOn(deliverable, head) } : {}),
                  ...(tail ? { tail: cardOn(deliverable, tail) } : {}),
                },
              }
            : {}),
        },
      });
      submitted = true;
      await patchRow(deliverable, { finalId: id });
    } catch (err) {
      logRejection('export', 'media_processing_v2', err);
      const failure = toTrpcError(err);
      refusals.push(failure);
      await patchRow(deliverable, { status: 'failed', error: failure.message }).catch(() => undefined);
    }
  }
  if (!submitted) {
    await updateEdit(owner, withoutExport(job.id)).catch(() => undefined);
    throw refusals[0]!;
  }
  // The rows are saved; this write is the export's one move of rev.
  const { rev } = await reviseEdit(owner, (cur) => ({ ...cur }));
  return { job, rev };
}

/**
 * The bed's file on this computer. Only the desktop platform's storage can name
 * one (Bay's has no `storagePath`), and `ownsAsset` keeps the key to this owner's.
 */
function bedFile(owner: string, key: string): string {
  const { storagePath } = platformStorage as unknown as { storagePath?: (key: string) => string };
  const file = ownsAsset(owner, key) ? storagePath?.(key) : undefined;
  if (!file || !existsSync(file)) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: "That music's file is no longer on this computer." });
  }
  return file;
}

/**
 * The timeline as src/interchange.ts reads it: each cut as the export plays it, and
 * the saved bed under them, on their files on this computer. Only the desktop client
 * can name those files.
 */
function interchangeInput(
  ctx: RunwayCtx,
  owner: string,
  doc: EditDoc,
  cuts: readonly TimelineItem[],
  arts: ReadonlyMap<string, Artifact>
): InterchangeInput {
  const files = ctx.runway as unknown as { taskFile?: (id: string) => string | null };
  const first = arts.get(playId(cuts[0]!))!;
  const clips = timelineClips(cuts, arts);
  const { music } = doc;
  return {
    name: FILM_NAME,
    fps: first.fps && first.fps <= 60 ? first.fps : 24,
    width: even(first.width, 1920),
    height: even(first.height, 1080),
    transition: cuts.length > 1 ? doc.transition : 'hard',
    fadeSeconds: doc.fadeSeconds,
    cuts: cuts.map((c, i) => {
      const id = playId(c);
      const file = files.taskFile?.(id);
      if (!file) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: "That clip's file is no longer on this computer." });
      }
      const { sourceStart, duration, availableDuration } = clips[i]!;
      return {
        key: c.key,
        clipId: c.clipId,
        playId: id,
        sourceStart,
        duration,
        file,
        availableSeconds: availableDuration,
        ...(c.colour ? { colour: c.colour } : {}),
      };
    }),
    ...(music
      ? {
          music: {
            name: music.name,
            file: bedFile(owner, music.assetKey),
            inSeconds: music.inSeconds,
            gain: music.gain,
            fadeIn: music.fadeIn,
            fadeOut: music.fadeOut,
          },
        }
      : {}),
  };
}

/**
 * Submit the timeline to FilmCraft as OTIO. Claimed like an export and tracked as a
 * master of one file, so `project` settles it the same way. Nothing reached FilmCraft
 * when the submit fails, so the record goes and the caller hears why.
 */
async function startConform(
  ctx: RunwayCtx,
  owner: string,
  doc: EditDoc,
  output: 'mp4' | 'mov'
): Promise<{ job: ExportJob; rev: number }> {
  const { cuts, arts, base } = await exportPlan(ctx, doc);
  const film = interchangeInput(ctx, owner, doc, cuts, arts);
  // Its id says h264 in either container, so the row names the file itself.
  const row: ExportDeliverable & { label: string } = { id: 'h264', status: 'pending', label: SIDECAR_LABELS.filmcraft, fileName: `render-to-film-filmcraft.${output}` };
  const job: ExportJob = { ...base, fadeSeconds: doc.fadeSeconds, deliverables: [row] };
  await claimExport(owner, job);
  let finalId: string;
  try {
    ({ id: finalId } = await ctx.runway.createTask('media_processing_v2', {
      name: 'render-to-film FilmCraft conform',
      operation: 'conform_otio',
      input: [...new Set(cuts.map((c) => arts.get(playId(c))!.assetId))],
      parameters: {
        otio: JSON.stringify(toOtio(film)),
        output,
        // FilmCraft opens this OTIO as a 1920x1080 sequence and, before the size can be
        // changed, places every clip at that frame's centre. sequence.settings alone leaves
        // them there (a 1280x720 film comes out with its top-left quarter black and the
        // picture cropped, exit 0); fitting the selection re-centres and scales each clip
        // from its own size, so mixed-size cuts come out right too. Checked on the real
        // 0.15.0 binary, 2026-10-31.
        script: [
          JSON.stringify({ id: 'sequence.settings', params: { width: film.width, height: film.height } }),
          JSON.stringify({ id: 'edit.selectAll', params: {} }),
          JSON.stringify({ id: 'clip.fitToFrame', params: {} }),
        ],
      },
    }));
  } catch (err) {
    logRejection('export', 'media_processing_v2', err);
    await updateEdit(owner, withoutExport(job.id)).catch(() => undefined);
    throw toTrpcError(err);
  }
  const { rev } = await reviseEdit(owner, (cur) => ({
    ...cur,
    exports: cur.exports.map((e) =>
      e.id === job.id ? { ...e, deliverables: e.deliverables?.map((d) => ({ ...d, finalId })) } : e
    ),
  }));
  return { job, rev };
}

async function submitStitch(ctx: RunwayCtx, job: ExportJob, input: string[]): Promise<string> {
  // Stitch measures its inputs against `durationSeconds`; sending the summed
  // length ourselves means the task never depends on an asset lookup.
  const seconds = round((job.parts ?? []).reduce((s, p) => s + (p.seconds ?? 0), 0));
  const { id } = await ctx.runway.createTask('media_processing_v2', {
    name: 'render-to-film film export',
    operation: 'stitch',
    input,
    ...(seconds > 0 && job.parts?.every((p) => p.seconds) ? { durationSeconds: seconds } : {}),
    parameters: {
      transition: { type: 'fade', duration: Math.min(4.9, Math.max(0.1, job.fadeSeconds ?? 0.5)) },
    },
  });
  return id;
}

/** Settle finished grades and edits, and swap them into their cuts. */
async function advanceDerived(ctx: RunwayCtx, owner: string, doc: EditDoc): Promise<EditDoc> {
  const pending = doc.derived.filter((d): d is PolledDerived => d.status === 'pending');
  if (!pending.length) return doc;
  const desktop = capabilitiesOf(ctx.runway).desktop;
  type Outcome = { id: string; status: Derived['status']; error?: string | undefined; pollErrors?: number | undefined };
  const results = await Promise.all(
    pending.map(async (d): Promise<Outcome | null> => {
      const snap = await ctx.runway.taskSnapshot(d.id).catch(() => null);
      if (snap) {
        const s = settled(snap);
        if (s.status !== 'pending') return { id: d.id, ...s };
      }
      if (!(desktop && snap) && Date.now() - Date.parse(d.createdAt) > DERIVED_STALE_MS) {
        return { id: d.id, status: 'failed', error: 'This re-render took too long and was stopped. Try it again.' };
      }
      if (snap) return d.pollErrors ? { id: d.id, status: 'pending', pollErrors: 0 } : null;
      const errors = (d.pollErrors ?? 0) + 1;
      return errors >= MAX_POLL_ERRORS
        ? { id: d.id, status: 'failed', error: 'Runway stopped answering about this re-render, so it may still finish in your Runway assets. Try it again.' }
        : { id: d.id, status: 'pending', pollErrors: errors };
    })
  );
  const changes = results.filter((r): r is Outcome => !!r);
  if (!changes.length) return doc;
  const done = changes.filter((r) => r.status !== 'pending');
  return updateEdit(owner, (cur) => ({
    ...cur,
    derived: cur.derived.map((d): PolledDerived => {
      const r = changes.find((x) => x.id === d.id);
      if (!r || d.status !== 'pending') return d;
      return r.status === 'pending'
        ? { ...d, pollErrors: r.pollErrors }
        : { ...d, status: r.status, error: r.error, pollErrors: undefined };
    }),
    timeline: cur.timeline.map((t) => {
      const r = done.find((x) => x.id === t.pendingId);
      if (!r) return t;
      return r.status === 'succeeded'
        ? { ...t, versionId: r.id, pendingId: undefined, lastError: undefined }
        : { ...t, pendingId: undefined, lastError: r.error ?? 'The re-render failed.' };
    }),
  }));
}

/** A failure no retry can change: a refused submit, credits, a plan gate. */
function isTerminal(err: unknown): boolean {
  if (err instanceof RunwayCreditError || err instanceof RunwayTaskError) return true;
  if (err instanceof RunwayAuthError) return err.permissionDenied === true;
  return err instanceof TRPCError && err.code === 'PRECONDITION_FAILED';
}

/**
 * What a finished export reports. On desktop that is the file's own length,
 * which each fade shortens by its overlap and a clip shorter than its cut by what
 * it lacks. Bay keeps the sum of the timeline.
 */
async function filmLength(ctx: RunwayCtx, finalId: string): Promise<Partial<ExportJob>> {
  if (!capabilitiesOf(ctx.runway).desktop) return {};
  const film = await artifactOf(ctx, finalId).catch(() => null);
  return film?.duration ? { seconds: round(film.duration) } : {};
}

/** The QC report a finished master's artifact carries (`metadata.qc`), when it has one. */
async function qcOf(ctx: RunwayCtx, id: string): Promise<QcReport | undefined> {
  const task = await ctx.runway.getTask(id).catch(() => null);
  return (task?.artifacts[0]?.metadata as { qc?: QcReport } | undefined)?.qc;
}

type DeliverableResult = Pick<ExportDeliverable, 'id' | 'status' | 'error' | 'qc'>;

/** How one unfinished deliverable ended; null while it is still running. */
async function deliverableResult(ctx: RunwayCtx, job: ExportJob, d: ExportDeliverable): Promise<DeliverableResult | null> {
  if (!d.finalId) {
    return Date.now() - Date.parse(job.createdAt) > EXPORT_SUBMIT_STALE_MS
      ? { id: d.id, status: 'failed', error: 'The master stopped before this file was started. Start it again.' }
      : null;
  }
  const s = settled(await ctx.runway.taskSnapshot(d.finalId));
  if (s.status === 'pending') return null;
  if (s.status === 'failed') return { id: d.id, status: 'failed', error: s.error };
  const qc = await qcOf(ctx, d.finalId);
  return { id: d.id, status: 'succeeded', ...(qc ? { qc } : {}) };
}

function withResults(rows: readonly ExportDeliverable[], results: readonly DeliverableResult[]): ExportDeliverable[] {
  return rows.map((d) => {
    const r = results.find((x) => x.id === d.id);
    return r && d.status === 'pending' ? { ...d, ...r } : d;
  });
}

/**
 * A master once these results are in. It is done when no file is still running, and
 * failed only when none came out: a good file stays usable beside a failed one, whose
 * row says why. `finalId` is the first good file, for what plays and downloads one film.
 */
function settleMaster(
  job: ExportJob,
  results: readonly DeliverableResult[],
  length: Partial<ExportJob>,
  pollErrors: number
): ExportJob {
  const deliverables = withResults(job.deliverables ?? [], results);
  const settledJob = { ...job, deliverables, pollErrors };
  if (deliverables.some((d) => d.status === 'pending')) return settledJob;
  const film = deliverables.find((d) => d.status === 'succeeded');
  return film
    ? { ...settledJob, ...length, status: 'succeeded', finalId: film.finalId, error: undefined }
    : { ...settledJob, status: 'failed', error: deliverables.find((d) => d.error)?.error ?? 'The master failed.' };
}

/**
 * Read a master's unfinished tasks and save what they say. Each row answers for
 * itself: a task that is gone fails its own row, and one that can't be read costs
 * the job a failed poll while the others settle. With the failed polls used up and
 * no other file running, a lost row fails beside a good file; with no good file the
 * job stops and keeps the row pending, for Check again to follow. The write merges
 * by row into the document as it is then, because `startMaster` may still be saving
 * task ids. A job with no row left pending always settles: `startMaster` can fail
 * the last one itself, after the polls have settled the others.
 */
async function advanceMaster(ctx: RunwayCtx, owner: string, job: ExportJob): Promise<EditDoc | null> {
  const rows = job.deliverables ?? [];
  const open = rows.filter((d) => d.status === 'pending');
  const reads = await Promise.allSettled(open.map((d) => deliverableResult(ctx, job, d)));
  const results: DeliverableResult[] = [];
  const unread: DeliverableResult[] = [];
  reads.forEach((read, i) => {
    if (read.status === 'fulfilled') {
      if (read.value) results.push(read.value);
      return;
    }
    logRejection('export', 'media_processing_v2', read.reason);
    const lost: DeliverableResult = { id: open[i]!.id, status: 'failed', error: exportError(read.reason) };
    (isTerminal(read.reason) ? results : unread).push(lost);
  });
  if (open.length && !results.length && !unread.length && !job.pollErrors) return null;
  const pollErrors = unread.length ? (job.pollErrors ?? 0) + 1 : 0;
  const merged = withResults(rows, results);
  const running = merged.filter((d) => d.status === 'pending').length > unread.length;
  const gaveUp = pollErrors >= MAX_POLL_ERRORS && !running;
  const good = merged.some((d) => d.status === 'succeeded');
  const answers = gaveUp && good ? [...results, ...unread] : results;
  const finished = withResults(rows, answers);
  const film = finished.some((d) => d.status === 'pending') ? undefined : finished.find((d) => d.status === 'succeeded');
  const length = film?.finalId ? await filmLength(ctx, film.finalId) : {};
  const stopped: Partial<ExportJob> = gaveUp && !good ? { status: 'failed', error: unread[0]!.error } : {};
  return updateEdit(owner, (cur) => ({
    ...cur,
    exports: cur.exports.map((e) => (e.id === job.id ? { ...settleMaster(e, answers, length, pollErrors), ...stopped } : e)),
  }));
}

async function advanceExports(ctx: RunwayCtx, owner: string, doc: EditDoc): Promise<EditDoc> {
  let next = doc;
  for (const job of doc.exports.filter((e) => e.status === 'pending')) {
    let patch: Partial<ExportJob> | null = null;
    let claimedStitch = false;
    try {
      if (job.deliverables) {
        next = (await advanceMaster(ctx, owner, job)) ?? next;
      } else if (job.finalId) {
        const snap = await ctx.runway.taskSnapshot(job.finalId);
        const s = settled(snap);
        patch = s.status !== 'pending' ? { status: s.status, error: s.error, pollErrors: 0 } : null;
        if (s.status === 'succeeded') patch = { ...patch, ...(await filmLength(ctx, job.finalId)) };
        if (!patch && job.pollErrors) patch = { pollErrors: 0 };
      } else if (job.parts && !job.stitchAt) {
        const snaps = await Promise.all(
          job.parts.map((p) => (p.trimId ? ctx.runway.taskSnapshot(p.trimId) : null))
        );
        const failed = snaps.find((s) => s?.done && s.status !== 'SUCCEEDED');
        if (failed) {
          patch = { status: 'failed', error: snapError(failed) ?? 'Cutting one of the clips failed.' };
        } else if (snaps.every((s) => !s || (s.done && s.status === 'SUCCEEDED'))) {
          // Claim the stitch first, so two polls never submit it twice. `stitchBy`
          // tells this poll's claim from another made in the same millisecond.
          const at = now();
          const by = randomUUID();
          const claimed = await updateEdit(owner, (cur) => ({
            ...cur,
            exports: cur.exports.map((e) => (e.id === job.id && !e.stitchAt ? { ...e, stitchAt: at, stitchBy: by } : e)),
          }));
          if (claimed.exports.find((e) => e.id === job.id)?.stitchBy !== by) continue;
          claimedStitch = true;
          const input: string[] = [];
          for (const p of job.parts) {
            input.push(p.assetId ?? (await artifactOf(ctx, p.trimId!)).assetId);
          }
          patch = { finalId: await submitStitch(ctx, job, input), pollErrors: 0 };
        } else if (job.pollErrors) {
          patch = { pollErrors: 0 };
        }
      } else if (job.parts && job.stitchAt && Date.now() - Date.parse(job.stitchAt) > EXPORT_SUBMIT_STALE_MS) {
        // The stitch was claimed but its task id was never saved: stop, and let Check again send it.
        patch = {
          status: 'failed',
          error: 'The export stopped before the final film was sent to Runway.',
          stitchAt: undefined,
          stitchBy: undefined,
        };
      } else if (!job.finalId && !job.parts && Date.now() - Date.parse(job.createdAt) > EXPORT_SUBMIT_STALE_MS) {
        patch = { status: 'failed', error: 'The export stopped before it was sent to Runway. Press Export film to start over.' };
      }
    } catch (err) {
      logRejection('export', 'media_processing_v2', err);
      const errors = (job.pollErrors ?? 0) + 1;
      if (isTerminal(err) || errors >= MAX_POLL_ERRORS) {
        // A stitch that didn't go through is released here too, so Check again can send it.
        patch = { status: 'failed', error: exportError(err), ...(claimedStitch ? { stitchAt: undefined, stitchBy: undefined } : {}) };
      } else {
        // Keep it pending and look again on the next poll; a stitch that
        // didn't go through is released so that poll can submit it.
        patch = { pollErrors: errors, ...(claimedStitch ? { stitchAt: undefined, stitchBy: undefined } : {}) };
      }
    }
    if (patch) {
      const p = patch;
      next = await updateEdit(owner, (cur) => ({
        ...cur,
        exports: cur.exports.map((e) => (e.id === job.id ? { ...e, ...p } : e)),
      }));
    }
  }
  return next;
}

/** Why an export stopped, in one sentence the visitor can act on. */
function exportError(err: unknown): string {
  if (isTerminal(err)) return toTrpcError(err).message;
  const reason = err instanceof RunwayApiError ? parseRunwayApiErrorReason(err.body) : undefined;
  const status = err instanceof RunwayApiError ? ` (${err.status}${reason ? `: ${reason}` : ''})` : '';
  return `Runway stopped answering about this export${status}, so it may still finish in your Runway assets.`;
}

/** Finish the editor's turn once Claude has answered: parse, apply, reply. */
async function advanceAgent(
  ctx: RunwayCtx,
  owner: string,
  doc: EditDoc,
  clips: readonly EditClip[]
): Promise<EditDoc> {
  const agent = doc.agent;
  if (!agent) return doc;
  const stale = Date.now() - Date.parse(agent.at) > AGENT_STALE_MS;
  if (agent.status === 'applying') {
    return stale ? finishAgent(owner, agent.taskId, 'The editor stopped before it finished. Send your message again.', [], true) : doc;
  }
  const snap = await textTaskSnapshot(ctx, owner, agent.taskId).catch(() => null);
  if (!snap?.done) {
    return snap || !stale ? doc : finishAgent(owner, agent.taskId, 'The editor did not answer. Send your message again.', [], true);
  }
  // Claim the turn so a second poll doesn't apply the same plan twice; `by`
  // tells this poll's claim from another made in the same millisecond.
  const at = now();
  const by = randomUUID();
  const claimed = await updateEdit(owner, (cur) =>
    cur.agent?.taskId === agent.taskId && cur.agent.status === 'running'
      ? { ...cur, agent: { ...cur.agent, status: 'applying', at, by } }
      : cur
  );
  if (claimed.agent?.taskId !== agent.taskId || claimed.agent.by !== by) return claimed;

  const plan = snap.status === 'SUCCEEDED' && snap.text && !snap.truncated ? parseEditorPlan(snap.text) : null;
  if (!plan) {
    const why =
      snapError(snap) ??
      (snap.truncated
        ? 'The editor ran out of room before it finished its answer. Try a shorter request.'
        : 'The editor answered in a form the app could not read. Send your message again.');
    return finishAgent(owner, agent.taskId, why, [], true);
  }
  try {
    const { actions, exportWaits } = await applyPlan(ctx, owner, claimed, clips, plan, agent.handles, agent.cutKeys);
    const reply = exportWaits
      ? `${plan.reply}\n\nI have not exported yet: the export waits until the cuts finish re-rendering. Press Export film then.`
      : plan.reply;
    return finishAgent(owner, agent.taskId, reply, actions, false);
  } catch (err) {
    const message = err instanceof Error ? toTrpcError(err).message : 'Applying the plan failed.';
    return finishAgent(owner, agent.taskId, `${plan.reply}\n\nI could not apply it: ${message}`, [], true);
  }
}

function finishAgent(owner: string, taskId: string, text: string, actions: string[], error: boolean) {
  const msg: ChatMessage = { role: 'agent', text, at: now(), actions: actions.length ? actions : undefined, error: error || undefined };
  return updateEdit(owner, (cur) =>
    cur.agent?.taskId === taskId
      ? { ...cur, agent: undefined, messages: [...cur.messages, msg] }
      : cur
  );
}

/** Carry out the editor's plan against the doc it was shown. */
async function applyPlan(
  ctx: RunwayCtx,
  owner: string,
  doc: EditDoc,
  clips: readonly EditClip[],
  plan: EditorPlan,
  handles: Record<string, string>,
  cutKeys: readonly string[]
): Promise<EditorAction> {
  const actions: string[] = [];
  let timeline = doc.timeline;

  if (plan.timeline) {
    const built: TimelineItem[] = [];
    for (const entry of plan.timeline) {
      let item: TimelineItem | undefined;
      if (entry.cut) {
        const key = cutKeys[entry.cut - 1];
        item = doc.timeline.find((t) => t.key === key);
      } else if (entry.clip) {
        const clipId = handles[entry.clip];
        if (clipId && clips.some((c) => c.id === clipId)) {
          item = { key: randomUUID(), clipId, sourceStart: 0, duration: 0 };
        }
      }
      if (!item) continue;
      // A reused cut is copied when it appears twice, so each has its own key.
      if (built.some((b) => b.key === item!.key)) item = { ...item, key: randomUUID(), pendingId: undefined };
      built.push(
        clampCut({ ...item, sourceStart: entry.in, duration: entry.out - entry.in }, lengthOf(playId(item), doc, clips))
      );
    }
    if (plan.timeline.length && !built.length) {
      actions.push('Timeline unchanged: the cuts the editor named were not found');
    } else {
      timeline = built.slice(0, MAX_TIMELINE);
    }
    const total = round(timeline.reduce((s, t) => s + t.duration, 0));
    actions.push(`Timeline: ${timeline.length} ${timeline.length === 1 ? 'cut' : 'cuts'}, ${total}s`);
  }

  let working: EditDoc = { ...doc, timeline };
  if (plan.transition) {
    working = { ...working, transition: plan.transition };
  }
  // Inside the 0.1 to 4.9 the timeline save takes, or the next save of this doc is refused.
  if (plan.fadeSeconds) working = { ...working, fadeSeconds: round(Math.min(4.9, Math.max(0.1, plan.fadeSeconds))) };
  if (plan.transition || plan.fadeSeconds) {
    actions.push(working.transition === 'fade' ? `Transitions: ${working.fadeSeconds}s fades` : 'Transitions: hard cuts');
  }

  // Looks, grades, then edits, each on the cut number after the timeline change.
  for (const l of plan.look ?? []) {
    const item = working.timeline[l.cut - 1];
    if (!item) continue;
    const colour = {
      gradeId: l.grade,
      strength: l.strength ?? 1,
      exposure: l.exposure ?? 0,
      contrast: l.contrast ?? 0,
      saturation: l.saturation ?? 0,
      warmth: l.warmth ?? 0,
    };
    const neutral = isNeutral(colour);
    working = {
      ...working,
      timeline: working.timeline.map((t, i) => (i === l.cut - 1 ? { ...t, colour: neutral ? undefined : colour } : t)),
    };
    actions.push(neutral ? `Cut ${l.cut}: colour back to original` : `Cut ${l.cut}: ${gradeName(l.grade)} look`);
  }
  // Cuts whose grade the editor removed; the final save keeps that change.
  const ungraded = new Set<string>();
  for (const g of plan.grade ?? []) {
    const item = working.timeline[g.cut - 1];
    if (!item) continue;
    if (item.pendingId) {
      actions.push(`Cut ${g.cut} is still re-rendering, so its grade waits`);
      continue;
    }
    try {
      const res = await startGrade(ctx, working, clips, item, g.grade);
      working = withCut(working, res.item, res.derived);
      if (g.grade === 'none') ungraded.add(item.key);
      actions.push(g.grade === 'none' ? `Cut ${g.cut}: grade removed` : `Cut ${g.cut}: ${gradeName(g.grade)} grade rendering`);
    } catch (err) {
      actions.push(`Cut ${g.cut}: grade not started (${err instanceof Error ? toTrpcError(err).message : 'failed'})`);
    }
  }
  for (const e of plan.edit ?? []) {
    const item = working.timeline[e.cut - 1];
    if (!item) continue;
    if (item.pendingId) {
      actions.push(`Cut ${e.cut} is still re-rendering, so the edit waits`);
      continue;
    }
    try {
      const res = await startEdit(ctx, working, clips, item, e.instruction);
      working = withCut(working, res.item, res.derived);
      actions.push(`Cut ${e.cut}: edit rendering, "${e.instruction.slice(0, 80)}"`);
    } catch (err) {
      actions.push(`Cut ${e.cut}: edit not started (${err instanceof Error ? toTrpcError(err).message : 'failed'})`);
    }
  }

  const forget = new Set((plan.forget ?? []).map((n) => n - 1));
  let memory = working.memory.filter((_, i) => !forget.has(i));
  if (forget.size) actions.push(`Forgot ${forget.size} ${forget.size === 1 ? 'preference' : 'preferences'}`);
  for (const r of plan.remember ?? []) {
    const text = r.trim();
    if (text && !memory.some((m) => m.toLowerCase() === text.toLowerCase())) {
      memory = [...memory, text];
      actions.push(`Remembered: ${text}`);
    }
  }
  working = { ...working, memory: memory.slice(-MAX_MEMORY) };

  let exportWaits = false;
  if (plan.export) {
    const blocker = exportBlocker(working);
    if (blocker) {
      exportWaits = working.timeline.some((t) => t.pendingId);
      actions.push(exportWaits ? 'Export waits until the re-renders finish' : `Export not started (${blocker})`);
    } else {
      try {
        // The record is saved by startExport itself, before anything is submitted.
        await startExport(ctx, owner, working);
        actions.push('Export started');
      } catch (err) {
        actions.push(`Export not started (${err instanceof Error ? toTrpcError(err).message : 'failed'})`);
      }
    }
  }

  const applied = working;
  const newDerived = applied.derived.filter((d) => !doc.derived.some((x) => x.id === d.id));
  const started = new Set(newDerived.map((d) => d.id));
  // Not a mutation, but when the cut itself changes a draft from before it is stale.
  // A reply alone, or a preference remembered, is not a newer cut: the rev stays, or
  // the page's next save would be refused for a change nobody made.
  const cutOf = (d: EditDoc) => JSON.stringify([d.timeline, d.transition, d.fadeSeconds]);
  const notes = (cur: EditDoc) => ({
    derived: [...newDerived, ...cur.derived.filter((d) => !newDerived.some((n) => n.id === d.id))],
    memory: applied.memory,
  });
  if (cutOf(applied) === cutOf(doc)) {
    // The turn left the cut alone, so it writes nothing to it: a save that landed meanwhile stays.
    await updateEdit(owner, (cur) => ({ ...cur, ...notes(cur) }));
    return { actions, exportWaits };
  }
  await reviseEdit(owner, (cur) => ({
    ...cur,
    // A grade or edit that landed while the editor worked stays on its cut.
    timeline: applied.timeline.map((t) => {
      const live = cur.timeline.find((c) => c.key === t.key);
      if (!live || (t.pendingId && started.has(t.pendingId))) return t;
      // An ungraded cut keeps the copy the editor chose, plus anything started on it since.
      if (ungraded.has(t.key)) return { ...t, pendingId: live.pendingId, lastError: live.lastError };
      return { ...t, versionId: live.versionId, pendingId: live.pendingId, lastError: live.lastError };
    }),
    transition: applied.transition,
    fadeSeconds: applied.fadeSeconds,
    ...notes(cur),
  }));
  return { actions, exportWaits };
}

async function load(ctx: RunwayCtx & { req: Parameters<typeof ownerKey>[0] }) {
  const owner = await ownerKey(ctx.req);
  const [doc, lib] = await Promise.all([readEdit(owner), readLibrary(owner)]);
  return { owner, doc, lib, clips: availableClips(lib, doc) };
}

function findCut(doc: EditDoc, key: string): TimelineItem {
  const item = doc.timeline.find((t) => t.key === key);
  if (!item) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'That cut is no longer on the timeline.' });
  }
  if (item.pendingId) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'That cut is still re-rendering. Wait for it to finish first.',
    });
  }
  return item;
}

/** A file the music can be: only one of this owner's own uploads. */
function checkMusicKey(owner: string, key: string) {
  if (!ownsAsset(owner, key)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'That music is not one of your uploads.' });
}

/** A picture a title card is cut from: only one of this owner's own uploads. */
function checkCardKey(owner: string, key: string | undefined) {
  if (key !== undefined && !ownsAsset(owner, key)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'That title card is not yours.' });
}

const cutInput = z.object({
  key: z.string().min(1).max(64),
  clipId: z.string().min(1),
  versionId: z.string().min(1).optional(),
  sourceStart: z.number().min(0),
  duration: z.number().positive(),
  colour: colourSchema.optional(),
  frame: z.object({ mode: z.enum(['crop', 'fit']), x: z.number().min(0).max(1) }).optional(),
});

const titleCard = z.object({
  text: z.string().trim().min(1).max(TITLE_CARD.maxTitle),
  subtitle: z.string().trim().max(TITLE_CARD.maxSubtitle).optional(),
  seconds: z.number().min(TITLE_CARD.minSeconds).max(TITLE_CARD.maxSeconds),
});

const drawnCard = z.object({ key: z.string().min(1), verticalKey: z.string().min(1).optional() });

export const editRouter = router({
  /** The visitor's edit, with every finished task settled into it. */
  project: signedInProcedure.query(async ({ ctx }) => {
    const loaded = await load(ctx);
    const { owner, clips } = loaded;
    let doc = loaded.doc;
    try {
      doc = await advanceDerived(ctx, owner, doc);
      doc = await advanceExports(ctx, owner, doc);
      doc = await advanceAgent(ctx, owner, doc, clips);
    } catch (err) {
      console.warn('[edit] advance', err);
    }
    const { agent, ...rest } = doc;
    return {
      ...rest,
      agent: agent ? { status: agent.status, at: agent.at } : null,
      clips,
      notes: Object.fromEntries(doc.timeline.map((t) => [t.key, versionNotes(doc.derived, t)])),
    };
  }),

  /** Replace the timeline (order, trims, which cuts) and its transitions. */
  saveTimeline: signedInProcedure
    .input(
      z.object({
        items: z.array(cutInput).max(MAX_TIMELINE),
        transition: z.enum(['hard', 'fade']),
        fadeSeconds: z.number().min(0.1).max(4.9),
        /** The rev this draft was made from; without it the save is not checked. */
        baseRev: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { owner, lib, clips } = await load(ctx);
      // Check against every finished clip, not just the recent ones listed on the page.
      const known = new Set(succeededClips(lib).map((c) => c.id));
      const lengths = [...clips, ...succeededClips(lib).filter((c) => !clips.some((x) => x.id === c.id))];
      let stale = false;
      const doc = await reviseEdit(owner, (cur) => {
        stale = input.baseRev !== undefined && input.baseRev !== cur.rev;
        if (stale) return cur;
        const items: TimelineItem[] = [];
        for (const raw of input.items) {
          if (!known.has(raw.clipId)) continue;
          const existing = cur.timeline.find((t) => t.key === raw.key);
          // The page never owns a cut's version (grades land while it edits);
          // only a new cut copied from another may bring one.
          const versionId = existing
            ? existing.versionId
            : raw.versionId && cur.derived.some((d) => d.id === raw.versionId && d.status === 'succeeded')
              ? raw.versionId
              : undefined;
          const item: TimelineItem = {
            key: raw.key,
            clipId: raw.clipId,
            versionId,
            pendingId: existing?.pendingId,
            lastError: existing?.lastError,
            sourceStart: raw.sourceStart,
            duration: raw.duration,
            colour: raw.colour && !isNeutral(raw.colour) ? raw.colour : undefined,
            frame: raw.frame,
          };
          items.push(clampCut(item, lengthOf(playId(item), cur, lengths)));
        }
        return { ...cur, timeline: items, transition: input.transition, fadeSeconds: round(input.fadeSeconds) };
      });
      if (stale) throw new TRPCError({ code: 'CONFLICT', message: 'The cut changed elsewhere. Reload it and try again.' });
      return { ok: true, rev: doc.rev };
    }),

  /** Colour grade one cut with a preset (a new copy; "none" takes it back). */
  gradeClip: signedInProcedure
    .input(z.object({ key: z.string().min(1), gradeId: z.enum(GRADE_IDS) }))
    .mutation(async ({ ctx, input }) => {
      const { owner, doc, clips } = await load(ctx);
      const res = await startGrade(ctx, doc, clips, findCut(doc, input.key), input.gradeId);
      const { rev } = await reviseEdit(owner, (cur) => withCut(cur, res.item, res.derived));
      return { pending: !!res.derived, rev };
    }),

  /** A plain-language visual edit on one cut ("make it rain"). */
  aiEditClip: signedInProcedure
    .input(z.object({ key: z.string().min(1), instruction: z.string().trim().min(3).max(600) }))
    .mutation(async ({ ctx, input }) => {
      const { owner, doc, clips } = await load(ctx);
      const res = await startEdit(ctx, doc, clips, findCut(doc, input.key), input.instruction);
      const { rev } = await reviseEdit(owner, (cur) => withCut(cur, res.item, res.derived));
      return { pending: true, rev };
    }),

  /** Put a cut back to its original clip, before any grade or edit. */
  restoreOriginal: signedInProcedure
    .input(z.object({ key: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      const { rev } = await reviseEdit(owner, (cur) => ({
        ...cur,
        timeline: cur.timeline.map((t) =>
          t.key === input.key ? { ...t, versionId: undefined, pendingId: undefined, lastError: undefined } : t
        ),
      }));
      return { ok: true, rev };
    }),

  /** Switch a cut to another finished copy of it (or back to the original). */
  setVersion: signedInProcedure
    .input(z.object({ key: z.string().min(1), versionId: z.string().min(1).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const { owner, lib } = await load(ctx);
      const lengths = succeededClips(lib);
      let error: TRPCError | undefined;
      const { rev } = await reviseEdit(owner, (cur) => {
        error = undefined;
        const item = cur.timeline.find((t) => t.key === input.key);
        if (!item) {
          error = new TRPCError({ code: 'NOT_FOUND', message: 'That cut is no longer on the timeline.' });
          return cur;
        }
        const copy = input.versionId ? cur.derived.find((d) => d.id === input.versionId) : undefined;
        if (input.versionId && (!copy || copy.status !== 'succeeded' || rootClipId(cur.derived, copy.id) !== item.clipId)) {
          error = new TRPCError({ code: 'BAD_REQUEST', message: 'That version is not a finished copy of this cut.' });
          return cur;
        }
        return {
          ...cur,
          timeline: cur.timeline.map((t) =>
            t.key === input.key
              ? clampCut({ ...t, versionId: input.versionId ?? undefined, pendingId: undefined, lastError: undefined }, lengthOf(input.versionId ?? t.clipId, cur, lengths))
              : t
          ),
        };
      });
      if (error) throw error;
      return { ok: true, rev };
    }),

  /** Send a message to the AI editor. Returns at once; `project` brings the reply. */
  agentSend: signedInProcedure
    .input(z.object({ text: z.string().trim().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const { owner, doc, clips, lib } = await load(ctx);
      // A provider turn (`ai_` id) is busy until its job says otherwise, so a
      // slow paid call is never sent twice; Runway turns keep the clock rule.
      const turnLive =
        !!doc.agent &&
        doc.agent.status === 'running' &&
        isTextTaskId(doc.agent.taskId) &&
        (await textTaskSnapshot(ctx, owner, doc.agent.taskId).catch(() => null))?.done === false;
      if (doc.agent && (turnLive || Date.now() - Date.parse(doc.agent.at) < AGENT_STALE_MS)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'The editor is still working on your last message. Wait for its reply.',
        });
      }
      // Clips on the timeline stay listed even when they fall off the recent 60.
      const shown: EditorClip[] = clips.map((c, i) => ({
        handle: `c${i + 1}`,
        id: c.id,
        seconds: c.seconds,
        label: c.label,
      }));
      for (const t of doc.timeline) {
        const clip = lib.clips.find((c) => c.id === t.clipId);
        if (clip && !shown.some((s) => s.id === clip.id)) {
          shown.push({ handle: `c${shown.length + 1}`, id: clip.id, seconds: clipLength(clip), label: clipLabel(clip, lib) });
        }
      }
      const cutNotes = doc.timeline.map((t) =>
        [
          ...versionNotes(doc.derived, t),
          t.pendingId ? 're-rendering now' : '',
          t.versionId ? `playing a ${lengthOf(t.versionId, doc, clips)}s copy` : '',
        ]
          .filter(Boolean)
          .join(', ')
      );
      let taskId: string;
      try {
        ({ id: taskId } = await createTextTask(ctx, owner, {
          name: 'render-to-film editor',
          model: 'claude-sonnet-5-5',
          system_prompt: EDITOR_SYSTEM_PROMPT,
          prompt: buildEditorPrompt(doc, shown, cutNotes, input.text),
          temperature: 0.3,
          max_output_tokens: 6000,
        }));
      } catch (err) {
        logRejection('editor', 'claude_api', err);
        throw toTrpcError(err);
      }
      const msg: ChatMessage = { role: 'user', text: input.text, at: now() };
      const { rev } = await reviseEdit(owner, (cur) => ({
        ...cur,
        messages: [...cur.messages, msg],
        agent: {
          taskId,
          status: 'running',
          at: now(),
          handles: Object.fromEntries(shown.map((s) => [s.handle, s.id])),
          cutKeys: cur.timeline.map((t) => t.key),
        },
      }));
      return { ok: true, rev };
    }),

  addMemory: signedInProcedure
    .input(z.object({ text: z.string().trim().min(2).max(240) }))
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      const { rev } = await reviseEdit(owner, (cur) =>
        cur.memory.some((m) => m.toLowerCase() === input.text.toLowerCase())
          ? cur
          : { ...cur, memory: [...cur.memory, input.text].slice(-MAX_MEMORY) }
      );
      return { ok: true, rev };
    }),

  forgetMemory: signedInProcedure
    .input(z.object({ text: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      const { rev } = await reviseEdit(owner, (cur) => ({ ...cur, memory: cur.memory.filter((m) => m !== input.text) }));
      return { ok: true, rev };
    }),

  clearChat: signedInProcedure.mutation(async ({ ctx }) => {
    const owner = await ownerKey(ctx.req);
    const { rev } = await reviseEdit(owner, (cur) => ({ ...cur, messages: [], agent: undefined }));
    return { ok: true, rev };
  }),

  /**
   * Look again at an export that stopped because Runway couldn't be reached.
   * It resumes the tasks already submitted, so nothing is billed twice.
   */
  resumeExport: signedInProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    const owner = await ownerKey(ctx.req);
    // A master resumes what is still running; a row that failed stays failed.
    const hasWork = (e: ExportJob) => (e.deliverables ? e.deliverables.some((d) => d.status === 'pending' && d.finalId) : e.finalId || e.parts);
    const resumes = (e: ExportJob) => e.id === input.id && e.status === 'failed' && !!hasWork(e);
    const doc = await reviseEdit(owner, (cur) =>
      cur.exports.some(resumes)
        ? {
            ...cur,
            // Nothing polls a failed export, so a stitch claim without a task id is
            // stale and is dropped; the next poll sends the stitch again.
            exports: cur.exports.map((e) =>
              resumes(e)
                ? { ...e, status: 'pending', error: undefined, pollErrors: 0, ...(e.finalId ? {} : { stitchAt: undefined, stitchBy: undefined }) }
                : e
            ),
          }
        : cur
    );
    const job = doc.exports.find((e) => e.id === input.id);
    if (job?.status !== 'pending') {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'That export cannot be resumed. Press Export film to start it again.' });
    }
    return { ok: true, rev: doc.rev };
  }),

  /** Lay a music bed under the film. The file comes from POST /api/upload-audio. */
  setMusic: signedInProcedure
    .input(
      z.object({
        assetKey: z.string().min(1),
        name: z.string().trim().min(1).max(200),
        inSeconds: z.number().min(0).max(3600),
        gain: z.number().min(-24).max(12),
        fadeIn: z.number().min(0).max(10),
        fadeOut: z.number().min(0).max(10),
        licence: z.string().trim().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      checkMusicKey(owner, input.assetKey);
      const { rev } = await reviseEdit(owner, (cur) => ({ ...cur, music: input }));
      return { ok: true, rev };
    }),

  clearMusic: signedInProcedure.mutation(async ({ ctx }) => {
    const owner = await ownerKey(ctx.req);
    const { rev } = await reviseEdit(owner, (cur) => ({ ...cur, music: null }));
    return { ok: true, rev };
  }),

  /** The title at the head and the end card. A master draws them; nothing else reads them. */
  setTitles: signedInProcedure
    .input(z.object({ head: titleCard.nullable(), tail: titleCard.nullable() }))
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      const titles = input.head || input.tail ? input : null;
      const { rev } = await reviseEdit(owner, (cur) => ({ ...cur, titles }));
      return { rev };
    }),

  /** Export the timeline as one film. Returns at once; `project` tracks it. */
  exportFilm: signedInProcedure.mutation(async ({ ctx }) => {
    const { owner, doc } = await load(ctx);
    const blocker = exportBlocker(doc);
    if (blocker) throw new TRPCError({ code: 'CONFLICT', message: blocker });
    const { job, rev } = await startExport(ctx, owner, doc);
    return { id: job.id, rev };
  }),

  /** Master the timeline, one finished file per deliverable. Desktop only; `project` tracks it. */
  exportMaster: signedInProcedure
    .input(
      z.object({
        deliverables: z.array(z.enum(DELIVERABLE_IDS)).min(1).max(4),
        musicAssetKey: z.string().min(1).nullable(),
        cards: z.object({ head: drawnCard.optional(), tail: drawnCard.optional() }).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canMaster(ctx.runway)) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Mastering runs in the desktop app.' });
      }
      const { owner, doc } = await load(ctx);
      const key = input.musicAssetKey;
      if (key) checkMusicKey(owner, key);
      for (const card of [input.cards?.head, input.cards?.tail]) {
        checkCardKey(owner, card?.key);
        checkCardKey(owner, card?.verticalKey);
      }
      const blocker = exportBlocker(doc);
      if (blocker) throw new TRPCError({ code: 'CONFLICT', message: blocker });
      const cards = masterCards(doc, input.cards);
      const music = key ? (doc.music?.assetKey === key ? doc.music : { ...MUSIC_DEFAULTS, assetKey: key }) : null;
      const { job, rev } = await startMaster(ctx, owner, doc, [...new Set(input.deliverables)], music, cards);
      return { id: job.id, rev };
    }),

  /**
   * The cut as a file another editor reads. Desktop only: it names each clip's file
   * on this computer. An EDL is a picture cut, so it never asks after the bed's file.
   */
  interchange: signedInProcedure
    .input(z.object({ format: z.enum(['otio', 'edl']) }))
    .query(async ({ ctx, input }) => {
      if (!capabilitiesOf(ctx.runway).interchange) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Cut lists are made in the desktop app.' });
      }
      const { owner, doc } = await load(ctx);
      const { cuts, arts } = await exportPlan(ctx, doc);
      if (input.format === 'edl') return toEdl(interchangeInput(ctx, owner, { ...doc, music: null }, cuts, arts));
      return JSON.stringify(toOtio(interchangeInput(ctx, owner, doc, cuts, arts)), null, 2);
    }),

  /** Render the timeline through FilmCraft rather than ffmpeg. Desktop only; `project` tracks it. */
  conformFilmcraft: signedInProcedure
    .input(z.object({ output: z.enum(['mp4', 'mov']) }))
    .mutation(async ({ ctx, input }) => {
      if (!capabilitiesOf(ctx.runway).sidecars) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'FilmCraft runs in the desktop app.' });
      }
      const { owner, doc } = await load(ctx);
      const blocker = exportBlocker(doc);
      if (blocker) throw new TRPCError({ code: 'CONFLICT', message: blocker });
      const { job, rev } = await startConform(ctx, owner, doc, input.output);
      return { id: job.id, rev };
    }),
});
