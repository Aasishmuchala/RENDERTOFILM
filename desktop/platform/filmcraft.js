// media_processing_v2's `conform_otio`: the cut, as OpenTimelineIO, rendered by
// FilmCraft's engine instead of ffmpeg. FilmCraft is a sidecar (./sidecars.js):
// optional, pinned, never required, and bay/tasks.js refuses the operation before
// a task exists when it is not here.
//
// A run has a folder of its own, <results>/<task>/, holding film.otio, script.jsonl
// (what went to the CLI's stdin) and film.mp4 or film.mov. The film goes on the task
// only once it has been read back, so half a film is never served. A run that fails
// leaves no folder, and one the app closed on starts again at the next boot, free
// and local. Nothing here uses a shell: the CLI gets an argument array.
//
// `filmcraft-cli run -` answers on stdout, one JSON object per script line. A line
// that fails says why there and exits 1 with nothing on stderr; a script it cannot
// read says why on stderr and exits 2. It exits 0 even after drawing placeholder
// frames for clips it could not open, and only export's own result says so, which
// is why this reads stdout as well as the exit code: such a film is not the render.
//
// The script's shape and the names in `file.import` and `file.exportMedia` come from
// FilmCraft v0.15.0's source (apps/filmcraft-cli/src/main.rs,
// crates/engine/src/commands.rs) and were checked on the pinned 0.15.0 binary on
// 2026-11-01, as .router/filmcraft-sidecar.test.mjs can again with
// RTF_REAL_FILMCRAFT_BIN; a pin that rejects them fails the run with the CLI's own
// reason (`filmcraft-cli describe file.exportMedia` lists them). The film carries
// only what the OTIO does: src/interchange.ts writes a Video track, so the sound on
// it is a silent stereo track, as the app's own cuts drop their clips' sound. An
// OTIO with no `metadata.filmcraft.settings`,
// which is what src/interchange.ts writes, opens as a 1920x1080 sequence, and the
// import places every clip at that frame's centre before the size can be changed,
// so src/edit-api.ts adds `sequence.settings` with the film's own size and then
// `edit.selectAll` and `clip.fitToFrame`: without the fit the clips stay where the
// import put them (a 1280x720 film comes out off-centre and cropped, with exit 0 and
// nothing in offlineMedia, so nothing here could tell).
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { MISSING_CLIP, artifactDetails, probe, videoFields } from './ffmpeg.js';
import { localFileForUrl, resultPathFor } from './realgen/files.js';

export const NOT_INSTALLED = 'FilmCraft is not installed. Add it under Settings, Power tools.';
const UNSUPPORTED = 'This kind of video processing is not available in the desktop app.';
const BAD_CUT = 'That cut could not be read, so nothing was sent to FilmCraft.';
const BAD_OUTPUT = 'That conform format is not available.';
const BAD_SCRIPT = 'That FilmCraft script is not valid.';
const TIMED_OUT = 'The conform took too long and was stopped. Try it again.';
const STOPPED = 'FilmCraft stopped before it finished. Try it again.';
const NO_FILM = 'FilmCraft finished without writing the film. Try it again.';
const DAMAGED = 'The finished video came out damaged, so it was not kept. Try it again.';
const OFFLINE = 'FilmCraft could not open every clip in this cut, so the film was not kept.';
const NO_SPACE = 'There is not enough disk space to finish this. Free some space and try again.';

const OPERATION = 'conform_otio';
const OTIO_NAME = 'film.otio';
const SCRIPT_NAME = 'script.jsonl';
/** The CLI's own format names. Its `export` guesses these from the extension; `run` does not. */
const FORMATS = { mp4: 'h264', mov: 'prores' };
const TIMEOUT_MS = 30 * 60 * 1000;
/** How long a stopped CLI gets to exit before it is killed outright. */
const STOP_GRACE_MS = 3000;
/** How long the pipes get to empty once the CLI has exited: something it left running can hold them open. */
const DRAIN_MS = 1000;
const LOG_LINES = 200;
const LINE_CHARS = 300;
/** A line still being read: a tool that never prints a newline stops growing here. */
const PENDING_CHARS = 1024 * 1024;
/** What a usage error prints after its reason, so never the reason. */
const USAGE_HINT = /^Run `filmcraft-cli help`/;

/** A failure whose message is already fit to show. */
class ConformError extends Error {}

const liveRuns = new Set();

/** Stops every run in this process, for main's quit: left alone, one would outlive the server. */
export function stopFilmcraft() {
  for (const child of liveRuns) child.kill();
}

/** Every line of `stream` to `onLine`, whole, however the chunks fell. */
function eachLine(stream, onLine) {
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    const parts = `${pending}${chunk}`.split(/[\r\n]+/);
    pending = (parts.pop() ?? '').slice(-PENDING_CHARS);
    parts.forEach(onLine);
  });
  stream.on('end', () => {
    if (pending) onLine(pending);
  });
}

/**
 * `<bin> run -` in `cwd`, with `script` on stdin. `onLine(text, stream)` hears what it
 * prints. It resolves `{ code }`, null for a signal, and rejects with one sentence
 * when the CLI will not start or runs past `timeoutMs`. `close` waits for everything
 * holding the pipes, which can be something the CLI left running, so a run ends without
 * it too: `drainMs` after the CLI exits, and at the hard stop.
 */
function runCli(bin, script, { cwd, timeoutMs, drainMs, onLine }) {
  return new Promise((resolve, reject) => {
    const cannotStart = (err) => new ConformError(`FilmCraft could not be started (${err?.code ?? 'error'}).`);
    let child;
    try {
      child = spawn(bin, ['run', '-'], { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      reject(cannotStart(err));
      return;
    }
    liveRuns.add(child);
    let timedOut = false;
    let settled = false;
    let hardStop;
    let drain;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      hardStop = setTimeout(() => {
        child.kill('SIGKILL');
        finish(reject, new ConformError(TIMED_OUT));
      }, STOP_GRACE_MS);
    }, timeoutMs);
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(hardStop);
      clearTimeout(drain);
      liveRuns.delete(child);
      // Whatever still holds them keeps no file of ours open and writes nothing onto a finished task.
      for (const pipe of child.stdio ?? []) pipe?.destroy();
      fn(value);
    };
    const ended = (code) => (timedOut ? finish(reject, new ConformError(TIMED_OUT)) : finish(resolve, { code }));
    child.on('error', (err) => finish(reject, cannotStart(err)));
    child.on('exit', (code) => {
      if (!settled) drain = setTimeout(ended, drainMs, code);
    });
    child.on('close', ended);
    if (child.stdout) eachLine(child.stdout, (text) => onLine(text, 'stdout'));
    if (child.stderr) eachLine(child.stderr, (text) => onLine(text, 'stderr'));
    // A CLI that exits without reading closes the pipe; its exit is what says why.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(script);
  });
}

/** One of `run`'s result lines, `{ id, ok, error?, result? }`; null for anything else it prints. */
function resultLine(text) {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed?.ok === 'boolean' ? parsed : null;
  } catch {
    return null;
  }
}

/** `{ otio, extra, output }` of a request, or a sentence: the CLI is not worth starting on a bad one. */
function readParameters(parameters) {
  const { otio, script = [], output } = parameters ?? {};
  if (!Object.hasOwn(FORMATS, output ?? '')) throw new ConformError(BAD_OUTPUT);
  try {
    JSON.parse(otio);
  } catch {
    throw new ConformError(BAD_CUT);
  }
  const lines = Array.isArray(script) && script.every((line) => typeof line === 'string' && !/[\r\n]/.test(line));
  if (!lines) throw new ConformError(BAD_SCRIPT);
  return { otio, extra: script, output };
}

/**
 * The lines `run -` reads, one `{"id","params"}` each: the cut, what the caller
 * added, the film. `range: 'entire'`, because an In/Out in the document would
 * otherwise shorten it. FilmCraft opens the OTIO as the active sequence, and the
 * export takes that one.
 */
function scriptFor(film, output, extra) {
  const line = (id, params) => JSON.stringify({ id, params });
  const lines = [
    line('file.import', { paths: [OTIO_NAME] }),
    ...extra,
    line('file.exportMedia', { path: film, format: FORMATS[output], range: 'entire', wait: true }),
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * dirs: { ASSETS_DIR, UPLOADS_DIR, STORAGE_DIR }. lookupTaskPath(taskId) is the
 * `/__mock/...` path a finished task's file is served at. persist() saves tasks.json.
 * sidecars is ./sidecars.js, or a stand-in with its `resolve`. The optional ones:
 * storagePath maps a storage key to its file, mockOrigin() is for result URLs,
 * timeoutMs is 30 minutes, and drainMs is a second.
 */
export function createFilmcraftProvider({
  dirs,
  lookupTaskPath,
  persist,
  sidecars,
  storagePath,
  mockOrigin = () => `http://localhost:${process.env.PORT ?? 3000}`,
  timeoutMs = TIMEOUT_MS,
  drainMs = DRAIN_MS,
}) {
  const running = new Map(); // task id -> its run

  function save() {
    try {
      persist?.();
    } catch (err) {
      console.warn(`[filmcraft] could not save tasks: ${err?.message ?? err}`);
    }
  }
  function update(task, real, top) {
    if (top) Object.assign(task, top);
    task.real = { ...task.real, ...real };
    save();
  }

  /** Where a run keeps its files, and the `/__mock/...` path of that folder. */
  function folderOf(task) {
    const base = resultPathFor(task.id, 'x.mp4', dirs.STORAGE_DIR);
    return { folder: base.file.slice(0, -'.mp4'.length), served: base.path.slice(0, -'.mp4'.length) };
  }

  /** Every clip the cut plays is still here, or the missing-clip sentence: FilmCraft would draw a placeholder for one that is gone. */
  async function checkClips(input) {
    for (const assetId of Array.isArray(input) ? input : []) {
      const taskId = String(assetId ?? '').replace(/-artifact-\d+$/, '');
      const served = taskId ? lookupTaskPath?.(taskId) : null;
      const file = served ? localFileForUrl(served, dirs, storagePath) : null;
      const found = file ? await fsp.stat(file).then((st) => st.isFile(), () => false) : false;
      if (!found) throw new ConformError(MISSING_CLIP);
    }
  }

  /** The `task.real` fields of a finished film; a throw means it is not one. */
  async function readBack(film) {
    const written = await fsp.stat(film).then((st) => st.isFile() && st.size > 0, () => false);
    if (!written) throw new ConformError(NO_FILM);
    const info = await probe(film).catch(() => null);
    if (!(info?.width > 0)) throw new ConformError(DAMAGED);
    return videoFields(info);
  }

  /** Runs the script, keeps what the CLI prints on `task.log`, and throws unless a whole film came out. */
  async function render(task, bin, script, folder) {
    let refused = '';
    let lastError = '';
    let offline = false;
    const onLine = (text, stream) => {
      const line = text.trim();
      if (!line) return;
      task.log.push(line.slice(0, LINE_CHARS));
      if (task.log.length > LOG_LINES) task.log.shift();
      if (stream === 'stderr') {
        if (!USAGE_HINT.test(line)) lastError = line;
        return;
      }
      const result = resultLine(line);
      if (result?.ok === false) refused = String(result.error ?? result.id ?? '');
      if (result?.id === 'file.exportMedia' && result.result?.offlineMedia?.length) offline = true;
    };
    const { code } = await runCli(bin, script, { cwd: folder, timeoutMs, drainMs, onLine });
    if (code !== 0) {
      // The film is named by its whole path, which is this computer's, not the user's.
      const reason = (refused || lastError).replaceAll(`${folder}${path.sep}`, '');
      throw new ConformError(reason ? `FilmCraft stopped: ${reason.slice(0, LINE_CHARS)}` : STOPPED);
    }
    if (offline) throw new ConformError(OFFLINE);
  }

  async function run(task, options) {
    const { folder, served } = folderOf(task);
    try {
      update(task, { state: 'running', progress: 0 }, { log: [] });
      const { otio, extra, output } = readParameters(options.parameters);
      const bin = sidecars.resolve('filmcraft');
      if (!bin) throw new ConformError(NOT_INSTALLED);
      await checkClips(options.input);
      await fsp.rm(folder, { recursive: true, force: true });
      await fsp.mkdir(folder, { recursive: true });
      const film = path.join(folder, `film.${output}`);
      const script = scriptFor(film, output, extra);
      await fsp.writeFile(path.join(folder, OTIO_NAME), otio);
      await fsp.writeFile(path.join(folder, SCRIPT_NAME), script);
      await render(task, bin, script, folder);
      const fields = await readBack(film);
      update(task, { state: 'succeeded', progress: 1, options: undefined, ...fields }, { path: `${served}/film.${output}` });
    } catch (err) {
      const shown = err instanceof ConformError ? err.message : err?.code === 'ENOSPC' ? NO_SPACE : STOPPED;
      console.warn(`[filmcraft] failed ${task.id}: ${String(err?.message ?? err).slice(0, LINE_CHARS)}`);
      await fsp.rm(folder, { recursive: true, force: true }).catch(() => undefined);
      update(task, { state: 'failed', error: shown, options: undefined });
    }
  }

  function start(task, options) {
    const existing = running.get(task.id);
    if (existing) return existing;
    task.real = {
      ...task.real,
      kind: 'filmcraft',
      state: 'queued',
      progress: 0,
      error: undefined,
      notes: [],
      operation: OPERATION,
      // Kept while the run is unfinished, so a restart can run it again from the start.
      options: { operation: OPERATION, input: options?.input, parameters: options?.parameters },
    };
    save();
    const p = run(task, options ?? {})
      .catch((err) => console.warn(`[filmcraft] ${task.id}: ${err?.message ?? err}`))
      .finally(() => running.delete(task.id));
    running.set(task.id, p);
    return p;
  }

  return {
    id: 'filmcraft',
    name: 'FilmCraft',

    supports(_type, options) {
      return options?.operation === OPERATION ? { ok: true, notes: [] } : { ok: false, reason: UNSUPPORTED };
    },

    start,

    /** At boot: a run that was queued or running when the app closed starts again, free and local. */
    async resume(task) {
      const r = task?.real;
      if (r?.kind !== 'filmcraft' || (r.state !== 'queued' && r.state !== 'running')) return;
      if (!r.options) {
        update(task, { state: 'failed', error: 'This conform was interrupted. Start it again.' });
        return;
      }
      await start(task, r.options);
    },

    /** The TaskSnapshot of a conform. */
    snapshot(task) {
      const r = task.real ?? {};
      if (r.state === 'succeeded') {
        const snap = { id: task.id, done: true, status: 'SUCCEEDED', progress: 1 };
        if (task.path) snap.url = `${mockOrigin()}${task.path}`;
        return snap;
      }
      if (r.state === 'failed') {
        return { id: task.id, done: true, status: 'FAILED', progress: 1, error: r.error ?? 'The conform failed.' };
      }
      return {
        id: task.id,
        done: false,
        status: r.state === 'running' ? 'RUNNING' : 'PENDING',
        progress: Math.max(0, Math.min(0.99, r.progress ?? 0)),
      };
    },

    /** `{ metadata: { duration, frameRate, size } }` once the film has been read back. */
    artifactMeta(task) {
      const r = task?.real;
      return r?.kind === 'filmcraft' && r.state === 'succeeded' ? artifactDetails(r) : {};
    },

    /** Test seam: settles when every run in this process has stopped. */
    idle() {
      return Promise.all([...running.values()]).then(() => undefined);
    },
  };
}
