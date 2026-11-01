// The task half of @runway/bay/runway: RunwayClient, tasks.json and the dispatch
// behind them. Who runs a task is settled once, when it is created; from then on
// its own `real.kind` answers for it, so switching provider never touches a run.
//
// - The desktop app (BAY_ENV=desktop, or RTF_SIMULATOR=1): the owner's provider
//   from Settings, through the Provider contract (../providers/types.js).
//   `media_processing_v2` runs in ffmpeg whoever the provider is, its
//   `conform_otio` in FilmCraft and its `relight` in LightCraft when that sidecar
//   is here. A task the provider cannot run is refused in one sentence, before
//   anything is saved.
// - The plain harness and its tests: the simulator, with REAL_GEN handing stills
//   and clips to ../realgen. Its client has no `capabilities()`, so the client
//   code reads it as Bay.
//
// Tasks are kept in memory and in <data>/storage/tasks.json, every state change
// written at once, so a restarted server still answers for them: resumeAll()
// follows what was already submitted by its remote id and never resubmits. A
// tasks.json that will not read is restored from its backup (./durable.js); with
// nothing to restore, no run starts and the file is never overwritten.
// runway.js re-exports what the app imports from here.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { capabilitiesFor } from './capabilities.js';
import { isRecord, readBackup, restoreDurable, writeDurable } from './durable.js';
import { bootReady } from './guard.js';
import { ASSETS_DIR, STORAGE_DIR, UPLOADS_DIR, mockOrigin } from './paths.js';
// A cycle with runway.js, safe because these names are only read inside
// functions that run once both modules have.
import { LOCAL_OWNER, LOCAL_PROFILE, RunwayTaskError } from './runway.js';
import { documentStore, storagePath } from './storage.js';
import { createFfmpegProvider, stopFfmpeg } from '../ffmpeg.js';
import { createHiggsfieldProvider } from '../providers/higgsfield.js';
import { createRunwayProvider } from '../providers/runway-api.js';
import { AI_TEXT_SENTENCE } from '../providers/runway-mapping.js';
import { SCALE, createSimulatorProvider, lookFromPrompt } from '../providers/simulator.js';
import { localFileForUrl, refusesInput } from '../realgen/files.js';
import { stopWaits } from '../realgen/higgsfield.js';
import * as realgen from '../realgen/index.js';

export { __mockFailNext, lifestylePlanAnswer, lookFromPrompt } from '../providers/simulator.js';

// Read once: a process is one or the other for its whole life.
const DESKTOP = process.env.BAY_ENV === 'desktop' || process.env.RTF_SIMULATOR === '1';
const simulatorOffered = () => process.env.RTF_SIMULATOR === '1';

const DEFAULT_BUDGET = 300; // credits a day until the owner sets their own
const NO_PROVIDER = 'Choose a provider in Settings.';
const TASKS_LOST = 'Render to Film could not read its task list or the backup of it, so nothing was started and nothing was charged.';
const LIBRARY_LOST = 'Your library could not be read or restored from its backup, so nothing was started and nothing was charged.';
const NOT_MEDIA = 'Only images and videos from this app can go to a provider, so nothing was uploaded and nothing was charged.';

/** Nothing has reached a paid call yet. */
const BEFORE_SUBMIT = new Set(['queued', 'uploading', 'quoting']);
/** Possibly paid for: these are what a restart follows and what the quit dialog counts. */
const SUBMITTED = new Set(['submitted', 'waiting', 'downloading']);
/** Stay on this computer and go in no library: ffmpeg, and text that only the simulator answers. */
const LOCAL_TYPES = new Set(['media_processing_v2', 'claude_api']);
/** Who runs media_processing_v2 on this computer: nobody's generation provider, and started again at boot for free. */
const LOCAL_PROVIDERS = new Set(['ffmpeg', 'filmcraft']);

const TASKS_FILE = path.join(STORAGE_DIR, 'tasks.json');

let state; // { tasks: { [id]: Task }, checks: number }
let tasksLost = false; // tasks.json and its backup both failed: nothing may be saved or started

/** The parsed task list; a throw means the bytes are not one. */
function parseTasks(bytes) {
  const doc = JSON.parse(bytes.toString('utf8'));
  if (!isRecord(doc) || !isRecord(doc.tasks ?? {})) throw new Error('not a task list');
  return doc;
}

/** tasks.json, else its backup with the damaged file kept, else an empty list that `tasksLost` keeps off the disk. */
function readTasks() {
  let missing = false;
  try {
    return parseTasks(fs.readFileSync(TASKS_FILE));
  } catch (err) {
    missing = err?.code === 'ENOENT';
  }
  const backup = readBackup(TASKS_FILE);
  if (missing && !backup) return { tasks: {}, checks: 0 };
  try {
    const doc = parseTasks(backup);
    const kept = restoreDurable(TASKS_FILE, backup);
    console.warn(`[tasks] tasks.json could not be read; ${kept ? `kept it as ${kept} and ` : ''}restored ${Object.keys(doc.tasks ?? {}).length} tasks from its backup.`);
    return doc;
  } catch {
    tasksLost = true;
    console.error('[tasks] tasks.json could not be read and has no usable backup; it was left as it is, and no run will start.');
    return { tasks: {}, checks: 0 };
  }
}

function load() {
  if (state) return state;
  state = readTasks();
  state.tasks ??= {};
  state.checks ??= 0;
  return state;
}

let jobsReported = 0;
let jobsProvider = '';

/** Tells main how many runs are out and on whom, when that changes (it asks before quitting). */
function reportJobs() {
  const port = process.parentPort;
  if (!port) return;
  let active = 0;
  const names = new Set();
  for (const task of Object.values(state.tasks)) {
    if (!SUBMITTED.has(task?.real?.state)) continue;
    active += 1;
    names.add(providers[task.real.kind]?.name ?? task.real.kind);
  }
  const provider = [...names].join(' and ');
  if (active === jobsReported && provider === jobsProvider) return;
  jobsReported = active;
  jobsProvider = provider;
  port.postMessage({ type: 'jobs', active, provider });
}

function save() {
  if (tasksLost) return;
  writeDurable(TASKS_FILE, JSON.stringify(state, null, 2));
  reportJobs();
}

const dirs = { ASSETS_DIR, STORAGE_DIR, UPLOADS_DIR };
const realgenSetup = { getState: load, persist: save, mockOrigin, dirs, storagePath, lookFromPrompt };

// REAL_GEN=dry|higgsfield on the plain harness: stills and clips run on Higgsfield.
if (!DESKTOP && realgen.mode() !== 'off') realgen.boot(realgenSetup);

// ---------------------------------------------------------------- owners

const connections = documentStore({ prefix: 'connections/' });
const library = documentStore({ prefix: 'library/' });

/** The last read of each owner's document, for the callers that cannot wait: owner -> { provider, budget, runwayKey }. */
const owners = new Map();

/**
 * The one door every create path goes through, before anything is saved, uploaded
 * or billed. Reading the library is what restores a damaged one: a take that
 * cannot be recorded must not be paid for.
 */
async function assertRunnable(owner, type, options) {
  load();
  if (tasksLost) throw new RunwayTaskError(TASKS_LOST, { status: 400 });
  if (LOCAL_TYPES.has(type)) return;
  if (refusesInput(options)) throw new RunwayTaskError(NOT_MEDIA, { status: 400 });
  try {
    await library.get(`${owner}.json`);
  } catch (err) {
    console.warn(`[tasks] library: ${err?.message ?? err}`);
    throw new RunwayTaskError(LIBRARY_LOST, { status: 400 });
  }
}

/** Reads the owner's sealed `connections/` document; throws when it cannot be opened. */
async function readOwner(owner) {
  const doc = (await connections.get(`${owner}.json`))?.value;
  const entry = {
    provider: doc?.generation?.provider,
    budget: doc?.generation?.budget,
    runwayKey: doc?.apiKeys?.runwayapi?.key,
  };
  owners.set(owner, entry);
  return entry;
}

const chosenProvider = (owner) => owners.get(owner)?.provider ?? (simulatorOffered() ? 'simulator' : 'higgsfield');
const runwayKey = (owner) => owners.get(owner)?.runwayKey;

// ---------------------------------------------------------------- providers

const lookupTaskPath = (id) => load().tasks[id]?.path;

const providers = {
  simulator: createSimulatorProvider({ getState: load, mockOrigin }),
  higgsfield: createHiggsfieldProvider({ lookupTaskPath }),
  runway: createRunwayProvider({
    getKey: runwayKey,
    dirs: { ...dirs, storagePath },
    persist: save,
    mockOrigin,
  }),
  ffmpeg: createFfmpegProvider({ dirs, storagePath, lookupTaskPath, persist: save, mockOrigin }),
};

const builtProviders = { ...providers };

let filmcraftLoad; // one load, whoever asks first
let stopConforms; // what a quit calls, once there is anything to stop

/**
 * FilmCraft's module and the sidecars, with its provider in `providers` from then
 * on. Read when a conform first needs them, as ffmpeg.js reads master.js:
 * realgen-dry.test.mjs runs a private copy of bay/ with neither file beside it.
 */
function loadFilmcraft() {
  filmcraftLoad ??= Promise.all([import('../filmcraft.js'), import('../sidecars.js')]).then(([filmcraft, sidecars]) => {
    providers.filmcraft ??= filmcraft.createFilmcraftProvider({ dirs, storagePath, lookupTaskPath, persist: save, mockOrigin, sidecars });
    stopConforms = filmcraft.stopFilmcraft;
    return { sidecars, notInstalled: filmcraft.NOT_INSTALLED };
  });
  return filmcraftLoad;
}

/** Test seam: swaps any of higgsfield, runway, simulator, ffmpeg, filmcraft. */
export function __setProviders(next) {
  Object.assign(providers, next);
}

/** Test seams: the providers this module built, the owner read, its key, and the tasks in memory. */
export const __realProviders = () => builtProviders;
export const __readOwner = readOwner;
export const __runwayKey = runwayKey;
export const __tasksForTest = () => load().tasks;
export const __saveTasks = () => save();

/**
 * The owner's provider: what they saved, else the simulator under RTF_SIMULATOR,
 * else Higgsfield. Always a fresh read, so a change in Settings counts from the
 * next task. A document that will not open throws: nothing runs on a guess.
 */
export async function providerFor(owner) {
  await readOwner(owner);
  const id = chosenProvider(owner);
  if (id === 'simulator' && !simulatorOffered()) throw new RunwayTaskError(NO_PROVIDER, { status: 400 });
  return providers[id];
}

/**
 * The provider a later step of some work is held to: the one that started it,
 * whatever is chosen today. One that cannot be used any more refuses the step in
 * one sentence, so it is never billed to another provider.
 */
async function providerStartedOn(owner, id) {
  await readOwner(owner);
  const provider = !LOCAL_PROVIDERS.has(id) && Object.hasOwn(providers, id) ? providers[id] : undefined;
  if (!provider || (id === 'simulator' && !simulatorOffered())) {
    throw new RunwayTaskError('This was started on a provider that is no longer available, so nothing was sent.', { status: 400 });
  }
  const refusal = provider.unavailable?.(owner);
  if (refusal) throw new RunwayTaskError(refusal, { status: 400 });
  return provider;
}

/** Whoever answers for a task from here on: the one that ran it, whatever is chosen today. */
const providerOfTask = (task) => (Object.hasOwn(providers, task?.real?.kind ?? '') ? providers[task.real.kind] : providers.simulator);

const envFor = (owner) => ({ owner, persist: save, getState: load, mockOrigin });

function failRun(task, error, hint) {
  task.real = { ...task.real, state: 'failed', error, hint };
  save();
}

const running = new Set(); // what this process has started and not seen settle

/** Runs `work`, tracked for idle(). A provider's start never rejects; if one does, a task that never left the queue is failed. */
function track(task, work) {
  let run;
  try {
    run = Promise.resolve(work());
  } catch (err) {
    run = Promise.reject(err);
  }
  const tracked = run
    .catch((err) => {
      console.warn(`[tasks] ${task.id}: ${err?.message ?? err}`);
      if (task.real?.state === 'queued') failRun(task, 'This run could not start.', realgen.NOT_CHARGED);
    })
    .finally(() => running.delete(tracked));
  running.add(tracked);
}

/** Test seam: settles when every run started here has stopped. */
export async function idle() {
  while (running.size > 0) await Promise.all(running);
}

// ---------------------------------------------------------------- boot

let resumed = false;

/**
 * Once per process, after boot: a run with a remote id is followed by that id, a
 * run that never reached a paid call is failed as uncharged, and an ffmpeg run
 * starts again (local and free). An owner whose document will not open keeps
 * their paid runs as they are, for the next launch, rather than failing them.
 */
export async function resumeAll() {
  if (resumed) return;
  resumed = true;
  // Listed before the first await: anything created after this is this process's own run.
  const tasks = Object.values(load().tasks).filter((task) => task?.real?.state);
  await Promise.all([import('../lightcraft.js'), import('../sidecars.js')])
    .then(([lightcraft, sidecars]) => lightcraft.registerLightcraft(providers, sidecars))
    .catch((err) => console.warn(`[tasks] lightcraft: ${err?.message ?? err}`));
  const locked = new Set();
  const opened = new Set();
  for (const task of tasks) {
    const { kind, state: runState } = task.real;
    if (LOCAL_PROVIDERS.has(kind)) {
      if (runState === 'queued' || runState === 'running') {
        if (kind === 'filmcraft') await loadFilmcraft();
        track(task, () => providers[kind].resume(task));
      }
      continue;
    }
    if (!Object.hasOwn(providers, kind)) continue;
    if (BEFORE_SUBMIT.has(runState)) {
      failRun(task, realgen.RESTART_BEFORE_SUBMIT, realgen.NOT_CHARGED);
      continue;
    }
    if (!SUBMITTED.has(runState)) continue;
    const owner = task.owner ?? LOCAL_OWNER;
    if (!opened.has(owner) && !locked.has(owner)) {
      try {
        await readOwner(owner);
        opened.add(owner);
      } catch (err) {
        locked.add(owner);
        console.warn(`[tasks] resume: ${err?.message ?? err}`);
      }
    }
    if (locked.has(owner)) continue;
    track(task, () => providers[kind].resume(task, envFor(owner)));
  }
  reportJobs();
}

/**
 * Main's last word before it quits. tasks.json is written as runs change, so
 * nothing needs flushing: a paid run is followed again by its id at the next
 * boot, and a stopped encode starts again there, free.
 */
function exitOnShutdown(port = process.parentPort) {
  port?.on('message', ({ data }) => {
    if (data?.type !== 'shutdown') return;
    stopFfmpeg();
    stopConforms?.();
    stopWaits();
    process.exit(0);
  });
}

let booted;

/**
 * Once, from runwayAuth(): realgen's files, the CLI it will run, then resumeAll()
 * as soon as boot has handed over the key that opens the owners' documents.
 * Later calls get the same promise; the plain harness boots at import instead.
 */
export function bootTasks() {
  if (!DESKTOP) return Promise.resolve();
  if (booted) return booted;
  exitOnShutdown();
  providers.higgsfield.pinBinary?.();
  realgen.boot({
    ...realgenSetup,
    budget: () => owners.get(LOCAL_OWNER)?.budget ?? DEFAULT_BUDGET,
    providerActive: () => chosenProvider(LOCAL_OWNER) === 'higgsfield',
  });
  booted = bootReady.then(resumeAll).catch((err) => console.warn(`[tasks] resume: ${err?.message ?? err}`));
  return booted;
}

// ---------------------------------------------------------------- tasks

/** Test hook: forget every task. */
export function __mockResetTasks() {
  tasksLost = false;
  state = { tasks: {}, checks: 0 };
  save();
}

/** Saves a queued task, then starts it. */
function launch(provider, owner, type, options, notes) {
  const task = {
    id: randomUUID(),
    type,
    createdAt: Date.now(),
    owner,
    real: { kind: provider.id, state: 'queued', notes },
  };
  load().tasks[task.id] = task;
  save();
  track(task, () => provider.start(task, options, envFor(owner)));
  return { id: task.id };
}

/** What a task would cost the owner, routed as createTask routes it. */
async function quoteTask(owner, type, options) {
  if (LOCAL_TYPES.has(type)) return { unit: 'credits', amount: 0 };
  const provider = await providerFor(owner);
  return (await provider.quote?.(type, options)) ?? { unit: 'credits', amount: null };
}

/** Who runs a media_processing_v2 task: FilmCraft a conform, once it is here; ffmpeg everything else. */
async function localRunner(options) {
  if (options?.operation !== 'conform_otio') return providers.ffmpeg;
  const { sidecars, notInstalled } = await loadFilmcraft();
  const { ok } = await sidecars.status('filmcraft');
  if (!ok) throw new RunwayTaskError(notInstalled, { status: 400 });
  return providers.filmcraft;
}

/** The file on this computer behind a task's result, null when it has none. */
function taskFile(id) {
  const served = lookupTaskPath(id);
  return served ? localFileForUrl(served, dirs, storagePath) : null;
}

/** The plain harness: the simulator, unless REAL_GEN hands the task to realgen. */
function harnessTask(type, options) {
  const s = load();
  const simulator = providers.simulator;
  const task = simulator.prepare({ id: randomUUID(), type, createdAt: Date.now() }, options);
  if (realgen.mode() !== 'off' && !task.fail) {
    const d = realgen.decide(type, options, { lookupTaskPath });
    if (d.kind === 'passthrough') { task.path = d.path; task.durationMs = 1000 * SCALE; task.real = { kind: 'passthrough', reason: d.reason }; }
    else if (d.kind === 'higgsfield') { task.real = { kind: 'higgsfield', state: 'queued', notes: d.notes }; s.tasks[task.id] = task; save(); realgen.start(task, options, d); return { id: task.id }; }
    else task.real = { kind: 'simulated', reason: d.reason };
  }
  simulator.answer(task, options);
  s.tasks[task.id] = task;
  save();
  return { id: task.id };
}

export class RunwayClient {
  constructor(owner = LOCAL_OWNER) {
    this.owner = owner;
    // Only here: on the harness these stay absent, and the app reads a client without them as Bay.
    if (!DESKTOP) return;
    this.capabilities = () => ({ ...capabilitiesFor(providers[chosenProvider(owner)]), interchange: true, sidecars: true });
    this.taskFile = taskFile;
    this.account = async () => (await providerFor(owner)).account(owner);
    this.quote = (type, options = {}) => quoteTask(owner, type, options);
    this.verifyRunwayKey = verifyRunwayKey;
    this.higgsfield = {
      login: () => providers.higgsfield.login(),
      logout: () => providers.higgsfield.logout(),
      status: () => providers.higgsfield.binaryStatus(),
    };
  }

  /** Called per request, so capabilities(), which cannot wait, reads today's provider. */
  async ready() {
    if (!DESKTOP) return;
    await readOwner(this.owner).catch((err) => console.warn(`[tasks] connections: ${err?.message ?? err}`));
  }

  async getProfile() {
    return { ...LOCAL_PROFILE };
  }

  /** `opts.provider`: a later step of work that provider started (src/task-helpers.ts, onProvider). */
  async createTask(type, options = {}, opts = {}) {
    await assertRunnable(this.owner, type, options);
    if (!DESKTOP) return harnessTask(type, options);
    if (type === 'media_processing_v2') {
      const runner = await localRunner(options);
      const local = runner.supports(type, options);
      if (!local.ok) throw new RunwayTaskError(local.reason, { status: 400 });
      return launch(runner, this.owner, type, options, local.notes);
    }
    const provider = opts.provider ? await providerStartedOn(this.owner, opts.provider) : await providerFor(this.owner);
    if (type === 'claude_api' && provider.id !== 'simulator') {
      throw new RunwayTaskError(AI_TEXT_SENTENCE, { status: 400 });
    }
    const verdict = provider.supports(type, options);
    if (!verdict.ok) throw new RunwayTaskError(verdict.reason, { status: 400 });
    return launch(provider, this.owner, type, options, verdict.notes);
  }

  async taskSnapshot(id, opts = {}) {
    const task = load().tasks[id];
    if (!task) {
      throw new RunwayTaskError('That task was not found.', {
        status: 404,
        body: { error: { message: 'Task not found' } },
      });
    }
    if (task.real?.kind === 'filmcraft') await loadFilmcraft();
    return providerOfTask(task).snapshot(task, opts);
  }

  async getTask(id) {
    const snap = await this.taskSnapshot(id);
    const task = load().tasks[id];
    const provider = providerOfTask(task);
    // A frame capture has one artifact per frame; the snapshot's url is only the first.
    const artifacts =
      task.real?.kind === 'ffmpeg'
        ? provider.artifacts(task)
        : snap.url
          ? [{ id: `${id}-artifact-0`, url: snap.url, ...provider.artifactMeta(task) }]
          : [];
    return { id, status: snap.status, artifacts };
  }

  async uploadAsset(bytes, { filename }) {
    const ext = (path.extname(filename ?? '') || '.jpg').toLowerCase();
    const name = `${randomUUID()}${ext}`;
    await fsp.mkdir(UPLOADS_DIR, { recursive: true });
    await fsp.writeFile(path.join(UPLOADS_DIR, name), bytes);
    return { url: `${mockOrigin()}/__mock/uploads/${name}` };
  }

  async runTask(type, options = {}) {
    const { id } = await this.createTask(type, options);
    for (;;) {
      const snap = await this.taskSnapshot(id);
      if (snap.done) {
        if (snap.status !== 'SUCCEEDED') {
          throw new RunwayTaskError(snap.error ?? 'The task failed.', { status: 400 });
        }
        return { artifacts: (await this.getTask(id)).artifacts };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

/** Rejects with only a `status`: nothing here may carry the key into a log line or an answer. */
async function verifyRunwayKey(key) {
  try {
    await providers.runway.verifyKey(key);
  } catch (err) {
    throw Object.assign(new Error('The Runway API did not accept that key.'), { status: err?.status });
  }
}
