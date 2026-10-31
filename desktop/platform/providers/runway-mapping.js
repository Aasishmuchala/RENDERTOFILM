// Runway developer API mapping — turns an app task (type + options) into one
// call on Runway's public API. Pure: no I/O and no SDK import, so the table is
// unit-tested and nothing here can spend a credit.
//
// mapRunway(type, options, ctx) returns one of
//   { kind: 'runway', endpoint, model, body, notes, expectedSeconds }
//   { kind: 'unsupported', reason }     reason is the sentence the visitor reads
// endpoint is the SDK resource: textToImage, imageToVideo, videoToVideo,
// imageUpscale or videoUpscale. ctx = { uri?(localUrl), startSize?: { width,
// height } }; uri is applied to every image or video reference (the caller has
// uploaded them first) and defaults to the url itself.
//
// A request this table cannot express is refused in one sentence. Nothing here
// falls back to another model.
//
// Fields, enums, limits: @runwayml/sdk 4.24.0 resources/*.d.ts and
// https://docs.dev.runwayml.com/api (2026-10-31).
import { framesOf, promptOf, refsOf, snapRatio, snapRatioStr, videoRefsOf } from '../realgen/mapping.js';

export const AI_TEXT_SENTENCE =
  'Planning and checks need an AI text provider. Add an Anthropic or OmegaPlus key in Settings.';
export const EXPORTS_SENTENCE = 'Exports run locally.';

/** Bay alias → public model id. `veo3_1` picks its Fast id from `options.model`. */
export const RUNWAY_MODELS = {
  gemini_3_pro: 'gemini_image3_pro',
  nano_banana_2_1: 'nano_banana_2.1',
  gemini_3_1_flash_image: 'gemini_image3.1_flash',
  gpt_image_2_5_sunburst: 'gpt_image_2_5_sunburst',
  gpt_image_2_5_flare: 'gpt_image_2_5_flare',
  gpt_image_2: 'gpt_image_2',
  seedream_5_pro: 'seedream5_pro',
  grok_imagine_image_2: 'grok_imagine_image_2',
  ref_image_to_image: 'gen4_image',
  seedance_2: 'seedance2',
  seedance_2_fast: 'seedance2_fast',
  seedance_2_5: 'seedance2_5',
  kling_3_0_pro: 'kling3.0_pro',
  kling_3_0_4k: 'kling3.0_4k',
  kling_o3_pro: 'klingO3_pro',
  kling_4_0: 'kling_4',
  veo3_1: 'veo3.1',
  'gen4.5': 'gen4.5',
  gen4_turbo: 'gen4_turbo',
  minimax_hailuo_3_0: 'hailuo3',
  workflow_aleph_2: 'aleph2',
  magnific_precision_upscaler_v2: 'magnific_precision_upscaler_v2',
  magnific_video_upscaler_creative: 'magnific_video_upscaler_creative',
};

/** Display names, as src/models.ts spells them. */
const NAMES = {
  gemini_3_pro: 'Nano Banana Pro',
  nano_banana_2_1: 'Nano Banana 2.1',
  gemini_3_1_flash_image: 'Nano Banana 2',
  gpt_image_2_5_sunburst: 'GPT Image 2.5 Sunburst',
  gpt_image_2_5_flare: 'GPT Image 2.5 Flare',
  gpt_image_2: 'GPT Image 2',
  seedream_5_pro: 'Seedream 5.0 Pro',
  grok_imagine_image_2: 'Grok Imagine Image 2',
  ref_image_to_image: 'Gen-4 Image',
  seedance_2: 'Seedance 2.0',
  seedance_2_fast: 'Seedance 2.0 Fast',
  seedance_2_5: 'Seedance 2.5',
  kling_3_0_pro: 'Kling 3.0 Pro',
  kling_3_0_4k: 'Kling 3.0 4K',
  kling_o3_pro: 'Kling O3 Pro',
  kling_4_0: 'Kling 4.0',
  veo3_1: 'Veo 3.1',
  'gen4.5': 'Gen-4.5',
  gen4_turbo: 'Gen-4 Turbo',
  minimax_hailuo_3_0: 'MiniMax H3',
  workflow_aleph_2: 'Aleph',
  magnific_precision_upscaler_v2: 'Magnific Precision',
  magnific_video_upscaler_creative: 'Magnific Video Upscale',
};

/** What the public API has no equivalent for (Phase 12 table). */
const NOT_OFFERED = {
  bfl_flux_2_max: 'FLUX.2 [max]',
  krea_image_3: 'Krea Image 3',
  seedream_5: 'Seedream 5.0',
  ltx_2_5_pro: 'LTX-2.5 Pro',
  wan_2_6: 'Wan 2.6',
  magnific_creative_upscaler: 'Magnific Creative',
  media_upscale: 'Runway Video Upscale',
  flux_video_upscale: 'FLUX Video Upscale',
  bytedance_video_upscale: 'ByteDance Video Upscale',
};

/**
 * Each model's `ratio` union, verbatim from the SDK's .d.ts, grouped by output
 * tier (the `auto*`/`adaptive` entries are in AUTO_RATIO). gen4_image keeps only
 * the pairs gen4ImageSize can ask for. The test compares these to the .d.ts.
 */
const GPT_RATIOS = {
  '1k': ['2048:880', '1920:1088', '1920:1280', '1920:1440', '1920:1536', '1920:1920', '1536:1920', '1440:1920', '1280:1920', '1088:1920'],
  '2k': ['2912:1248', '2560:1440', '2560:1712', '2560:1920', '2560:2048', '2560:2560', '2048:2560', '1920:2560', '1712:2560', '1440:2560'],
  '4k': ['3840:1648', '3840:2160', '3504:2336', '3264:2448', '3200:2560', '2880:2880', '2560:3200', '2448:3264', '2336:3504', '2160:3840'],
};
const SEEDANCE_480 = ['992:432', '864:496', '752:560', '640:640', '560:752', '496:864'];
const SEEDANCE_720 = ['1470:630', '1280:720', '1112:834', '960:960', '834:1112', '720:1280'];
const SEEDANCE_1080 = ['2206:946', '1920:1080', '1664:1248', '1440:1440', '1248:1664', '1080:1920'];
const SEEDANCE_4K = ['3840:1646', '3840:2160', '3840:2880', '3840:3840', '2880:3840', '2160:3840'];

export const RUNWAY_RATIOS = {
  gen4_image: {
    '720p': ['1280:720', '720:1280', '720:720'],
    '1080p': ['1920:1080', '1080:1920', '1080:1080'],
  },
  gemini_image3_pro: {
    '1k': ['1344:768', '768:1344', '1024:1024', '1184:864', '864:1184', '1536:672', '832:1248', '1248:832', '896:1152', '1152:896'],
    '2k': ['2048:2048', '1696:2528', '2528:1696', '1792:2400', '2400:1792', '1856:2304', '2304:1856', '1536:2752', '2752:1536', '3168:1344'],
    '4k': ['4096:4096', '3392:5056', '5056:3392', '3584:4800', '4800:3584', '3712:4608', '4608:3712', '3072:5504', '5504:3072', '6336:2688'],
  },
  'gemini_image3.1_flash': {
    '512': ['512:512', '416:624', '624:416', '432:592', '592:432', '448:576', '576:448', '384:672', '672:384', '768:336', '256:1024', '1024:256', '176:1408', '1408:176'],
    '1k': ['1024:1024', '832:1248', '1248:832', '864:1184', '1184:864', '896:1152', '1152:896', '768:1344', '1344:768', '1536:672', '512:2048', '2048:512', '352:2816', '2816:352'],
    '2k': ['2048:2048', '1696:2528', '2528:1696', '1792:2400', '2400:1792', '1856:2304', '2304:1856', '1536:2752', '2752:1536', '3168:1344', '1024:4096', '4096:1024', '704:5632', '5632:704'],
    '4k': ['4096:4096', '3392:5056', '5056:3392', '3584:4800', '4800:3584', '3712:4608', '4608:3712', '3072:5504', '5504:3072', '6336:2688', '2048:8192', '8192:2048', '1408:11264', '11264:1408'],
  },
  'nano_banana_2.1': {
    '1k': ['1024:1024', '848:1264', '1264:848', '896:1200', '1200:896', '928:1152', '1152:928', '768:1376', '1376:768', '1584:672', '512:2064', '2064:512', '352:2928', '2928:352'],
    '2k': ['2048:2048', '1696:2528', '2528:1696', '1792:2400', '2400:1792', '1856:2304', '2304:1856', '1536:2752', '2752:1536', '3168:1344', '1024:4128', '4128:1024', '704:5856', '5856:704'],
    '4k': ['4096:4096', '3392:5056', '5056:3392', '3584:4800', '4800:3584', '3712:4608', '4608:3712', '3072:5504', '5504:3072', '6336:2688', '2048:8256', '8256:2048', '1408:11712', '11712:1408'],
  },
  gpt_image_2: GPT_RATIOS,
  gpt_image_2_5_sunburst: GPT_RATIOS,
  gpt_image_2_5_flare: GPT_RATIOS,
  seedream5_pro: {
    '1k': ['1024:1024', '1184:896', '896:1184', '1376:768', '768:1376', '1296:864', '864:1296'],
    '2k': ['2048:2048', '2304:1728', '1728:2304', '2720:1530', '1530:2720', '2496:1664', '1664:2496'],
  },
  grok_imagine_image_2: {
    '1k': ['1024:1024', '1280:720', '720:1280', '1152:864', '864:1152', '1248:832', '832:1248', '1248:576', '576:1248', '1280:576', '576:1280', '1408:704', '704:1408'],
    '2k': ['2048:2048', '2816:1584', '1584:2816', '2368:1776', '1776:2368', '2496:1664', '1664:2496', '2912:1344', '1344:2912', '3200:1440', '1440:3200', '2912:1456', '1456:2912'],
  },
  'gen4.5': { '720p': ['1280:720', '720:1280', '1104:832', '960:960', '832:1104', '1584:672'] },
  gen4_turbo: { '720p': ['1280:720', '720:1280', '1104:832', '832:1104', '960:960', '1584:672'] },
  'veo3.1': { '720p': ['1280:720', '720:1280'], '1080p': ['1080:1920', '1920:1080'] },
  'veo3.1_fast': { '720p': ['1280:720', '720:1280'], '1080p': ['1080:1920', '1920:1080'] },
  'kling3.0_pro': { '1080p': ['1920:1080', '1080:1920', '1440:1440'] },
  'kling3.0_4k': { '4k': ['3840:2160', '2160:3840', '2880:2880'] },
  klingO3_pro: { '1080p': ['1920:1080', '1080:1920', '1440:1440'] },
  seedance2: { '480p': SEEDANCE_480, '720p': SEEDANCE_720, '1080p': SEEDANCE_1080, '4k': SEEDANCE_4K },
  seedance2_fast: { '480p': SEEDANCE_480, '720p': SEEDANCE_720 },
  seedance2_5: {
    '480p': ['992:432', '854:480', '752:560', '640:640', '560:752', '480:854'],
    '720p': SEEDANCE_720,
    '1080p': SEEDANCE_1080,
  },
  hailuo3: { any: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] },
};

/** The `auto*`/`adaptive` value per tier: only when neither the app nor the start frame gave a shape. */
const GPT_AUTO = { '1k': 'auto', '2k': 'auto', '4k': 'auto' }; // billed at the 4K tier (pricing page)
const TIER_AUTO = { '1k': 'auto_1k', '2k': 'auto_2k' };
export const AUTO_RATIO = {
  gpt_image_2: GPT_AUTO,
  gpt_image_2_5_sunburst: GPT_AUTO,
  gpt_image_2_5_flare: GPT_AUTO,
  seedream5_pro: TIER_AUTO,
  grok_imagine_image_2: TIER_AUTO,
  hailuo3: { any: 'adaptive' },
  kling_4: { '720p': 'auto_720p', '1080p': 'auto_1080p' },
};

const GPT_SIZES = { 1: '1k', 2: '2k', 4: '4k' };
const GPT_QUALITIES = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Per still: its tier option, default tier, prompt cap, reference cap, tagged references. */
const STILLS = {
  gemini_3_pro: { tier: (o) => o.image_size, fallback: '2k', prompt: 5500, refs: 14, tags: true },
  gemini_3_1_flash_image: { tier: (o) => o.image_size, fallback: '2k', prompt: 5500, refs: 14, tags: true },
  nano_banana_2_1: { tier: (o) => o.resolution, fallback: '2k', prompt: 5500, refs: 14, tags: true },
  gpt_image_2_5_sunburst: { tier: (o) => GPT_SIZES[o.size], fallback: '2k', prompt: 32000, refs: 16, tags: true, qualities: GPT_QUALITIES },
  gpt_image_2_5_flare: { tier: (o) => GPT_SIZES[o.size], fallback: '2k', prompt: 32000, refs: 16, tags: true, qualities: GPT_QUALITIES },
  gpt_image_2: { tier: (o) => GPT_SIZES[o.size], fallback: '2k', prompt: 32000, refs: 16, tags: true, qualities: ['low', 'medium', 'high', 'auto'] },
  seedream_5_pro: { tier: (o) => o.resolution, fallback: '2k', prompt: 4000, refs: 10 },
  grok_imagine_image_2: { tier: (o) => o.resolution, fallback: '2k', prompt: 2500, refs: 3 },
  ref_image_to_image: {
    // gen4ImageSize sends 1920x1088 and 1088x1088 at 1080p: the short side is the tier.
    tier: (o) => (Math.min(o.width, o.height) >= 1080 ? '1080p' : o.width > 0 ? '720p' : undefined),
    fallback: '1080p',
    prompt: 1000,
    refs: 3,
    tags: true,
  },
};

/** Default tier of the clip models that have more than one. */
const CLIP_TIER = {
  seedance_2: '1080p',
  seedance_2_fast: '720p',
  seedance_2_5: '1080p',
  veo3_1: '720p',
  kling_4_0: '1080p',
  minimax_hailuo_3_0: '2k',
};

/** Prompt cap of each clip model, in UTF-16 code units, and whether it has an `audio` switch to turn off. */
const CLIPS = {
  'gen4.5': { prompt: 1000 },
  gen4_turbo: { prompt: 1000 },
  veo3_1: { prompt: 1000, audio: true },
  kling_3_0_pro: { prompt: 2500, audio: true },
  kling_3_0_4k: { prompt: 2500, audio: true },
  kling_o3_pro: { prompt: 2500, audio: true },
  seedance_2: { prompt: 3500, audio: true },
  seedance_2_fast: { prompt: 3500, audio: true },
  seedance_2_5: { prompt: 15000, audio: true },
  minimax_hailuo_3_0: { prompt: 6000 },
  kling_4_0: { prompt: 26000 },
};

const SEEDANCE_REFS = 9;
const HAILUO_REFS = 9;
const KLING_O3_REFS = 7; // keyframes included (inputs page)
const KLING_4_REFS = 10;
const ALEPH_PROMPT = 1000;
const UPSCALE_FACTORS = [2, 4, 8, 16];
const VEO_SECONDS = [4, 6, 8];
const TAG = /^[A-Za-z][A-Za-z0-9_]{2,15}$/;

const IMAGE_SECONDS = 90;
const VIDEO_SECONDS = 300;

// ---------------------------------------------------------------- helpers

const unsupported = (reason) => ({ kind: 'unsupported', reason });
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/** Seconds as the app sent them (`duration` or `seconds`), whole, `fallback` when missing. */
function secondsOf(o, fallback = 5) {
  const n = Number(o.duration ?? o.seconds);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

/** The public model id of an app task, or undefined when the API has no such model. */
export function publicModel(type, options) {
  if (type === 'veo3_1' && options?.model === 'veo-3.1-fast') return 'veo3.1_fast';
  return Object.hasOwn(RUNWAY_MODELS, type) ? RUNWAY_MODELS[type] : undefined;
}

/**
 * The whole seconds a clip runs for on the API, what `body.duration` and the
 * quote both use: the requested length inside the model's documented range,
 * moved only when the API would refuse it.
 */
export function runwaySeconds(type, options) {
  const o = options && typeof options === 'object' ? options : {};
  switch (type) {
    case 'veo3_1': {
      const s = secondsOf(o, 8);
      return VEO_SECONDS.reduce((best, x) => (Math.abs(x - s) < Math.abs(best - s) ? x : best));
    }
    case 'gen4.5':
    case 'gen4_turbo':
      return clamp(secondsOf(o), 2, 10);
    case 'kling_3_0_pro':
    case 'kling_3_0_4k':
    case 'kling_o3_pro':
      return clamp(secondsOf(o), 3, 15);
    case 'kling_4_0':
      return clamp(secondsOf(o), 3, 30);
    case 'seedance_2':
    case 'seedance_2_fast':
      return clamp(secondsOf(o), 4, 15);
    case 'seedance_2_5':
      return clamp(secondsOf(o), 4, 30);
    case 'minimax_hailuo_3_0':
      return clamp(secondsOf(o), 5, 15);
    default:
      return secondsOf(o);
  }
}

/** The output tier a task runs at, `notes` (when given) saying what was not offered. */
export function runwayTier(type, options, notes) {
  const o = options && typeof options === 'object' ? options : {};
  const still = STILLS[type];
  if (still) {
    const v = String(still.tier(o) ?? '').trim().toLowerCase();
    return pickTier(v, RUNWAY_RATIOS[RUNWAY_MODELS[type]], still.fallback, type, notes, still.tier(o));
  }
  if (type === 'veo3_1') return o.resolution === '1080p' ? '1080p' : '720p';
  if (type === 'minimax_hailuo_3_0') return /^768p$/i.test(String(o.resolution)) ? '768p' : '2k';
  if (type === 'kling_4_0') return o.resolution === '720p' ? '720p' : '1080p';
  const tiers = RUNWAY_RATIOS[publicModel(type, o)];
  const fallback = CLIP_TIER[type];
  if (!tiers || !fallback) return undefined;
  return pickTier(String(o.resolution ?? '').trim().toLowerCase(), tiers, fallback, type, notes, o.resolution);
}

function pickTier(value, tiers, fallback, type, notes, asked) {
  if (Object.hasOwn(tiers, value)) return value;
  if (notes && asked !== undefined && asked !== null && asked !== '') {
    notes.push(`${NAMES[type]} at ${asked} is not offered; using ${fallback}`);
  }
  return fallback;
}

/** The ratio in `list` the app asked for: `aspectRatio`, width/height, or a WxH resolution. */
function askedRatio(o, list) {
  const asked = snapRatioStr(o.aspectRatio ?? o.aspect_ratio, list);
  if (asked) return asked;
  const sized = snapRatio(o.width, o.height, list);
  if (sized) return sized;
  const wxh = /(\d+)\s*x\s*(\d+)/i.exec(typeof o.resolution === 'string' ? o.resolution : '');
  return wxh ? snapRatio(Number(wxh[1]), Number(wxh[2]), list) : undefined;
}

/** What the app asked for, else the start frame's own shape, else undefined. */
function shapedRatio(o, list, ctx) {
  const asked = askedRatio(o, list);
  if (asked) return asked;
  return ctx.startSize ? snapRatio(ctx.startSize.width, ctx.startSize.height, list) : undefined;
}

/** A clip's ratio inside its tier: the app's, else the start frame's, else landscape. */
function clipRatio(o, list, ctx) {
  return shapedRatio(o, list, ctx) ?? snapRatio(16, 9, list);
}

/** The prompt cut to the model's cap at a sentence end; undefined when there is none. */
function promptFor(o, max, type, notes) {
  const text = promptOf(o);
  if (text.length <= max) return text || undefined;
  notes.push(`${NAMES[type]} takes ${max} prompt characters; the rest is cut`);
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  return end > max * 0.6 ? cut.slice(0, end + 1) : cut;
}

/** The first `max` entries, noting what was dropped. */
function capped(list, max, noun, type, notes) {
  if (list.length <= max) return list;
  notes.push(`${list.length} ${noun}; ${NAMES[type]} takes ${max} on the Runway API, the rest are dropped`);
  return list.slice(0, max);
}

/** The body with its unset keys removed: the API refuses an empty `promptText`. */
function clean(body) {
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
}

function call(endpoint, model, body, notes, expectedSeconds) {
  return { kind: 'runway', endpoint, model, body: clean(body), notes, expectedSeconds };
}

/** `[{ uri, position: 'first' }, { uri, position: 'last' }?]`. */
function keyframes(f, ctx) {
  return [
    { uri: ctx.uri(f.start), position: 'first' },
    ...(f.end ? [{ uri: ctx.uri(f.end), position: 'last' }] : []),
  ];
}

/** Seedance and H3 have two modes that cannot be mixed: typed keyframes, or references with no position. */
function framesOrReferences(f, max, type, ctx, notes) {
  if (f.extras.length === 0) return keyframes(f, ctx);
  const urls = [...new Set([f.start, ...f.extras])];
  return capped(urls, max, 'reference images', type, notes).map((url) => ({ uri: ctx.uri(url) }));
}

// ---------------------------------------------------------------- mapping

function still(type, o, ctx, notes) {
  const model = RUNWAY_MODELS[type];
  const s = STILLS[type];
  const tier = runwayTier(type, o, notes);
  const list = RUNWAY_RATIOS[model][tier];
  const promptText = promptFor(o, s.prompt, type, notes);
  if (!promptText) return unsupported(`${NAMES[type]} needs a prompt.`);

  const tags = new Map((o.referenceImages ?? o.reference_images ?? []).map((r) => [r?.url, r?.tag]));
  const referenceImages = capped(refsOf(o), s.refs, 'reference images', type, notes).map((url) => {
    const tag = tags.get(url);
    return s.tags && TAG.test(tag ?? '') ? { uri: ctx.uri(url), tag } : { uri: ctx.uri(url) };
  });

  let quality;
  if (s.qualities) {
    quality = o.quality ?? 'high';
    if (!s.qualities.includes(quality)) {
      notes.push(`${NAMES[type]} quality ${quality} is not offered; using high`);
      quality = 'high';
    }
  }
  return call('textToImage', model, {
    model,
    promptText,
    ratio: shapedRatio(o, list, ctx) ?? AUTO_RATIO[model]?.[tier] ?? snapRatio(16, 9, list),
    referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
    quality,
    edit: type === 'grok_imagine_image_2' && o.edit === true && referenceImages.length > 0 ? true : undefined,
  }, notes, IMAGE_SECONDS);
}

/** Everything a clip on `imageToVideo` shares: prompt, seconds and the audio switch. */
function clipBody(type, model, o, notes) {
  const c = CLIPS[type];
  const asked = secondsOf(o, runwaySeconds(type, o));
  const duration = runwaySeconds(type, o);
  if (asked !== duration) notes.push(`${NAMES[type]} runs ${duration} s on the Runway API, not ${asked} s`);
  return {
    model,
    promptText: promptFor(o, c.prompt, type, notes),
    duration,
    // On by default, and the rate card is the no-audio one.
    audio: c.audio ? false : undefined,
  };
}

const imageToVideo = (model, body, notes) => call('imageToVideo', model, body, notes, VIDEO_SECONDS);

function clip(type, o, ctx, notes) {
  const model = publicModel(type, o);
  const name = NAMES[type];
  const videos = videoRefsOf(o);
  if (videos.length > 0 && type !== 'kling_4_0') {
    return unsupported(`${name} cannot take a reference video on the Runway API.`);
  }
  const kling = type === 'kling_3_0_pro' || type === 'kling_3_0_4k' || type === 'kling_4_0';
  const f = framesOf(o, { kling });
  if (type === 'kling_4_0' && videos.length > 0) return klingVideo(o, f, videos, ctx, notes);
  if (!f.start) return unsupported(`${name} needs a start frame.`);
  const body = clipBody(type, model, o, notes);

  switch (type) {
    case 'gen4.5':
    case 'gen4_turbo': {
      if (!body.promptText && type === 'gen4.5') return unsupported(`${name} needs a prompt.`);
      if (f.end) notes.push(`${name} takes a first frame only on the Runway API; the end frame is dropped`);
      if (f.middle > 0) notes.push(`${f.middle} middle keyframe(s) dropped; ${name} takes a first frame only`);
      return imageToVideo(model, {
        ...body,
        promptImage: [{ uri: ctx.uri(f.start), position: 'first' }],
        ratio: clipRatio(o, RUNWAY_RATIOS[model]['720p'], ctx),
      }, notes);
    }
    case 'veo3_1': {
      const list = RUNWAY_RATIOS[model][runwayTier(type, o)];
      return imageToVideo(model, {
        ...body,
        promptImage: keyframes(f, ctx),
        ratio: clipRatio(o, list, ctx),
        negativePrompt: typeof o.negative_prompt === 'string' ? o.negative_prompt.slice(0, 1000) : undefined,
      }, notes);
    }
    case 'kling_3_0_pro':
    case 'kling_3_0_4k': {
      const list = Object.values(RUNWAY_RATIOS[model])[0];
      return imageToVideo(model, { ...body, promptImage: keyframes(f, ctx), ratio: clipRatio(o, list, ctx) }, notes);
    }
    case 'kling_o3_pro': {
      const frames = keyframes(f, ctx);
      const references = capped(f.extras, KLING_O3_REFS - frames.length, 'reference images', type, notes);
      return imageToVideo(model, {
        ...body,
        promptImage: frames,
        ratio: clipRatio(o, RUNWAY_RATIOS[model]['1080p'], ctx),
        references: references.length > 0 ? references.map((url) => ({ uri: ctx.uri(url) })) : undefined,
      }, notes);
    }
    case 'kling_4_0':
      return imageToVideo(model, {
        ...body,
        promptImage: keyframes(f, ctx),
        ratio: AUTO_RATIO[model][runwayTier(type, o)],
      }, notes);
    case 'seedance_2':
    case 'seedance_2_fast':
    case 'seedance_2_5': {
      const list = RUNWAY_RATIOS[model][runwayTier(type, o, notes)];
      return imageToVideo(model, {
        ...body,
        promptImage: framesOrReferences(f, SEEDANCE_REFS, type, ctx, notes),
        ratio: clipRatio(o, list, ctx),
      }, notes);
    }
    default: {
      // minimax_hailuo_3_0
      if (!body.promptText) return unsupported(`${name} needs a prompt.`);
      return imageToVideo(model, {
        ...body,
        promptImage: framesOrReferences(f, HAILUO_REFS, type, ctx, notes),
        ratio: askedRatio(o, RUNWAY_RATIOS[model].any) ?? AUTO_RATIO[model].any,
        resolution: runwayTier(type, o),
      }, notes);
    }
  }
}

/** Recreate's Kling route: an edit of the reference clip. Length and framing follow the source. */
function klingVideo(o, f, videos, ctx, notes) {
  const type = 'kling_4_0';
  const model = RUNWAY_MODELS[type];
  const frames = [f.start, f.end].filter(Boolean);
  const references = capped([...frames, ...f.extras], KLING_4_REFS, 'reference images', type, notes);
  const kept = capped(videos, 1, 'reference videos', type, notes);
  return call('videoToVideo', model, {
    model,
    videoUri: ctx.uri(kept[0]),
    promptText: promptFor(o, CLIPS[type].prompt, type, notes) ?? 'Recreate this shot.',
    ratio: AUTO_RATIO[model][runwayTier(type, o)],
    references: references.length > 0 ? references.map((url) => ({ uri: ctx.uri(url) })) : undefined,
  }, notes, VIDEO_SECONDS);
}

/** The decision for one app task; see the header for the two shapes. */
export function mapRunway(type, options, ctx) {
  const o = options && typeof options === 'object' ? options : {};
  const c = { uri: ctx?.uri ?? ((url) => url), startSize: ctx?.startSize };
  const notes = [];
  if (Object.hasOwn(NOT_OFFERED, type)) {
    return unsupported(`${NOT_OFFERED[type]} is not offered by the Runway API. Pick another model.`);
  }
  if (Object.hasOwn(STILLS, type)) return still(type, o, c, notes);
  if (Object.hasOwn(CLIPS, type)) return clip(type, o, c, notes);
  switch (type) {
    case 'claude_api':
      return unsupported(AI_TEXT_SENTENCE);
    case 'media_processing_v2':
      return unsupported(EXPORTS_SENTENCE);
    case 'workflow_aleph_2': {
      const model = RUNWAY_MODELS[type];
      if (typeof o.input_video !== 'string') return unsupported('Aleph needs a clip to work on.');
      return call('videoToVideo', model, {
        model,
        videoUri: c.uri(o.input_video),
        promptText: promptFor(o, ALEPH_PROMPT, type, notes),
      }, notes, VIDEO_SECONDS);
    }
    case 'magnific_precision_upscaler_v2': {
      const model = RUNWAY_MODELS[type];
      if (typeof o.image?.url !== 'string') return unsupported('Magnific Precision needs an image to work on.');
      const asked = Number(o.scaleFactor);
      return call('imageUpscale', model, {
        model,
        imageUri: c.uri(o.image.url),
        scaleFactor: UPSCALE_FACTORS.includes(asked) ? asked : 2,
        flavor: 'photo',
        ultraDetail: o.ultraDetail,
      }, notes, IMAGE_SECONDS);
    }
    case 'magnific_video_upscaler_creative': {
      const model = RUNWAY_MODELS[type];
      if (typeof o.video?.url !== 'string') return unsupported('Magnific Video Upscale needs a clip to work on.');
      return call('videoUpscale', model, { model, videoUri: c.uri(o.video.url), resolution: '4k' }, notes, VIDEO_SECONDS);
    }
    default:
      return unsupported(`${String(type)} is not offered by the Runway API. Pick another model.`);
  }
}
