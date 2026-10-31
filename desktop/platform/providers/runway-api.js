// Runway developer API provider — runs stills and clips on Runway's public API
// with the owner's own key, through the official @runwayml/sdk. The Provider
// shape is the Phase 12 contract: tasks.js owns tasks.json and calls in here.
//
// Pipeline: queued -> uploading -> submitted -> waiting -> downloading ->
// succeeded | failed.
// Money rules, realgen's: a task reaches `create` at most once. It is
// `submitted` on disk before the call, its remote id is on disk the moment the
// reply is, and a restart only ever follows that id with `tasks.retrieve`. The
// client retries reads, but `create` goes out with `maxRetries: 0`: the API has
// no idempotency key, so a retried timeout could bill the same run twice.
//
// The SDK is imported on first use, and `sdk` injects a stand-in, so the harness
// and the tests load this file without it. Keys never reach task.real, a file
// or the console: every error message goes through redact().
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { localFileForUrl, resultPathFor, sha1 } from '../realgen/files.js';
import { mapRunway } from './runway-mapping.js';
import { RUNWAY_RATES, RUNWAY_RATES_BY_ALIAS } from './runway-rates.js';

const LABEL = 'Runway API';
export const KEY_REFUSED = 'Your Runway API key was refused. Check it in Settings.';
const NOT_CHARGED = 'Nothing was charged.';
const RESTART_BEFORE_ID =
  'The server restarted before Runway returned a task id; not resubmitting. Check your tasks at dev.runwayml.com before running again.';
const MAY_HAVE_STARTED = 'Runway may have started this run. Check your tasks at dev.runwayml.com before running again.';
const followHint = (id) => `Runway task ${id} may still finish; it is on your dev.runwayml.com account.`;

const POLL_MS = 5000; // the docs ask for no more than one read every five seconds
/** How long a dropped connection is waited out (polling is free, the run goes on at Runway). */
const OUTAGE_MS = 45 * 60_000;
/** `runway://` uris last 24 hours (Uploads page); this leaves room for a queue. */
const UPLOAD_TTL_MS = 23 * 60 * 60_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const DOWNLOAD_ATTEMPTS = 6;
const TRANSIENT = /ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|socket hang up|network|connection|timed? ?out|fetch failed/i;

const PROGRESS = { queued: 0.05, uploading: 0.1, submitted: 0.1, waiting: 0.1, downloading: 0.95 };
const RESULT_TYPES = { 'video/mp4': 'mp4', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** The Phase 12 table's Runway column. Model ids, as src/models.ts spells them. */
const IMAGE_MODELS = [
  'nano-banana-pro',
  'nano-banana-2-1',
  'nano-banana-2',
  'gpt-image-2-5-sunburst',
  'gpt-image-2-5-flare',
  'gpt-image-2',
  'seedream-5-pro',
  'grok-imagine-2',
  'gen-4-image',
];
const VIDEO_MODELS = [
  'seedance-2',
  'seedance-2-5',
  'seedance-2-fast',
  'kling-3-pro',
  'kling-3-4k',
  'kling-o3-pro',
  'kling-4-0',
  'veo-3-1',
  'veo-3-1-fast',
  'gen-4-5',
  'gen-4-turbo',
  'minimax-h3',
];
const NOTES = {
  'gen-4-5': 'First frame only on the Runway API',
  'kling-4-0': 'Always has sound on the Runway API',
  'veo-3-1': 'Silent on the Runway API',
  'veo-3-1-fast': 'Silent on the Runway API',
};
/** Both Veo models share the alias `veo3_1`, so each has its own line; the client reads a model id before its alias. */
const RATES = {
  ...RUNWAY_RATES_BY_ALIAS,
  'veo-3-1': RUNWAY_RATES['veo3.1'],
  'veo-3-1-fast': RUNWAY_RATES['veo3.1_fast'],
};

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `message` with the key and anything key-shaped taken out, cut to 300 characters. */
export function redact(message, key) {
  let text = String(message ?? '');
  if (key) text = text.split(key).join('[key]');
  return text
    .replace(/Bearer\s+\S+/gi, 'Bearer [key]')
    .replace(/\bkey_[A-Za-z0-9_-]{6,}/g, '[key]')
    .slice(0, 300);
}

/** An error that says nothing about the task: the connection dropped or Runway hiccuped. */
function transient(err) {
  const status = err?.status;
  if (typeof status === 'number') return status === 429 || status >= 500;
  return TRANSIENT.test(String(err?.message ?? err)) || TRANSIENT.test(String(err?.name ?? ''));
}

let sharpModule; // undefined: not tried yet; null: not installed

async function imageSize(file) {
  if (sharpModule === undefined) {
    try {
      sharpModule = (await import('sharp')).default;
    } catch (err) {
      sharpModule = null;
      console.warn(`[runway-api] sharp is not available (${err.message}); image sizes are skipped`);
    }
  }
  if (!sharpModule) return null;
  try {
    const m = await sharpModule(file).metadata();
    if (!(m.width > 0) || !(m.height > 0)) return null;
    return m.orientation >= 5 ? { width: m.height, height: m.width } : { width: m.width, height: m.height };
  } catch {
    return null;
  }
}

/**
 * The Runway provider. `getKey(owner)` reads the owner's sealed key; `dirs` is
 * { ASSETS_DIR, UPLOADS_DIR, STORAGE_DIR, storagePath? }. `mockOrigin()` gives a
 * result's absolute URL; `fetchImpl` carries every request, `sdk` is `{ RunwayML,
 * toFile }`. `pollMs` and `sleep` are test seams.
 */
export function createRunwayProvider({
  getKey,
  dirs,
  persist,
  fetchImpl,
  sdk,
  mockOrigin,
  pollMs = POLL_MS,
  sleep = defaultSleep,
}) {
  const running = new Map(); // taskId -> this process's pipeline for it
  const uploading = new Map(); // key fingerprint + sha1 -> an upload in flight
  const uploadsFile = path.join(dirs.STORAGE_DIR, 'runwayapi', 'uploads.json');
  let sdkLoaded;
  let clientFor = { key: undefined, client: undefined };

  const loadSdk = () => (sdkLoaded ??= Promise.resolve(sdk ?? import('@runwayml/sdk')));

  async function clientOf(key) {
    if (clientFor.key !== key) {
      const { RunwayML } = await loadSdk();
      clientFor = { key, client: new RunwayML({ apiKey: key, maxRetries: 2, ...(fetchImpl ? { fetch: fetchImpl } : {}) }) };
    }
    return clientFor.client;
  }

  const keyOf = (task, env) => getKey(env?.owner ?? task?.owner);

  /** Patches task.real (and the task itself) and persists. */
  function patch(task, env, real, top) {
    if (top) Object.assign(task, top);
    task.real = { ...task.real, ...real };
    (env?.persist ?? persist)?.();
  }

  function fail(task, env, error, hint) {
    patch(task, env, { state: 'failed', error: String(error).slice(0, 300), ...(hint ? { hint } : {}) });
    console.warn(`[runway-api] failed ${task.id} ${task.type}: ${task.real.error}`);
  }

  // ---------------------------------------------------------------- inputs

  function readUploads() {
    try {
      const all = JSON.parse(fs.readFileSync(uploadsFile, 'utf8'));
      return all && typeof all === 'object' ? all : {};
    } catch {
      return {};
    }
  }

  function writeUploads(all) {
    fs.mkdirSync(path.dirname(uploadsFile), { recursive: true });
    const tmp = `${uploadsFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
    fs.renameSync(tmp, uploadsFile);
  }

  /** A `runway://` uri for a local file: uploads.json by content hash, else one upload. */
  async function uploadOnce(file, client, key) {
    const bytes = await fsp.readFile(file);
    const hash = sha1(bytes);
    const owner = sha1(Buffer.from(key)).slice(0, 12); // a fingerprint: uris belong to one account
    const hit = readUploads()[hash];
    if (hit?.uri && hit.owner === owner && Date.now() - hit.at < UPLOAD_TTL_MS) return hit.uri;
    const slot = `${owner}:${hash}`;
    if (!uploading.has(slot)) {
      const p = (async () => {
        const { toFile } = await loadSdk();
        const up = await client.uploads.createEphemeral({ file: await toFile(bytes, path.basename(file)) });
        const all = readUploads();
        all[hash] = { uri: up.uri, owner, file: path.basename(file), at: Date.now() };
        writeUploads(all);
        return up.uri;
      })().finally(() => uploading.delete(slot));
      uploading.set(slot, p);
    }
    return uploading.get(slot);
  }

  /** The uri for every input url, and the first frame's real size. */
  async function prepareInputs(urls, client, key) {
    const uris = new Map();
    let startSize = null;
    for (const url of new Set(urls)) {
      const local = localFileForUrl(url, dirs);
      if (local) {
        uris.set(url, await uploadOnce(local, client, key));
        startSize ??= await imageSize(local);
      } else if (typeof url === 'string' && url.startsWith('https://')) {
        uris.set(url, url); // the API takes an https url as it is
      } else {
        throw new Error('An input is neither a file on this computer nor an https URL.');
      }
    }
    return { uris, startSize };
  }

  // ---------------------------------------------------------------- pipeline

  /** Upload, then the one paid call, then the same wait a restart takes. */
  async function submit(task, options, env) {
    const key = keyOf(task, env);
    const urls = [];
    const first = mapRunway(task.type, options, { uri: (url) => (urls.push(url), url) });
    if (first.kind !== 'runway') return fail(task, env, first.reason, NOT_CHARGED);
    if (!key) return fail(task, env, KEY_REFUSED, NOT_CHARGED);

    // The canned path a simulator run picks is not this run's result.
    patch(task, env, {
      state: 'uploading',
      family: first.endpoint === 'textToImage' || first.endpoint === 'imageUpscale' ? 'image' : 'video',
      model: first.model,
      endpoint: first.endpoint,
      expectedSeconds: first.expectedSeconds,
      notes: first.notes,
    }, { path: undefined });

    let client;
    let d;
    try {
      client = await clientOf(key);
      const { uris, startSize } = await prepareInputs(urls, client, key);
      d = mapRunway(task.type, options, { uri: (url) => uris.get(url), ...(startSize ? { startSize } : {}) });
    } catch (err) {
      return fail(task, env, err?.status === 401 ? KEY_REFUSED : redact(err?.message ?? err, key), NOT_CHARGED);
    }
    if (d.kind !== 'runway') return fail(task, env, d.reason, NOT_CHARGED);

    // On disk before the paid call: from here on a restart never resubmits.
    patch(task, env, {
      state: 'submitted',
      notes: d.notes,
      ...(typeof d.body.duration === 'number' ? { duration: d.body.duration } : {}),
    });
    let created;
    try {
      created = await client[d.endpoint].create(d.body, { maxRetries: 0 });
    } catch (err) {
      if (err?.status === 401) return fail(task, env, KEY_REFUSED, NOT_CHARGED);
      const refused = err?.status >= 400 && err?.status < 500;
      return fail(task, env, `The Runway API refused the request: ${redact(err?.message ?? err, key)}`,
        refused ? NOT_CHARGED : MAY_HAVE_STARTED);
    }
    patch(task, env, {
      state: 'waiting',
      remoteId: created.id,
      credits: created.estimatedCost?.credits,
      remoteStatus: 'PENDING',
      progress: PROGRESS.waiting,
    });
    await follow(task, env);
  }

  /** Polls a submitted task (free) and fetches its result; the only path a restart takes. */
  async function follow(task, env) {
    const id = task.real.remoteId;
    const key = keyOf(task, env);
    if (!key) return fail(task, env, KEY_REFUSED, followHint(id));
    try {
      const client = await clientOf(key);
      let downSince = null;
      for (;;) {
        let t;
        try {
          t = await client.tasks.retrieve(id);
          downSince = null;
        } catch (err) {
          if (!transient(err)) throw err;
          downSince ??= Date.now();
          if (Date.now() - downSince > OUTAGE_MS) throw err;
          await sleep(pollMs);
          continue;
        }
        if (t.status === 'SUCCEEDED') {
          const url = t.output?.[0];
          if (typeof url !== 'string') return fail(task, env, 'Runway finished the run but returned no result.', followHint(id));
          await finish(task, env, url, t.cost?.credits);
          return;
        }
        if (t.status === 'FAILED') {
          return fail(task, env, redact(t.failure ?? 'The Runway run failed.', key),
            t.failureCode ? redact(t.failureCode, key) : followHint(id));
        }
        if (t.status === 'CANCELLED') return fail(task, env, 'The run was cancelled on Runway.', followHint(id));
        const progress = t.status === 'RUNNING' && typeof t.progress === 'number' ? t.progress : PROGRESS.waiting;
        if (progress !== task.real.progress || t.status !== task.real.remoteStatus) {
          patch(task, env, { state: 'waiting', remoteStatus: t.status, progress });
        }
        await sleep(pollMs);
      }
    } catch (err) {
      fail(task, env, err?.status === 401 ? KEY_REFUSED : redact(err?.message ?? err, key), followHint(id));
    }
  }

  async function saveResult(task, res) {
    const url = task.real.resultUrl;
    let target = resultPathFor(task.id, url, dirs.STORAGE_DIR);
    if (target.file.endsWith('.bin')) {
      const type = String(res.headers?.get?.('content-type') ?? '').split(';')[0].trim();
      if (RESULT_TYPES[type]) target = resultPathFor(task.id, `result.${RESULT_TYPES[type]}`, dirs.STORAGE_DIR);
    }
    await fsp.mkdir(path.dirname(target.file), { recursive: true });
    const tmp = `${target.file}.tmp`;
    try {
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
      await fsp.rename(tmp, target.file);
    } catch (err) {
      await fsp.rm(tmp, { force: true });
      throw err;
    }
    return target;
  }

  /** Result URLs last 24 to 48 hours: downloaded at once into storage/realgen/results/. */
  async function finish(task, env, url, cost) {
    patch(task, env, { state: 'downloading', resultUrl: url, ...(typeof cost === 'number' ? { credits: cost } : {}) });
    const doFetch = fetchImpl ?? fetch;
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await doFetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
        if (!res.ok || !res.body) {
          throw Object.assign(new Error(`Downloading the Runway result failed (${res.status}).`), { status: res.status });
        }
        const target = await saveResult(task, res);
        const size = task.real.family === 'image' ? await imageSize(target.file) : null;
        patch(task, env, { state: 'succeeded', ...(size ?? {}) }, { path: target.path });
        return;
      } catch (err) {
        if (attempt >= DOWNLOAD_ATTEMPTS || !transient(err)) throw err;
        await sleep(Math.min(pollMs * attempt, 60_000));
      }
    }
  }

  /** Runs `work` once per task in this process; never rejects. */
  function track(task, env, work) {
    if (running.has(task.id)) return running.get(task.id);
    const p = Promise.resolve()
      .then(work)
      .catch((err) => fail(task, env, redact(err?.message ?? err, keyOf(task, env)), MAY_HAVE_STARTED))
      .finally(() => running.delete(task.id));
    running.set(task.id, p);
    return p;
  }

  // ---------------------------------------------------------------- Provider

  return {
    id: 'runway',
    name: LABEL,
    rates: RATES,

    capabilities() {
      return {
        provider: 'runway',
        providerName: LABEL,
        desktop: true,
        imageModels: [...IMAGE_MODELS],
        videoModels: [...VIDEO_MODELS],
        stillUpscalers: ['precision'],
        clipUpscalers: ['magnific-video'],
        aleph: true,
        export: true,
        // The API cannot pin the still as the first frame beside a reference video, and there is no upscale route.
        recreate: false,
        textViaRunway: false,
        notes: { ...NOTES },
        rates: { ...RATES },
      };
    },

    supports(type, options) {
      const d = mapRunway(type, options);
      return d.kind === 'runway' ? { ok: true, notes: d.notes } : { ok: false, reason: d.reason };
    },

    start(task, options, env) {
      // A task that already has a remote id was paid for: it is only ever followed.
      return track(task, env, () => (task.real?.remoteId ? follow(task, env) : submit(task, options, env)));
    },

    snapshot(task, opts = {}) {
      const r = task.real ?? {};
      if (r.state === 'succeeded') {
        const origin = opts.origin ?? mockOrigin?.() ?? '';
        return { id: task.id, done: true, status: 'SUCCEEDED', progress: 1, ...(task.path ? { url: `${origin}${task.path}` } : {}) };
      }
      if (r.state === 'failed') {
        return {
          id: task.id,
          done: true,
          status: 'FAILED',
          progress: 1,
          error: r.error ?? 'The Runway run failed.',
          ...(r.hint ? { hint: r.hint } : {}),
        };
      }
      const progress = r.state === 'waiting' ? r.progress ?? PROGRESS.waiting : PROGRESS[r.state] ?? 0;
      return { id: task.id, done: false, status: r.remoteStatus === 'RUNNING' ? 'RUNNING' : 'PENDING', progress };
    },

    artifactMeta(task) {
      const r = task?.real;
      const metadata = {
        ...(r?.width > 0 && r?.height > 0 ? { size: { width: r.width, height: r.height } } : {}),
        ...(r?.duration > 0 ? { duration: r.duration } : {}),
        ...(r?.frameRate > 0 ? { frameRate: r.frameRate } : {}),
      };
      return Object.keys(metadata).length > 0 ? { metadata } : {};
    },

    /** After a restart: follow a known remote id, else fail the task. Never resubmits. */
    resume(task, env) {
      if (!task.real?.remoteId) {
        fail(task, env, RESTART_BEFORE_ID, MAY_HAVE_STARTED);
        return Promise.resolve();
      }
      return track(task, env, () => follow(task, env));
    },

    /** Free. Rejects when `key` does not work: `status` is 401 or 403 when Runway refused it. */
    async verifyKey(key) {
      const client = await clientOf(key);
      await client.organization.retrieve();
    },

    /** Free. `null` when the account could not be asked (no connection). */
    async account(owner) {
      const key = getKey(owner);
      if (!key) return { label: LABEL, signedIn: false };
      try {
        const client = await clientOf(key);
        const org = await client.organization.retrieve();
        return { label: LABEL, credits: org.creditBalance, signedIn: true };
      } catch (err) {
        if (err?.status === 401) return { label: LABEL, signedIn: false };
        console.warn(`[runway-api] account: ${redact(err?.message ?? err, key)}`);
        return null;
      }
    },
  };
}
