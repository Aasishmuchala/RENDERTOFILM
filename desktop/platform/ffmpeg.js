// media_processing_v2 on this computer: the Edit tab's export, trim and stitch
// and the Close-ups tab's frame capture run through ffmpeg, whichever
// generation provider the owner picked. A task is queued, runs, then succeeds
// with an H.264 file kept beside the other results
// (/__mock/storage/realgen/results/<task>.mp4), or with one JPEG per
// requested time under /__mock/storage/realgen/results/<task>/, or fails with
// a sentence. Nothing here uses a shell: ffmpeg is spawned with an argument
// array, so paths with spaces and Windows paths work as they are.
//
// - ffmpegPath(): RTF_FFMPEG, else the bundled ffmpeg-static, else `ffmpeg`.
// - probe(file): { seconds, width, height, fps } read from ffmpeg's own output.
// - createFfmpegProvider(): start / snapshot / artifacts / artifactMeta /
//   resume in the Provider shape (task.real.kind = 'ffmpeg').
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { localFileForUrl, resultPathFor } from './realgen/files.js';

// Not `require`: the server bundle's banner already declares that name.
const nodeRequire = createRequire(import.meta.url);

export const MISSING_CLIP = "That clip's file is no longer on this computer.";
const UNSUPPORTED = 'This kind of video processing is not available in the desktop app.';
const TIMED_OUT = 'The export took too long and was stopped. Try it again.';

const OPERATIONS = new Set(['trim', 'timeline_export', 'stitch', 'capture_frames']);
const TIMEOUT_MS = 30 * 60 * 1000;
const MAX_PARALLEL = 2;
const ERROR_CHARS = 300;

// ---------------------------------------------------------------- binary

/** `app.asar` -> `app.asar.unpacked` (either slash), so a packed binary can be run. */
export function unpackedPath(file) {
  return String(file).replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked');
}

/** RTF_FFMPEG, else the bundled ffmpeg-static (unpacked from the asar), else `ffmpeg` on PATH. */
export function ffmpegPath() {
  const own = process.env.RTF_FFMPEG?.trim();
  if (own) return own;
  try {
    const bundled = nodeRequire('ffmpeg-static');
    if (typeof bundled === 'string' && bundled) return unpackedPath(bundled);
  } catch {
    // not installed here: fall through to PATH
  }
  return 'ffmpeg';
}

// ---------------------------------------------------------------- running ffmpeg

/** An ffmpeg failure whose message is already fit to show. */
class FfmpegError extends Error {}

const STATS_LINE = /^\s*(?:frame|size)=/;
const TIME = /time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;

const liveRuns = new Set();

/** Stops every encode in this process, for main's quit: left alone, one would outlive the server. */
export function stopFfmpeg() {
  for (const child of liveRuns) child.kill();
}

/**
 * Runs ffmpeg with `args`. `onTime(seconds)` hears each progress line; on a
 * failure the rejection carries the last 300 characters of what ffmpeg said
 * (never the command line). `timeoutMs` kills a run that goes on too long.
 */
function runFfmpeg(bin, args, { onTime, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      reject(new FfmpegError(`ffmpeg could not be started (${err?.code ?? 'error'}).`));
      return;
    }
    liveRuns.add(child);
    child.on('close', () => liveRuns.delete(child));
    let pending = '';
    let tail = '';
    let timedOut = false;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const line = (text) => {
      const t = TIME.exec(text);
      if (t && STATS_LINE.test(text)) {
        onTime?.(Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]));
      } else if (text.trim()) {
        tail = `${tail} ${text.trim()}`.slice(-ERROR_CHARS);
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      pending += chunk.toString('utf8');
      const parts = pending.split(/[\r\n]+/);
      pending = parts.pop() ?? '';
      parts.forEach(line);
    });
    child.on('error', (err) =>
      finish(reject, new FfmpegError(`ffmpeg could not be started (${err?.code ?? 'error'}).`))
    );
    child.on('close', (code) => {
      if (pending) line(pending);
      if (timedOut) return finish(reject, new FfmpegError(TIMED_OUT));
      if (code === 0) return finish(resolve);
      finish(reject, new FfmpegError(tail.trim() || `ffmpeg stopped with code ${code}.`));
    });
  });
}

/** Collected stderr of a short ffmpeg run (probe). */
function captureStderr(bin, args) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      reject(new FfmpegError(`ffmpeg could not be started (${err?.code ?? 'error'}).`));
      return;
    }
    let text = '';
    child.stderr.on('data', (c) => {
      text = (text + c.toString('utf8')).slice(-100000);
    });
    child.on('error', (err) => reject(new FfmpegError(`ffmpeg could not be started (${err?.code ?? 'error'}).`)));
    child.on('close', () => resolve(text));
  });
}

/**
 * `{ seconds, width, height, fps }` of a video file, read from the lines
 * ffmpeg prints about its input. One frame is decoded and the rest is not
 * read, so a long 4K file probes in a moment.
 */
export async function probe(file, { bin = ffmpegPath() } = {}) {
  const text = await captureStderr(bin, ['-hide_banner', '-nostdin', '-i', file, '-an', '-frames:v', '1', '-f', 'null', '-']);
  if (!/Input #0/.test(text)) {
    throw new FfmpegError(text.trim().split(/\r?\n/).pop()?.slice(-ERROR_CHARS) || 'ffmpeg could not read that file.');
  }
  const d = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(text);
  const seconds = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0;
  const video = text.split(/\r?\n/).find((l) => /Stream #\d+:\d+.*Video:/.test(l)) ?? '';
  // "0x31637661" (a codec tag) has a single digit before the x, so two digits are required.
  const size = /[\s,](\d{2,6})x(\d{2,6})(?=[\s,[])/.exec(video);
  const rate = /([\d.]+)\s+fps/.exec(video) ?? /([\d.]+)\s+tbr/.exec(video);
  return {
    seconds,
    width: size ? Number(size[1]) : 0,
    height: size ? Number(size[2]) : 0,
    fps: rate ? Number(rate[1]) : 0,
  };
}

// ---------------------------------------------------------------- graphs

const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : fallback);
const sec = (n) => String(Math.round(n * 1000) / 1000);

/** A positive even size (H.264 4:2:0 needs it), else the default. */
function evenSize(n, fallback) {
  const v = Math.floor(num(n, 0));
  return v >= 2 ? v - (v % 2) : fallback;
}

/** A frame rate for the fps filter; the NTSC rates keep their exact fractions. */
function fpsArg(n, fallback) {
  const v = num(n, 0);
  if (!(v >= 1 && v <= 240)) return String(fallback);
  for (const [near, exact] of [[23.976, '24000/1001'], [29.97, '30000/1001'], [59.94, '60000/1001']]) {
    if (Math.abs(v - near) < 0.01) return exact;
  }
  return sec(v);
}

/** Every clip is brought to one size, shape and frame rate so they join cleanly. */
function normalise(width, height, fps) {
  return (
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p,settb=AVTB`
  );
}

const ENCODE = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an'];

// ---------------------------------------------------------------- provider

/**
 * dirs: { ASSETS_DIR, UPLOADS_DIR, STORAGE_DIR }. storagePath, when given,
 * maps a storage key to its file (the platform's own). lookupTaskPath(taskId)
 * is the `/__mock/...` path a finished task's file is served at. persist()
 * saves tasks.json. The optional ones: ffmpeg (a path, else ffmpegPath()),
 * mockOrigin() for result URLs, maxParallel (2) and timeoutMs (30 minutes).
 */
export function createFfmpegProvider({
  dirs,
  storagePath,
  lookupTaskPath,
  persist,
  ffmpeg,
  mockOrigin = () => `http://localhost:${process.env.PORT ?? 3000}`,
  maxParallel = MAX_PARALLEL,
  timeoutMs = TIMEOUT_MS,
}) {
  const running = new Map(); // task id -> its run
  const waiting = [];
  let active = 0;

  const bin = () => ffmpeg ?? ffmpegPath();

  async function acquire() {
    if (active < maxParallel) {
      active += 1;
      return;
    }
    await new Promise((resolve) => waiting.push(resolve));
  }
  function release() {
    const next = waiting.shift();
    if (next) next(); // the slot passes straight on
    else active -= 1;
  }

  function save() {
    try {
      persist?.();
    } catch (err) {
      console.warn(`[ffmpeg] could not save tasks: ${err?.message ?? err}`);
    }
  }
  function update(task, real, top) {
    if (top) Object.assign(task, top);
    task.real = { ...task.real, ...real };
    save();
  }

  /** The file behind `<taskId>-artifact-<n>`, or the missing-clip sentence. */
  async function fileOfAsset(assetId) {
    const taskId = String(assetId ?? '').replace(/-artifact-\d+$/, '');
    const served = taskId ? lookupTaskPath?.(taskId) : null;
    const file = served ? localFileForUrl(served, dirs, storagePath) : null;
    if (!file) throw new FfmpegError(MISSING_CLIP);
    try {
      if (!(await fsp.stat(file)).isFile()) throw new Error('not a file');
    } catch {
      throw new FfmpegError(MISSING_CLIP);
    }
    return file;
  }

  async function probeClip(file) {
    try {
      return await probe(file, { bin: bin() });
    } catch (err) {
      if (err?.message?.includes('could not be started')) throw err;
      throw new FfmpegError('That clip could not be read.');
    }
  }

  /** `{ args, seconds }`: everything between the global flags and the output file. */
  async function plan(operation, options) {
    const p = options.parameters ?? {};
    if (operation === 'trim') {
      const file = await fileOfAsset(options.input?.[0]);
      const start = num(p.start, NaN);
      const end = num(p.end, NaN);
      if (!(start >= 0) || !(end > start)) throw new FfmpegError('That cut has no length.');
      return { args: ['-ss', sec(start), '-to', sec(end), '-i', file], seconds: end - start };
    }

    if (operation === 'timeline_export') {
      const clips = Array.isArray(p.clips) ? p.clips : [];
      if (!clips.length) throw new FfmpegError('There is nothing to export.');
      const width = evenSize(p.width, 1920);
      const height = evenSize(p.height, 1080);
      const chain = normalise(width, height, fpsArg(p.fps, 24));
      const args = [];
      const filters = [];
      let seconds = 0;
      for (const [i, clip] of clips.entries()) {
        const file = await fileOfAsset(clip?.assetId);
        const from = num(clip?.sourceStart, 0);
        const length = num(clip?.duration, 0);
        if (!(from >= 0) || !(length > 0)) throw new FfmpegError('A clip in the timeline has no length.');
        args.push('-ss', sec(from), '-t', sec(length), '-i', file);
        filters.push(`[${i}:v]${chain}[v${i}]`);
        seconds += length;
      }
      const joined = clips.map((_, i) => `[v${i}]`).join('');
      filters.push(`${joined}concat=n=${clips.length}:v=1:a=0[out]`);
      return { args: [...args, '-filter_complex', filters.join(';'), '-map', '[out]'], seconds };
    }

    // stitch
    const ids = Array.isArray(options.input) ? options.input : [];
    if (!ids.length) throw new FfmpegError('There is nothing to join.');
    const files = [];
    for (const id of ids) files.push(await fileOfAsset(id));
    const infos = [];
    for (const file of files) infos.push(await probeClip(file));
    const lengths = infos.map((i) => i.seconds);
    const inputs = files.flatMap((f) => ['-i', f]);
    if (files.length === 1) return { args: inputs, seconds: lengths[0] };
    if (lengths.some((l) => !(l > 0))) throw new FfmpegError('That clip could not be read.');

    const first = infos[0];
    const chain = normalise(evenSize(first.width, 1920), evenSize(first.height, 1080), fpsArg(first.fps, 24));
    const filters = files.map((_, i) => `[${i}:v]${chain}[v${i}]`);
    const wanted = num(p.transition?.duration, p.transition ? 0.5 : 0);
    if (!(wanted > 0)) {
      filters.push(`${files.map((_, i) => `[v${i}]`).join('')}concat=n=${files.length}:v=1:a=0[out]`);
      return {
        args: [...inputs, '-filter_complex', filters.join(';'), '-map', '[out]'],
        seconds: lengths.reduce((s, l) => s + l, 0),
      };
    }
    const upper = Math.min(4.9, Math.min(...lengths) - 0.05);
    if (upper < 0.1) throw new FfmpegError('A clip is too short to join with a fade.');
    const d = sec(Math.min(upper, Math.max(0.1, wanted)));
    let prev = 'v0';
    let covered = lengths[0];
    for (let k = 1; k < files.length; k += 1) {
      const label = k === files.length - 1 ? 'out' : `x${k}`;
      filters.push(`[${prev}][v${k}]xfade=transition=fade:duration=${d}:offset=${sec(covered - Number(d))}[${label}]`);
      covered += lengths[k] - Number(d);
      prev = label;
    }
    return { args: [...inputs, '-filter_complex', filters.join(';'), '-map', '[out]'], seconds: covered };
  }

  /** Encodes one H.264 file for trim, timeline_export or stitch. */
  async function encode(task, operation, options) {
    const { args, seconds } = await plan(operation, options);
    update(task, { expectedSeconds: Math.round(seconds * 1000) / 1000 });
    const out = resultPathFor(task.id, 'x.mp4', dirs.STORAGE_DIR);
    await fsp.mkdir(path.dirname(out.file), { recursive: true });
    try {
      await runFfmpeg(bin(), ['-y', '-hide_banner', '-nostdin', '-loglevel', 'error', '-stats', ...args, ...ENCODE, out.file], {
        timeoutMs,
        onTime: (t) => {
          // progress is only read in memory; the file is saved on state changes
          task.real.progress = Math.max(0, Math.min(0.99, t / Math.max(0.1, seconds)));
        },
      });
    } catch (err) {
      await fsp.rm(out.file, { force: true }).catch(() => undefined);
      throw err;
    }
    let meta = {};
    try {
      const o = await probe(out.file, { bin: bin() });
      meta = { width: o.width, height: o.height, duration: o.seconds, frameRate: o.fps };
    } catch {
      meta = { duration: seconds }; // the file is good; only its details are unknown
    }
    update(task, { state: 'succeeded', progress: 1, options: undefined, ...meta }, { path: out.path });
  }

  const nonEmpty = (file) =>
    fsp.stat(file).then(
      (st) => st.isFile() && st.size > 0,
      () => false
    );

  /** One full-size JPEG at `time`; a time past the end gives the clip's last frame. */
  async function takeFrame(file, time, target, limit) {
    const head = ['-y', '-hide_banner', '-nostdin', '-loglevel', 'error'];
    const tail = ['-an', '-frames:v', '1', '-q:v', '2', '-update', '1', target];
    try {
      await runFfmpeg(bin(), [...head, '-ss', sec(Math.max(0, time)), '-i', file, ...tail], { timeoutMs: limit });
    } catch (err) {
      if (err?.message === TIMED_OUT) throw err;
      // Seeking past the end decodes nothing (some ffmpeg versions call that an error): take the last frame instead.
    }
    if (await nonEmpty(target)) return;
    await runFfmpeg(bin(), [...head, '-sseof', '-1', '-i', file, ...tail], { timeoutMs: limit });
    if (!(await nonEmpty(target))) throw new FfmpegError('No picture could be taken from that clip.');
  }

  /** capture_frames: one JPEG per time, at the clip's full size, in the order of `times`. */
  async function capture(task, options) {
    const file = await fileOfAsset(options.input?.[0]);
    const asked = options.parameters?.times;
    const times = Array.isArray(asked) ? asked.map((t) => num(t, NaN)) : [];
    if (!times.length) throw new FfmpegError('There are no frames to take.');
    if (times.some((t) => !Number.isFinite(t))) throw new FfmpegError('Those frame times are not valid.');
    const src = await probeClip(file);
    const base = resultPathFor(task.id, 'x.jpg', dirs.STORAGE_DIR);
    const folder = base.file.slice(0, -'.jpg'.length);
    const served = base.path.slice(0, -'.jpg'.length);
    await fsp.rm(folder, { recursive: true, force: true });
    await fsp.mkdir(folder, { recursive: true });
    const deadline = Date.now() + timeoutMs;
    const frames = [];
    try {
      for (const [i, time] of times.entries()) {
        const left = deadline - Date.now();
        if (left <= 0) throw new FfmpegError(TIMED_OUT);
        const name = `frame-${String(i + 1).padStart(3, '0')}.jpg`;
        await takeFrame(file, time, path.join(folder, name), left);
        frames.push({ path: `${served}/${name}`, time });
        task.real.progress = Math.min(0.99, frames.length / times.length);
      }
    } catch (err) {
      await fsp.rm(folder, { recursive: true, force: true }).catch(() => undefined);
      throw err;
    }
    const size = src.width > 0 && src.height > 0 ? { width: src.width, height: src.height } : {};
    update(task, { state: 'succeeded', progress: 1, options: undefined, frames, ...size }, { path: frames[0].path });
  }

  async function run(task, options) {
    await acquire();
    try {
      update(task, { state: 'running', progress: 0 });
      const operation = options?.operation;
      if (!OPERATIONS.has(operation)) throw new FfmpegError(UNSUPPORTED);
      if (operation === 'capture_frames') await capture(task, options);
      else await encode(task, operation, options);
    } catch (err) {
      const message = String(err instanceof FfmpegError ? err.message : (err?.message ?? err))
        .replace(/\s+/g, ' ')
        .trim()
        .slice(-ERROR_CHARS);
      console.warn(`[ffmpeg] failed ${task.id} ${options?.operation ?? ''}: ${message}`);
      update(task, { state: 'failed', error: message || 'The export failed.', options: undefined, frames: undefined });
    } finally {
      release();
    }
  }

  function start(task, options) {
    const existing = running.get(task.id);
    if (existing) return existing;
    const operation = options?.operation;
    task.real = {
      ...task.real,
      kind: 'ffmpeg',
      state: 'queued',
      progress: 0,
      error: undefined,
      frames: undefined,
      notes: [],
      operation,
      // Kept while the run is unfinished, so a restart can run it again from the start.
      options: { operation, input: options?.input, parameters: options?.parameters },
    };
    save();
    const p = run(task, options ?? {})
      .catch((err) => console.warn(`[ffmpeg] ${task.id}: ${err?.message ?? err}`))
      .finally(() => running.delete(task.id));
    running.set(task.id, p);
    return p;
  }

  function metaOf(task) {
    const r = task?.real;
    if (r?.kind !== 'ffmpeg' || r.state !== 'succeeded') return {};
    const metadata = {};
    if (r.duration > 0) metadata.duration = r.duration;
    if (r.frameRate > 0) metadata.frameRate = r.frameRate;
    if (r.width > 0 && r.height > 0) metadata.size = { width: r.width, height: r.height };
    return Object.keys(metadata).length ? { metadata } : {};
  }

  function artifactsOf(task) {
    const r = task?.real;
    if (r?.kind !== 'ffmpeg' || r.state !== 'succeeded') return [];
    const served = Array.isArray(r.frames) && r.frames.length ? r.frames.map((f) => f.path) : task.path ? [task.path] : [];
    return served.map((p, i) => ({ id: `${task.id}-artifact-${i}`, url: `${mockOrigin()}${p}`, isDirectory: false, ...metaOf(task) }));
  }

  return {
    id: 'ffmpeg',
    name: 'ffmpeg',

    supports(_type, options) {
      return OPERATIONS.has(options?.operation) ? { ok: true, notes: [] } : { ok: false, reason: UNSUPPORTED };
    },

    start,

    /** At boot: a run that was queued or running when the app closed starts again, free and local. */
    resume(task) {
      const r = task?.real;
      if (r?.kind !== 'ffmpeg' || (r.state !== 'queued' && r.state !== 'running')) return Promise.resolve();
      if (!r.options) {
        update(task, { state: 'failed', error: 'This export was interrupted. Start it again.' });
        return Promise.resolve();
      }
      return start(task, r.options);
    },

    /** The TaskSnapshot of an ffmpeg task. */
    snapshot(task) {
      const r = task.real ?? {};
      if (r.state === 'succeeded') {
        const snap = { id: task.id, done: true, status: 'SUCCEEDED', progress: 1 };
        if (task.path) snap.url = `${mockOrigin()}${task.path}`;
        return snap;
      }
      if (r.state === 'failed') {
        return { id: task.id, done: true, status: 'FAILED', progress: 1, error: r.error ?? 'The export failed.' };
      }
      return {
        id: task.id,
        done: false,
        status: r.state === 'running' ? 'RUNNING' : 'PENDING',
        progress: Math.max(0, Math.min(0.99, r.progress ?? 0)),
      };
    },

    /** `{ metadata: { duration, frameRate, size } }` once the file has been read (size only for captured frames). */
    artifactMeta: metaOf,

    /**
     * The task's artifacts, `[]` until it has succeeded: one `{ id, url, isDirectory, metadata? }` for a
     * video, one per requested time for capture_frames, in the order of `times`.
     */
    artifacts: artifactsOf,

    /** Test seam: settles when every run in this process has stopped. */
    idle() {
      return Promise.all([...running.values()]).then(() => undefined);
    },
  };
}
