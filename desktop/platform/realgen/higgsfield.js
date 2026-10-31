// Real-mode Higgsfield CLI — the only module that runs the `higgsfield` binary.
//
// - Every call is execFile (never a shell) with `--json` appended.
// - upload and cost are free; create is the one paid call. create and wait
//   write the CLI's raw stdout to disk before anything parses it: the CLI's
//   own list does not show every job, so a lost reply is a lost paid result.
// - `create --wait` prints a list of jobs, `get`/`wait` one object; parseJob
//   takes either.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const DEFAULT_BIN = '/usr/local/bin/higgsfield';

/** REAL_GEN_HF_BIN, else the Homebrew/installer path (launch.json may carry no PATH). */
export function binPath() {
  return process.env.REAL_GEN_HF_BIN?.trim() || DEFAULT_BIN;
}

/** REAL_GEN_WAIT_TIMEOUT as a CLI duration (`30m`, `1h`, `90s`). */
export function waitTimeout() {
  return process.env.REAL_GEN_WAIT_TIMEOUT?.trim() || '30m';
}

export class HiggsfieldError extends Error {
  constructor(message, { stdout = '', stderr = '', code } = {}) {
    super(message);
    this.name = 'HiggsfieldError';
    this.stdout = stdout;
    this.stderr = stderr;
    this.code = code;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The CLI's own words: its `Error:` line, else the first non-empty line of stderr, else stdout (≤300). */
function messageOf(stderr, stdout, fallback) {
  const lines = (text) => String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const err = lines(stderr);
  const line = err.find((l) => /^error\b/i.test(l)) ?? err[0] ?? lines(stdout)[0] ?? fallback ?? 'no output';
  return String(line).slice(0, 300);
}

/** JSON of a reply; tolerates a non-JSON preamble before the first `[` or `{`. */
export function parseJson(text) {
  const s = String(text ?? '').trim();
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    const at = s.search(/[[{]/);
    if (at <= 0) return undefined;
    try {
      return JSON.parse(s.slice(at));
    } catch {
      return undefined;
    }
  }
}

/** The job in a reply: the first of a list, else the object (or its `job`/`jobs[0]`/`data[0]`). */
export function parseJob(json) {
  let j = Array.isArray(json) ? json[0] : json;
  // `generate create` without --wait prints only the job ids: ["<uuid>"] (seen 2026-10-29).
  if (typeof j === 'string' && /^[0-9a-f-]{36}$/i.test(j)) j = { id: j };
  if (j && typeof j === 'object' && typeof j.id !== 'string') {
    j = j.job ?? (Array.isArray(j.jobs) ? j.jobs[0] : undefined) ?? (Array.isArray(j.data) ? j.data[0] : undefined) ?? j;
  }
  return j && typeof j === 'object' && !Array.isArray(j) ? j : null;
}

const waits = new Set();

/**
 * Stops every `generate wait`, for main's quit. A wait is free and picks up by
 * job id at the next boot; left alone it outlives the app, and on Windows a
 * running hf.exe keeps the installer from replacing it.
 */
export function stopWaits() {
  for (const child of waits) child.kill();
}

/** `higgsfield <args> --json`, raw: never rejects → { code, stdout, stderr, error }. */
export function exec(args, { timeout = 0 } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      binPath(),
      [...args, '--json'],
      { maxBuffer: 16 << 20, timeout, encoding: 'utf8' },
      (error, stdout, stderr) => {
        resolve({
          code: error ? (typeof error.code === 'number' ? error.code : -1) : 0,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          error: error ?? null,
        });
      }
    );
    if (args[1] === 'wait') {
      waits.add(child);
      child.once('close', () => waits.delete(child));
    }
  });
}

/**
 * `higgsfield <args> --json` → { stdout, json }. A non-zero exit or stdout that
 * is not JSON throws a HiggsfieldError whose message is the CLI's own words.
 */
export async function run(args, opts) {
  const r = await exec(args, opts);
  const json = parseJson(r.stdout);
  if (r.code !== 0 || json === undefined) {
    throw new HiggsfieldError(messageOf(r.stderr, r.stdout, r.error?.message), r);
  }
  return { stdout: r.stdout, json };
}

/** Writes a reply exactly as the CLI printed it (sync: it is on disk before we act on it). */
function keepRaw(file, stdout) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, stdout);
}

/** Uploads a local file (free) → { id, url }; one retry after 2 s (uploads see transient 520s). */
export async function upload(file) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const { json, stdout } = await run(['upload', 'create', file], { timeout: 5 * 60_000 });
      if (typeof json?.id !== 'string' || !json.id) {
        throw new HiggsfieldError(`no upload id in ${stdout.trim().slice(0, 200)}`, { stdout });
      }
      return { id: json.id, url: typeof json.url === 'string' ? json.url : null };
    } catch (err) {
      if (attempt >= 2) throw err;
      await sleep(2000);
    }
  }
}

/** The quote for `generate create <args>` in credits (free; Higgsfield validates every param). */
export async function cost(args) {
  const { json, stdout } = await run(['generate', 'cost', ...args], { timeout: 2 * 60_000 });
  const credits = Number(json?.credits);
  if (json?.credits === undefined || !Number.isFinite(credits)) {
    throw new HiggsfieldError(`no credits in ${stdout.trim().slice(0, 200)}`, { stdout });
  }
  return credits;
}

/**
 * The paid call: `generate create <args>` without --wait. The raw stdout goes
 * to `rawFile` first, whatever the exit code; a reply that names a job is
 * returned even from a non-zero exit (the job exists, so it must be followed).
 * No job id → throws `Higgsfield did not return a job id: <msg>`. Never retried.
 */
export async function create(args, rawFile) {
  // Generous timeout: killing a paid call mid-reply is worse than waiting for it.
  const r = await exec(['generate', 'create', ...args], { timeout: 45 * 60_000 });
  keepRaw(rawFile, r.stdout);
  const job = parseJob(parseJson(r.stdout));
  if (job && typeof job.id === 'string' && job.id) return job;
  throw new HiggsfieldError(
    `Higgsfield did not return a job id: ${messageOf(r.stderr, r.stdout, r.error?.message)}`.slice(0, 300),
    r
  );
}

/**
 * `generate wait <jobId>` (free: polls an existing job) → the job object; the
 * raw stdout goes to `rawFile` first. A reply with a status is returned even
 * from a non-zero exit (a failed job is still an answer).
 */
export async function wait(jobId, rawFile, { timeout = waitTimeout(), interval = '5s' } = {}) {
  const r = await exec(['generate', 'wait', jobId, '--timeout', timeout, '--interval', interval]);
  keepRaw(rawFile, r.stdout);
  const job = parseJob(parseJson(r.stdout));
  if (job && (typeof job.status === 'string' || typeof job.result_url === 'string')) return job;
  throw new HiggsfieldError(
    `Waiting on Higgsfield job ${jobId} failed: ${messageOf(r.stderr, r.stdout, r.error?.message)}`.slice(0, 300),
    r
  );
}

/** Streams `url` to `<file>.tmp`, then renames it into place (a half file never shows). */
export async function download(url, file) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`Downloading the Higgsfield result failed (${res.status}).`);
  const tmp = `${file}.tmp`;
  try {
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
    await fsp.rename(tmp, file);
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
}
