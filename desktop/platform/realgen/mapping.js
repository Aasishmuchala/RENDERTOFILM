// Real-mode mapping — turns a Runway task (type + options) into a Higgsfield
// CLI call. Pure: no I/O, so the table is unit-tested and `generate cost` can
// vouch for any decision before a credit is spent.
//
// mapTask(type, options, ctx) returns one of
//   { kind: 'simulated', reason }                the stub keeps its canned answer
//   { kind: 'passthrough', path, reason }        the result is a file already on disk
//   { kind: 'higgsfield', family, model, params, prompt, media, expectedSeconds, notes }
//                                                (prompt is null for a model that takes none)
// and argsFor(decision, mediaIds) is the argv after `higgsfield generate create|cost`.
// ctx = { lookupTaskPath?(taskId), startSize?: { width, height } }.
import { stripOrigin } from './files.js';

// ---------------------------------------------------------------- enums

const NANO_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '9:16', '16:9', '21:9'];
const KLING_RATIOS = ['16:9', '9:16', '1:1'];
const VIDEO_RATIOS = ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];

/** What Higgsfield accepts, from `higgsfield model get <model> --json` (2026-10-29). */
export const HF_ENUMS = {
  nano_banana_2_1: {
    aspect_ratio: ['auto', ...NANO_RATIOS, '4:1', '1:4', '8:1', '1:8'],
    resolution: ['1k', '2k', '4k'],
    thinking_level: ['minimal', 'medium', 'high'],
  },
  nano_banana_pro: { aspect_ratio: NANO_RATIOS, resolution: ['1k', '2k', '4k'] },
  nano_banana_flash: { aspect_ratio: ['auto', ...NANO_RATIOS], resolution: ['1k', '2k', '4k'] },
  gpt_image_2_5: {
    aspect_ratio: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9', '27:16', '16:27', '9:8', '8:9', '4:5', '5:4'],
    quality: ['low', 'medium', 'high', 'xhigh', 'max'],
    resolution: ['1k', '2k', '4k'],
    variant: ['flare', 'sunburst'],
  },
  gpt_image_2: {
    aspect_ratio: ['auto', '1:1', '4:3', '3:4', '16:9', '21:9', '9:16', '3:2', '2:3', '4:5', '5:4'],
    quality: ['low', 'medium', 'high'],
    resolution: ['1k', '2k', '4k'],
  },
  seedream_v5_pro: {
    aspect_ratio: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
    resolution: ['1k', '1.5k', '2k'],
  },
  seedream_5_0_flash: {
    aspect_ratio: ['auto', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
    resolution: ['1k', '1.5k', '2k'],
  },
  flux_2: {
    aspect_ratio: ['1:1', '4:3', '3:4', '16:9', '9:16'],
    resolution: ['1k', '2k'],
    variant: ['pro', 'flex', 'max'],
  },
  grok_image_2_0: {
    aspect_ratio: ['1:1', 'auto', '1:2', '2:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'],
    quality: ['low', 'medium'],
    resolution: ['1k', '2k'],
  },
  kling3_0: { aspect_ratio: KLING_RATIOS, mode: ['std', 'pro', '4k'], sound: ['on', 'off'] },
  kling4_0: {
    aspect_ratio: ['21:9', '16:9', '9:16', '1:1', 'auto'],
    mode: ['text-to-video', 'image-to-video', 'reference-to-video', 'video-edit'],
    resolution: ['720p', '1080p'],
  },
  kling_o3_flf: { aspect_ratio: KLING_RATIOS, mode: ['std', 'pro', '4k'], sound: ['on', 'off'] },
  seedance_2_0: {
    aspect_ratio: ['auto', '16:9', '9:16', '4:3', '3:4', '1:1', '21:9'],
    mode: ['std', 'fast'],
    resolution: ['480p', '720p', '1080p', '4k'],
  },
  seedance_2_5: {
    aspect_ratio: VIDEO_RATIOS,
    mode: ['omni_reference'],
    resolution: ['480p', '720p', '1080p'],
  },
  veo3_1: {
    aspect_ratio: ['16:9', '9:16'],
    duration: [4, 6, 8],
    quality: ['basic', 'high', 'ultra'],
    variant: ['veo-3-1-preview', 'veo-3-1-fast'],
  },
  minimax_h3: { aspect_ratio: VIDEO_RATIOS, resolution: ['2K'] },
  wan2_6: { aspect_ratio: KLING_RATIOS, duration: [5, 10, 15], quality: ['720p', '1080p'] },
  bytedance_video_upscale: {
    model_version: ['standard', 'pro'],
    preset: ['common', 'aigc', 'short_series', 'ugc', 'old_film'],
    resolution: ['1080p', '2k', '4k'],
  },
};

const IMAGE_SECONDS = 90;
const VIDEO_SECONDS = 300;

// ---------------------------------------------------------------- helpers

/** The prompt, whichever key the task type uses for it. */
export function promptOf(o) {
  const p = o?.prompt ?? o?.text_prompt ?? o?.textPrompt;
  return typeof p === 'string' ? p : '';
}

/** The reference image elements, in the app's order (urls plus any `type`/`tag`). */
function refItems(o) {
  const list = o?.referenceImages ?? o?.reference_images ?? [];
  return (Array.isArray(list) ? list : []).filter((r) => typeof r?.url === 'string');
}

/** The reference image urls, in the app's order. */
export function refsOf(o) {
  return refItems(o).map((r) => r.url);
}

/** The reference video urls, in the app's order. */
export function videoRefsOf(o) {
  const list = o?.referenceVideos ?? o?.reference_videos ?? [];
  return (Array.isArray(list) ? list : []).filter((r) => typeof r?.url === 'string').map((r) => r.url);
}

/** The allowed ratio nearest width:height (compared in log space); 'auto' never wins. */
export function snapRatio(width, height, allowed) {
  if (!(width > 0) || !(height > 0)) return undefined;
  const target = Math.log(width / height);
  let best;
  let bestDist = Infinity;
  for (const r of allowed) {
    if (r === 'auto') continue;
    const [w, h] = r.split(':').map(Number);
    if (!(w > 0) || !(h > 0)) continue;
    const d = Math.abs(Math.log(w / h) - target);
    if (d < bestDist) {
      best = r;
      bestDist = d;
    }
  }
  return best;
}

/** `snapRatio` for a 'w:h' string; undefined when it is not one ('auto', 'adaptive', ...). */
export function snapRatioStr(ratio, allowed) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(String(ratio ?? ''));
  return m ? snapRatio(Number(m[1]), Number(m[2]), allowed) : undefined;
}

/** Kling takes 5 or 10 s here: short clips cost the 5 s quote, longer ones the 10 s. */
export function klingSeconds(s) {
  return s > 7 ? 10 : 5;
}

/** The first `max` urls, noting what was dropped. */
function clampRefs(urls, max, notes, noun = 'reference images') {
  if (urls.length <= max) return urls;
  notes.push(`${urls.length} ${noun}; Higgsfield takes ${max}, the rest are dropped`);
  return urls.slice(0, max);
}

/** The output ratio: what the app asked for, else width/height, else a WxH resolution, else the start frame. */
function ratioOf(o, allowed, ctx, fallback) {
  const asked = snapRatioStr(o.aspectRatio ?? o.aspect_ratio, allowed);
  if (asked) return asked;
  const sized = snapRatio(o.width, o.height, allowed);
  if (sized) return sized;
  const wxh = /(\d+)\s*x\s*(\d+)/i.exec(typeof o.resolution === 'string' ? o.resolution : '');
  const parsed = wxh && snapRatio(Number(wxh[1]), Number(wxh[2]), allowed);
  if (parsed) return parsed;
  const frame = ctx.startSize && snapRatio(ctx.startSize.width, ctx.startSize.height, allowed);
  return frame || fallback;
}

/** A still's ratio; 'auto' (follow the reference) when the model has it and the app sent none. */
function stillRatio(model, o, ctx) {
  const allowed = HF_ENUMS[model].aspect_ratio;
  return ratioOf(o, allowed, ctx, allowed.includes('auto') ? 'auto' : '16:9');
}

/** A clip's ratio; the start frame's own, else 16:9. */
function clipRatio(model, o, ctx) {
  return ratioOf(o, HF_ENUMS[model].aspect_ratio, ctx, '16:9');
}

/** `value` (lower-cased) when `model` offers it for `key`, else `fallback` with a note. */
function pick(model, key, value, fallback, notes, allowed = HF_ENUMS[model][key]) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : value;
  if (allowed.includes(v)) return v;
  if (value !== undefined && value !== null && value !== '') {
    notes.push(`${model} ${key} ${value} is not offered; using ${fallback}`);
  }
  return fallback;
}

/** The option in `options` nearest `value`, `fallback` when there is no number. */
function nearest(value, options, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return options.reduce((best, x) => (Math.abs(x - n) < Math.abs(best - n) ? x : best));
}

/** Seconds as the app sent them (`duration` or `seconds`), whole, `fallback` when missing. */
function secondsOf(o, fallback = 5) {
  const n = Number(o.duration ?? o.seconds);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

const SIZE_TO_RES = { 1: '1k', 2: '2k', 4: '4k' };

function still(model, o, notes, params, max = Infinity) {
  return {
    kind: 'higgsfield',
    family: 'image',
    model,
    params,
    prompt: promptOf(o),
    media: clampRefs(refsOf(o), max, notes).map((url) => ({ flag: '--image', url })),
    expectedSeconds: IMAGE_SECONDS,
    notes,
  };
}

/**
 * A clip's frames. start: the explicit start, the first keyframe, else the
 * first reference. end: the explicit end, the keyframe at the last second, a
 * reference typed end_frame, else (Kling types) the second reference. A plain
 * list (first element untyped, more than one) sends its tail as references.
 */
export function framesOf(o, { kling = false } = {}) {
  const items = refItems(o);
  const keyframes = Array.isArray(o.keyframes) ? o.keyframes : [];
  const endKey = keyframes.findLast((k, i) => i > 0 && k?.timestamp === secondsOf(o));
  const start = o.startFrame?.url ?? o.init_image ?? keyframes[0]?.image ?? items[0]?.url;
  const end =
    o.endFrame?.url ??
    endKey?.image ??
    items.find((r) => r.type === 'end_frame')?.url ??
    (kling ? items[1]?.url : undefined);
  const plain = items.length > 1 && items[0].type === undefined && !kling;
  return {
    start,
    end,
    extras: plain ? items.slice(1).map((r) => r.url) : [],
    middle: keyframes.filter((k, i) => i > 0 && k !== endKey).length,
  };
}

export function framesMedia({ start, end, extras }) {
  return [
    ...(start ? [{ flag: '--start-image', url: start }] : []),
    ...(end ? [{ flag: '--end-image', url: end }] : []),
    ...extras.map((url) => ({ flag: '--image-references', url })),
  ];
}

function clip(model, o, notes, params, media) {
  return {
    kind: 'higgsfield',
    family: 'video',
    model,
    params,
    prompt: promptOf(o),
    media,
    expectedSeconds: VIDEO_SECONDS,
    notes,
  };
}

/** A Gen-4.5 / Gen-4 Turbo / LTX request run as a Kling 3.0 standard clip. */
function klingStandard(o, ctx, notes, frames, withEnd) {
  const media = framesMedia({ ...frames, end: withEnd ? frames.end : undefined, extras: [] });
  return clip('kling3_0', o, notes, {
    mode: 'std',
    sound: 'off',
    duration: klingSeconds(secondsOf(o)),
    aspect_ratio: clipRatio('kling3_0', o, ctx),
  }, media);
}

const simulated = (reason) => ({ kind: 'simulated', reason });

/** A pass-through of a file that is already one of the stub's own. */
function passthrough(mockPath, reason, missing) {
  return typeof mockPath === 'string' && mockPath.startsWith('/__mock/')
    ? { kind: 'passthrough', path: mockPath, reason }
    : simulated(missing);
}

// ---------------------------------------------------------------- mapping

/** The decision for one Runway task; see the header for the three shapes. */
export function mapTask(type, options, ctx) {
  const o = options && typeof options === 'object' ? options : {};
  const c = ctx ?? {};
  const notes = [];
  switch (type) {
    // ---- stills
    case 'nano_banana_2_1':
      return still('nano_banana_2_1', o, notes, {
        aspect_ratio: stillRatio('nano_banana_2_1', o, c),
        resolution: pick('nano_banana_2_1', 'resolution', o.resolution, '2k', notes),
        thinking_level: 'high',
      }, 14);
    case 'gemini_3_pro':
    case 'gemini_3_1_flash_image': {
      const model = type === 'gemini_3_pro' ? 'nano_banana_pro' : 'nano_banana_flash';
      return still(model, o, notes, {
        aspect_ratio: stillRatio(model, o, c),
        resolution: pick(model, 'resolution', o.image_size, '2k', notes),
      }, 14);
    }
    case 'gpt_image_2_5_sunburst':
    case 'gpt_image_2_5_flare':
      return still('gpt_image_2_5', o, notes, {
        aspect_ratio: stillRatio('gpt_image_2_5', o, c),
        quality: pick('gpt_image_2_5', 'quality', o.quality ?? 'high', 'high', notes),
        resolution: SIZE_TO_RES[o.size] ?? '2k',
        variant: type.endsWith('_flare') ? 'flare' : 'sunburst',
      });
    case 'gpt_image_2':
      return still('gpt_image_2', o, notes, {
        aspect_ratio: stillRatio('gpt_image_2', o, c),
        quality: pick('gpt_image_2', 'quality', o.quality ?? 'high', 'high', notes),
        resolution: SIZE_TO_RES[o.size] ?? '2k',
      });
    case 'seedream_5_pro':
      return still('seedream_v5_pro', o, notes, {
        aspect_ratio: stillRatio('seedream_v5_pro', o, c),
        resolution: pick('seedream_v5_pro', 'resolution', o.resolution, '2k', notes),
      }, 10);
    case 'seedream_5':
      return still('seedream_5_0_flash', o, notes, {
        aspect_ratio: stillRatio('seedream_5_0_flash', o, c),
        resolution: pick('seedream_5_0_flash', 'resolution', o.resolution, '2k', notes),
      });
    case 'bfl_flux_2_max': {
      // Flux on Higgsfield stops at 2k: the 4 MP preset is quoted and run at 2k.
      if (String(o.resolution) === '4') notes.push('Flux 2 Max at 4 MP is not offered; using 2k');
      return still('flux_2', o, notes, {
        aspect_ratio: stillRatio('flux_2', o, c),
        resolution: o.resolution === '1' || o.resolution === 1 ? '1k' : '2k',
        variant: 'max',
      });
    }
    case 'grok_imagine_image_2':
      return still('grok_image_2_0', o, notes, {
        aspect_ratio: stillRatio('grok_image_2_0', o, c),
        quality: 'medium',
        resolution: pick('grok_image_2_0', 'resolution', o.resolution, '2k', notes),
      });
    case 'krea_image_3':
      notes.push('no Higgsfield Krea; using nano_banana_pro');
      return still('nano_banana_pro', o, notes, {
        aspect_ratio: stillRatio('nano_banana_pro', o, c),
        resolution: '2k',
      }, 14);
    case 'ref_image_to_image':
      notes.push('no Higgsfield Gen-4 Image; using nano_banana_pro');
      return still('nano_banana_pro', o, notes, {
        aspect_ratio: stillRatio('nano_banana_pro', o, c),
        resolution: Math.max(o.width, o.height) <= 1280 ? '1k' : '2k',
      }, 14);

    // ---- clips
    case 'kling_3_0_4k':
    case 'kling_3_0_pro':
    case 'kling_o3_pro': {
      const f = framesOf(o, { kling: true });
      const o3 = type === 'kling_o3_pro';
      return clip(o3 ? 'kling_o3_flf' : 'kling3_0', o, notes, {
        mode: type === 'kling_3_0_4k' ? '4k' : 'pro',
        sound: 'off',
        duration: klingSeconds(secondsOf(o)),
        aspect_ratio: clipRatio('kling3_0', o, c),
      }, framesMedia({ ...f, end: o3 ? undefined : f.end, extras: [] }));
    }
    case 'kling_4_0': {
      const f = framesOf(o, { kling: true });
      const videos = videoRefsOf(o);
      const mode = pick('kling4_0', 'mode', o.mode, videos.length ? 'reference-to-video' : 'image-to-video', notes);
      return clip('kling4_0', o, notes, {
        aspect_ratio: clipRatio('kling4_0', o, c),
        duration: Math.min(15, Math.max(3, secondsOf(o))),
        mode,
        resolution: pick('kling4_0', 'resolution', o.resolution, '1080p', notes),
      }, [
        ...framesMedia({ start: f.start, end: f.end, extras: [] }),
        ...videos.map((url) => ({ flag: '--video-references', url })),
      ]);
    }
    case 'seedance_2':
    case 'seedance_2_fast':
    case 'seedance_2_5': {
      const model = type === 'seedance_2_5' ? 'seedance_2_5' : 'seedance_2_0';
      const fast = type === 'seedance_2_fast';
      const f = framesOf(o);
      // Seedance 2.0 counts the start and end frames inside its 9 image references.
      const room = model === 'seedance_2_0' ? 9 - (f.start ? 1 : 0) - (f.end ? 1 : 0) : Infinity;
      const extras = clampRefs(f.extras, room, notes);
      const videos = videoRefsOf(o);
      if (model === 'seedance_2_5' && videos.length > 0) {
        notes.push(`seedance_2_5 on Higgsfield takes no video reference; ${videos.length} dropped`);
      }
      const videoMedia = model === 'seedance_2_0'
        ? clampRefs(videos, 3, notes, 'reference videos').map((url) => ({ flag: '--video-references', url }))
        : [];
      return clip(model, o, notes, {
        mode: model === 'seedance_2_5' ? 'omni_reference' : fast ? 'fast' : 'std',
        resolution: pick(model, 'resolution', o.resolution, fast ? '720p' : '1080p', notes,
          fast ? ['480p', '720p'] : HF_ENUMS[model].resolution),
        duration: secondsOf(o),
        generate_audio: false,
        aspect_ratio: clipRatio(model, o, c),
      }, [...framesMedia({ ...f, extras }), ...videoMedia]);
    }
    case 'veo3_1': {
      const f = framesOf(o);
      if (f.end) notes.push('Veo 3.1 on Higgsfield takes a start image only; the end frame is dropped');
      return clip('veo3_1', o, notes, {
        variant: o.model === 'veo-3.1-fast' ? 'veo-3-1-fast' : 'veo-3-1-preview',
        duration: nearest(secondsOf(o, 8), HF_ENUMS.veo3_1.duration, 8),
        quality: o.resolution === '1080p' ? 'high' : 'basic',
        aspect_ratio: clipRatio('veo3_1', o, c),
      }, framesMedia({ start: f.start, extras: [] }));
    }
    case 'gen4.5': {
      notes.push('no Higgsfield Gen-4.5; using kling3_0 std');
      const f = framesOf(o);
      if (f.middle > 0) notes.push(`${f.middle} middle keyframe(s) dropped; Kling takes a first and last frame`);
      return klingStandard(o, c, notes, f, true);
    }
    case 'gen4_turbo':
      notes.push('no Higgsfield Gen-4 Turbo; using kling3_0 std');
      return klingStandard(o, c, notes, framesOf(o), false);
    case 'ltx_2_5_pro':
      notes.push('no Higgsfield LTX 2.5 Pro; using kling3_0 std');
      return klingStandard(o, c, notes, framesOf(o), true);
    case 'minimax_hailuo_3_0': {
      const f = framesOf(o);
      if (o.resolution !== undefined && String(o.resolution).toUpperCase() !== '2K') {
        notes.push(`MiniMax H3 on Higgsfield is 2K only; using 2K for ${o.resolution}`);
      }
      // Higgsfield refuses start/end frames next to reference media, so a plain
      // list goes up as references only, the first frame leading.
      const media = f.extras.length > 0
        ? [f.start, ...f.extras].map((url) => ({ flag: '--image-references', url }))
        : framesMedia(f);
      return clip('minimax_h3', o, notes, {
        aspect_ratio: 'auto',
        duration: secondsOf(o),
        resolution: '2K',
      }, media);
    }
    case 'wan_2_6':
      return clip('wan2_6', o, notes, {
        aspect_ratio: clipRatio('wan2_6', o, c),
        duration: nearest(secondsOf(o), HF_ENUMS.wan2_6.duration, 5),
        quality: /1920|1440/.test(String(o.resolution)) ? '1080p' : '720p',
      }, refsOf(o).map((url) => ({ flag: '--image-references', url })));

    // ---- no Higgsfield run
    case 'claude_api':
      return simulated('text-via-app-settings');
    case 'media_processing_v2':
      return simulated('not-generation');
    case 'workflow_aleph_2':
      return simulated('runway-only');
    case 'bytedance_video_upscale':
    case 'media_upscale': {
      // The parent clip goes to ByteDance's 4K upscaler (4 credits); that model takes no prompt.
      const parent = c.lookupTaskPath?.(String(o.task_artifact_id ?? '').replace(/-artifact-\d+$/, ''));
      if (typeof parent !== 'string' || !parent.startsWith('/__mock/')) return simulated('upscale-input-unknown');
      return {
        kind: 'higgsfield',
        family: 'video',
        model: 'bytedance_video_upscale',
        params: { model_version: 'standard', preset: 'aigc', resolution: '4k' },
        prompt: null,
        media: [{ flag: '--video-references', url: parent }],
        expectedSeconds: VIDEO_SECONDS,
        notes,
      };
    }
    case 'flux_video_upscale':
      return passthrough(stripOrigin(o.video?.url), 'upscale-passthrough', 'upscale-input-not-local');
    default:
      if (typeof type === 'string' && type.startsWith('magnific_')) {
        return passthrough(stripOrigin(o.image?.url), 'upscale-passthrough', 'upscale-input-not-local');
      }
      return simulated(`unmapped:${type}`);
  }
}

/** The argv after `higgsfield generate create|cost`; `ids[i]` is media[i]'s uploaded id. */
export function argsFor(d, ids) {
  return [
    d.model,
    ...(d.prompt === null ? [] : ['--prompt', d.prompt]),
    ...Object.keys(d.params)
      .sort()
      .flatMap((k) => [`--${k}`, String(d.params[k])]),
    ...d.media.flatMap((m, i) => [m.flag, ids[i]]),
  ];
}
