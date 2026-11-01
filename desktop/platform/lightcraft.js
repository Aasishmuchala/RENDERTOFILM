// media_processing_v2 operation `relight`: LightCraft develops a finished still
// on this computer. It moves tone and colour on the pixels that are there, so a
// relight adds nothing to the picture. The task runs `lightcraft-cli render` and
// succeeds with a PNG kept beside the other results
// (/__mock/storage/realgen/results/<task>.png), or fails with a sentence.
//
// tasks.js turns this on with one statement in resumeAll(), on the line after
// `const tasks = ...`, and createTask's media path needs no other change. Earlier
// would make boot's list late, and a run created meanwhile would be failed as
// abandoned. Not a static import: realgen-dry.test.mjs runs a private copy of bay/
// with neither file beside it.
//
// - createLightcraftProvider({ sidecars }): the provider, in the Provider shape
//   (./providers/types.js). `sidecars` answers resolve() and status(); what else
//   a run needs comes in its `env`. A run is `submitted`, because that is what
//   boot follows, and one the app closed on starts again, free and local.
// - registerLightcraft(providers, sidecars): sets `providers.lightcraft` and sends
//   the `relight` operation to it from `providers.ffmpeg`, which keeps every other.
// - stopLightcraft(): ends every render in this process.
//
// Nothing here uses a shell: the CLI is spawned with an argument array, so paths
// with spaces and Windows paths work as they are.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { ASSETS_DIR, STORAGE_DIR, UPLOADS_DIR, mockOrigin as platformOrigin } from './bay/paths.js';
import { storagePath as platformStoragePath } from './bay/storage.js';
import { localFileForUrl, resultPathFor } from './realgen/files.js';

const OPERATION = 'relight';
const TOOL = 'lightcraft';
const ASSET_ID = /^(.+)-artifact-\d+$/;

const UNSUPPORTED = 'This kind of video processing is not available in the desktop app.';
const NOT_INSTALLED = 'LightCraft is not installed. Add it under Settings, Power tools.';
const UNKNOWN_PRESET = 'That relight preset is not available.';
const MISSING_STILL = "That still's file is no longer on this computer.";
const STOPPED = 'LightCraft stopped before it finished. Try it again.';
const TIMED_OUT = 'The relight took too long and was stopped. Try it again.';
const INTERRUPTED = 'This relight was interrupted. Start it again.';
const DAMAGED = 'The relit picture came out damaged, so it was not kept. Try it again.';
const TIMEOUT_MS = 10 * 60 * 1000;
const ERROR_CHARS = 300;
/** `<task>.<12 hex>.tmp.png`, the name of one attempt. */
const TEMP_NAME = /\.[0-9a-f]{12}\.tmp\.png$/;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// 0.16.0 has no presets by these names (its own are `lc.<id>`), so each is the
// develop controls that make it, sent as `render --set`. Only light, white balance
// and colour: rendered files read `wb.temp` relative to 6500, which is as shot.
const PRESETS = {
  'soft-overcast': { 'wb.temp': 6200, 'light.contrast': -18, 'light.highlights': -35, 'light.shadows': 28, 'color.saturation': -6 },
  'golden-low': { 'wb.temp': 7400, 'wb.tint': 8, 'light.exposure': -0.1, 'light.contrast': 8, 'light.highlights': -30, 'light.shadows': 16, 'color.vibrance': 12 },
  'blue-hour': { 'wb.temp': 5300, 'wb.tint': 6, 'light.exposure': -0.55, 'light.contrast': 6, 'light.highlights': -25, 'light.shadows': 18, 'color.saturation': -10 },
  'studio-neutral': { 'wb.temp': 6500, 'wb.tint': 0, 'light.contrast': 4, 'light.highlights': -14, 'light.shadows': 14 },
};

/**
 * The `render` command, as 0.16.0 spells it in its own usage text (`-o`, `--set`,
 * `--opt`). `longEdge=0` is full size, and `bitDepth` follows the `.png` of `output`.
 */
function renderArgs(input, output, parameters) {
  const controls = Object.entries(PRESETS[parameters.preset]).flatMap(([control, value]) => ['--set', `${control}=${value}`]);
  return ['render', input, '-o', output, ...controls, '--opt', `longEdge=${parameters.longEdge ?? 0}`, '--opt', `bitDepth=${parameters.bitDepth ?? 16}`];
}

/** `{ width, height }` of a PNG, from the header every one opens with. */
function pngSize(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a png');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** A relight failure whose message is already fit to show. */
class RelightError extends Error {}

/**
 * What a failed run said last, as the task's error. The CLI's own name is noise there,
 * and it names `files` by their whole paths, which are this computer's, not the user's.
 */
function saidLast(text, files) {
  const line = text.split(/\r?\n/).filter((l) => l.trim()).pop()?.trim().replace(/^lightcraft-cli:\s*/, '');
  if (!line) return STOPPED;
  const named = files.reduce((said, file) => said.replaceAll(file, path.basename(file)), line);
  return `LightCraft stopped: ${named.slice(-ERROR_CHARS)}`;
}

const liveRuns = new Set();

/**
 * Stops every render in this process. Its file is only an attempt, so nothing is
 * lost, and the stop is SIGKILL: a tool that ignored SIGTERM would hold the quit.
 */
export function stopLightcraft() {
  for (const child of liveRuns) child.kill('SIGKILL');
}

/**
 * Runs the CLI to its end; any other ending rejects with one sentence. `timeoutMs`
 * stops a run that goes on too long. Output is drained or the CLI would block on it.
 * Windows rejects a `.cmd` by throwing. `files` are the paths in `args`, for saidLast.
 */
function runCli(bin, args, timeoutMs, files) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      reject(new RelightError(STOPPED));
      return;
    }
    liveRuns.add(child);
    let said = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.resume();
    child.stderr.on('data', (chunk) => {
      said = `${said}${chunk.toString('utf8')}`.slice(-(ERROR_CHARS * 4));
    });
    // 'close' follows when the program could not start, so the ending is settled there.
    child.on('error', () => undefined);
    child.on('close', (code) => {
      clearTimeout(timer);
      liveRuns.delete(child);
      if (timedOut) reject(new RelightError(TIMED_OUT));
      else if (code === 0) resolve();
      else reject(new RelightError(saidLast(said, files)));
    });
  });
}

/** The PNG at `file`, read back; a CLI that says it worked is not taken at its word. */
async function readBack(file) {
  try {
    return pngSize(await fsp.readFile(file));
  } catch {
    throw new RelightError(DAMAGED);
  }
}

/**
 * `sidecars`: resolve(id) and status(id) (./sidecars.js). The defaults are the
 * platform's own folders and origin, and ten minutes for one render.
 */
export function createLightcraftProvider({
  sidecars,
  dirs = { ASSETS_DIR, STORAGE_DIR, UPLOADS_DIR },
  storagePath = platformStoragePath,
  mockOrigin = platformOrigin,
  timeoutMs = TIMEOUT_MS,
}) {
  /** One state change, on disk at once. A save that fails is logged: the run goes on, as ffmpeg's does. */
  function update(task, real, env) {
    task.real = { ...task.real, ...real };
    try {
      env.persist();
    } catch (err) {
      console.warn(`[lightcraft] could not save tasks: ${err?.message ?? err}`);
    }
  }

  /** The file behind `input`, an asset id of a task here or a URL this app handed out, or the missing-still sentence. */
  async function fileOfInput(input, env) {
    const text = String(input ?? '');
    const asset = ASSET_ID.exec(text);
    const served = asset ? env.getState().tasks[asset[1]]?.path : text;
    const file = served ? localFileForUrl(served, dirs, storagePath) : null;
    const found = file ? await fsp.stat(file).then((st) => st.isFile(), () => false) : false;
    if (!found) throw new RelightError(MISSING_STILL);
    return file;
  }

  /** The pinned CLI's path; any other copy is refused with what status() found. */
  async function pinnedCli() {
    const found = await sidecars.status(TOOL);
    if (!found.ok) throw new RelightError(found.installed ? found.message : NOT_INSTALLED);
    return found.path;
  }

  async function relight(task, options, env) {
    const parameters = options.parameters ?? {};
    const input = await fileOfInput(parameters.input, env);
    const bin = await pinnedCli();
    const out = resultPathFor(task.id, 'x.png', dirs.STORAGE_DIR);
    await fsp.mkdir(path.dirname(out.file), { recursive: true });
    const temp = out.file.replace(/\.png$/, `.${randomBytes(6).toString('hex')}.tmp.png`);
    update(task, { attempt: path.basename(temp) }, env);
    try {
      await runCli(bin, renderArgs(input, temp, parameters), timeoutMs, [input, temp]);
      const size = await readBack(temp);
      await fsp.rename(temp, out.file);
      task.path = out.path;
      update(task, { state: 'succeeded', options: undefined, attempt: undefined, ...size }, env);
    } catch (err) {
      await fsp.rm(temp, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  /** Before a run starts again: the file of its last attempt goes. */
  async function clearAttempt(task) {
    const name = String(task.real.attempt);
    if (!TEMP_NAME.test(name)) return;
    const folder = path.dirname(resultPathFor('x', 'x.png', dirs.STORAGE_DIR).file);
    await fsp.rm(path.join(folder, path.basename(name)), { force: true }).catch(() => undefined);
  }

  function start(task, options, env) {
    // Kept while the run is unfinished, so a restart can run it again from the start.
    const kept = { operation: options.operation, parameters: options.parameters };
    update(task, { kind: 'lightcraft', state: 'submitted', error: undefined, notes: [], options: kept }, env);
    return relight(task, options, env).catch((err) => {
      console.warn(`[lightcraft] failed ${task.id}: ${err?.message ?? err}`);
      const error = err instanceof RelightError ? err.message : STOPPED;
      update(task, { state: 'failed', options: undefined, attempt: undefined, error }, env);
    });
  }

  return {
    id: 'lightcraft',
    name: 'LightCraft',

    supports(_type, options) {
      if (options?.operation !== OPERATION) return { ok: false, reason: UNSUPPORTED };
      if (!Object.hasOwn(PRESETS, options.parameters?.preset ?? '')) return { ok: false, reason: UNKNOWN_PRESET };
      return sidecars.resolve(TOOL) ? { ok: true, notes: [] } : { ok: false, reason: NOT_INSTALLED };
    },

    start,

    /** At boot: a relight that was running when the app closed starts again. */
    async resume(task, env) {
      const r = task?.real;
      if (r?.kind !== 'lightcraft' || r.state !== 'submitted') return;
      await clearAttempt(task);
      if (!r.options) {
        update(task, { state: 'failed', error: INTERRUPTED }, env);
        return;
      }
      await start(task, r.options, env);
    },

    /** The TaskSnapshot of a relight. */
    snapshot(task) {
      const r = task.real ?? {};
      if (r.state === 'succeeded') return { id: task.id, done: true, status: 'SUCCEEDED', progress: 1, url: `${mockOrigin()}${task.path}` };
      if (r.state === 'failed') return { id: task.id, done: true, status: 'FAILED', progress: 1, error: r.error ?? STOPPED };
      return { id: task.id, done: false, status: 'RUNNING', progress: 0 };
    },

    /** `{ metadata: { size } }` once the file has been read. */
    artifactMeta(task) {
      const r = task?.real;
      return r?.state === 'succeeded' ? { metadata: { size: { width: r.width, height: r.height } } } : {};
    },
  };
}

/** What tasks.js's resumeAll() calls (see the top of this file). */
export function registerLightcraft(providers, sidecars) {
  const lightcraft = createLightcraftProvider({ sidecars });
  // tasks.js stops ffmpeg by name before it exits; this line stands in for that here.
  process.once('exit', stopLightcraft);
  const { ffmpeg } = providers;
  const isRelight = (options) => options?.operation === OPERATION;
  providers.lightcraft = lightcraft;
  providers.ffmpeg = {
    ...ffmpeg,
    supports: (type, options) => (isRelight(options) ? lightcraft : ffmpeg).supports(type, options),
    start: (task, options, env) => (isRelight(options) ? lightcraft : ffmpeg).start(task, options, env),
  };
}
