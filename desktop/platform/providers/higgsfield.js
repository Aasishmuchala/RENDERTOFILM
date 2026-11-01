// Higgsfield as a provider: ../realgen runs the pipeline (upload, free quote,
// budget, one `generate create`, `generate wait`, download); this file says what
// it may run, and finds the CLI. The CLI signs in with its own OAuth and keeps its
// own credentials, which the app never reads, logs or copies.
//
// mapTask keeps a Higgsfield stand-in for what the app's models have no match
// for, so the plain harness can still run them. A provider must not: `supports`
// allows only the Phase 12 table's Higgsfield column and refuses the rest in one
// sentence, so a stand-in model can never be billed here.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { HIGGSFIELD_CAPABILITIES } from '../bay/capabilities.js';
import { MISSING_CLIP, unpackedPath } from '../ffmpeg.js';
import * as hf from '../realgen/higgsfield.js';
import * as realgen from '../realgen/index.js';
import { mapTask } from '../realgen/mapping.js';

// Not `require`: the server bundle's banner already declares that name.
const nodeRequire = createRequire(import.meta.url);

const LABEL = 'Higgsfield';
const INSTALL = 'npm install -g @higgsfield/cli';
const CLI_MISSING = 'The Higgsfield CLI is not installed. Settings shows how to add it.';
const GRADES = 'Grades and AI edits need the Runway API provider.';
const NO_ESTIMATE = 'Higgsfield gives no estimate before running.';
const LOGIN_MS = 5 * 60_000;
const VERSION_MS = 10_000;
const ACCOUNT_MS = 30_000;

/** The task types Higgsfield runs as themselves. Anything else never reaches realgen. */
const OFFERED = new Set([
  'gemini_3_pro',
  'nano_banana_2_1',
  'gemini_3_1_flash_image',
  'gpt_image_2_5_sunburst',
  'gpt_image_2_5_flare',
  'gpt_image_2',
  'seedream_5_pro',
  'seedream_5',
  'bfl_flux_2_max',
  'grok_imagine_image_2',
  'seedance_2',
  'seedance_2_fast',
  'seedance_2_5',
  'kling_3_0_pro',
  'kling_3_0_4k',
  'kling_o3_pro',
  'kling_4_0',
  'veo3_1',
  'minimax_hailuo_3_0',
  'wan_2_6',
  'bytedance_video_upscale',
]);

/** Display names of what it does not run, as src/models.ts spells them. */
const NOT_OFFERED = {
  krea_image_3: 'Krea Image 3',
  ref_image_to_image: 'Gen-4 Image',
  'gen4.5': 'Gen-4.5',
  gen4_turbo: 'Gen-4 Turbo',
  ltx_2_5_pro: 'LTX-2.5 Pro',
  magnific_precision_upscaler_v2: 'Magnific Precision',
  magnific_creative_upscaler: 'Magnific Creative',
  magnific_video_upscaler_creative: 'Magnific Video Upscale',
  media_upscale: 'Runway Video Upscale',
  flux_video_upscale: 'FLUX Video Upscale',
};

const notOffered = (name) => `${name} is not offered by Higgsfield. Pick another model.`;

function usable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The binary @higgsfield/cli's postinstall fetched, outside the asar; null when it is not installed. */
function bundledBin() {
  try {
    const pkg = nodeRequire.resolve('@higgsfield/cli/package.json');
    return unpackedPath(path.join(path.dirname(pkg), 'vendor', process.platform === 'win32' ? 'hf.exe' : 'hf'));
  } catch {
    return null;
  }
}

/** `higgsfield` on PATH. Windows' `.cmd` shim cannot be run without a shell, so its binary is named beside it. */
function onPath() {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  if (process.platform === 'win32') {
    return dirs.map((dir) => path.join(dir, 'node_modules', '@higgsfield', 'cli', 'vendor', 'hf.exe')).find(usable);
  }
  return dirs.map((dir) => path.join(dir, 'higgsfield')).find(usable);
}

/**
 * The CLI to run, null when there is none. REAL_GEN_HF_BIN is final when set
 * (main pins the unpacked binary there, tests pin their fake CLI): falling
 * through from it could run a real account from a test. Then the bundled binary,
 * then PATH, then the installer's own path, which a Finder launch has no PATH for.
 */
function resolveBin() {
  const own = process.env.REAL_GEN_HF_BIN?.trim();
  if (own) return usable(own) ? own : null;
  const bin = [bundledBin(), onPath(), hf.DEFAULT_BIN].find((file) => file && usable(file)) ?? null;
  // realgen runs hf.binPath(), so what Settings names is what runs.
  if (bin) process.env.REAL_GEN_HF_BIN = bin;
  return bin;
}

/** `higgsfield --version` → '1.2.2'; null when it refuses to run. */
function versionOf(bin) {
  return new Promise((resolve) => {
    execFile(bin, ['--version'], { timeout: VERSION_MS, windowsHide: true, encoding: 'utf8' }, (error, stdout) => {
      resolve(error ? null : (/\d+\.\d+\.\d+/.exec(String(stdout))?.[0] ?? null));
    });
  });
}

/** `{ path, version, bundled }`, or how to install one when the CLI is missing or refuses to run. */
export async function binaryStatus() {
  const bin = resolveBin();
  const version = bin ? await versionOf(bin) : null;
  if (!version) return { missing: true, install: INSTALL };
  return { path: bin, version, bundled: bin === bundledBin() };
}

/** Free. `{ signedIn: false }` for any failure of `account status`; the email is shown, never logged. */
async function account() {
  try {
    const { json } = await hf.run(['account', 'status'], { timeout: ACCOUNT_MS });
    return {
      label: LABEL,
      email: typeof json?.email === 'string' ? json.email : undefined,
      credits: typeof json?.credits === 'number' ? json.credits : undefined,
      plan: typeof json?.subscription_plan_type === 'string' ? json.subscription_plan_type : undefined,
      signedIn: true,
    };
  } catch {
    return { label: LABEL, signedIn: false };
  }
}

/** Runs the CLI's own browser sign-in until it exits, for five minutes at most. */
function browserSignIn(bin) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['auth', 'login'], { stdio: 'ignore', detached: true, windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Higgsfield sign-in timed out.'));
    }, LOGIN_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.unref();
  });
}

let signingIn; // one browser sign-in at a time

/** Resolves once `account status` works; rejects if the sign-in did not finish. */
function login() {
  signingIn ??= (async () => {
    const bin = resolveBin();
    if (!bin) throw new Error(CLI_MISSING);
    await browserSignIn(bin);
    if (!(await account()).signedIn) throw new Error('Higgsfield sign-in did not finish.');
  })().finally(() => {
    signingIn = undefined;
  });
  return signingIn;
}

async function logout() {
  const r = await hf.exec(['auth', 'logout'], { timeout: ACCOUNT_MS });
  if (r.code !== 0) throw new Error('Higgsfield sign-out failed.');
}

/** `lookupTaskPath(taskId)` is the `/__mock/...` path of a finished task's file (upscales read it). */
export function createHiggsfieldProvider({ lookupTaskPath }) {
  /** The realgen decision for a task, or the sentence that refuses it. */
  function decide(type, options) {
    if (type === 'workflow_aleph_2') return { reason: GRADES };
    if (!OFFERED.has(type)) return { reason: notOffered(NOT_OFFERED[type] ?? 'This') };
    if (!resolveBin()) return { reason: CLI_MISSING };
    const d = mapTask(type, options, { lookupTaskPath });
    // The only offered type that can get here: an upscale whose clip has no file.
    return d.kind === 'higgsfield' ? { d } : { reason: MISSING_CLIP };
  }

  return {
    id: 'higgsfield',
    name: LABEL,
    binaryStatus,
    login,
    logout,

    /** Settles which CLI realgen runs, at boot and before its first call. */
    pinBinary: resolveBin,

    capabilities() {
      return HIGGSFIELD_CAPABILITIES;
    },

    supports(type, options) {
      const { d, reason } = decide(type, options);
      return d ? { ok: true, notes: d.notes } : { ok: false, reason };
    },

    /** realgen's own quote runs the CLI, and a price has to work without one. */
    async quote() {
      return { unit: 'credits', amount: null, note: NO_ESTIMATE };
    },

    /** The pipeline is realgen's; it never rejects, and a task reaches `generate create` once. */
    async start(task, options, env) {
      const { d, reason } = decide(task.type, options);
      if (d) return realgen.start(task, options, d);
      task.real = { ...task.real, state: 'failed', error: reason, hint: realgen.NOT_CHARGED };
      env.persist();
      return undefined;
    },

    snapshot(task, opts) {
      return realgen.snapshotPatch(task, opts);
    },

    artifactMeta(task) {
      return realgen.artifactMeta(task);
    },

    /** Follows a known job id with `generate wait` (free), or fails the task. Never resubmits. */
    resume(task) {
      return realgen.resume(task);
    },

    account,
  };
}
