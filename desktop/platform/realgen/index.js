// Real-mode generation — runs a still or clip on Higgsfield. Two callers: the
// desktop app, for an owner whose provider is Higgsfield
// (../providers/higgsfield.js), and the plain harness under
// REAL_GEN=dry|higgsfield (README.md has the modes).
//
// ../bay/tasks.js boots this once, then calls start() in createTask (the
// harness after decide()), resume() after a restart on desktop, snapshotPatch()
// in taskSnapshot and artifactMeta() in getTask; ../bay/runway.js calls status()
// for /__mock/realgen/status.
// A run lives in task.real = { kind, state, notes[], model?, params?,
// mediaIds?, credits?, jobId?, resultUrl?, width?, height?, error?, hint?,
// waitStartedAt? } and every state change is written to tasks.json at once.
//
// Pipeline: uploading -> quoting -> (dry: canned asset) -> submitted ->
// waiting -> downloading -> succeeded | failed.
// Money rules: a task reaches `generate create` at most once. It is
// `submitted` on disk before the call, its job id is on disk the moment the
// reply is, and a restart only ever follows that id with `generate wait`.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { localFileForUrl, resultPathFor, sha1, stripOrigin } from './files.js';
import * as hf from './higgsfield.js';
import { append, budgetCheck, parseBudget, readAll, spent } from './ledger.js';
import { argsFor, mapTask } from './mapping.js';

const ACTIVE = new Set(['queued', 'uploading', 'quoting', 'submitted', 'waiting', 'downloading']);
const PROGRESS = { queued: 0.05, uploading: 0.15, quoting: 0.2, submitted: 0.3, downloading: 0.95 };
const DRY_SECONDS = 3;
export const NOT_CHARGED = 'Nothing was charged.';
const RESTART_BEFORE_ID =
  'The server restarted before Higgsfield returned a job id; not resubmitting. ' +
  'Check `higgsfield generate list` before running again.';
const getHint = (jobId) => `Higgsfield job ${jobId} may still finish: \`higgsfield generate get ${jobId}\` shows it.`;
export const RESTART_BEFORE_SUBMIT = 'The server restarted before this run was submitted. Nothing was charged; run it again.';

let MODE; // read once from REAL_GEN, then fixed for the process
let env; // what boot() was given, plus where the real-mode files live
const running = new Map(); // taskId -> this process's pipeline for it
const reserved = new Map(); // taskId -> { session, mode, credits }: passed the budget, not yet in the ledger
const uploading = new Map(); // sha1 -> an upload in flight (two tasks, one file, one upload)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const roundedCredits = (n) => String(Math.round(n * 100) / 100);

/** The desktop refusal: the budget there is a Settings field, not an env var. */
function budgetSentence(quote, used, limit) {
  return (
    `Today's Higgsfield budget is reached: this run quotes ${roundedCredits(quote)} credits and ` +
    `${roundedCredits(used)} of ${roundedCredits(limit)} are used. Raise it in Settings.`
  );
}

/** Collapsed and cut to `n` characters (prompts are logged at most 80). */
function short(text, n = 80) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// ---------------------------------------------------------------- settings

/**
 * `off` (the simulator), `dry` (upload + quote, canned result) or `higgsfield`.
 * REAL_GEN decides on the harness. On desktop the owner's provider does, and
 * REAL_GEN=dry still forces dry.
 */
export function mode() {
  if (MODE === undefined) {
    const v = String(process.env.REAL_GEN ?? '').trim().toLowerCase();
    MODE = v === 'dry' || v === 'higgsfield' ? v : 'off';
    if (MODE === 'off' && v && v !== 'off' && !env?.providerActive) {
      console.warn(`[realgen] REAL_GEN=${v} is not dry or higgsfield; running the simulator`);
    }
  }
  if (!env?.providerActive) return MODE;
  if (!env.providerActive()) return 'off';
  return MODE === 'dry' ? 'dry' : 'higgsfield';
}

/** The mode a run goes under: a pipeline only exists on Higgsfield, so it is never `off`. */
function runMode() {
  mode();
  return MODE === 'dry' ? 'dry' : 'higgsfield';
}

/** The budget bucket: REAL_GEN_SESSION, else today's local date. */
function session() {
  return process.env.REAL_GEN_SESSION?.trim() || new Date().toLocaleDateString('en-CA');
}

/** Desktop: the owner's daily budget from Settings. Harness: the env fallback. */
function budget() {
  return env?.budget ? env.budget() : parseBudget(process.env.REAL_GEN_BUDGET);
}

function origin() {
  return env?.mockOrigin?.() ?? `http://localhost:${process.env.PORT ?? 3000}`;
}

/** Where a run's spend is on record; boot() has not run when REAL_GEN is off. */
function ledgerHint() {
  return `See ${env?.ledger ?? 'higgsfield-ledger.jsonl in the data folder'}.`;
}

// ---------------------------------------------------------------- task state

/** Patches task.real (and the task itself) and persists; null when the task is gone. */
function update(taskId, real, top) {
  const task = env.getState().tasks[taskId];
  if (!task) return null;
  if (top) Object.assign(task, top);
  task.real = { ...task.real, ...real };
  env.persist();
  return task;
}

function fail(run, error, hint) {
  const message = String(error ?? 'The Higgsfield run failed.').slice(0, 300);
  update(run.taskId, { state: 'failed', error: message, ...(hint ? { hint } : {}) });
  console.warn(`[realgen] failed ${run.taskId} ${run.type}: ${message}`);
}

/** One ledger line; never throws (a full disk must not strand a paid job). */
function record(event, run, extra = {}) {
  try {
    return append(env.ledger, {
      session: run.session,
      mode: run.mode,
      event,
      taskId: run.taskId,
      appType: run.type,
      ...extra,
    });
  } catch (err) {
    console.warn(`[realgen] ledger write failed (${event} ${run.taskId}): ${err.message}`);
    return null;
  }
}

function rawFile(taskId, kind) {
  return path.join(env.jobs, `${String(taskId).replace(/[^\w.-]/g, '_')}.${kind}.json`);
}

function track(taskId, promise) {
  const p = promise
    .catch((err) => console.warn(`[realgen] ${taskId}: ${err?.message ?? err}`))
    .finally(() => running.delete(taskId));
  running.set(taskId, p);
  return p;
}

/** Test seam: settles when every pipeline in this process has stopped. */
export function idle() {
  return Promise.all([...running.values()]).then(() => undefined);
}

// ---------------------------------------------------------------- inputs

/** Credits that passed the budget in this session and mode but are not in the ledger yet. */
function reservedFor(run) {
  let total = 0;
  for (const r of reserved.values()) if (r.session === run.session && r.mode === run.mode) total += r.credits;
  return total;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function readUploads() {
  try {
    const all = JSON.parse(fs.readFileSync(env.uploads, 'utf8'));
    return all && typeof all === 'object' ? all : {};
  } catch {
    return {};
  }
}

const EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'mp4']);
const CONTENT_EXTS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4' };

/** The file behind an input URL: the stub's own file, or a remote one fetched into realgen/inputs/. */
async function inputFile(url) {
  const local = localFileForUrl(url, env.dirs, env.storagePath);
  if (local) {
    try {
      return { file: local, hash: sha1(await fsp.readFile(local)) };
    } catch (err) {
      if (err?.code === 'ENOENT') throw new Error(`An input image is missing on disk: ${stripOrigin(url)}`);
      throw err;
    }
  }
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Could not fetch an input image (${res.status}).`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const hash = sha1(bytes);
    const found = path.extname(new URL(url).pathname).slice(1).toLowerCase();
    const type = String(res.headers.get('content-type') ?? '').split(';')[0].trim();
    const ext = EXTS.has(found) ? found : CONTENT_EXTS[type] ?? 'jpg';
    const file = path.join(env.inputs, `${hash}.${ext}`);
    if (!fs.existsSync(file)) {
      await fsp.mkdir(env.inputs, { recursive: true });
      await fsp.writeFile(file, bytes);
    }
    return { file, hash };
  }
  throw new Error(`An input image is neither a file the mock serves nor an http(s) URL (${short(url, 60)}).`);
}

/** The Higgsfield id for a file: realgen/uploads.json by content hash, else one (free) upload. */
function uploadOnce({ file, hash }) {
  const bin = hf.binPath();
  const hit = readUploads()[hash];
  if (hit?.id && hit.bin === bin) return Promise.resolve(hit.id);
  if (!uploading.has(hash)) {
    const p = hf
      .upload(file)
      .then((up) => {
        const all = readUploads();
        all[hash] = { id: up.id, url: up.url, file: path.basename(file), bin, at: new Date().toISOString() };
        writeJson(env.uploads, all);
        console.log(`[realgen] uploaded ${path.basename(file)} → ${up.id}`);
        return up.id;
      })
      .catch((err) => {
        throw new Error(`Higgsfield upload failed: ${err.message}`);
      })
      .finally(() => uploading.delete(hash));
    uploading.set(hash, p);
  }
  return uploading.get(hash);
}

/** Forgets cached upload ids (a failed create may mean Higgsfield no longer knows them). */
function forgetUploads(ids) {
  const all = readUploads();
  let changed = false;
  for (const [hash, entry] of Object.entries(all)) {
    if (ids.includes(entry?.id)) {
      delete all[hash];
      changed = true;
    }
  }
  if (changed) writeJson(env.uploads, all);
}

let sharpModule; // undefined: not tried yet; null: not installed

async function loadSharp() {
  if (sharpModule === undefined) {
    try {
      sharpModule = (await import('sharp')).default;
    } catch (err) {
      sharpModule = null;
      console.warn(`[realgen] sharp is not available (${err.message}); image sizes and start-frame ratios are skipped`);
    }
  }
  return sharpModule;
}

/** Display width/height of an image (EXIF rotation applied), null when unreadable. */
async function imageSize(file) {
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    const m = await sharp(file).metadata();
    if (!(m.width > 0) || !(m.height > 0)) return null;
    return m.orientation >= 5 ? { width: m.height, height: m.width } : { width: m.width, height: m.height };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- pipeline

/** The stub's decision for one createTask (see mapping.js for the shapes). */
export function decide(type, options, ctx) {
  const d = mapTask(type, options, ctx);
  if (d.kind === 'passthrough') console.log(`[realgen] ${type}: pass-through ${d.path}`);
  else if (d.kind === 'simulated' && d.reason !== 'text-via-app-settings') {
    console.log(`[realgen] ${type}: simulated (${d.reason})`);
  }
  return d;
}

/** Starts the run for a task just saved as `queued`; the promise never rejects and need not be awaited. */
export function start(task, options, d) {
  if (running.has(task.id)) return running.get(task.id);
  return track(task.id, submitFlow(task.id, task.type, options, d));
}

async function submitFlow(taskId, type, options, first) {
  const run = { taskId, type, session: session(), mode: runMode(), family: first.family, model: first.model };
  let stage = 'upload';
  try {
    if (!env) throw new Error('Real mode did not start (boot was not called).');
    console.log(`[realgen] start ${taskId} ${type} → ${first.model} "${short(first.prompt)}"`);
    for (const note of first.notes) console.log(`[realgen] note ${taskId}: ${note}`);
    // The canned path the stub picked is not this run's result.
    if (!update(taskId, {
      state: 'uploading',
      session: run.session,
      mode: run.mode,
      family: first.family,
      model: first.model,
      params: first.params,
      expectedSeconds: first.expectedSeconds,
    }, { path: undefined })) return;

    const inputs = [];
    for (const m of first.media) inputs.push(await inputFile(m.url));
    const mediaIds = [];
    for (const input of inputs) mediaIds.push(await uploadOnce(input));

    // The first frame's own size settles the ratio when the app sent none.
    let d = first;
    const size = inputs.length > 0 ? await imageSize(inputs[0].file) : null;
    if (size) {
      const lookupTaskPath = (id) => env.getState().tasks[id]?.path;
      const again = mapTask(type, options, { lookupTaskPath, startSize: size });
      if (again.kind === 'higgsfield' && again.media.length === first.media.length) d = again;
    }
    const args = argsFor(d, mediaIds);
    run.model = d.model;

    stage = 'quote';
    if (!update(taskId, { state: 'quoting', mediaIds, model: d.model, params: d.params, notes: d.notes })) return;
    let credits;
    try {
      credits = await hf.cost(args);
    } catch (err) {
      record('error', run, { error: err.message, stage });
      fail(run, `Higgsfield rejected the request: ${err.message}`, NOT_CHARGED);
      return;
    }
    run.credits = credits;
    record('quote', run, { hfModel: d.model, args, credits, notes: d.notes });

    // Budget: the ledger plus runs already past this check. No await from
    // here to the reservation, so two runs cannot both slip under it.
    const used = spent(env.ledger, { session: run.session, mode: run.mode }) + reservedFor(run);
    const limit = budget();
    const check = budgetCheck({ spent: used, quote: credits, budget: limit, session: run.session });
    if (!check.ok) {
      record('refused', run, { hfModel: d.model, credits, spent: used, budget: limit });
      fail(run, env.budget ? budgetSentence(credits, used, limit) : check.message, NOT_CHARGED);
      return;
    }

    if (run.mode === 'dry') {
      record('dry-submit', run, { hfModel: d.model, args, credits });
      const look = env.lookFromPrompt?.(d.prompt) ?? 'golden-hour';
      const canned = d.family === 'video' ? '/__mock/assets/clip.mp4' : `/__mock/assets/${look}.jpg`;
      update(taskId, { state: 'waiting', credits, waitStartedAt: Date.now(), expectedSeconds: DRY_SECONDS }, { path: canned });
      console.log(`[realgen] dry ${taskId} ${type} → ${d.model} ${credits} cr (would create)`);
      await sleep(DRY_SECONDS * 1000);
      update(taskId, { state: 'succeeded' });
      return;
    }

    reserved.set(taskId, { session: run.session, mode: run.mode, credits });
    stage = 'submit';
    // On disk before the paid call: from here on a restart marks the task
    // failed and never resubmits it.
    if (!update(taskId, { state: 'submitted', credits })) {
      reserved.delete(taskId);
      return;
    }
    console.log(`[realgen] submit ${taskId} ${type} → ${d.model} ${credits} cr "${short(d.prompt)}"`);
    let job;
    try {
      job = await hf.create(args, rawFile(taskId, 'create'));
    } catch (err) {
      reserved.delete(taskId);
      forgetUploads(mediaIds);
      record('error', run, { error: err.message, stage, credits });
      fail(run, err.message, `Raw reply: ${rawFile(taskId, 'create')}. Check \`higgsfield generate list\` before running again.`);
      return;
    }
    run.jobId = job.id;
    try {
      update(taskId, { jobId: job.id }); // the id is on disk before anything else happens
    } finally {
      record('submit', run, { hfModel: d.model, args, credits, jobId: job.id }); // spent, whatever happens next
      reserved.delete(taskId);
    }
    console.log(`[realgen] job ${taskId} ${job.id} (${job.status ?? 'no status'})`);

    await follow(run, job.status === 'completed' && typeof job.result_url === 'string' ? job : null);
  } catch (err) {
    reserved.delete(taskId);
    const message = String(err?.message ?? err).slice(0, 300);
    record('error', run, { error: message, stage, ...(run.jobId ? { jobId: run.jobId } : {}) });
    fail(run, message, run.jobId ? getHint(run.jobId) : stage === 'submit' ? ledgerHint() : NOT_CHARGED);
  }
}

/**
 * Waits on a submitted job (free) and fetches its result; the only path a
 * restart takes. `done` is a job create already reported completed.
 */
async function follow(run, done = null) {
  let stage = 'wait';
  try {
    let job = done;
    if (!job) {
      update(run.taskId, { state: 'waiting', waitStartedAt: Date.now() });
      job = await waitThroughOutages(run);
    }
    if (job.status !== 'completed' || typeof job.result_url !== 'string') {
      const why = typeof job.error === 'string' ? job.error : job.error?.message ?? (job.error ? JSON.stringify(job.error) : '');
      const message = `Higgsfield job ${run.jobId} ended with status ${job.status ?? 'unknown'}${why ? `: ${why}` : ''}`;
      record('result', run, { jobId: run.jobId, status: job.status ?? null, error: message.slice(0, 300) });
      fail(run, message, `Inspect it with \`higgsfield generate get ${run.jobId}\`.`);
      return;
    }
    stage = 'download';
    await finish(run, job.result_url);
  } catch (err) {
    const message = String(err?.message ?? err).slice(0, 300);
    record('error', run, { error: message, stage, jobId: run.jobId });
    fail(run, message, getHint(run.jobId));
  }
}

/** A wait or download error that says nothing about the job: the network or the CLI's own call dropped. */
const TRANSIENT = /no response|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|socket hang up|network|timed? ?out|fetch failed|5\d\d/i;
/** How long a dropped connection is waited out before the task is failed (waiting is free). */
const OUTAGE_MS = 45 * 60_000;

/**
 * `hf.wait`, retried through outages: a paid job keeps running at Higgsfield
 * while our connection is down, so a transient error waits and asks again
 * (10 s, doubling to 2 min) instead of failing the task (2026-10-29: a DNS
 * drop failed a finished 110-credit 4K clip).
 */
async function waitThroughOutages(run) {
  const started = Date.now();
  for (let pause = 10_000; ; pause = Math.min(pause * 2, 120_000)) {
    try {
      return await hf.wait(run.jobId, rawFile(run.taskId, 'wait'));
    } catch (err) {
      const message = String(err?.message ?? err);
      if (!TRANSIENT.test(message) || Date.now() - started > OUTAGE_MS) throw err;
      console.warn(`[realgen] wait ${run.taskId}: ${message.slice(0, 120)}; asking again in ${pause / 1000}s`);
      await sleep(pause);
    }
  }
}

/** Downloads the result into storage/realgen/results/ and marks the task done. */
async function finish(run, url) {
  update(run.taskId, { state: 'downloading', resultUrl: url });
  const { file, path: mockPath } = resultPathFor(run.taskId, url, env.dirs.STORAGE_DIR);
  for (let attempt = 1; ; attempt++) {
    try {
      await hf.download(url, file);
      break;
    } catch (err) {
      if (attempt >= 6 || !TRANSIENT.test(String(err?.message ?? err))) throw err;
      await sleep(Math.min(2000 * 2 ** attempt, 60_000));
    }
  }
  const size = run.family === 'image' ? await imageSize(file) : null;
  update(run.taskId, { state: 'succeeded', ...(size ?? {}) }, { path: mockPath });
  record('result', run, { jobId: run.jobId, status: 'completed', resultUrl: url, path: mockPath });
  console.log(`[realgen] done ${run.taskId} ${run.type} → ${run.model} ${run.credits ?? '?'} cr ${mockPath}`);
}

/** After a restart: follow a known job id, else fail the task. Never resubmits. */
export function resume(task) {
  if (running.has(task.id)) return running.get(task.id);
  const r = task.real;
  const run = {
    taskId: task.id,
    type: task.type,
    session: r.session ?? session(),
    mode: r.mode ?? runMode(),
    family: r.family ?? task.family,
    model: r.model,
    credits: r.credits,
    jobId: r.jobId,
  };
  if (r.jobId) {
    record('resume', run, { jobId: r.jobId });
    console.log(`[realgen] resume ${task.id} ${task.type} → job ${r.jobId}`);
    return track(task.id, follow(run));
  }
  if (r.mode === 'dry' && r.state === 'waiting' && task.path) {
    update(task.id, { state: 'succeeded' }); // a dry run's result is already in place
  } else if (r.mode !== 'dry' && (r.state === 'submitted' || r.state === 'waiting' || r.state === 'downloading')) {
    record('error', run, { error: RESTART_BEFORE_ID, stage: 'resume' });
    fail(run, RESTART_BEFORE_ID, `Raw reply (if any): ${rawFile(task.id, 'create')}.`);
  } else {
    record('error', run, { error: RESTART_BEFORE_SUBMIT, stage: 'resume' });
    fail(run, RESTART_BEFORE_SUBMIT, NOT_CHARGED);
  }
  return undefined;
}

// ---------------------------------------------------------------- stub hooks

/**
 * Once: file locations, the banner, and on the harness resume() for every
 * unfinished run. Desktop passes `budget` (the owner's credits a day) and
 * `providerActive` (is Higgsfield the owner's provider), and resumes in tasks.js,
 * which waits for the sealed keys every provider's resume may need.
 */
export function boot({ getState, persist, mockOrigin, dirs, storagePath, lookFromPrompt, budget: dailyBudget, providerActive }) {
  if (env) return;
  const dir = path.join(dirs.STORAGE_DIR, 'realgen');
  env = {
    getState,
    persist,
    mockOrigin,
    dirs,
    storagePath,
    lookFromPrompt,
    budget: dailyBudget,
    providerActive,
    ledger: path.join(dirs.STORAGE_DIR, 'higgsfield-ledger.jsonl'),
    uploads: path.join(dir, 'uploads.json'),
    inputs: path.join(dir, 'inputs'),
    jobs: path.join(dir, 'jobs'),
  };
  try {
    fs.mkdirSync(path.dirname(env.ledger), { recursive: true });
    fs.closeSync(fs.openSync(env.ledger, 'a')); // the ledger exists from the first boot
  } catch (err) {
    console.warn(`[realgen] cannot open the ledger: ${err.message}`);
  }
  // Desktop has no owner read yet at this point, so a banner would name the defaults.
  if (!providerActive) console.log(`[realgen] mode=${mode()} session=${session()} budget=${budget()}cr`);
  try {
    fs.accessSync(hf.binPath(), fs.constants.X_OK);
  } catch {
    console.warn(`[realgen] no Higgsfield CLI at ${hf.binPath()}; set REAL_GEN_HF_BIN`);
  }
  if (providerActive) return;
  for (const task of Object.values(getState().tasks ?? {})) {
    if (task?.real?.kind !== 'higgsfield' || !ACTIVE.has(task.real.state)) continue;
    try {
      resume(task);
    } catch (err) {
      console.warn(`[realgen] resume ${task.id}: ${err.message}`);
    }
  }
}

/** The TaskSnapshot of a task with a real run (B.3). */
export function snapshotPatch(task, _opts = {}) {
  const r = task.real;
  const now = Date.now();
  let progress = PROGRESS[r.state] ?? 0;
  if (r.state === 'waiting') {
    const seconds = (now - (r.waitStartedAt ?? now)) / 1000;
    progress = 0.3 + 0.6 * Math.min(1, seconds / (r.expectedSeconds > 0 ? r.expectedSeconds : 90));
  }
  if (r.state === 'succeeded') {
    const snap = { id: task.id, done: true, status: 'SUCCEEDED', progress: 1 };
    if (task.path) snap.url = `${origin()}${task.path}`;
    return snap;
  }
  if (r.state === 'failed') {
    return {
      id: task.id,
      done: true,
      status: 'FAILED',
      progress: 1,
      error: r.error ?? 'The Higgsfield run failed.',
      hint: r.hint ?? ledgerHint(),
    };
  }
  return { id: task.id, done: false, status: now - task.createdAt < 500 ? 'PENDING' : 'RUNNING', progress };
}

/** `{ metadata: { size } }` for an artifact whose real size is known, else {}. */
export function artifactMeta(task) {
  const r = task?.real;
  return r?.width > 0 && r?.height > 0 ? { metadata: { size: { width: r.width, height: r.height } } } : {};
}

/** GET /__mock/realgen/status: mode, budget, runs in flight, the last 20 ledger lines. */
export function status() {
  const m = mode();
  if (m === 'off' || !env) return { mode: 'off' };
  const s = session();
  const limit = budget();
  const used = spent(env.ledger, { session: s, mode: m });
  const held = reservedFor({ session: s, mode: m });
  const active = Object.values(env.getState().tasks ?? {})
    .filter((t) => t?.real?.kind === 'higgsfield' && ACTIVE.has(t.real.state))
    .map((t) => ({
      taskId: t.id,
      type: t.type,
      state: t.real.state,
      model: t.real.model ?? null,
      credits: t.real.credits ?? null,
      jobId: t.real.jobId ?? null,
    }));
  return {
    mode: m,
    session: s,
    budget: limit,
    spent: used,
    remaining: Math.max(0, Math.round((limit - used - held) * 100) / 100),
    active,
    recent: readAll(env.ledger).slice(-20),
  };
}
