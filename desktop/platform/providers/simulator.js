// The simulator: a provider that spends nothing. Each task "renders" for a fixed
// time by model family, then succeeds with a mock still or clip URL. Its text
// answers are canned, each in the shape its caller parses. In the desktop app it
// is offered only under RTF_SIMULATOR=1; the plain harness runs on it by default.
import { SIMULATOR_CAPABILITIES } from '../bay/capabilities.js';

// Image families (prefix match): gpt_image_2* and seedream_5* included.
const IMAGE_TYPES = [
  'gemini_3_pro',
  'gemini_3_1_flash_image',
  'nano_banana_2_1',
  'gpt_image_2',
  'seedream_5',
  'bfl_flux_2_max',
  'grok_imagine_image_2',
  'krea_image_3',
  'ref_image_to_image',
];
const VIDEO_TYPES = [
  'seedance_2',
  'kling_',
  'gen4.5',
  'gen4_turbo',
  'veo3_1',
  'minimax_hailuo_3_0',
  'ltx_2_5_pro',
  'wan_2_6',
  'workflow_aleph',
];
const CLIP_UPSCALERS = ['media_upscale', 'flux_video_upscale', 'bytedance_video_upscale', 'magnific_video_upscaler_creative'];

/** Which simulated family a task type belongs to, and how long it "renders". */
function familyOf(type, options = {}) {
  if (type === 'claude_api') return { family: 'text', seconds: 5 };
  // A film export or a trim is a clip; frame capture stays a still.
  if (type === 'media_processing_v2' && ['timeline_export', 'trim', 'stitch'].includes(options.operation))
    return { family: 'video', seconds: 12 };
  if (CLIP_UPSCALERS.includes(type)) return { family: 'upscale-clip', seconds: 8 };
  if (type.startsWith('magnific_')) return { family: 'upscale-still', seconds: 5 };
  if (VIDEO_TYPES.some((t) => type.startsWith(t))) return { family: 'video', seconds: 12 };
  if (IMAGE_TYPES.some((t) => type.startsWith(t))) return { family: 'image', seconds: 6 };
  return { family: 'image', seconds: 6 }; // unknown types: treated as a still
}

// Look keywords; the one that appears earliest in the prompt wins.
const LOOK_KEYWORDS = [
  ['blue hour', 'blue-hour'],
  ['golden', 'golden-hour'],
  ['overcast', 'overcast'],
  ['rain', 'after-rain'],
  ['moonlit', 'moonlit'],
  ['moon', 'moonlit'],
  ['night', 'night-lit'],
];

export function lookFromPrompt(prompt) {
  const text = String(prompt ?? '').toLowerCase();
  let best = { at: Infinity, look: 'golden-hour' };
  for (const [word, look] of LOOK_KEYWORDS) {
    const m = new RegExp(`\\b${word}`).exec(text);
    if (m && m.index < best.at) best = { at: m.index, look };
  }
  return best.look;
}

const PASS_REPORT = {
  verdict: 'pass',
  score: 9,
  summary: 'Every person reads as photographed in the scene.',
  checks: [
    { id: 'scale', ok: true, note: 'Heights match the seating and steps beside them.' },
    { id: 'grounding', ok: true, note: 'Feet planted, weight believable.' },
    { id: 'light', ok: true, note: 'Key and shadows match the scene.' },
    { id: 'faces', ok: true, note: 'Natural faces and hands.' },
    { id: 'blend', ok: true, note: 'Same grade and grain as the plate.' },
    { id: 'fidelity', ok: true, note: 'Architecture unchanged.' },
  ],
  fixes: '',
};
const ISSUES_REPORT = {
  ...PASS_REPORT,
  verdict: 'issues',
  score: 6,
  checks: PASS_REPORT.checks.map((c) =>
    c.id === 'scale'
      ? { ...c, ok: false, note: 'The woman on the left is about a head too tall against the step beside her.' }
      : c.id === 'light'
        ? { ...c, ok: false, note: 'Her shadow falls the wrong way.' }
        : c
  ),
  fixes:
    'Make the woman on the left shorter, her head level with the top of the step; cast her shadow to the right like the trees.',
};

/**
 * The shot director's answer (src/shot-director-api.ts). The visitor is a
 * person on purpose, so a still with no crowd shows the people rule removing
 * them; the lamp post is static but listed as moving, so the drop shows too.
 */
const SHOT_ANSWER = {
  inventory: [
    { id: 'pool', name: 'the long reflecting pool', where: 'centre, lower half', kind: 'water', moves: true },
    { id: 'hedge', name: 'the low box hedge on the left', where: 'left third, foreground', kind: 'vegetation', moves: true },
    { id: 'pavilion', name: 'the timber pavilion', where: 'right third, middle ground', kind: 'structure', moves: false },
    { id: 'lamp-post', name: 'the bronze lamp post', where: 'right edge', kind: 'object', moves: false },
    { id: 'paving', name: 'the pale stone paving', where: 'lower edge', kind: 'ground', moves: false },
    { id: 'sky', name: 'the clear evening sky', where: 'top band', kind: 'sky', moves: false },
    { id: 'visitor', name: 'the woman at the pool edge', where: 'centre left, middle ground', kind: 'people', moves: true },
  ],
  people: { present: true, count: 1, action: 'the visitor turns her head toward the pavilion and stops' },
  camera: { move: 'pan-right', from: 'pool', to: 'pavilion', why: 'the eye already travels that way' },
  moving: [
    { id: 'pool', how: 'ripples slowly, reflections sliding' },
    { id: 'hedge', how: 'leaves stir in a light breeze' },
    { id: 'lamp-post', how: 'sways gently' },
  ],
  beats: [
    { at: 0, what: 'the shot opens on the pool and its reflections' },
    { at: 0.5, what: 'the camera passes the hedge as the ripples settle' },
    { at: 1, what: 'the camera comes to rest on the timber pavilion' },
  ],
  focus: { start: 'pool', end: 'pavilion' },
  end: 'the timber pavilion beyond the still pool',
  rationale: 'The eye travels from the water to the pavilion.',
};

const LIFESTYLE_GRAMMARS = ['wide', 'mid', 'close', 'detail', 'empty', 'wide'];
const LIFESTYLE_CHAPTERS = ['morning', 'play', 'together', 'golden'];

/**
 * The Lifestyle planner's answer for `count` renders, in the shape
 * src/lifestyle-api.ts parses (also read by .router/lifestyle-plan-parse.ts).
 */
export function lifestylePlanAnswer(count) {
  return {
    frames: Array.from({ length: count }, (_, i) => {
      const grammar = LIFESTYLE_GRAMMARS[i % LIFESTYLE_GRAMMARS.length];
      const people = grammar !== 'detail' && grammar !== 'empty';
      return {
        image: i + 1,
        setting: 'exterior',
        space: 'pool garden',
        chapter: LIFESTYLE_CHAPTERS[i % LIFESTYLE_CHAPTERS.length],
        position: 10 * (i + 1),
        title: `By the pool ${i + 1}`,
        grammar,
        moment: '',
        keep: 'the pool, the timber pavilions, the palms and the pink paving',
        crop: grammar === 'close' || grammar === 'detail' ? 'the nearest lounger at bottom left' : '',
        people: people
          ? 'The mother walks slowly along the far edge of the pool.'
          : 'No people. The water catching the light beside the nearest lounger.',
        cast: people ? ['mother'] : [],
        why: 'A calm frame that suits its chapter.',
      };
    }),
  };
}

// Every duration is multiplied by this (e.g. MOCK_TASK_SCALE=0.2 for fast QA).
export const SCALE = Number(process.env.MOCK_TASK_SCALE ?? 1) || 1;

let failNext = false;

/** Test hook: the next created task fails. */
export function __mockFailNext() {
  failNext = true;
}

/** The result a finished task points at (path only; origin added on read). */
function resultFor(type, family, options) {
  if (family === 'text') return {};
  if (family === 'video' || family === 'upscale-clip') return { path: '/__mock/assets/clip.mp4' };
  if (family === 'upscale-still') {
    const url = options?.image?.url;
    const m = typeof url === 'string' ? /\/__mock\/assets\/[\w-]+\.jpg$/.exec(url) : null;
    return { path: m ? m[0] : '/__mock/assets/golden-hour.jpg' };
  }
  const prompt = options?.text_prompt ?? options?.prompt ?? options?.textPrompt;
  return { path: `/__mock/assets/${lookFromPrompt(prompt)}.jpg` };
}

function promptOf(options) {
  const p = options?.text_prompt ?? options?.prompt ?? options?.textPrompt;
  return typeof p === 'string' ? p : '';
}

/** `getState()` is tasks.json in memory; `mockOrigin()` gives a result's absolute URL. */
export function createSimulatorProvider({ getState, mockOrigin }) {
  /** Fills in `task` ({ id, type, createdAt, ... }): its family, its timer and its canned result. */
  function prepare(task, options) {
    const { family, seconds } = familyOf(task.type, options);
    const fail = failNext || promptOf(options).includes('MOCK_FAIL');
    failNext = false;
    return Object.assign(task, {
      family,
      durationMs: (fail ? Math.min(seconds, 2) : seconds) * 1000 * SCALE,
      fail,
      // Recorded so tests can see which model a task asked for.
      model: typeof options.model === 'string' ? options.model : undefined,
      // And, for a clip, the prompt and frames it was sent.
      ...(family === 'video'
        ? { request: { textPrompt: options.textPrompt ?? options.text_prompt, referenceImages: options.referenceImages } }
        : {}),
      ...resultFor(task.type, family, options),
    });
  }

  /** The text of a finished Claude task. Each answers in the shape its caller parses (by task name). */
  function answer(task, options) {
    if (task.family !== 'text' || task.fail) return;
    const s = getState();
    const name = String(options?.name ?? '');
    if (name.includes('close-up finder')) {
      const n = Math.max(1, Math.min(6, Number(/Find the (\d+)/.exec(String(options?.prompt ?? ''))?.[1] ?? 4)));
      const frames = Array.isArray(options?.images) ? options.images.length : 1;
      const subjects = ['the bronze crane sculpture on the left', 'water sheeting down the stone wall', 'the street lamp head against the sky', 'planting at the pool edge', 'stone texture where the light grazes it', 'reflections in the pool'];
      task.text = JSON.stringify({ shots: Array.from({ length: n }, (_, i) => ({ frame: (i % frames) + 1, subject: subjects[i % subjects.length], framing: 'tight close-up, 100mm, subject in the left third', why: 'Strong texture caught by low light.' })) });
    } else if (name.includes('editor')) {
      task.text = JSON.stringify({ reply: 'Set half-second fades between the cuts.', transition: 'fade', fadeSeconds: 0.5 });
    } else if (name.includes('lifestyle plan')) {
      task.text = JSON.stringify(lifestylePlanAnswer(Array.isArray(options?.images) ? options.images.length : 1));
    } else if (name.includes('shot director')) {
      task.text = JSON.stringify(SHOT_ANSWER);
    } else {
      // Alternate pass / issues on successive people checks.
      task.text = JSON.stringify(s.checks % 2 === 0 ? PASS_REPORT : ISSUES_REPORT);
      s.checks += 1;
    }
  }

  return {
    id: 'simulator',
    name: 'Simulator',
    prepare,
    answer,

    capabilities() {
      return SIMULATOR_CAPABILITIES;
    },

    supports() {
      return { ok: true, notes: [] };
    },

    /** A timer needs no run: the snapshot reads `createdAt`, so there is nothing to resume either. */
    async start(task, options, env) {
      task.real = { kind: 'simulator' };
      answer(prepare(task, options), options);
      env.persist();
    },

    snapshot(task, opts = {}) {
      const elapsed = Date.now() - task.createdAt;
      const done = elapsed >= task.durationMs;
      const snap = {
        id: task.id,
        done,
        status: done ? (task.fail ? 'FAILED' : 'SUCCEEDED') : elapsed < 500 ? 'PENDING' : 'RUNNING',
        progress: Math.max(0, Math.min(1, elapsed / task.durationMs)),
      };
      if (done && task.fail) {
        snap.error = 'Mock failure for testing.';
        snap.hint = 'Try again.';
      }
      if (done && !task.fail && task.path) snap.url = `${mockOrigin()}${task.path}`;
      if (done && !task.fail && opts.includeText && task.text !== undefined) {
        snap.text = task.text;
        snap.truncated = false;
      }
      return snap;
    },

    artifactMeta() {
      return {};
    },

    resume() {},

    async account() {
      return { label: 'Simulator', signedIn: true };
    },
  };
}
