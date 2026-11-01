// media_processing_v2 on this computer: the Edit tab's export, trim and stitch,
// its master and the Close-ups tab's frame capture run through ffmpeg, whichever
// generation provider the owner picked. A task is queued, runs, then succeeds
// with an H.264 file kept beside the other results
// (/__mock/storage/realgen/results/<task>.mp4), or with one JPEG per
// requested time under /__mock/storage/realgen/results/<task>/, or fails with
// a sentence. Nothing here uses a shell: ffmpeg is spawned with an argument
// array, so paths with spaces and Windows paths work as they are.
//
// An encode never writes to its final name. Each attempt writes its own
// <task>.<attempt>.tmp.mp4 beside it, and the file is renamed into place only
// after it has been read back: it decodes to the end, runs the planned length
// and has the planned size. The attempt's pid goes to tasks.json, so a restart
// can stop an encoder that outlived a crashed server.
//
// A master (master.js builds its arguments) is such an encode with more around
// it: the music is measured first (a bed too hot for loudnorm's numbers is turned
// down and measured again), the file is <task>.mp4 or <task>.mov by its
// deliverable, and its QC report goes to <task>.qc.json and the artifact's
// metadata. A title card is one more cut, of a still in storage, at the head or
// the tail. A master that was interrupted starts again from the beginning.
//
// - ffmpegPath(): RTF_FFMPEG, else the bundled ffmpeg-static, else `ffmpeg`.
// - probe(file), probeSync(file): { seconds, width, height, fps } read from
//   ffmpeg's own output; probeSync is for a caller that cannot wait.
// - createFfmpegProvider(): start / snapshot / artifacts / artifactMeta /
//   resume in the Provider shape (task.real.kind = 'ffmpeg').
import { execFile, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { localFileForUrl, resultPathFor } from './realgen/files.js';

// Not `require`: the server bundle's banner already declares that name.
const nodeRequire = createRequire(import.meta.url);

/** Read when a master runs, and only then: realgen-dry.test.mjs runs a private copy of this file with no master.js beside it. */
const masterGraphs = () => import('./master.js');

export const MISSING_CLIP = "That clip's file is no longer on this computer.";
const UNSUPPORTED = 'This kind of video processing is not available in the desktop app.';
const TIMED_OUT = 'The export took too long and was stopped. Try it again.';
const STOPPED = 'The video processing stopped before it finished. Try it again.';
const DAMAGED = 'The finished video came out damaged, so it was not kept. Try it again.';
const NO_SPACE = 'There is not enough disk space to finish this. Free some space and try again.';
const AFTER_END = 'A cut in the timeline starts after its clip ends.';
const MISSING_MUSIC = "That music's file is no longer on this computer.";
const MISSING_CARD = 'That title card is no longer on this computer.';
const CARD_LENGTH = 'A title card runs between 1 and 10 seconds.';
const BAD_MUSIC = 'That music could not be read.';
const SILENT_MUSIC = 'That music is silent where the film plays it, so it cannot be mastered.';
const LOUD_MUSIC = 'That music is too loud at this gain. Turn its gain down.';
const NO_SOUND = 'This film has no sound, so its loudness and true peak were not measured.';

const OPERATIONS = new Set(['trim', 'timeline_export', 'stitch', 'capture_frames', 'master']);
const TIMEOUT_MS = 30 * 60 * 1000;
const MAX_PARALLEL = 2;
const ERROR_CHARS = 300;
/** What a run whose answer is in its log keeps: the end, where ebur128's Summary and loudnorm's block are. */
const OUTPUT_CHARS = 100_000;
const PROBE_MS = 15_000;
/** How long a stopped encoder gets to exit before it is killed outright. */
const STOP_GRACE_MS = 3000;
/** How many times a hot bed is measured, turned down between passes, before the master gives up on it. */
const MEASURE_PASSES = 3;
/** The seconds a title card may run and the fade from or to black it plays with: TITLE_CARD in src/master.ts. */
const CARD_SECONDS = { min: 1, max: 10 };
const CARD_FADE = 0.5;
const NO_ROOM = /ENOSPC|No space left/i;
/** `<task>.<12 hex>.tmp.mp4` (`.mov` for a ProRes master), the name of one attempt. */
const TEMP_NAME = /\.[0-9a-f]{12}\.tmp\.(?:mp4|mov)$/;

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

/** An ffmpeg failure whose message is already fit to show; `detail` goes to the log alone. */
class FfmpegError extends Error {
  constructor(message, detail) {
    super(message);
    this.detail = detail;
  }
}

const STATS_LINE = /^\s*(?:frame|size)=/;
const FRAME = /^\s*frame=\s*(\d+)/;
const TIME = /time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;

const liveRuns = new Set();

/** Stops every encode in this process, for main's quit: left alone, one would outlive the server. */
export function stopFfmpeg() {
  for (const child of liveRuns) child.kill();
}

/**
 * Runs ffmpeg with `args`. `onSpawn(pid)` hears the process start and
 * `onTime(seconds)` each progress line. It resolves `{ seconds, frames, said }`: the
 * last time and frame count reported and whatever ffmpeg printed besides its
 * progress. A failure rejects with one sentence, and the last 300 characters of
 * what ffmpeg said (never the command line) as its `detail`. `timeoutMs` kills a
 * run that goes on too long. `keepOutput` adds `output`, the end of that text line
 * by line, for a run whose answer is in its log.
 */
function runFfmpeg(bin, args, { onSpawn, onTime, timeoutMs = TIMEOUT_MS, keepOutput = false } = {}) {
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
    if (child.pid) onSpawn?.(child.pid);
    let pending = '';
    let tail = '';
    let output = '';
    let reached = 0;
    let frames = 0;
    let timedOut = false;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const line = (text) => {
      if (STATS_LINE.test(text)) {
        frames = Number(FRAME.exec(text)?.[1] ?? frames);
        // A run that produced nothing reports a negative time, or none: that is no progress.
        const t = TIME.exec(text);
        if (!t) return;
        reached = Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]);
        onTime?.(reached);
      } else if (text.trim()) {
        tail = `${tail} ${text.trim()}`.slice(-ERROR_CHARS);
        if (keepOutput) output = `${output}${text}\n`.slice(-OUTPUT_CHARS);
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
    child.on('close', (code, signal) => {
      if (pending) line(pending);
      if (timedOut) return finish(reject, new FfmpegError(TIMED_OUT));
      const said = tail.trim();
      if (code === 0) return finish(resolve, { seconds: reached, frames, said, output });
      finish(reject, new FfmpegError(STOPPED, said || `ffmpeg stopped by ${signal ?? `code ${code}`}`));
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

const probeArgs = (file) => ['-hide_banner', '-nostdin', '-i', file, '-an', '-frames:v', '1', '-f', 'null', '-'];

const videoLine = (text) => text.split(/\r?\n/).find((l) => /Stream #\d+:\d+.*Video:/.test(l)) ?? '';

/** What ffmpeg's lines about its input say, null when it found no input. */
function readProbe(text) {
  if (!/Input #0/.test(text)) return null;
  const d = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(text);
  const seconds = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0;
  const video = videoLine(text);
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

/**
 * The colour tags on ffmpeg's video line, `yuv420p(tv, bt709, progressive)`, with
 * `a/b/c` for a matrix, primaries and transfer that differ; what is not there stays
 * undefined. ProRes has no range field, so ffmpeg 6 prints none: it is always limited.
 */
function readColour(text) {
  const video = videoLine(text);
  const parts = (/,\s*\w+\(([^)]*)\)/.exec(video)?.[1] ?? '').split(',').map((part) => part.trim());
  const range = parts.find((part) => part === 'tv' || part === 'pc');
  const names = parts.find((part) => part && part !== range && !/progressive|first/.test(part));
  const [colorspace, primaries = colorspace, trc = colorspace] = names?.split('/') ?? [];
  return { colorspace, primaries, trc, range: range ?? (/Video: prores/.test(video) ? 'tv' : undefined) };
}

/**
 * `{ seconds, width, height, fps }` of a video file, read from the lines
 * ffmpeg prints about its input. One frame is decoded and the rest is not
 * read, so a long 4K file probes in a moment.
 */
export async function probe(file, { bin = ffmpegPath() } = {}) {
  const text = await captureStderr(bin, probeArgs(file));
  const info = readProbe(text);
  if (!info) throw new FfmpegError(text.trim().split(/\r?\n/).pop()?.slice(-ERROR_CHARS) || 'ffmpeg could not read that file.');
  return info;
}

/** `probe` for a caller that cannot wait (an artifact's metadata is read in one go): null when the file cannot be read. */
export function probeSync(file, { bin = ffmpegPath() } = {}) {
  const run = spawnSync(bin, probeArgs(file), {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    encoding: 'utf8',
    timeout: PROBE_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
  return run.error ? null : readProbe(run.stderr ?? '');
}

/** The `task.real` fields of what a probe read. */
export const videoFields = (info) => ({ width: info.width, height: info.height, duration: info.seconds, frameRate: info.fps });

/** `{ metadata }` of an artifact from `task.real`'s fields, `{}` when none is known. */
export function artifactDetails(fields) {
  const metadata = {};
  if (fields?.duration > 0) metadata.duration = fields.duration;
  if (fields?.frameRate > 0) metadata.frameRate = fields.frameRate;
  if (fields?.width > 0 && fields?.height > 0) metadata.size = { width: fields.width, height: fields.height };
  if (fields?.qc) metadata.qc = fields.qc;
  return Object.keys(metadata).length ? { metadata } : {};
}

// ---------------------------------------------------------------- orphans

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Signal 0 only asks. A process of another user answers EPERM, and is not ours either. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The command that reads a process's full command line here; no shell, and `pid` is a checked integer. */
export function commandLineQuery(pid, platform = process.platform) {
  return platform === 'win32'
    ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`]]
    : ['ps', ['-ww', '-o', 'command=', '-p', String(pid)]];
}

/** A process's command line, '' when it cannot be read. */
function commandLineOf(pid) {
  const [file, args] = commandLineQuery(pid);
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: PROBE_MS, maxBuffer: 1024 * 1024 }, (_err, stdout) => resolve(String(stdout ?? '')));
  });
}

async function gone(pid, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) {
    if (!alive(pid)) return true;
  }
  return !alive(pid);
}

/**
 * Stops the encoder of an attempt a crashed server left running. A pid is reused
 * once its process has gone, so this only touches a process whose command line
 * still names that attempt's own file (`encoder.token`). When that cannot be
 * read nothing is killed: the attempt's unique name already keeps it apart.
 * `process.kill` works on Windows too, where any signal ends the process at once.
 */
export async function stopEncoder(encoder, { graceMs = STOP_GRACE_MS } = {}) {
  const { pid, token } = encoder ?? {};
  if (!Number.isSafeInteger(pid) || pid <= 0 || !token || !alive(pid)) return false;
  if (!(await commandLineOf(pid)).includes(token)) return false;
  try {
    process.kill(pid);
    if (await gone(pid, graceMs)) return true;
    process.kill(pid, 'SIGKILL');
    return await gone(pid, graceMs);
  } catch {
    return !alive(pid);
  }
}

/** Into place, atomically. Windows refuses a rename while a virus scanner still holds the new file, so it asks again. */
async function moveIntoPlace(temp, file) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fsp.rename(temp, file);
      return;
    } catch (err) {
      if (process.platform !== 'win32' || attempt >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(err?.code)) throw err;
      await sleep(250 * attempt);
    }
  }
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

/** What a run whose answer is in its log runs at: below info, ebur128's Summary and loudnorm's block never print. */
const INFO_FLAGS = ['-hide_banner', '-nostdin', '-loglevel', 'info', '-stats'];

/** A film with no sound has nothing for ebur128 to read: its report says so, and judges the picture alone. */
function silentReport(report) {
  const findings = report.findings.filter((finding) => !/^(?:Integrated loudness|True peak)/.test(finding));
  return { ...report, findings, pass: findings.length === 0, notes: [NO_SOUND] };
}

/** How far a film may sit from its planned length: each cut can round by a frame or so at either end. */
const lengthSlack = (cuts, fps) => 0.25 + cuts * (0.05 + 1.5 / (fps > 0 ? fps : 24));

// ---------------------------------------------------------------- provider

/**
 * dirs: { ASSETS_DIR, UPLOADS_DIR, STORAGE_DIR }. storagePath, when given,
 * maps a storage key to its file (the platform's own). lookupTaskPath(taskId)
 * is the `/__mock/...` path a finished task's file is served at. persist()
 * saves tasks.json. The optional ones: ffmpeg (a path, else ffmpegPath()),
 * mockOrigin() for result URLs, maxParallel (2), timeoutMs (30 minutes) and
 * sweepAtBoot (a desktop server clears what a crash left in the results folder;
 * nothing else encodes, so nothing else may).
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
  sweepAtBoot = process.env.BAY_ENV === 'desktop' || process.env.RTF_SIMULATOR === '1',
}) {
  const running = new Map(); // task id -> its run
  const waiting = [];
  const attempts = new Set(); // the temp names this process is writing
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

  /** The file of a storage key (a music bed, a title card) through the same gate as every other file; or `missing`, the sentence for one that is gone. */
  async function fileOfKey(key, missing) {
    const file = localFileForUrl(`/__mock/storage/${String(key ?? '').split('/').map(encodeURIComponent).join('/')}`, dirs, storagePath);
    const found = file ? await fsp.stat(file).then((st) => st.isFile(), () => false) : false;
    if (!found) throw new FfmpegError(missing);
    return file;
  }

  /** A title card's `{ file, seconds }`, or the sentence that stops the master. */
  async function planCard(card) {
    const seconds = num(card.seconds, NaN);
    if (!(seconds >= CARD_SECONDS.min && seconds <= CARD_SECONDS.max)) throw new FfmpegError(CARD_LENGTH);
    return { file: await fileOfKey(card.assetKey, MISSING_CARD), seconds };
  }

  async function probeClip(file) {
    try {
      return await probe(file, { bin: bin() });
    } catch (err) {
      if (err?.message?.includes('could not be started')) throw err;
      throw new FfmpegError('That clip could not be read.');
    }
  }

  /** `probeClip`, plus the pictures a clip holds: its `seconds` is its longest stream, and sound can outlast the picture. */
  async function probeFrames(file) {
    const info = await probeClip(file);
    if (!(info.fps > 0)) throw new FfmpegError('That clip could not be read.');
    const reader = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-stats', '-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-'];
    const { frames } = await runFfmpeg(bin(), reader, { timeoutMs });
    if (!(frames > 0)) throw new FfmpegError('That clip could not be read.');
    return { ...info, frames };
  }

  /** `{ args, seconds }`: everything between the global flags and the output file. */
  async function plan(operation, options) {
    const p = options.parameters ?? {};
    if (operation === 'trim') {
      const file = await fileOfAsset(options.input?.[0]);
      const start = num(p.start, NaN);
      const end = num(p.end, NaN);
      if (!(start >= 0) || !(end > start)) throw new FfmpegError('That cut has no length.');
      const src = await probeClip(file);
      const last = src.seconds > 0 ? Math.min(end, src.seconds) : end;
      if (!(last > start)) throw new FfmpegError('That cut has no length.');
      return { args: ['-ss', sec(start), '-to', sec(end), '-i', file], seconds: last - start, cuts: 1, width: src.width, height: src.height };
    }

    if (operation === 'timeline_export') {
      const clips = Array.isArray(p.clips) ? p.clips : [];
      if (!clips.length) throw new FfmpegError('There is nothing to export.');
      const read = new Map(); // a clip cut twice is read once
      const cuts = [];
      for (const clip of clips) {
        const file = await fileOfAsset(clip?.assetId);
        const from = num(clip?.sourceStart, 0);
        const length = num(clip?.duration, 0);
        if (!(from >= 0) || !(length > 0)) throw new FfmpegError('A clip in the timeline has no length.');
        if (!read.has(file)) read.set(file, await probeClip(file));
        const held = read.get(file).seconds;
        const plays = held > 0 ? Math.min(length, held - from) : length;
        if (!(plays > 0)) throw new FfmpegError(AFTER_END);
        cuts.push({ file, from, length, plays });
      }
      // The first clip sets the film's size and rate, as in a stitch, unless the request names its own.
      const first = read.get(cuts[0].file);
      const width = evenSize(p.width, evenSize(first.width, 1920));
      const height = evenSize(p.height, evenSize(first.height, 1080));
      const chain = normalise(width, height, fpsArg(p.fps, fpsArg(first.fps, 24)));
      const args = cuts.flatMap((c) => ['-ss', sec(c.from), '-t', sec(c.length), '-i', c.file]);
      const filters = cuts.map((_, i) => `[${i}:v]${chain}[v${i}]`);
      filters.push(`${cuts.map((_, i) => `[v${i}]`).join('')}concat=n=${cuts.length}:v=1:a=0[out]`);
      const seconds = cuts.reduce((sum, c) => sum + c.plays, 0);
      return { args: [...args, '-filter_complex', filters.join(';'), '-map', '[out]'], seconds, cuts: cuts.length, width, height };
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
    const first = infos[0];
    if (files.length === 1) return { args: inputs, seconds: lengths[0], cuts: 1, width: first.width, height: first.height };
    if (lengths.some((l) => !(l > 0))) throw new FfmpegError('That clip could not be read.');

    const width = evenSize(first.width, 1920);
    const height = evenSize(first.height, 1080);
    const chain = normalise(width, height, fpsArg(first.fps, 24));
    const shape = { cuts: files.length, width, height };
    const filters = files.map((_, i) => `[${i}:v]${chain}[v${i}]`);
    const wanted = num(p.transition?.duration, p.transition ? 0.5 : 0);
    if (!(wanted > 0)) {
      filters.push(`${files.map((_, i) => `[v${i}]`).join('')}concat=n=${files.length}:v=1:a=0[out]`);
      return {
        args: [...inputs, '-filter_complex', filters.join(';'), '-map', '[out]'],
        seconds: lengths.reduce((s, l) => s + l, 0),
        ...shape,
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
    return { args: [...inputs, '-filter_complex', filters.join(';'), '-map', '[out]'], seconds: covered, ...shape };
  }

  /**
   * `{ film, want, ext }` of a master: the options master.js builds from (no output
   * yet), what the file must read back as, and its extension. A cut is held to the
   * pictures its clip has from `sourceStart` on, because a fade whose last cut has
   * none hangs ffmpeg 6 and a cut that runs out cuts the film short on any build.
   * `cards` become the first and last cuts, and the first clip still sets the size.
   */
  async function planMaster(p) {
    const { DELIVERABLES, filmSeconds } = await masterGraphs();
    const clips = Array.isArray(p.clips) ? p.clips : [];
    if (!clips.length) throw new FfmpegError('There is nothing to master.');
    if (!Object.hasOwn(DELIVERABLES, p.deliverable ?? '')) throw new FfmpegError('That master format is not available.');
    const read = new Map(); // a clip cut twice is read once
    const inputs = [];
    const cuts = [];
    for (const clip of clips) {
      const file = await fileOfAsset(clip?.assetId);
      const from = num(clip?.sourceStart, 0);
      const length = num(clip?.duration, 0);
      if (!(from >= 0) || !(length > 0)) throw new FfmpegError('A clip in the timeline has no length.');
      if (!read.has(file)) read.set(file, await probeFrames(file));
      const src = read.get(file);
      // The filter keeps the pictures at or after `from`, written to the millisecond.
      const left = (src.frames - Math.ceil(Number(sec(from)) * src.fps - 1e-6)) / src.fps;
      if (!(left > 0)) throw new FfmpegError(AFTER_END);
      inputs.push(file);
      cuts.push({ sourceStart: from, duration: Math.min(length, left), ...(clip.frame ? { frame: clip.frame } : {}) });
    }
    const first = read.get(inputs[0]);
    const head = p.cards?.head ? await planCard(p.cards.head) : null;
    const tail = p.cards?.tail ? await planCard(p.cards.tail) : null;
    const cardCut = ({ seconds }, fade) => ({ sourceStart: 0, duration: seconds, image: true, ...fade, frame: { mode: 'fit' } });
    const film = {
      inputs: [...(head ? [head.file] : []), ...inputs, ...(tail ? [tail.file] : [])],
      cuts: [...(head ? [cardCut(head, { fadeIn: CARD_FADE })] : []), ...cuts, ...(tail ? [cardCut(tail, { fadeOut: CARD_FADE })] : [])],
      transition: p.transition === 'fade' ? 'fade' : 'hard',
      fadeSeconds: num(p.fadeSeconds, 0.5),
      width: evenSize(p.width, evenSize(first.width, 1920)),
      height: evenSize(p.height, evenSize(first.height, 1080)),
      fps: num(p.fps, 0) > 0 ? num(p.fps, 0) : first.fps,
      deliverable: p.deliverable,
      ...(p.music ? { music: { ...p.music, file: await fileOfKey(p.music.assetKey, MISSING_MUSIC) } } : {}),
    };
    let seconds;
    try {
      seconds = filmSeconds(film);
    } catch (err) {
      throw new FfmpegError(err.message);
    }
    return { film, want: { seconds, cuts: film.cuts.length, width: film.width, height: film.height }, ext: DELIVERABLES[p.deliverable].ext };
  }

  /**
   * The first loudnorm pass over the bed: `{ film, loudnorm }`, the film the render is
   * to take and its `loudnorm` option. loudnorm accepts a measured loudness and
   * threshold only below 0 LUFS, and a limited track with the Editing slider up reads
   * above it, so such a bed is turned down past 0 and measured again; the render plays
   * it at that gain, and loudnorm's linear mode adds back exactly what was taken.
   */
  async function measureMusic(film, onTime) {
    const { buildMeasureArgs, parseLoudnorm } = await masterGraphs();
    for (let pass = 1; ; pass += 1) {
      let output;
      try {
        // Progress is read from the first pass alone, so a second one never sends it back.
        ({ output } = await runFfmpeg(bin(), [...INFO_FLAGS, ...buildMeasureArgs(film)], { timeoutMs, onTime: pass === 1 ? onTime : undefined, keepOutput: true }));
      } catch (err) {
        if (err?.message !== STOPPED) throw err;
        throw new FfmpegError(BAD_MUSIC, err.detail);
      }
      const measured = parseLoudnorm(output);
      if (!measured) throw new FfmpegError(SILENT_MUSIC);
      const { input_i, input_tp, input_lra, input_thresh, target_offset } = measured;
      const over = Math.max(input_i, input_thresh);
      if (over < 0) return { film, loudnorm: { measured_I: input_i, measured_TP: input_tp, measured_LRA: input_lra, measured_thresh: input_thresh, target_offset } };
      if (pass >= MEASURE_PASSES) throw new FfmpegError(LOUD_MUSIC, `the bed measures ${input_i} LUFS at ${num(film.music.gain, 0)} dB`);
      film = { ...film, music: { ...film.music, gain: num(film.music.gain, 0) - (Math.ceil(over) + 1) } };
    }
  }

  /** The QC report of a rendered master: `frames` is what its read-back decoded, and only a film with sound runs ebur128. */
  async function reportOn(file, film, frames, run) {
    const { buildQcArgs, expectedFrames, filmSeconds, parseQc } = await masterGraphs();
    const seen = { ...readColour(await captureStderr(bin(), probeArgs(file))), frames, expectedFrames: expectedFrames(filmSeconds(film), film.fps) };
    if (!film.music) return silentReport(parseQc('', seen));
    const { output } = await runFfmpeg(bin(), [...INFO_FLAGS, ...buildQcArgs(file)], { ...run, timeoutMs, keepOutput: true });
    return parseQc(output, seen);
  }

  /**
   * Reads a finished file back: it must decode to its last frame, run the planned
   * length and have the planned size. Throws when it does not, so a damaged file
   * never reaches its final name. Returns `fields`, the `task.real` fields it read,
   * and the `frames` it decoded. `audio` decodes the sound too; `run` is passed on
   * to the decode.
   */
  async function verify(file, want, { audio = false, ...run } = {}) {
    let info;
    let decoded;
    try {
      info = await probe(file, { bin: bin() });
      const reader = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-stats', '-xerror', '-i', file, '-map', '0:v:0', ...(audio ? ['-map', '0:a:0?'] : []), '-f', 'null', '-'];
      decoded = await runFfmpeg(bin(), reader, { ...run, timeoutMs });
    } catch (err) {
      if (err?.message === TIMED_OUT) throw err;
      throw new FfmpegError(DAMAGED, err?.detail ?? err?.message);
    }
    const off = Math.abs(decoded.seconds - want.seconds);
    const problems = [
      decoded.said,
      want.seconds > 0 && off > lengthSlack(want.cuts, info.fps) && `decoded ${decoded.seconds}s of a planned ${want.seconds}s`,
      want.width > 0 && (info.width !== want.width || info.height !== want.height) && `${info.width}x${info.height}, planned ${want.width}x${want.height}`,
    ].filter(Boolean);
    if (problems.length) throw new FfmpegError(DAMAGED, problems.join('; '));
    return { fields: videoFields(info), frames: decoded.frames };
  }

  /** Encodes one H.264 file for trim, timeline_export or stitch. */
  async function encode(task, operation, options) {
    const { args, ...want } = await plan(operation, options);
    const { seconds } = want;
    update(task, { expectedSeconds: Math.round(seconds * 1000) / 1000 });
    const out = resultPathFor(task.id, 'x.mp4', dirs.STORAGE_DIR);
    await fsp.mkdir(path.dirname(out.file), { recursive: true });
    const temp = out.file.replace(/\.mp4$/, `.${randomBytes(6).toString('hex')}.tmp.mp4`);
    const token = path.basename(temp);
    attempts.add(token);
    try {
      await runFfmpeg(bin(), ['-y', '-hide_banner', '-nostdin', '-loglevel', 'error', '-stats', ...args, ...ENCODE, temp], {
        timeoutMs,
        onSpawn: (pid) => update(task, { encoder: { pid, token } }),
        onTime: (t) => {
          // progress is only read in memory; the file is saved on state changes
          task.real.progress = Math.max(0, Math.min(0.99, t / Math.max(0.1, seconds)));
        },
      });
      const { fields } = await verify(temp, want);
      await moveIntoPlace(temp, out.file);
      update(task, { state: 'succeeded', progress: 1, options: undefined, encoder: undefined, ...fields }, { path: out.path });
    } catch (err) {
      await fsp.rm(temp, { force: true }).catch(() => undefined);
      throw err;
    } finally {
      attempts.delete(token);
    }
  }

  /**
   * One master: the bed measured (to 15 %), the film rendered to its own attempt (to
   * 90 %), read back and judged (to the end), the report written, the file moved into
   * place. A QC finding keeps the file and says why; what cannot be read back does not.
   */
  async function master(task, options) {
    const { buildMasterArgs } = await masterGraphs();
    const { film, want, ext } = await planMaster(options.parameters ?? {});
    const { seconds } = want;
    update(task, { expectedSeconds: Math.round(seconds * 1000) / 1000 });
    const base = resultPathFor(task.id, 'x.mp4', dirs.STORAGE_DIR);
    const stem = base.file.slice(0, -'.mp4'.length);
    const served = base.path.slice(0, -'.mp4'.length);
    await fsp.mkdir(path.dirname(base.file), { recursive: true });
    const temp = `${stem}.${randomBytes(6).toString('hex')}.tmp.${ext}`;
    const report = `${stem}.qc.json`;
    const token = path.basename(temp);
    const onSpawn = (pid) => update(task, { encoder: { pid, token } });
    /** Progress from `from` to `to` over one run through the film; read in memory, as in `encode`. */
    const stretch = (from, to) => (t) => {
      task.real.progress = from + (to - from) * Math.min(1, t / Math.max(0.1, seconds));
    };
    attempts.add(token);
    try {
      // The bed may come back turned down: the render takes the film it was measured on.
      const { film: mix, loudnorm } = film.music ? await measureMusic({ ...film, output: temp }, stretch(0, 0.15)) : { film };
      task.real.progress = 0.15;
      await runFfmpeg(bin(), ['-y', '-hide_banner', '-nostdin', '-loglevel', 'error', '-stats', ...buildMasterArgs({ ...mix, output: temp, loudnorm })], {
        timeoutMs,
        onSpawn,
        onTime: stretch(0.15, 0.9),
      });
      task.real.progress = 0.9;
      const { fields, frames } = await verify(temp, want, { audio: true, onSpawn, onTime: stretch(0.9, 0.95) });
      task.real.progress = 0.95;
      const qc = await reportOn(temp, film, frames, { onSpawn, onTime: stretch(0.95, 1) });
      await fsp.writeFile(report, `${JSON.stringify(qc, null, 2)}\n`);
      await moveIntoPlace(temp, `${stem}.${ext}`);
      update(task, { state: 'succeeded', progress: 1, options: undefined, encoder: undefined, qc, qcPath: `${served}.qc.json`, ...fields }, { path: `${served}.${ext}` });
    } catch (err) {
      await fsp.rm(temp, { force: true }).catch(() => undefined);
      await fsp.rm(report, { force: true }).catch(() => undefined);
      throw err;
    } finally {
      attempts.delete(token);
    }
  }

  /** Clears what a crash left in the results folder. A file an orphan still holds on Windows goes once resume has stopped it. */
  async function sweep() {
    const folder = path.dirname(resultPathFor('x', 'x.mp4', dirs.STORAGE_DIR).file);
    const names = await fsp.readdir(folder).catch(() => []);
    const stale = names.filter((name) => TEMP_NAME.test(name) && !attempts.has(name));
    await Promise.all(
      stale.map((name) => fsp.rm(path.join(folder, name), { force: true }).catch((err) => console.warn(`[ffmpeg] could not clear ${name}: ${err?.code ?? err}`)))
    );
  }

  /** Before a run starts again: the encoder of its last attempt is stopped and that attempt's file removed. */
  async function clearAttempt(task) {
    const { encoder } = task.real;
    if (!encoder) return;
    if (await stopEncoder(encoder)) console.warn(`[ffmpeg] stopped an encoder left running for ${task.id}`);
    const folder = path.dirname(resultPathFor('x', 'x.mp4', dirs.STORAGE_DIR).file);
    if (TEMP_NAME.test(String(encoder.token))) await fsp.rm(path.join(folder, path.basename(encoder.token)), { force: true }).catch(() => undefined);
    update(task, { encoder: undefined });
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
      else if (operation === 'master') await master(task, options);
      else await encode(task, operation, options);
    } catch (err) {
      // One sentence for the page; what ffmpeg really said stays in the log.
      const detail = String(err?.detail ?? err?.message ?? err)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(-ERROR_CHARS);
      const shown = NO_ROOM.test(detail) ? NO_SPACE : err instanceof FfmpegError ? err.message : STOPPED;
      console.warn(`[ffmpeg] failed ${task.id} ${options?.operation ?? ''}: ${detail}`);
      update(task, { state: 'failed', error: shown, options: undefined, frames: undefined, encoder: undefined });
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
    return r?.kind === 'ffmpeg' && r.state === 'succeeded' ? artifactDetails(r) : {};
  }

  function artifactsOf(task) {
    const r = task?.real;
    if (r?.kind !== 'ffmpeg' || r.state !== 'succeeded') return [];
    const served = Array.isArray(r.frames) && r.frames.length ? r.frames.map((f) => f.path) : task.path ? [task.path] : [];
    return served.map((p, i) => ({ id: `${task.id}-artifact-${i}`, url: `${mockOrigin()}${p}`, isDirectory: false, ...metaOf(task) }));
  }

  if (sweepAtBoot) void sweep();

  return {
    id: 'ffmpeg',
    name: 'ffmpeg',

    supports(_type, options) {
      return OPERATIONS.has(options?.operation) ? { ok: true, notes: [] } : { ok: false, reason: UNSUPPORTED };
    },

    start,

    /**
     * At boot: a run that was queued or running when the app closed starts again,
     * free and local, once nothing of its last attempt is still writing.
     */
    async resume(task) {
      const r = task?.real;
      if (r?.kind !== 'ffmpeg' || (r.state !== 'queued' && r.state !== 'running')) return;
      await clearAttempt(task);
      if (!r.options) {
        update(task, { state: 'failed', error: 'This export was interrupted. Start it again.' });
        return;
      }
      await start(task, r.options);
    },

    sweep,

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

    /** `{ metadata: { duration, frameRate, size, qc } }` once the file has been read (size only for captured frames, qc only for a master). */
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
