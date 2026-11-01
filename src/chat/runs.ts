// The RunEngine (PLAN-13 section 5): the background work an approved Quote pays
// for. A Run is an ordered list of Steps; one tick advances at most one step
// action, under a claim, so the desktop Driver and a Bay poller ticking the same
// Run never submit the same paid work twice. Before every paid call the Step
// writes an intent and the run is saved; a running Step with an intent and fewer
// ids than it expected is one whose tick died or outran its claim (a released
// claim always has its ids on record), so whoever finds it, a boot's resumeAll
// after three quiet minutes or the tick that takes the claim over, moves the run
// to submit_unknown and never resubmits (section 2). Every call goes through the
// app's own routers (createCaller), so what a Run sends a provider is what the
// pages send, byte for byte. The Store and the Gate come in by injection;
// nothing here imports a sibling's implementation.
import { randomUUID } from 'node:crypto';

import type { inferRouterInputs } from '@trpc/server';

import { AppRouter, type AppRouterType } from '../api.ts';
import { type Capabilities, capabilitiesOf } from '../capabilities.ts';
import { CHAPTER_IDS, chapterById, grammarById } from '../lifestyle.ts';
import { boardFrame } from '../lifestyle-api.ts';
import { ANIMATE_VIDEO_MODELS, imageModelTakesCastSheet, videoDurations, type VideoModelId } from '../models.ts';
import { documentStore } from '../storage.ts';
import type { Context } from '../trpc.ts';
import {
  type AuditDecision,
  type DeliverableId,
  type Gate,
  type Quote,
  type Run,
  type RunEngine,
  runNext,
  type RunState,
  specHash,
  type Step,
  type StepId,
  type Store,
} from './domain.ts';
import {
  cutFor,
  fadeOf,
  fadeProblem,
  type FilmShape,
  nextStep,
  overlapOf,
  pickFrames,
  runView,
  shapeOf,
  pastQuote,
  spentOn,
  stepsFor,
} from './pipeline.ts';

export type RunEngineDeps = {
  store: Store;
  gate: Gate;
  now(): number;
  log(line: string): void;
};

/** A claim or an intent this old belongs to a tick that is gone. */
export const CLAIM_TTL_MS = 3 * 60_000;

/** Free calls that threw, in a row, before a step gives up: a poll that cannot reach the provider is not a task that failed. */
export const MAX_POLL_ERRORS = 10;

/** What a Run says when a paid call may have gone out without its id coming back. */
export const SUBMIT_UNKNOWN =
  'A submission may have been charged but its id was not recorded; check the Library before running again.';

const ACTIVE = new Set<RunState>(['queued', 'running', 'awaiting_user']);
/** The states a tick acts on; a queued Run's first tick starts it. */
const TICKABLE = new Set<RunState>(['queued', 'running']);

type Caller = ReturnType<AppRouterType['createCaller']>;
type Inputs = inferRouterInputs<AppRouterType>;
type ShotRaw = NonNullable<Inputs['createVideo']['shot']>;
type LifestyleJob = NonNullable<Awaited<ReturnType<Caller['lifestyle']['job']>>>;
/** A planned frame as the Lifestyle page would shoot it: the person's choices applied. */
type BoardFrame = ReturnType<typeof boardFrame>;
type Project = Awaited<ReturnType<Caller['edit']['project']>>;
/** T18 adds `exportMaster`; until it lands, the film goes out as `exportFilm`. */
type ExportMaster = (input: { deliverables: DeliverableId[]; musicAssetKey: string | null; cards: null }) => Promise<{ id: string }>;

// One tick at a time per Run in this process: the claim is read and written
// under it, so two ticks on one clock never both find the Run free. Module
// level: every engine shares it. Across processes the claim itself is the lock.
const queues = new Map<string, Promise<unknown>>();

function serial<T>(key: string, work: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
  queues.set(key, run);
  void run
    .finally(() => {
      if (queues.get(key) === run) queues.delete(key);
    })
    .catch(() => {});
  return run;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const codeOf = (err: unknown) => (err as { code?: unknown } | null)?.code;
const isConflict = (err: unknown) => codeOf(err) === 'CONFLICT';
/** A router refusing the call's input: the call is wrong, not the provider unreachable, so it is never retried. */
const isBadRequest = (err: unknown) => codeOf(err) === 'BAD_REQUEST';

/**
 * The sentence a Run shows for a call that threw. A router's input refusal
 * (zod, through tRPC) arrives as the issues in JSON, which a Run card never
 * shows: those become one plain line naming the field and what was wrong.
 */
function sentenceOf(err: unknown): string {
  const text = message(err);
  let issues: unknown = (err as { cause?: { issues?: unknown } } | null)?.cause?.issues;
  if (!Array.isArray(issues) && isBadRequest(err) && text.trimStart().startsWith('[')) {
    try {
      issues = JSON.parse(text);
    } catch {
      issues = undefined;
    }
  }
  if (!Array.isArray(issues) || issues.length === 0) return text;
  const lines = (issues as { path?: unknown; message?: unknown }[]).map((issue) => {
    const at = Array.isArray(issue.path) && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `${at}${typeof issue.message === 'string' ? issue.message : 'not accepted'}`;
  });
  return `A call of this run was refused (${lines.join('; ')}).`;
}

/** Thrown by a tick's save when the Run was stopped or its claim taken over since the claim: the tick's copy is void and no paid call follows. */
class TickLost extends Error {
  constructor() {
    super('This tick lost its claim.');
  }
}

/** A free call that threw: the step stays where it is and tries again next tick. The sentence is the call's own. */
class Transient extends Error {}

/** Runs a call that pays for nothing (a status read, a timeline save); when it throws, the step waits rather than failing the run, unless the call itself was refused as wrong. */
async function free<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (isBadRequest(err)) throw err;
    throw new Transient(message(err));
  }
}

// ---------------------------------------------------------------------------
// Step actions. Each runs once per tick on the run's working copy and either
// returns (the step waits for the next tick), closes the step, or throws the
// sentence that fails the run.

/** What one step action works with. */
type Tick = {
  trpc: Caller;
  caps: Capabilities;
  owner: string;
  run: Run;
  step: Step;
  now: number;
  /** The Quote this Run was approved on. */
  quote(): Promise<Quote | null>;
  /**
   * Writes the run as it stands, under the run's lock, once the stored Run is
   * still running under this tick's claim; otherwise nothing is written and
   * TickLost is thrown. An intent must be on disk before the call it covers.
   */
  save(): Promise<void>;
};

type Action = (t: Tick) => Promise<void>;

/** `step.meta`, created on first use, read as the shape this step keeps there. */
function metaOf<T extends Record<string, unknown>>(step: Step): T {
  step.meta ??= {};
  return step.meta as T;
}

/** What every step keeps: the ids its last intent promised, and free calls that threw in a row. */
type StepMeta = { expected?: number; pollErrors?: number };
/** The frames chosen for the film, the first-pass still shot for each (by image index), and how many second passes went out. */
type StillsMeta = StepMeta & { frames?: number[]; shots?: Record<string, string>; passes?: number };
/** The director's text task per still, and its plan once read. */
type DirectMeta = StepMeta & { tasks?: Record<string, string>; raw?: Record<string, unknown> };
/** The clip per still, and which have finished. */
type ClipsMeta = StepMeta & { clips?: Record<string, string>; done?: Record<string, true> };

const expectedOf = (step: Step) => (typeof step.meta?.['expected'] === 'number' ? step.meta['expected'] : 1);

/** A running step whose intent has no id under it: the paid call may have gone out and its answer is lost. */
const unresolved = (step: Step) =>
  step.state === 'running' && step.intent !== undefined && step.ids.length < expectedOf(step);

/** Written and saved before a paid call: the ids this step will hold once the call answers. */
async function intent(t: Tick): Promise<void> {
  t.step.intent = { at: t.now };
  metaOf<StepMeta>(t.step).expected = t.step.ids.length + 1;
  await t.save();
}

/**
 * One paid call under its intent. With `mayRefuse`, a CONFLICT is the router
 * refusing before anything went out (a claim it keeps itself: the cast's, the
 * export's): the intent is withdrawn, nothing is counted, and the step waits,
 * answering undefined. Any other throw fails the run as the call's own sentence.
 */
async function paid<T>(t: Tick, call: () => Promise<T>, opts: { mayRefuse?: boolean } = {}): Promise<T | undefined> {
  const was = { intent: t.step.intent, expected: metaOf<StepMeta>(t.step).expected };
  await intent(t);
  try {
    return await call();
  } catch (err) {
    if (!opts.mayRefuse || !isConflict(err)) throw err;
    if (was.intent) t.step.intent = was.intent;
    else delete t.step.intent;
    if (was.expected === undefined) delete metaOf<StepMeta>(t.step).expected;
    else metaOf<StepMeta>(t.step).expected = was.expected;
    return undefined;
  }
}

function close(step: Step, state: 'done' | 'skipped', at: number): void {
  step.state = state;
  step.endedAt = at;
}

/** One Run at a time on the owner's Editing document, which every Run of the owner shares. */
const editTurn = <T>(t: Tick, work: () => Promise<T>) => serial(`${t.owner}/edit`, work);

/** The provider's video models a Run can use: the ones the Animate page offers. */
const runModels = (caps: Capabilities): string[] =>
  caps.videoModels.filter((id) => ANIMATE_VIDEO_MODELS.some((m) => m.id === id));
/** The spec's model, else the first the provider offers a Run. */
const videoModelOf = (run: Run, caps: Capabilities): VideoModelId =>
  (run.spec.videoModel ?? runModels(caps)[0] ?? 'seedance-2') as VideoModelId;
/** What this Run makes from `frames` frames. The Pricer asks the same question, so a Quote prices what gets made. */
const shapedBy = (run: Run, caps: Capabilities, frames: number): FilmShape =>
  shapeOf(run.spec, frames, videoDurations(videoModelOf(run, caps)));
/** The frames a Run already holds, once they are chosen. */
const heldFrames = (run: Run) => Math.max(run.outputs.stillIds.length, run.outputs.clipIds.length);
/** How long each clip of this Run runs, from the frames it holds. */
const clipSecondsOf = (run: Run, caps: Capabilities) => shapedBy(run, caps, heldFrames(run)).clipSeconds;

/** The Lifestyle job a Run shoots from, as its spec or its plan step names it. */
const jobIdOf = (run: Run) => run.spec.lifestyleJobId ?? run.steps.find((s) => s.id === 'plan')?.jobId;

/** The Lifestyle jobs as they are stored: a Run that has ended reads these, since a poll of `lifestyle.job` sends second passes. */
const lifestyleDocs = documentStore<{ jobs: LifestyleJob[] }>({ prefix: 'lifestyle/' });

/** The Lifestyle job this Run shoots from. Polling it also settles its stills and sends each finished first pass to its second. */
async function lifestyleJob(t: Tick): Promise<LifestyleJob> {
  const id = jobIdOf(t.run);
  if (!id) throw new Error('This film has no Lifestyle plan to shoot from.');
  const job = await free(() => t.trpc.lifestyle.job({ id }));
  if (!job) throw new Error('The Lifestyle plan is no longer there.');
  return job;
}

/** A brief that names nobody, as the shoot reads it (NO_PEOPLE_LEAD in src/lifestyle-api.ts). */
const NO_PEOPLE_LEAD = /^no people\b/i;

/**
 * The frames the film can shoot, each as the Lifestyle page would shoot it
 * (boardFrame: the person's choices applied, the planner's brief kept only for
 * the shot it was written for). A frame left out of the film is not here, nor
 * a frame whose shot wants people but whose brief names none (a shot changed
 * from an empty or a detail with no new brief): the page refuses to shoot that
 * one, and a Run must find out before anything is paid for, not mid-shoot.
 */
export function filmFrames(job: Pick<LifestyleJob, 'plan' | 'choices'>): BoardFrame[] {
  return (job.plan ?? [])
    .map((f) => boardFrame(f, job.choices?.[f.image]))
    .filter((f) => f.include && !(grammarById(f.grammar).people && (!f.people || NO_PEOPLE_LEAD.test(f.people))));
}

/** The cast sheets a plan still needs, priced and refused alike: one per chapter with residents, when it has no cast yet (castPlan in src/lifestyle-api.ts). */
export function sheetsOf(job: Pick<LifestyleJob, 'plan' | 'choices' | 'cast'>): number {
  const included = (job.plan ?? []).map((f) => boardFrame(f, job.choices?.[f.image])).filter((f) => f.include);
  return job.cast ? 0 : new Set(included.filter((f) => f.cast.length > 0).map((f) => f.chapter)).size;
}

/** Film order, as the Lifestyle page lays its frames out (byFilmOrder in src/lifestyle-api.ts): chapter, then position, then image. */
const byFilmOrder = (a: BoardFrame, b: BoardFrame) =>
  CHAPTER_IDS.indexOf(a.chapter) - CHAPTER_IDS.indexOf(b.chapter) || a.position - b.position || a.image - b.image;

/**
 * The `n` frames that become clips, in film order. pickFrames visits the
 * chapters round-robin so a short film still reaches every chapter; the film
 * then plays what it chose chapter by chapter (PLAN-13 decision 11), in the
 * order the page shows, with the person's chapter choices counted.
 */
function chooseFrames(frames: BoardFrame[], n: number): BoardFrame[] {
  const picked = new Set(
    pickFrames(
      frames.map((f) => ({ index: f.image, chapter: f.chapter, grammar: f.grammar, people: grammarById(f.grammar).people })),
      n
    )
  );
  return frames.filter((f) => picked.has(f.image)).sort(byFilmOrder);
}

/** The frames this Run's film is made of. */
function filmOf(t: Tick, job: LifestyleJob): BoardFrame[] {
  const frames = filmFrames(job);
  return chooseFrames(frames, shapedBy(t.run, t.caps, frames.length).clips);
}

/** Whether any frame the film shoots has household roles in it, so a cast sheet is wanted (what `lifestyle.cast` would make one for). */
function hasRoles(job: LifestyleJob): boolean {
  return filmFrames(job).some((f) => f.cast.length > 0);
}

/**
 * Why the chosen frames cannot be shot with the job's cast: a generated cast
 * with no sheet for a chapter one of them puts residents in. A cast cut short
 * by a refused sheet leaves one, and so does a frame moved to another chapter
 * after the cast was made. The shoot refuses such a frame when its turn comes
 * (src/lifestyle-api.ts), after the frames before it were paid for, so a Run
 * asks here, before any frame is. A model that takes no cast sheet shoots
 * without one, so nothing is missing then.
 */
function missingSheet(job: LifestyleJob, chosen: BoardFrame[]): string | undefined {
  const cast = job.cast;
  if (cast?.mode !== 'generated' || !imageModelTakesCastSheet(job.imageModel)) return undefined;
  const have = new Set((cast.sheets ?? []).map((s) => s.chapter));
  const frame = chosen.find((f) => f.cast.length > 0 && !have.has(f.chapter));
  if (!frame) return undefined;
  const chapter = chapterById(frame.chapter).name;
  return `The cast for ${chapter} has no sheet, so the film cannot be shot with it. Create the cast again on the Lifestyle page, or shoot without a cast.`;
}

/**
 * Whether the sheets the chosen frames shoot with are finished, as the shoot will
 * read them in the Library (src/lifestyle-api.ts): one still being made is waited
 * for, and one that failed fails the run here in the shoot's own words, before a
 * frame is paid for instead of at the first frame that needs it.
 */
async function sheetsReady(t: Tick, job: LifestyleJob, chosen: BoardFrame[]): Promise<boolean> {
  const why = missingSheet(job, chosen);
  if (why) throw new Error(why);
  const { cast } = job;
  const chapters = new Set(chosen.filter((f) => f.cast.length > 0).map((f) => f.chapter));
  if (cast?.mode !== 'generated' || !imageModelTakesCastSheet(job.imageModel) || chapters.size === 0) return true;
  const lib = await free(() => t.trpc.library());
  let ready = true;
  for (const id of chapters) {
    const sheet = cast.sheets?.find((s) => s.chapter === id);
    const made = lib.stills.find((s) => s.id === sheet?.stillId);
    const chapter = chapterById(id).name;
    if (!made) throw new Error(`The cast for ${chapter} has no sheet. Create the cast again, or shoot without a cast.`);
    if (made.status === 'failed') throw new Error(`The cast for ${chapter} could not be made. Create the cast again, or shoot without a cast.`);
    if (made.status !== 'succeeded') ready = false;
  }
  return ready;
}

/**
 * Why this Run cannot go on as asked, found before its first paid call: a
 * video model the provider does not offer a Run (the spec named one, or the
 * provider changed between the Quote and the Run) would be refused at the first
 * clip, after every still was paid for; a fade its clips cannot carry would be
 * refused at the master, after everything was. The fade needs to know the
 * `frames`: what the Run holds, or what a step that has read the plan says.
 */
function unoffered(run: Run, caps: Capabilities, frames = heldFrames(run)): string | undefined {
  const model = run.spec.videoModel;
  const open = (s: Step) => s.state === 'pending' || s.state === 'running';
  const makesClips = run.steps.some((s) => (s.id === 'direct' || s.id === 'clips') && open(s));
  const offered = runModels(caps);
  if (makesClips && model !== undefined && !offered.includes(model)) {
    return `${caps.providerName} does not offer the video model "${model}". Choose one of ${offered.join(', ')} and ask again.`;
  }
  if (frames === 0 || !run.steps.some((s) => s.id === 'cut' && open(s))) return undefined;
  const { clips, clipSeconds } = shapedBy(run, caps, frames);
  return fadeProblem(clips, clipSeconds, overlapOf(run.spec));
}

/** The plan is there to count, so the Run is asked again with its frames. */
function refuseUnoffered(t: Tick, frames: number): void {
  const why = unoffered(t.run, t.caps, frames);
  if (why) throw new Error(why);
}

/**
 * The plan can move on the Lifestyle page while a Run waits: what it makes now must
 * still be what was approved. Only the cast step buys sheets, so a Run of stills
 * shoots without them and a film at its stills is past buying any.
 */
async function refusePastQuote(t: Tick, job: LifestyleJob): Promise<void> {
  const shape = shapedBy(t.run, t.caps, filmFrames(job).length);
  const why = pastQuote(await t.quote(), shape, t.step.id === 'stills' ? 0 : sheetsOf(job));
  if (why) throw new Error(why);
}

const plan: Action = async (t) => {
  const job = await lifestyleJob(t);
  t.step.jobId = job.id;
  if (job.status === 'failed') throw new Error(job.error ?? 'The plan could not be made.');
  if (job.status !== 'planned') return;
  refuseUnoffered(t, filmFrames(job).length);
  await refusePastQuote(t, job);
  close(t.step, 'done', t.now);
};

/** A cast call that threw keeps the sheets it had sent, and those are billed: the job says which, so the failed step counts them. */
async function keepSheets(t: Tick, id: string): Promise<void> {
  const job = await t.trpc.lifestyle.job({ id }).catch(() => null);
  t.step.ids = (job?.cast?.sheets ?? []).map((s) => s.stillId);
}

const cast: Action = async (t) => {
  const job = await lifestyleJob(t);
  if (job.status !== 'planned') throw new Error(job.error ?? 'The plan is not ready to shoot.');
  refuseUnoffered(t, filmFrames(job).length);
  await refusePastQuote(t, job);
  // A cast is taken as done only when every frame of the film can shoot with it.
  const sheeted = () => {
    const why = missingSheet(job, filmOf(t, job));
    if (why) throw new Error(why);
  };
  if (job.cast?.approved) {
    if (await sheetsReady(t, job, filmOf(t, job))) close(t.step, 'done', t.now);
    return;
  }
  if (t.step.ids.length === 0) {
    const made = job.cast?.sheets ?? [];
    if (made.length > 0) {
      // A cast the page made and nobody approved yet: follow its sheets, once they are the film's.
      sheeted();
      t.step.ids = made.map((s) => s.stillId);
    } else {
      if (!hasRoles(job)) {
        close(t.step, 'skipped', t.now);
        return;
      }
      // A refusal means the page is making the cast right now: its sheets are followed next tick.
      const answer = await paid(
        t,
        () =>
          t.trpc.lifestyle.cast({ id: job.id, mode: 'generated' }).catch(async (err: unknown) => {
            await keepSheets(t, job.id);
            throw err;
          }),
        { mayRefuse: true }
      );
      if (!answer) return;
      t.step.ids = (answer.cast.sheets ?? []).map((s) => s.stillId);
      // No sheet made is no cast to wait for (nothing was paid for either).
      if (t.step.ids.length === 0) close(t.step, 'skipped', t.now);
      return;
    }
  }
  const lib = await free(() => t.trpc.library());
  for (const id of t.step.ids) {
    const sheet = lib.stills.find((s) => s.id === id);
    if (!sheet) throw new Error('A cast sheet was deleted from the Library before the film was shot.');
    if (sheet.status === 'failed') throw new Error(sheet.error ?? 'A cast sheet could not be made.');
    if (sheet.status !== 'succeeded') return;
  }
  sheeted();
  await free(() => t.trpc.lifestyle.approveCast({ id: job.id }));
  close(t.step, 'done', t.now);
};

/**
 * The finished still behind each first pass sent so far (its second pass when
 * the plan has one), or null while any is still on its way. A still or a pass
 * that failed throws its sentence, so the run ends before another frame is paid
 * for.
 */
async function finishedStills(t: Tick, job: LifestyleJob, ids: string[]): Promise<string[] | null> {
  if (ids.length === 0) return [];
  const lib = await free(() => t.trpc.library());
  const finals: string[] = [];
  let waiting = false;
  for (const id of ids) {
    const still = lib.stills.find((s) => s.id === id);
    if (!still) throw new Error('A still of this film was deleted from the Library.');
    if (still.status === 'failed') throw new Error(still.error ?? 'A still could not be made.');
    if (still.status !== 'succeeded') {
      waiting = true;
      continue;
    }
    const pass2 = job.shots?.find((s) => s.stillId === id)?.pass2;
    // On a two-pass plan the next poll of the job sends the second pass.
    if (job.pass2 && !pass2) {
      waiting = true;
      continue;
    }
    if (!pass2 || pass2.state === 'skipped') {
      finals.push(id);
      continue;
    }
    if (pass2.state === 'failed') throw new Error(pass2.error);
    if (pass2.state === 'deleted') throw new Error('The finished still was deleted from the Library.');
    if (pass2.state === 'starting') {
      waiting = true;
      continue;
    }
    const finished = lib.stills.find((s) => s.id === pass2.stillId);
    if (!finished) throw new Error('The finished still was deleted from the Library.');
    if (finished.status === 'failed') throw new Error(finished.error ?? 'The second pass could not be made.');
    if (finished.status !== 'succeeded') {
      waiting = true;
      continue;
    }
    finals.push(finished.id);
  }
  return waiting ? null : finals;
}

/** A take whose second pass went out, or is on its way. */
const passSent = (shot: NonNullable<LifestyleJob['shots']>[number] | undefined) =>
  shot?.pass2 !== undefined && shot.pass2.state !== 'failed' && shot.pass2.state !== 'skipped';

const stills: Action = async (t) => {
  const job = await lifestyleJob(t);
  if (job.status !== 'planned') throw new Error(job.error ?? 'The plan is not ready to shoot.');
  const meta = metaOf<StillsMeta>(t.step);
  if (meta.frames === undefined) {
    // The frames are chosen once, before the first is paid for: the last look at
    // the fade, since the count can have moved since the plan, and at the cast they
    // shoot with (a Run of stills alone has no cast step).
    const chosen = filmOf(t, job);
    refuseUnoffered(t, chosen.length);
    await refusePastQuote(t, job);
    if (!(await sheetsReady(t, job, chosen))) return;
    meta.frames = chosen.map((f) => f.image);
  }
  const { frames } = meta;
  const shots = (meta.shots ??= {});
  if (frames.length === 0) throw new Error('The plan has no frame in the film to shoot.');
  // What is already shot is read first: a failure ends the run before the next frame is paid for.
  const sent = frames.filter((i) => shots[String(i)] !== undefined).map((i) => shots[String(i)]!);
  // What the second passes cost is the job's to know, so it is kept here for the Run's bill, before a failure can end the tick.
  meta.passes = sent.filter((id) => passSent(job.shots?.find((s) => s.stillId === id))).length;
  const finals = await finishedStills(t, job, sent);
  // One frame a tick, so one tick is one submission.
  const next = frames.find((i) => shots[String(i)] === undefined);
  if (next !== undefined) {
    const made = await paid(t, () => t.trpc.lifestyle.shoot({ id: job.id, image: next, ...job.choices?.[next] }));
    if (!made) return;
    t.step.ids.push(made.id);
    shots[String(next)] = made.id;
    return;
  }
  // Every frame is shot: the step is done once each still and its second pass are in.
  if (!finals) return;
  t.run.outputs.stillIds = finals;
  close(t.step, 'done', t.now);
};

const direct: Action = async (t) => {
  const ids = t.run.outputs.stillIds;
  if (ids.length === 0) throw new Error('There is no still to direct.');
  const meta = metaOf<DirectMeta>(t.step);
  const tasks = (meta.tasks ??= {});
  const raw = (meta.raw ??= {});
  // The plans already asked for are read first: a failure ends the run before the next is sent.
  for (const id of ids) {
    if (raw[id] !== undefined || tasks[id] === undefined) continue;
    const status = await free(() => t.trpc.shot.status({ taskId: tasks[id]! }));
    if (status.status === 'failed') throw new Error(status.error);
    if (status.status === 'done') raw[id] = status.raw;
  }
  const next = ids.find((id) => tasks[id] === undefined);
  if (next !== undefined) {
    const planned = await paid(t, () =>
      t.trpc.shot.plan({
        first: { stillId: next },
        videoModel: videoModelOf(t.run, t.caps),
        seconds: clipSecondsOf(t.run, t.caps),
      })
    );
    if (!planned) return;
    t.step.ids.push(planned.taskId);
    tasks[next] = planned.taskId;
    return;
  }
  if (ids.every((id) => raw[id] !== undefined)) close(t.step, 'done', t.now);
};

const clips: Action = async (t) => {
  const ids = t.run.outputs.stillIds;
  if (ids.length === 0) throw new Error('There is no still to make a clip from.');
  const directed = t.run.steps.find((s) => s.id === 'direct');
  const raw = directed ? (metaOf<DirectMeta>(directed).raw ?? {}) : {};
  const meta = metaOf<ClipsMeta>(t.step);
  const made = (meta.clips ??= {});
  const done = (meta.done ??= {});
  // The clips already sent are read first: a failure ends the run before the next is paid for.
  for (const id of ids) {
    if (done[id] || made[id] === undefined) continue;
    const poll = await free(() => t.trpc.videoStatus({ id: made[id]! }));
    if (!poll.done) continue;
    if (poll.status !== 'SUCCEEDED') throw new Error(poll.error ?? 'The clip could not be made.');
    done[id] = true;
  }
  const next = ids.find((id) => made[id] === undefined);
  if (next !== undefined) {
    const shot = raw[next] as ShotRaw | undefined;
    const clip = await paid(t, () =>
      t.trpc.createVideo({
        stillId: next,
        videoModel: videoModelOf(t.run, t.caps),
        seconds: clipSecondsOf(t.run, t.caps),
        direction: '',
        onlyInImage: true,
        archviz: true,
        ...(shot ? { shot } : {}),
      })
    );
    if (!clip) return;
    t.step.ids.push(clip.id);
    made[next] = clip.id;
    return;
  }
  if (ids.every((id) => done[id])) {
    t.run.outputs.clipIds = ids.map((id) => made[id]!);
    close(t.step, 'done', t.now);
  }
};

/** This Run's cut of its clips, under its own keys: saveTimeline keeps a graded copy by key, so shared keys would play another film's shot. */
function cutOf(run: Run, caps: Capabilities) {
  const { spec } = run;
  return cutFor(run.outputs.clipIds, clipSecondsOf(run, caps), spec.transition ?? 'fade', fadeOf(spec), `cut-${run.id}`);
}

/** Whether the timeline plays exactly these clips, in this order. */
const holdsClips = (project: Project, clipIds: string[]) =>
  project.timeline.length === clipIds.length && project.timeline.every((c, i) => c.clipId === clipIds[i]);

/** What a Run says when its cut came back without a clip it paid for. */
const CUT_INCOMPLETE = 'The cut could not hold every clip of this film: a clip is missing from the Library.';

/**
 * Saves this Run's cut and reads it back. saveTimeline leaves out, without a
 * word, any clip the Library does not hold finished; a film missing a clip it
 * paid for is not done, so the cut is checked and the run fails instead.
 */
async function recut(t: Tick): Promise<void> {
  await free(() => t.trpc.edit.saveTimeline(cutOf(t.run, t.caps)));
  const project = await free(() => t.trpc.edit.project());
  if (!holdsClips(project, t.run.outputs.clipIds)) throw new Error(CUT_INCOMPLETE);
}

/** An export already running (another Run's, or the Editing page's), or a cut still re-rendering: the document refuses an export until it is through. */
const exportBusy = (project: Project) =>
  project.exports.some((e) => e.status === 'pending') || project.timeline.some((c) => c.pendingId);

const cut: Action = async (t) => {
  if (t.run.outputs.clipIds.length === 0) throw new Error('There is no clip to cut.');
  await editTurn(t, () => recut(t));
  close(t.step, 'done', t.now);
};

const master: Action = async (t) => {
  if (t.step.ids.length === 0) {
    const { spec } = t.run;
    const edit = t.trpc.edit as Caller['edit'] & { exportMaster?: ExportMaster };
    const masters = (t.caps as Capabilities & { master?: boolean }).master === true && typeof edit.exportMaster === 'function';
    // The Editing document is one per owner, so making sure the timeline is this
    // film's cut and sending the export is one turn: another Run cannot cut in
    // between. An export already running is waited for, which pays for nothing.
    await editTurn(t, async () => {
      const project = await free(() => t.trpc.edit.project());
      if (exportBusy(project)) return;
      const { clipIds } = t.run.outputs;
      if (clipIds.length > 0 && !holdsClips(project, clipIds)) await recut(t);
      // A spec that names no deliverable (or an empty list) gets the film's default.
      const deliverables = spec.deliverables?.length ? spec.deliverables : ['h264' as DeliverableId];
      const made = await paid(
        t,
        () => (masters ? edit.exportMaster!({ deliverables, musicAssetKey: spec.musicAssetKey ?? null, cards: null }) : edit.exportFilm()),
        { mayRefuse: true }
      );
      if (!made) return;
      t.step.ids.push(made.id);
      t.run.outputs.exportId = made.id;
    });
    return;
  }
  const id = t.step.ids[0]!;
  const project = await free(() => t.trpc.edit.project());
  const job = project.exports.find((e) => e.id === id);
  if (!job) throw new Error('The export is no longer in the Editing document.');
  if (job.status === 'failed') throw new Error(job.error ?? 'The export failed.');
  if (job.status === 'succeeded') close(t.step, 'done', t.now);
};

/** What T18's master adds to an export: the QC report's key and each deliverable's findings. */
type ExportQc = { qcKey?: string; deliverables?: { id?: string; status?: string; error?: string; qc?: unknown }[] };

const qc: Action = async (t) => {
  // Never fails the run: a report that cannot be read is simply absent.
  try {
    const exportId = t.run.outputs.exportId;
    const project = exportId ? await t.trpc.edit.project() : undefined;
    const job = project?.exports.find((e) => e.id === exportId) as ExportQc | undefined;
    if (job?.qcKey) t.run.outputs.qcReportKey = job.qcKey;
    const findings = (job?.deliverables ?? []).flatMap((d) => [
      ...(d.qc === undefined ? [] : [{ deliverable: d.id, qc: d.qc }]),
      // The export stands on the deliverables that came out, so the Run stays done and says what is missing.
      ...(d.status === 'failed' ? [{ deliverable: d.id, error: d.error ?? 'This file could not be made.' }] : []),
    ]);
    t.step.meta = {
      ...(job?.qcKey ? { qcReportKey: job.qcKey } : {}),
      ...(findings.length > 0 ? { findings } : {}),
    };
  } catch (err) {
    t.step.meta = { error: message(err) };
  }
  close(t.step, 'done', t.now);
};

const ACTIONS: Record<StepId, Action> = { plan, cast, stills, direct, clips, cut, master, qc };

/** The deliverables a done Run asked for and does not have. */
function failedDeliverables(run: Run): { deliverable?: string; error: string }[] {
  const findings = run.steps.find((s) => s.id === 'qc')?.meta?.['findings'];
  if (!Array.isArray(findings)) return [];
  return (findings as { deliverable?: string; error?: string }[]).flatMap(({ deliverable, error }) =>
    error === undefined ? [] : [{ ...(deliverable === undefined ? {} : { deliverable }), error }]
  );
}

/** Where the Run's result opens: the export in Editing, else what it made in the Library. */
function handoffFor(run: Run): { page: string; params: Record<string, string> } {
  const { exportId, clipIds, stillIds } = run.outputs;
  if (exportId) return { page: 'edit', params: { export: exportId } };
  if (clipIds.length > 0) return { page: 'library', params: { clip: clipIds[0]! } };
  if (stillIds.length > 0) return { page: 'library', params: { still: stillIds[0]! } };
  return { page: 'library', params: {} };
}

/** The step and the run end as submit_unknown; the claim is left to whoever holds the doc. */
function markUnknown(run: Run, step: Step, at: number): void {
  step.state = 'submit_unknown';
  step.error = SUBMIT_UNKNOWN;
  step.endedAt = at;
  run.state = runNext(run.state, 'unknown');
  run.error = SUBMIT_UNKNOWN;
  run.updatedAt = at;
}

/** One Quote, one Run: the Run's id comes from the Quote, so a second start, or a second pod's, finds the first. */
const runIdOf = (quote: Pick<Quote, 'id'>) => `run-${quote.id}`;

/** The step and the run end as failed, with the sentence of what threw (never a refusal's raw JSON). */
function fail(run: Run, step: Step, err: unknown, at: number): void {
  const sentence = sentenceOf(err);
  step.state = 'failed';
  step.error = sentence;
  step.endedAt = at;
  run.state = runNext(run.state, 'fail');
  run.error = sentence;
}

// ---------------------------------------------------------------------------
// The engine

export function createRunEngine(deps: RunEngineDeps): RunEngine {
  const { store, gate } = deps;
  const lockKey = (owner: string, runId: string) => `${owner}/${runId}`;
  const quoteKey = (owner: string, quoteId: string) => `${owner}/quote/${quoteId}`;
  const notFound = () => Object.assign(new Error('That run is no longer there.'), { status: 404, expose: true });
  const refused = (sentence: string) => Object.assign(new Error(sentence), { status: 409, expose: true });

  async function readRun(owner: string, runId: string): Promise<Run> {
    const run = await store.run(owner, runId);
    if (!run) throw notFound();
    return run;
  }

  /**
   * Writes down what the Run has already done. Best effort: the Run is saved, and
   * a record that cannot be written must not stop what follows it (the Run's own
   * work, its end, the Quote's settlement), so the loss is logged, never thrown.
   */
  async function record(run: Run, what: string, write: () => Promise<unknown>): Promise<void> {
    try {
      await write();
    } catch (err) {
      deps.log(`[runs] ${run.id}: ${what} could not be written: ${message(err)}`);
    }
  }

  /** Tells the thread's feed, as best it can. */
  async function emit(owner: string, run: Run, type: string, payload: Record<string, unknown>): Promise<void> {
    await record(run, `the ${type} event`, () =>
      store.appendEvent(owner, run.threadId, { type, payload: { runId: run.id, ...payload } })
    );
  }

  /**
   * The Run stands on its Quote: the thread, the audit log and the feed hear of it
   * once, whoever got there first (the start, or the tick that found it left behind).
   */
  async function announce(owner: string, run: Run, quote: Quote): Promise<void> {
    await record(run, 'the link from its thread', () => store.linkRun(owner, run.threadId, run.id));
    await record(run, 'the start row', () =>
      gate.audit(owner, {
        threadId: run.threadId,
        turnId: run.turnId,
        decision: 'start',
        ...(quote.source ? { source: quote.source } : {}),
        quoteId: quote.id,
        amount: quote.amount,
        unit: quote.unit,
        outcomeIds: [run.id],
      })
    );
    await emit(owner, run, 'run.started', { kind: run.kind, quoteId: quote.id });
    deps.log(`[runs] ${run.id} started: ${run.kind}`);
  }

  /** The Quote hears of its Run, if it has not; answers the Quote when this call told it. */
  function consume(owner: string, run: Run): Promise<Quote | null> {
    return serial(quoteKey(owner, run.quoteId), async () => {
      const quote = await store.quote(owner, run.quoteId);
      if (!quote || quote.consumedBy) return null;
      await store.saveQuote(owner, { ...quote, consumedBy: run.id });
      return quote;
    });
  }

  /**
   * The Run with its second passes as the job holds them now: the page's poll, or a
   * tick racing a stop, can send one after the Run last looked, and that one is billed.
   * A job that cannot be read leaves the count the Run kept, and the log says so.
   */
  async function withPassesNow(owner: string, run: Run): Promise<Run> {
    const stills = run.steps.find((s) => s.id === 'stills');
    const taken = Object.values((stills?.meta as StillsMeta | undefined)?.shots ?? {});
    if (taken.length === 0) return run;
    try {
      const job = (await lifestyleDocs.get(`${owner}.json`))?.value.jobs.find((j) => j.id === jobIdOf(run));
      if (!job) throw new Error('the plan is no longer there');
      const passes = taken.filter((id) => passSent(job.shots?.find((s) => s.stillId === id))).length;
      return { ...run, steps: run.steps.map((s) => (s === stills ? { ...s, meta: { ...s.meta, passes } } : s)) };
    } catch (err) {
      deps.log(`[runs] ${run.id}: its second passes could not be read again, so the count it kept stands: ${message(err)}`);
      return run;
    }
  }

  /**
   * The Run is over: the Quote's hold is settled at what the Run really spent
   * (spentOn) and the decision written down. Best effort; the Run is already saved.
   */
  async function ended(owner: string, run: Run, decision: AuditDecision): Promise<void> {
    await record(run, `the ${decision} settlement`, async () =>
      gate.reconcile(owner, run.quoteId, spentOn(await withPassesNow(owner, run), await store.quote(owner, run.quoteId)))
    );
    await record(run, `the ${decision} row`, () =>
      gate.audit(owner, {
        threadId: run.threadId,
        turnId: run.turnId,
        decision,
        quoteId: run.quoteId,
        outcomeIds: [run.id],
      })
    );
  }

  /**
   * Takes the claim under the per-run lock. `ours` is false when the Run is not
   * running or another tick holds a claim younger than CLAIM_TTL_MS; the stored
   * Run then comes back unchanged. The claim is read back after the write: a
   * tick in another process writing the same moment may have won.
   */
  function claim(owner: string, runId: string): Promise<{ run: Run; ours: boolean }> {
    return serial(lockKey(owner, runId), async () => {
      const run = await readRun(owner, runId);
      const now = deps.now();
      if (!TICKABLE.has(run.state)) return { run, ours: false };
      if (run.claim && now - run.claim.at < CLAIM_TTL_MS) return { run, ours: false };
      run.claim = { at: now, by: randomUUID() };
      run.updatedAt = now;
      await store.saveRun(owner, run);
      const stored = await store.run(owner, runId);
      if (stored?.claim?.by !== run.claim.by) return { run: stored ?? run, ours: false };
      return { run, ours: true };
    });
  }

  /**
   * Saves the Run as this tick leaves it and lets the claim go. `lost` when the
   * stored claim is no longer this tick's (a takeover, or a resumeAll that marked
   * the run): then nothing is written and the stored Run is answered, so the copy
   * that took over is never overwritten. A cancel that landed meanwhile keeps the
   * Run stopped; the claim stays on the doc until here, so an id made under the
   * cancel is kept.
   */
  function release(owner: string, run: Run): Promise<{ run: Run; lost: boolean }> {
    return serial(lockKey(owner, run.id), async () => {
      const stored = await store.run(owner, run.id);
      if (!stored || stored.claim?.by !== run.claim?.by) return { run: stored ?? run, lost: true };
      if (stored.state === 'stopped') {
        run.state = 'stopped';
        run.error = stored.error;
      }
      delete run.claim;
      run.updatedAt = deps.now();
      await store.saveRun(owner, run);
      return { run, lost: false };
    });
  }

  /** This tick's copy is void (stopped or taken over before its paid call): the stored Run is answered, with the claim let go when it is still this tick's. */
  function abandon(owner: string, run: Run): Promise<Run> {
    return serial(lockKey(owner, run.id), async () => {
      const stored = await store.run(owner, run.id);
      if (!stored) return run;
      if (stored.claim?.by === run.claim?.by) {
        delete stored.claim;
        stored.updatedAt = deps.now();
        await store.saveRun(owner, stored);
      }
      return stored;
    });
  }

  async function advance(ctx: Context, owner: string, runId: string): Promise<Run> {
    const taken = await claim(owner, runId);
    if (!taken.ours) return taken.run;
    const { run } = taken;
    // A start that died between the Run and the Quote left this for whoever comes
    // next. Until the Quote knows, nothing is paid for: a Run stays queued and tries again.
    try {
      const told = await consume(owner, run);
      if (told) await announce(owner, run, told);
    } catch (err) {
      deps.log(`[runs] ${run.id}: its quote could not be told, so the run waits: ${message(err)}`);
      return abandon(owner, run);
    }
    const now = deps.now();
    if (run.state === 'queued') run.state = runNext(run.state, 'start');
    const step = nextStep(run);
    let lost = false;
    if (step && unresolved(step)) {
      // Only a tick that died or outran its claim leaves an intent with no id under it: the work is never sent again.
      markUnknown(run, step, now);
    } else if (step) {
      if (step.state === 'pending') {
        step.state = 'running';
        step.startedAt = now;
      }
      try {
        // localContext() does not load the owner, so the provider is read here before its capabilities.
        await (ctx.runway as { ready?: () => Promise<void> } | undefined)?.ready?.();
        const caps = capabilitiesOf(ctx.runway);
        // A stop that landed while the provider was read: even a step's first free
        // read can send work (a poll of a Lifestyle job sends its second passes).
        const stored = await store.run(owner, runId);
        if (!stored || !TICKABLE.has(stored.state)) throw new TickLost();
        // What the provider will refuse is refused here, before the step's first paid call.
        const why = unoffered(run, caps);
        if (why) throw new Error(why);
        await ACTIONS[step.id]({
          quote: () => store.quote(owner, run.quoteId),
          trpc: AppRouter.createCaller(ctx),
          caps,
          owner,
          run,
          step,
          now,
          save: () =>
            serial(lockKey(owner, runId), async () => {
              const stored = await store.run(owner, runId);
              if (!stored || !TICKABLE.has(stored.state) || stored.claim?.by !== run.claim?.by) throw new TickLost();
              await store.saveRun(owner, run);
            }),
        });
        if (step.meta?.['pollErrors'] !== undefined) delete step.meta['pollErrors'];
      } catch (err) {
        const errors = err instanceof Transient ? (step.meta?.['pollErrors'] as number | undefined ?? 0) + 1 : MAX_POLL_ERRORS;
        if (err instanceof TickLost) {
          lost = true;
        } else if (errors < MAX_POLL_ERRORS) {
          // The provider could not be read; the step waits for the next tick.
          metaOf<StepMeta>(step).pollErrors = errors;
          deps.log(`[runs] ${run.id} ${step.id}: could not be read (${errors} of ${MAX_POLL_ERRORS}): ${message(err)}`);
        } else {
          fail(run, step, err, now);
        }
      }
    }
    if (lost) {
      deps.log(`[runs] ${run.id} ${step?.id ?? ''}: the run was stopped or taken over before the call; nothing was sent`);
      return abandon(owner, run);
    }
    if (run.state === 'running' && !nextStep(run)) run.state = runNext(run.state, 'done');
    const released = await release(owner, run);
    const saved = released.run;
    if (released.lost) {
      deps.log(`[runs] ${run.id} ${step?.id ?? ''}: the claim was lost during the tick; this tick's copy is dropped`);
      return saved;
    }
    if (step && saved.state !== 'stopped') {
      await emit(owner, saved, 'run.step', { stepId: step.id, state: step.state, label: runView(saved).label });
      deps.log(`[runs] ${saved.id} ${step.id} ${step.state}${step.error ? `: ${step.error}` : ''}`);
    }
    if (saved.state === 'done') {
      const failed = failedDeliverables(saved);
      await emit(owner, saved, 'run.done', {
        outputs: saved.outputs,
        handoff: handoffFor(saved),
        ...(failed.length > 0 ? { findings: failed } : {}),
      });
      await ended(owner, saved, 'finish');
    } else if (saved.state === 'failed' || saved.state === 'submit_unknown') {
      await emit(owner, saved, 'run.failed', { state: saved.state, error: saved.error });
      await ended(owner, saved, saved.state === 'failed' ? 'fail' : 'submit_unknown');
    }
    return saved;
  }

  return {
    async start(ctx, owner, quote: Quote) {
      // Under the Quote's lock, the store's copy is the one that counts, and the
      // Run's id comes from it, so two clicks and two pods land on one Run. A Run
      // already there is answered; one whose Quote never heard of it (a start that
      // died between the two writes) tells the Quote now. Otherwise this is the last
      // check before spend: a Quote not held, decided elsewhere or changed is refused.
      const started = await serial(quoteKey(owner, quote.id), async () => {
        const current = await store.quote(owner, quote.id);
        if (!current) throw refused('That quote is not on record.');
        const id = runIdOf(current);
        const landed = await store.run(owner, id);
        if (landed) {
          if (current.consumedBy) return { run: landed, told: null };
          await store.saveQuote(owner, { ...current, consumedBy: id });
          return { run: landed, told: current };
        }
        if (current.consumedBy) throw refused('That quote has already started a run.');
        if (current.state !== 'approved') throw refused('That quote is not approved.');
        if (specHash(current.spec) !== current.specHash) throw refused('That quote no longer matches what was priced.');
        const now = deps.now();
        const { spec } = current;
        const jobId = spec.lifestyleJobId ?? spec.storyboardJobId;
        const run: Run = {
          id,
          threadId: current.threadId,
          turnId: current.turnId,
          kind: spec.kind,
          spec,
          specHash: current.specHash,
          quoteId: current.id,
          state: 'queued',
          // The plan step points at the job it was given; its first tick closes it once the job is planned.
          steps: stepsFor(spec.kind).map((id) => ({ id, state: 'pending', ids: [], ...(id === 'plan' && jobId ? { jobId } : {}) })),
          createdAt: now,
          updatedAt: now,
          outputs: { stillIds: [...(spec.stillIds ?? [])], clipIds: [] },
        };
        await store.saveRun(owner, run);
        await store.saveQuote(owner, { ...current, consumedBy: run.id });
        return { run, told: current };
      });
      const { run, told } = started;
      if (!told) return run;
      // The Quote is spent from here on, so nothing below may answer no: the Run goes on either way.
      await announce(owner, run, told);
      try {
        return await advance(ctx, owner, run.id);
      } catch (err) {
        deps.log(`[runs] ${run.id}: its first tick failed, the next one takes it from here: ${message(err)}`);
        return run;
      }
    },

    advance,

    async cancel(_ctx, owner, runId) {
      const stopped = await serial(lockKey(owner, runId), async () => {
        const run = await readRun(owner, runId);
        if (!ACTIVE.has(run.state)) return { run, changed: false };
        run.state = runNext(run.state, 'stop');
        run.updatedAt = deps.now();
        // The claim stays: the tick holding it reads the stop at its next save or release and lets go itself, keeping any id it made meanwhile.
        await store.saveRun(owner, run);
        return { run, changed: true };
      });
      if (!stopped.changed) return stopped.run;
      // The provider is never told: a task already sent finishes on its own and stays in the Library.
      await emit(owner, stopped.run, 'run.stopped', {});
      await ended(owner, stopped.run, 'cancel');
      deps.log(`[runs] ${runId} stopped`);
      return stopped.run;
    },

    async resumeAll(_ctx, owner) {
      const now = deps.now();
      for (const run of await store.runs(owner, { active: true })) {
        if (run.state !== 'running') continue;
        const step = nextStep(run);
        if (!step || !unresolved(step) || now - step.intent!.at < CLAIM_TTL_MS) continue;
        const marked = await serial(lockKey(owner, run.id), async () => {
          const stored = await store.run(owner, run.id);
          if (!stored || stored.state !== 'running') return null;
          const at = nextStep(stored);
          if (!at || !unresolved(at)) return null;
          markUnknown(stored, at, now);
          delete stored.claim;
          await store.saveRun(owner, stored);
          return stored;
        });
        if (!marked) continue;
        await emit(owner, marked, 'run.failed', { state: marked.state, error: SUBMIT_UNKNOWN });
        await ended(owner, marked, 'submit_unknown');
        deps.log(`[runs] ${marked.id} ${step.id}: ${SUBMIT_UNKNOWN}`);
      }
    },

    async snapshot(owner, runId) {
      const run = await store.run(owner, runId);
      return run ? runView(run) : null;
    },
  };
}
