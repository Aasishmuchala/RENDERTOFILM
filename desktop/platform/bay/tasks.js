// The task half of @runway/bay/runway: RunwayClient, tasks.json and the dispatch
// behind them. Who runs a task is settled once, when it is created; from then on
// its own `real.kind` answers for it, so switching provider never touches a run.
//
// - The desktop app (BAY_ENV=desktop, or RTF_SIMULATOR=1): the owner's provider
//   from Settings, through the Provider contract (../providers/types.js).
//   `media_processing_v2` runs in ffmpeg whoever the provider is. A task the
//   provider cannot run is refused in one sentence, before anything is saved.
// - The plain harness and its tests: the simulator, with REAL_GEN handing stills
//   and clips to ../realgen. Its client has no `capabilities()`, so the client
//   code reads it as Bay.
//
// Tasks are kept in memory and in <data>/storage/tasks.json, every state change
// written at once, so a restarted server still answers for them: resumeAll()
// follows what was already submitted by its remote id and never resubmits.
// runway.js re-exports what the app imports from here.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { capabilitiesFor } from './capabilities.js';
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
import { stopWaits } from '../realgen/higgsfield.js';
import * as realgen from '../realgen/index.js';

export { __mockFailNext, lifestylePlanAnswer, lookFromPrompt } from '../providers/simulator.js';

// Read once: a process is one or the other for its whole life.
const DESKTOP = process.env.BAY_ENV === 'desktop' || process.env.RTF_SIMULATOR === '1';
const simulatorOffered = () => process.env.RTF_SIMULATOR === '1';

const DEFAULT_BUDGET = 300; // credits a day until the owner sets their own
const NO_PROVIDER = 'Choose a provider in Settings.';

/** Nothing has reached a paid call yet. */
const BEFORE_SUBMIT = new Set(['queued', 'uploading', 'quoting']);
/** Possibly paid for: these are what a restart follows and what the quit dialog counts. */
const SUBMITTED = new Set(['submitted', 'waiting', 'downloading']);

const TASKS_FILE = path.join(STORAGE_DIR, 'tasks.json');

let state; // { tasks: { [id]: Task }, checks: number }

function load() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
  } catch {
    state = { tasks: {}, checks: 0 };
  }
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
  fs.mkdirSync(path.dirname(TASKS_FILE), { recursive: true });
  const tmp = `${TASKS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, TASKS_FILE);
  reportJobs();
}

const dirs = { ASSETS_DIR, STORAGE_DIR, UPLOADS_DIR };
const realgenSetup = { getState: load, persist: save, mockOrigin, dirs, storagePath, lookFromPrompt };

// REAL_GEN=dry|higgsfield on the plain harness: stills and clips run on Higgsfield.
if (!DESKTOP && realgen.mode() !== 'off') realgen.boot(realgenSetup);

// ---------------------------------------------------------------- owners

const connections = documentStore({ prefix: 'connections/' });

/** The last read of each owner's document, for the callers that cannot wait: owner -> { provider, budget, runwayKey }. */
const owners = new Map();

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

/** Test seam: swaps any of higgsfield, runway, simulator, ffmpeg. */
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
  const locked = new Set();
  const opened = new Set();
  for (const task of tasks) {
    const { kind, state: runState } = task.real;
    if (kind === 'ffmpeg') {
      if (runState === 'queued' || runState === 'running') track(task, () => providers.ffmpeg.resume(task));
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
    this.capabilities = () => capabilitiesFor(providers[chosenProvider(owner)]);
    this.account = async () => (await providerFor(owner)).account(owner);
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

  async createTask(type, options = {}, _opts = {}) {
    if (!DESKTOP) return harnessTask(type, options);
    if (type === 'media_processing_v2') {
      const local = providers.ffmpeg.supports(type, options);
      if (!local.ok) throw new RunwayTaskError(local.reason, { status: 400 });
      return launch(providers.ffmpeg, this.owner, type, options, local.notes);
    }
    const provider = await providerFor(this.owner);
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
