/**
 * The model presets the app offers, shared by the server (src/api.ts maps
 * each preset onto its own task options) and the client pickers. `alias` is
 * the Runway task type; keep bay.models.json in step with this list.
 */
export type Resolution = { readonly id: string; readonly name: string };

/**
 * Image presets, grouped by provider in the picker. Every one takes the render
 * as a reference image. `resolutions[].id` is the model's own value for its
 * resolution field; the first listed `defaultResolution` is what a new take
 * uses. Models marked "preview access" or "paid plans" answer some accounts
 * with a plan refusal, which the UI shows as a terminal notice.
 */
export const IMAGE_MODELS = [
  {
    id: 'nano-banana-pro',
    name: 'Nano Banana Pro',
    group: 'Google',
    hint: 'Most faithful to your render',
    alias: 'gemini_3_pro',
    aspectRatios: ['16:9','1:1','21:9','2:3','3:2','3:4','4:3','4:5','5:4','9:16'],
    maxRefs: 14,
    resolutions: [
      { id: '1K', name: '1K' },
      { id: '2K', name: '2K' },
      { id: '4K', name: '4K' },
    ],
    defaultResolution: '2K',
  },
  {
    id: 'nano-banana-2-1',
    name: 'Nano Banana 2.1',
    group: 'Google',
    hint: 'Newest Nano Banana, preview access',
    alias: 'nano_banana_2_1',
    aspectRatios: ['16:9','1:1','21:9','2:3','3:2','3:4','4:3','4:5','5:4','9:16','9:21'],
    maxRefs: 14,
    promptLimit: 5500,
    resolutions: [
      { id: '1k', name: '1K' },
      { id: '2k', name: '2K' },
      { id: '4k', name: '4K' },
    ],
    defaultResolution: '2k',
  },
  {
    id: 'nano-banana-2',
    name: 'Nano Banana 2',
    group: 'Google',
    hint: 'Faster drafts',
    alias: 'gemini_3_1_flash_image',
    aspectRatios: ['16:9','1:1','21:9','2:3','3:2','3:4','4:3','4:5','5:4','9:16'],
    maxRefs: 14,
    resolutions: [
      { id: '1K', name: '1K' },
      { id: '2K', name: '2K' },
      { id: '4K', name: '4K' },
    ],
    defaultResolution: '2K',
  },
  {
    id: 'gpt-image-2-5-sunburst',
    name: 'GPT Image 2.5 Sunburst',
    group: 'OpenAI',
    hint: 'Rich, natural photo realism',
    alias: 'gpt_image_2_5_sunburst',
    aspectRatios: ['16:9','1:1','21:9','2:3','3:2','3:4','4:3','4:5','5:4','9:16'],
    maxRefs: 16,
    promptLimit: 4000,
    resolutions: [
      { id: '1', name: '1K' },
      { id: '2', name: '2K' },
      { id: '4', name: '4K' },
    ],
    defaultResolution: '2',
  },
  {
    id: 'gpt-image-2-5-flare',
    name: 'GPT Image 2.5 Flare',
    group: 'OpenAI',
    hint: 'The other 2.5 variant, same price',
    alias: 'gpt_image_2_5_flare',
    aspectRatios: ['16:9','1:1','21:9','2:3','3:2','3:4','4:3','4:5','5:4','9:16'],
    maxRefs: 16,
    promptLimit: 4000,
    resolutions: [
      { id: '1', name: '1K' },
      { id: '2', name: '2K' },
      { id: '4', name: '4K' },
    ],
    defaultResolution: '2',
  },
  {
    id: 'gpt-image-2',
    name: 'GPT Image 2',
    group: 'OpenAI',
    hint: 'Natural photo realism',
    alias: 'gpt_image_2',
    aspectRatios: ['16:9','1:1','21:9','2:3','3:2','3:4','4:3','4:5','5:4','9:16'],
    maxRefs: 16,
    promptLimit: 4000,
    resolutions: [
      { id: '1', name: '1K' },
      { id: '2', name: '2K' },
      { id: '4', name: '4K' },
    ],
    defaultResolution: '2',
  },
  {
    id: 'seedream-5-pro',
    name: 'Seedream 5.0 Pro',
    group: 'ByteDance',
    hint: 'Crisp materials and light',
    alias: 'seedream_5_pro',
    aspectRatios: ['16:9','1:1','2:3','3:2','3:4','4:3','9:16'],
    maxRefs: 10,
    promptLimit: 4000,
    resolutions: [
      { id: '1k', name: '1K' },
      { id: '2k', name: '2K' },
    ],
    defaultResolution: '2k',
  },
  {
    id: 'seedream-5',
    name: 'Seedream 5.0',
    group: 'ByteDance',
    hint: 'High resolution, up to 3K',
    alias: 'seedream_5',
    aspectRatios: ['16:9','1:1','21:9','2:3','3:2','3:4','4:3','9:16'],
    maxRefs: 10,
    promptLimit: 4000,
    resolutions: [
      { id: '2k', name: '2K' },
      { id: '3k', name: '3K' },
    ],
    defaultResolution: '2k',
  },
  {
    id: 'flux-2-max',
    name: 'FLUX.2 [max]',
    group: 'Black Forest Labs',
    hint: 'Detailed, photographic',
    alias: 'bfl_flux_2_max',
    aspectRatios: ['16:9','1:1','21:9','3:4','4:3','9:16','9:21'],
    maxRefs: 8,
    promptLimit: 4000,
    resolutions: [
      { id: '1', name: '1 MP' },
      { id: '2', name: '2 MP' },
      { id: '4', name: '4 MP' },
    ],
    defaultResolution: '2',
  },
  {
    id: 'grok-imagine-2',
    name: 'Grok Imagine Image 2',
    group: 'xAI',
    hint: 'Edits your render directly',
    alias: 'grok_imagine_image_2',
    aspectRatios: ['16:9','20:9','2:1','1:1','1:2','2:3','3:2','3:4','4:3','9:16'],
    maxRefs: 3,
    promptLimit: 4000,
    resolutions: [
      { id: '1k', name: '1K' },
      { id: '2k', name: '2K' },
    ],
    defaultResolution: '2k',
  },
  {
    id: 'krea-image-3',
    name: 'Krea Image 3',
    group: 'Krea',
    hint: 'Aesthetic, paid plans only',
    alias: 'krea_image_3',
    aspectRatios: ['16:9','1:1','21:9','2:3','3:2','3:4','4:3','4:5','5:4','9:16'],
    maxRefs: 8,
    promptLimit: 5000,
    resolutions: [{ id: '2k', name: '2K' }],
    defaultResolution: '2k',
  },
  {
    id: 'gen-4-image',
    name: 'Gen-4 Image',
    group: 'Runway',
    hint: "Runway's reference image model",
    alias: 'ref_image_to_image',
    aspectRatios: ['16:9','1:1','9:16'],
    maxRefs: 3,
    promptLimit: 4000,
    resolutions: [
      { id: '720p', name: '720p' },
      { id: '1080p', name: '1080p' },
    ],
    defaultResolution: '1080p',
  },
] as const satisfies readonly ModelPreset[];

type ModelPreset = {
  /** Reference images the model takes in `referenceImages`; the render is the first. */
  maxRefs?: number;
  /**
   * Video only: the most ordered keyframes (first + middle + last) the model
   * takes. 1 = first frame only, 2 = first and last, more = timestamped.
   * Unset reads as 1. Source: .bay/runway/options.md.
   */
  maxKeyframes?: number;
  /**
   * Video only: how many plain "extra" reference images it takes besides the
   * frames (the first frame then rides along as image 1). Unset reads as 0.
   */
  maxExtraImages?: number;
  /**
   * Video only: the model refuses typed keyframes (first/end) together with
   * plain reference images, so extra images and a last frame are either/or,
   * and the picked still then goes out as plain reference image 1.
   */
  extraImagesExcludeEnd?: boolean;
  /** Prompt cap in characters: the documented one, else the app's safe 4000. Unset for the Google Nano Banana models that take the prompt whole. */
  promptLimit?: number;
  id: string;
  name: string;
  group: string;
  hint: string;
  alias: string;
  resolutions: readonly Resolution[];
  defaultResolution: string;
  /** Frame shapes the picker offers, each one the model's own `supportedAspectRatios` value. */
  aspectRatios?: readonly string[];
  /** Offered only by the Video tab's Recreate in 4K, never by the Animate or Director pickers. */
  recreateOnly?: boolean;
};

export type ImageModelId = (typeof IMAGE_MODELS)[number]['id'];

export const IMAGE_MODEL_IDS = IMAGE_MODELS.map((m) => m.id) as [
  ImageModelId,
  ...ImageModelId[],
];

function imageModel(id: string | undefined): ModelPreset {
  return IMAGE_MODELS.find((m) => m.id === id) ?? IMAGE_MODELS[0];
}

export function imageModelName(id: string | undefined): string {
  return imageModel(id).name;
}

/**
 * Whether the model takes the cast sheet as a second reference image after
 * the render. The client and the server both ask, so the UI never offers an
 * upload the server would drop.
 */
export function imageModelTakesCastSheet(id: string | undefined): boolean {
  return (imageModel(id).maxRefs ?? 1) >= 2;
}

/** The model's prompt cap in characters, or `undefined` when none is documented. */
export function imageModelPromptLimit(id: string | undefined): number | undefined {
  return imageModel(id).promptLimit;
}

/** Up to two model names that do take a cast sheet, for the "pick X or Y" notice. */
export function castSheetModelNames(): string[] {
  return IMAGE_MODELS.filter((m) => imageModelTakesCastSheet(m.id))
    .slice(0, 2)
    .map((m) => m.name);
}

export function imageResolutions(id: ImageModelId): readonly Resolution[] {
  return imageModel(id).resolutions;
}

export function defaultImageResolution(id: ImageModelId): string {
  return imageModel(id).defaultResolution;
}

/** The display name ("2K") for a model's resolution id, or `undefined`. */
export function imageResolutionName(
  id: string | undefined,
  resolution: string | undefined
): string | undefined {
  return imageModel(id).resolutions.find((r) => r.id === resolution)?.name;
}

/** "Match render" in the aspect ratio picker: the render's own shape, snapped. */
export const MATCH_RENDER = 'match';

const ASPECT_ORDER = ['21:9', '20:9', '2:1', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '1:2', '9:16', '9:21'];

const ASPECT_HINTS: Record<string, string> = {
  '21:9': 'Cinema scope',
  '20:9': 'Ultra wide',
  '2:1': 'Univisium',
  '16:9': 'Widescreen',
  '3:2': 'Full-frame photo',
  '4:3': 'Classic',
  '5:4': 'Large format',
  '1:1': 'Square',
  '4:5': 'Portrait post',
  '3:4': 'Portrait',
  '2:3': 'Portrait photo',
  '1:2': 'Tall',
  '9:16': 'Vertical video',
  '9:21': 'Tall scope',
};

/** The aspect ratio picker's options for a model: "Match render", then wide to tall. */
export function imageAspectOptions(id: ImageModelId): { id: string; name: string; hint: string }[] {
  const own = imageModel(id).aspectRatios ?? [];
  return [
    { id: MATCH_RENDER, name: 'Match render', hint: 'Same shape as your render' },
    ...ASPECT_ORDER.filter((r) => own.includes(r)).map((r) => ({
      id: r,
      name: r,
      hint: ASPECT_HINTS[r] ?? '',
    })),
  ];
}

/** Whether a model offers this ratio (or it is "Match render"). */
export function imageModelHasAspect(id: ImageModelId, ratio: string): boolean {
  return ratio === MATCH_RENDER || (imageModel(id).aspectRatios ?? []).includes(ratio);
}

/** "16:9" → its width and height as whole numbers in that proportion, or `undefined`. */
export function aspectDims(ratio: string | undefined): { width: number; height: number } | undefined {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio ?? '');
  if (!m) return undefined;
  return { width: Math.round(Number(m[1]) * 100), height: Math.round(Number(m[2]) * 100) };
}

export type Orientation = 'landscape' | 'portrait' | 'square';

export function orientationOf(width: number, height: number): Orientation {
  const ratio = width / height;
  if (ratio > 1.15) return 'landscape';
  if (ratio < 0.87) return 'portrait';
  return 'square';
}

/**
 * Gen-4 Image takes only fixed size pairs: one per orientation, per tier.
 * The server sends exactly this (src/api.ts), and `maskedEditFit` judges the
 * same pair, so what the check promises is what the model is asked for.
 */
export function gen4ImageSize(
  resolution: string,
  width: number,
  height: number
): { width: number; height: number } {
  const hd = resolution === '1080p';
  const orientation = orientationOf(width, height);
  return orientation === 'landscape'
    ? hd ? { width: 1920, height: 1088 } : { width: 1280, height: 720 }
    : orientation === 'portrait'
      ? hd ? { width: 1088, height: 1920 } : { width: 720, height: 1280 }
      : hd ? { width: 1088, height: 1088 } : { width: 720, height: 720 };
}

const FIT_TOLERANCE = 0.015;

/** "21:9" for the nearest listed ratio, else a plain decimal like "2.7:1". */
function ratioLabel(width: number, height: number): string {
  const r = width / height;
  const near = ASPECT_ORDER.map((a) => ({ a, v: aspectDims(a)! })).find(
    ({ v }) => Math.abs(v.width / v.height / r - 1) <= FIT_TOLERANCE
  );
  if (near) return near.a;
  return r >= 1 ? `${(Math.round(r * 10) / 10).toString()}:1` : `1:${(Math.round((1 / r) * 10) / 10).toString()}`;
}

/**
 * The frame the server asks a model for when the shape is "match render": the
 * model's own listed ratio nearest the render's (Gen-4 Image: its fixed size).
 * Marked edits send exactly this, and `maskedEditFit` judges exactly this.
 */
export function snapMatchFrame(
  id: ImageModelId,
  width: number,
  height: number
): { width: number; height: number } {
  if (id === 'gen-4-image') return gen4ImageSize('720p', width, height);
  const own = (imageModel(id).aspectRatios ?? [])
    .map((a) => aspectDims(a))
    .filter((d): d is { width: number; height: number } => d !== undefined);
  if (own.length === 0) return { width, height };
  const target = Math.log(width / height);
  let best = own[0]!;
  for (const d of own) {
    if (Math.abs(Math.log(d.width / d.height) - target) < Math.abs(Math.log(best.width / best.height) - target)) {
      best = d;
    }
  }
  return best;
}

function fitsFrame(id: ImageModelId, width: number, height: number): boolean {
  const near = (out: { width: number; height: number }) =>
    Math.abs(out.width / out.height / (width / height) - 1) <= FIT_TOLERANCE;
  // Gen-4 Image's two size tiers differ slightly (1920x1088); both must fit.
  return id === 'gen-4-image'
    ? near(gen4ImageSize('720p', width, height)) && near(gen4ImageSize('1080p', width, height))
    : near(snapMatchFrame(id, width, height));
}

/**
 * Whether a marked edit lines up on this model. The untouched area is pasted
 * back from the render, so the model's output must have the render's shape:
 * `ok` only when the shape the server would request for "match render" is
 * within 1.5% of the render's own. Pure, so the client can warn before a
 * take and the server refuses the same requests.
 */
export function maskedEditFit(
  modelId: ImageModelId,
  width: number,
  height: number
): { ok: true } | { ok: false; reason: string } {
  if (!(width > 0) || !(height > 0) || fitsFrame(modelId, width, height)) return { ok: true };
  const others = IMAGE_MODELS.filter((m) => m.id !== modelId && fitsFrame(m.id, width, height));
  const preferred = ['nano-banana-2', 'gpt-image-2'];
  const names = [
    ...preferred.filter((p) => others.some((m) => m.id === p)),
    ...others.map((m) => m.id).filter((i) => !preferred.includes(i)),
  ]
    .slice(0, 2)
    .map((i) => imageModelName(i));
  return {
    ok: false,
    reason: `${imageModelName(modelId)} can't keep this render's ${ratioLabel(width, height)} frame, so a marked edit would not line up.${
      names.length ? ` Pick ${names.join(' or ')}.` : ''
    }`,
  };
}

/**
 * Video presets. Every one starts on the still as its first frame.
 * Frame support (`maxKeyframes`, `maxExtraImages`, `extraImagesExcludeEnd`) is
 * read from each model's options in .bay/runway/options.md: Seedance, MiniMax
 * H3, LTX, Veo, Gen-4.5 and Kling 3.0 take a first and a last frame (Gen-4.5's
 * k2v route documents first/last keyframes only, so no model here takes frames
 * in between); only Seedance and MiniMax H3 take
 * plain extra reference images. Kling O3 Pro, Gen-4 Turbo and Wan 2.6 document
 * no end frame or extra images, so they get none.
 * `resolutions[].id` is a tier the server maps onto the model's own field
 * for the still's orientation (src/api.ts).
 */
export const VIDEO_MODELS = [
  {
    id: 'seedance-2',
    maxKeyframes: 2,
    maxExtraImages: 8,
    extraImagesExcludeEnd: true,
    name: 'Seedance 2.0',
    group: 'ByteDance',
    hint: 'Best all-round motion',
    alias: 'seedance_2',
    resolutions: [
      { id: '480p', name: '480p' },
      { id: '720p', name: '720p' },
      { id: '1080p', name: '1080p' },
      { id: '4k', name: '4K' },
    ],
    defaultResolution: '1080p',
  },
  {
    id: 'seedance-2-5',
    maxKeyframes: 2,
    maxExtraImages: 29,
    extraImagesExcludeEnd: true,
    name: 'Seedance 2.5',
    group: 'ByteDance',
    hint: 'Newest Seedance, longer clips',
    alias: 'seedance_2_5',
    resolutions: [
      { id: '480p', name: '480p' },
      { id: '720p', name: '720p' },
      { id: '1080p', name: '1080p' },
    ],
    defaultResolution: '1080p',
  },
  {
    id: 'seedance-2-fast',
    maxKeyframes: 2,
    maxExtraImages: 8,
    extraImagesExcludeEnd: true,
    name: 'Seedance 2.0 Fast',
    group: 'ByteDance',
    hint: 'Quick, cheaper drafts',
    alias: 'seedance_2_fast',
    resolutions: [
      { id: '480p', name: '480p' },
      { id: '720p', name: '720p' },
    ],
    defaultResolution: '720p',
  },
  {
    id: 'kling-3-pro',
    maxKeyframes: 2,
    name: 'Kling 3.0 Pro',
    group: 'Kuaishou',
    hint: 'Steady image-to-video',
    alias: 'kling_3_0_pro',
    resolutions: [{ id: '1080p', name: '1080p' }],
    defaultResolution: '1080p',
  },
  {
    id: 'kling-3-4k',
    maxKeyframes: 2,
    name: 'Kling 3.0 4K',
    group: 'Kuaishou',
    hint: 'Native 4K output',
    alias: 'kling_3_0_4k',
    resolutions: [{ id: '4k', name: '4K' }],
    defaultResolution: '4k',
  },
  {
    id: 'kling-o3-pro',
    name: 'Kling O3 Pro',
    group: 'Kuaishou',
    hint: 'Strong prompt following',
    alias: 'kling_o3_pro',
    resolutions: [{ id: '1080p', name: '1080p' }],
    defaultResolution: '1080p',
  },
  {
    id: 'kling-4-0',
    name: 'Kling 4.0',
    group: 'Kuaishou',
    hint: 'Follows a reference video; used by Recreate in 4K',
    alias: 'kling_4_0',
    resolutions: [
      { id: '720p', name: '720p' },
      { id: '1080p', name: '1080p' },
    ],
    defaultResolution: '1080p',
    recreateOnly: true,
  },
  {
    id: 'veo-3-1',
    maxKeyframes: 2,
    name: 'Veo 3.1',
    group: 'Google',
    hint: 'Adds ambient sound',
    alias: 'veo3_1',
    resolutions: [
      { id: '720p', name: '720p' },
      { id: '1080p', name: '1080p' },
    ],
    defaultResolution: '1080p',
  },
  {
    id: 'veo-3-1-fast',
    maxKeyframes: 2,
    name: 'Veo 3.1 Fast',
    group: 'Google',
    hint: 'Faster Veo, with sound',
    alias: 'veo3_1',
    resolutions: [
      { id: '720p', name: '720p' },
      { id: '1080p', name: '1080p' },
    ],
    defaultResolution: '1080p',
  },
  {
    id: 'gen-4-5',
    maxKeyframes: 2,
    name: 'Gen-4.5',
    group: 'Runway',
    hint: "Runway's cinematic model",
    alias: 'gen4.5',
    resolutions: [{ id: '720p', name: '720p' }],
    defaultResolution: '720p',
  },
  {
    id: 'gen-4-turbo',
    name: 'Gen-4 Turbo',
    group: 'Runway',
    hint: 'Fast and inexpensive',
    alias: 'gen4_turbo',
    resolutions: [{ id: '720p', name: '720p' }],
    defaultResolution: '720p',
  },
  {
    id: 'minimax-h3',
    maxKeyframes: 2,
    maxExtraImages: 8,
    extraImagesExcludeEnd: true,
    name: 'MiniMax H3',
    group: 'MiniMax',
    hint: 'Up to 2K, preview access',
    alias: 'minimax_hailuo_3_0',
    resolutions: [
      { id: '768p', name: '768p' },
      { id: '2k', name: '2K' },
    ],
    defaultResolution: '2k',
  },
  {
    id: 'ltx-2-5-pro',
    maxKeyframes: 2,
    name: 'LTX-2.5 Pro',
    group: 'Lightricks',
    hint: 'Precise camera moves',
    alias: 'ltx_2_5_pro',
    resolutions: [
      { id: '720p', name: '720p' },
      { id: '1080p', name: '1080p' },
    ],
    defaultResolution: '1080p',
  },
  {
    id: 'wan-2-6',
    name: 'Wan 2.6',
    group: 'Alibaba',
    hint: 'Natural motion, up to 1080p',
    alias: 'wan_2_6',
    resolutions: [
      { id: '720p', name: '720p' },
      { id: '1080p', name: '1080p' },
    ],
    defaultResolution: '1080p',
  },
] as const satisfies readonly ModelPreset[];

export type VideoModelId = (typeof VIDEO_MODELS)[number]['id'];

export const VIDEO_MODEL_IDS = VIDEO_MODELS.map((m) => m.id) as [
  VideoModelId,
  ...VideoModelId[],
];

/** The models the Animate and Director pickers offer: all but the Recreate in 4K ones. */
export const ANIMATE_VIDEO_MODELS = VIDEO_MODELS.filter(
  (m) => !('recreateOnly' in m && m.recreateOnly)
);

function videoModel(id: string | undefined): ModelPreset {
  return VIDEO_MODELS.find((m) => m.id === id) ?? VIDEO_MODELS[0];
}

/** Most ordered keyframes (first + middle + last) the model takes; 1 = first frame only. */
export function videoKeyframeLimit(id: VideoModelId): number {
  return videoModel(id).maxKeyframes ?? 1;
}

/** Extra reference images (besides the frames) the model takes; 0 = none. */
export function videoExtraImageLimit(id: VideoModelId): number {
  return videoModel(id).maxExtraImages ?? 0;
}

/** True when extra images and a last frame can't be sent together. */
export function videoExtrasExcludeEnd(id: VideoModelId): boolean {
  return videoModel(id).extraImagesExcludeEnd === true;
}

/** Names of the models that take a last frame / middle frames / extra images. */
export function videoModelsWith(
  feature: 'end' | 'middle' | 'extra'
): string[] {
  return VIDEO_MODELS.filter((m) => {
    const p: ModelPreset = m;
    return feature === 'end'
      ? (p.maxKeyframes ?? 1) >= 2
      : feature === 'middle'
        ? (p.maxKeyframes ?? 1) >= 3
        : (p.maxExtraImages ?? 0) > 0;
  })
    .map((m) => m.name)
    .filter((n, i, all) => all.indexOf(n) === i);
}

/** `@img3` handles in a direction, in order, deduplicated. */
export function extraImageHandles(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(EXTRA_IMAGE_HANDLE)) {
    const n = Number(m[1]);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

const EXTRA_IMAGE_HANDLE = /@img(\d{1,2})\b/gi;

/** Replace each `@imgN` with `phrase(N)`. */
export function rewriteExtraImageHandles(text: string, phrase: (n: number) => string): string {
  return text.replace(EXTRA_IMAGE_HANDLE, (_, n: string) => phrase(Number(n)));
}

export function videoModelName(id: string | undefined): string {
  return videoModel(id).name;
}

export function videoResolutions(id: VideoModelId): readonly Resolution[] {
  return videoModel(id).resolutions;
}

export function defaultVideoResolution(id: VideoModelId): string {
  return videoModel(id).defaultResolution;
}

export function videoResolutionName(
  id: string | undefined,
  resolution: string | undefined
): string | undefined {
  return videoModel(id).resolutions.find((r) => r.id === resolution)?.name;
}

/**
 * Upscalers for a finished still. Both keep the frame as it is; Creative
 * adds fine photographic texture, Precision only sharpens what is there.
 */
export const STILL_UPSCALERS = [
  {
    id: 'precision',
    name: 'Magnific Precision',
    hint: 'Sharpens without changing anything',
    alias: 'magnific_precision_upscaler_v2',
  },
  {
    id: 'creative',
    name: 'Magnific Creative',
    hint: 'Adds fine photographic texture',
    alias: 'magnific_creative_upscaler',
  },
] as const;

export type StillUpscalerId = (typeof STILL_UPSCALERS)[number]['id'];

export const STILL_UPSCALER_IDS = STILL_UPSCALERS.map((u) => u.id) as [
  StillUpscalerId,
  ...StillUpscalerId[],
];

export const UPSCALE_FACTORS = [
  { id: '2', name: '2×' },
  { id: '4', name: '4×' },
] as const;

export type UpscaleFactor = 2 | 4;

/** Upscalers for a finished clip. */
export const CLIP_UPSCALERS = [
  {
    id: 'runway',
    name: 'Runway Video Upscale',
    hint: '4× sharper, clips up to 40 seconds',
    alias: 'media_upscale',
  },
  {
    id: 'flux',
    name: 'FLUX Video Upscale',
    hint: '2×, keeps faces stable, paid plans only',
    alias: 'flux_video_upscale',
  },
] as const;

/** FLUX Video Upscale takes clips up to this long (options.md). */
export const FLUX_UPSCALE_MAX_SECONDS = 20;
/** ...and up to this many bytes (50 MB). */
export const FLUX_UPSCALE_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Why FLUX Video Upscale can't take this clip, in one sentence, or
 * `undefined` when it can. It accepts clips up to 20 seconds, 50 MB and
 * 2560x1440; 4K and 2K clips, and anything already upscaled, are larger.
 */
export function fluxUpscaleBlock(clip: {
  videoModel: VideoModelId;
  length?: LengthId | undefined;
  seconds?: number | undefined;
  resolution?: string | undefined;
  upscaleOf?: string | undefined;
}): string | undefined {
  if (clip.upscaleOf) {
    return 'This clip is already upscaled, so it is larger than the 2560x1440 FLUX Video Upscale takes. Use Runway Video Upscale, or upscale the original clip.';
  }
  const res = (clip.resolution ?? defaultVideoResolution(clip.videoModel)).toLowerCase();
  if (res === '4k' || res === '2k') {
    return `This clip is ${res.toUpperCase()}, which is larger than the 2560x1440 FLUX Video Upscale takes. Use Runway Video Upscale instead.`;
  }
  const seconds = clipSeconds(clip.videoModel, clip.length, clip.seconds);
  if (seconds > FLUX_UPSCALE_MAX_SECONDS) {
    return `This clip runs ${seconds} seconds, and FLUX Video Upscale takes ${FLUX_UPSCALE_MAX_SECONDS} at most. Use Runway Video Upscale instead.`;
  }
  return undefined;
}

export type ClipUpscalerId = (typeof CLIP_UPSCALERS)[number]['id'];

export const CLIP_UPSCALER_IDS = CLIP_UPSCALERS.map((u) => u.id) as [
  ClipUpscalerId,
  ...ClipUpscalerId[],
];

export function upscalerName(id: string | undefined): string {
  return (
    [...STILL_UPSCALERS, ...CLIP_UPSCALERS].find((u) => u.id === id)?.name ??
    'Upscaler'
  );
}

/**
 * Camera moves for the video. All short, so nothing outside the still has to
 * be invented; `ltx` is the nearest LTX `cameraMotion` value.
 */
export const MOTIONS = [
  {
    id: 'still-life',
    name: 'Locked off',
    group: 'Static',
    hint: 'Camera still, the scene moves',
    ltx: 'static',
    camera:
      'The camera stays completely still on a tripod, exactly framed as the photograph',
  },
  {
    id: 'push-in',
    name: 'Push in',
    group: 'Dolly',
    hint: 'Dolly forward toward the centre',
    ltx: 'dolly_in',
    camera:
      'The camera dollies forward toward the centre of the frame, moving only a short distance',
  },
  {
    id: 'pull-out',
    name: 'Pull out',
    group: 'Dolly',
    hint: 'Dolly back, staying inside the frame',
    ltx: 'dolly_out',
    camera:
      'The camera dollies back a short distance, staying within what the photograph shows',
  },
  {
    id: 'drift-left',
    name: 'Track left',
    group: 'Dolly',
    hint: 'Slide left with parallax',
    ltx: 'dolly_left',
    camera:
      'The camera tracks a short distance to the left on a dolly track, with natural parallax between foreground and background',
  },
  {
    id: 'drift-right',
    name: 'Track right',
    group: 'Dolly',
    hint: 'Slide right with parallax',
    ltx: 'dolly_right',
    camera:
      'The camera tracks a short distance to the right on a dolly track, with natural parallax between foreground and background',
  },
  {
    id: 'pan-left',
    name: 'Pan left',
    group: 'Pan and tilt',
    hint: 'Turns left on the spot',
    ltx: 'dolly_left',
    camera:
      'The camera stays in place on a fluid head and pans a few degrees to the left, revealing only the continuation of what is already at the left edge',
  },
  {
    id: 'pan-right',
    name: 'Pan right',
    group: 'Pan and tilt',
    hint: 'Turns right on the spot',
    ltx: 'dolly_right',
    camera:
      'The camera stays in place on a fluid head and pans a few degrees to the right, revealing only the continuation of what is already at the right edge',
  },
  {
    id: 'tilt-up',
    name: 'Tilt up',
    group: 'Pan and tilt',
    hint: 'Tilts up toward the top of the wall',
    ltx: 'jib_up',
    camera:
      'The camera stays in place and tilts up a few degrees, revealing only the continuation of what is already at the top edge',
  },
  {
    id: 'tilt-down',
    name: 'Tilt down',
    group: 'Pan and tilt',
    hint: 'Tilts down toward the ground',
    ltx: 'jib_down',
    camera:
      'The camera stays in place and tilts down a few degrees, revealing only the continuation of the ground already at the bottom edge',
  },
  {
    id: 'crane-up',
    name: 'Crane up',
    group: 'Crane',
    hint: 'Rises, tilting down to hold the scene',
    ltx: 'jib_up',
    camera:
      'The camera rises a short distance on a crane while tilting down slightly to keep the scene centred',
  },
  {
    id: 'crane-down',
    name: 'Crane down',
    group: 'Crane',
    hint: 'Lowers, tilting up to hold the scene',
    ltx: 'jib_down',
    camera:
      'The camera lowers a short distance on a crane while tilting up slightly to keep the scene centred',
  },
  {
    id: 'arc-left',
    name: 'Arc left',
    group: 'Orbit',
    hint: 'Small curve around the centre',
    ltx: 'dolly_left',
    camera:
      'The camera moves along a small arc to the left around the centre of the scene, turning to keep it framed, travelling only a few degrees',
  },
  {
    id: 'arc-right',
    name: 'Arc right',
    group: 'Orbit',
    hint: 'Small curve around the centre',
    ltx: 'dolly_right',
    camera:
      'The camera moves along a small arc to the right around the centre of the scene, turning to keep it framed, travelling only a few degrees',
  },
  {
    id: 'focus-pull',
    name: 'Focus pull',
    group: 'Lens',
    hint: 'Camera still, focus shifts to the back',
    ltx: 'focus_shift',
    camera:
      'The camera stays still while the focus pulls smoothly from the foreground to the background',
  },
] as const;

export type MotionId = (typeof MOTIONS)[number]['id'];

export const MOTION_IDS = MOTIONS.map((m) => m.id) as [MotionId, ...MotionId[]];

/** How the camera moves: the rig and how the move starts and ends. */
export const MOVE_STYLES = [
  {
    id: 'steady',
    name: 'Steady',
    hint: 'Locked gimbal, no shake',
    camera:
      'on a fully stabilised gimbal, perfectly steady with no shake, wobble or jitter',
  },
  {
    id: 'linear',
    name: 'Linear',
    hint: 'Constant speed, start to finish',
    camera:
      'at one constant, even speed in a straight mechanical line from the first frame to the last, like a motion-control rig, with no easing',
  },
  {
    id: 'eased',
    name: 'Eased',
    hint: 'Starts and stops softly',
    camera:
      'easing in gently from rest, gliding through the middle and easing out to a soft stop',
  },
  {
    id: 'steadicam',
    name: 'Steadicam float',
    hint: 'Smooth, gently floating',
    camera:
      'on a Steadicam, smooth with a very gentle organic float, never shaky',
  },
  {
    id: 'handheld',
    name: 'Handheld',
    hint: 'Subtle, natural sway',
    camera:
      'handheld by a skilled operator, with a subtle, natural breathing sway and tiny corrections, never jerky',
  },
] as const;

export type MoveStyleId = (typeof MOVE_STYLES)[number]['id'];

export const MOVE_STYLE_IDS = MOVE_STYLES.map((m) => m.id) as [MoveStyleId, ...MoveStyleId[]];

export const SPEEDS = [
  { id: 'very-slow', name: 'Very slow', hint: 'Barely perceptible', camera: 'very slowly, almost imperceptibly' },
  { id: 'slow', name: 'Slow', hint: 'Calm, cinematic', camera: 'slowly and calmly' },
  { id: 'medium', name: 'Medium', hint: 'Noticeable, still short', camera: 'at a moderate, unhurried pace' },
] as const;

export type SpeedId = (typeof SPEEDS)[number]['id'];

export const SPEED_IDS = SPEEDS.map((s) => s.id) as [SpeedId, ...SpeedId[]];

/** A clip's camera in words, e.g. "Push in, eased, slow". Older clips have no style or speed. */
export function motionLabel(motion: string, style?: string, speed?: string): string {
  const parts = [
    MOTIONS.find((m) => m.id === motion)?.name,
    MOVE_STYLES.find((m) => m.id === style)?.name.toLowerCase(),
    SPEEDS.find((s) => s.id === speed)?.name.toLowerCase(),
  ];
  return parts.filter(Boolean).join(', ');
}

export const LENGTHS = [
  { id: 'short', name: 'Short' },
  { id: 'long', name: 'Long' },
] as const;

export type LengthId = (typeof LENGTHS)[number]['id'];

export const LENGTH_IDS = LENGTHS.map((l) => l.id) as [LengthId, ...LengthId[]];

/** Seconds each model ran for the old Short/Long choice; kept for older clips. */
const LEGACY_SECONDS: Record<VideoModelId, Record<LengthId, number>> = {
  'seedance-2': { short: 5, long: 10 },
  'seedance-2-5': { short: 5, long: 10 },
  'seedance-2-fast': { short: 5, long: 10 },
  'kling-3-pro': { short: 5, long: 10 },
  'kling-3-4k': { short: 5, long: 10 },
  'kling-o3-pro': { short: 5, long: 10 },
  'kling-4-0': { short: 5, long: 10 },
  'veo-3-1': { short: 6, long: 8 },
  'veo-3-1-fast': { short: 6, long: 8 },
  'gen-4-5': { short: 5, long: 10 },
  'gen-4-turbo': { short: 5, long: 10 },
  'minimax-h3': { short: 5, long: 10 },
  'ltx-2-5-pro': { short: 6, long: 10 },
  'wan-2-6': { short: 5, long: 10 },
};

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Every clip length (seconds) each model accepts, from its task options. */
const DURATIONS: Record<VideoModelId, readonly number[]> = {
  'seedance-2': range(4, 15),
  'seedance-2-fast': range(4, 15),
  'seedance-2-5': range(4, 30),
  'kling-3-pro': range(3, 15),
  'kling-3-4k': range(3, 15),
  'kling-o3-pro': range(3, 15),
  'kling-4-0': range(3, 15),
  'veo-3-1': [4, 6, 8],
  'veo-3-1-fast': [4, 6, 8],
  'gen-4-5': range(2, 10),
  'gen-4-turbo': range(2, 10),
  'minimax-h3': range(5, 15),
  'ltx-2-5-pro': [6, 8, 10],
  'wan-2-6': [5, 10, 15],
};

export function videoDurations(model: VideoModelId): readonly number[] {
  return DURATIONS[model] ?? [5, 10];
}

export function defaultVideoSeconds(model: VideoModelId): number {
  return snapVideoSeconds(model, 5);
}

/** The model's accepted length nearest to `seconds` (the shorter on a tie). */
export function snapVideoSeconds(model: VideoModelId, seconds: number): number {
  const options = videoDurations(model);
  return options.reduce((best, s) =>
    Math.abs(s - seconds) < Math.abs(best - seconds) ? s : best
  );
}

/** How long a clip runs: its own seconds, or what its old Short/Long meant. */
export function clipSeconds(
  model: VideoModelId,
  length: LengthId | undefined,
  seconds?: number | undefined
): number {
  if (seconds) return seconds;
  const l = length ?? 'short';
  return LEGACY_SECONDS[model]?.[l] ?? (l === 'short' ? 5 : 10);
}

/**
 * The video prompt keeps the still as the complete truth about the place:
 * one continuous shot, small camera move, natural motion only in the things
 * that move in real life. Seedance caps prompts at 3500 characters; this
 * stays well under even with extra direction.
 */
export function buildVideoPrompt(
  motion: MotionId,
  direction: string,
  withPeople: boolean,
  style: MoveStyleId = 'steady',
  speed: SpeedId = 'slow',
  frames?: { last?: boolean; middle?: number; refs?: number },
  /** Only what the photograph (and any supplied frames) shows may appear. */
  strict = false,
  /** Shot as a high-end architectural film (the Director's clips). */
  archviz = false
): string {
  const move = MOTIONS.find((m) => m.id === motion) ?? MOTIONS[0];
  const how = MOVE_STYLES.find((m) => m.id === style) ?? MOVE_STYLES[0];
  const pace = SPEEDS.find((s) => s.id === speed) ?? SPEEDS[1];
  // A locked-off or focus-only shot has no travel to style; only a handheld
  // camera still breathes.
  const travels = move.id !== 'still-life' && move.id !== 'focus-pull';
  const camera = travels
    ? `${move.camera}, moving ${pace.camera}, ${how.camera}`
    : how.id === 'handheld'
      ? `${move.camera.replace('on a tripod', 'held by hand')}, with only a subtle, natural handheld breathing`
      : move.camera;
  const extra = direction.trim();
  return [
    'A single continuous, photorealistic cinematic shot that starts exactly on this photograph.',
    `${camera}.`,
    'Every wall, sculpture, tree, lamp, pool, curb, plant and paving line stays exactly as it is in the photograph, rigid and unchanged in shape, number and position, with nothing added or removed.',
    'Only what moves in real life moves: water falls, flows and ripples naturally with true reflections, leaves and branches stir gently in a light breeze, and the light stays the same throughout.',
    withPeople
      ? PEOPLE_MOTION_SENTENCE
      : 'No people or animals appear.',
    strict ? STRICT_SENTENCE : '',
    extra ? (strict ? `Also, using only what is already in the image: ${extra}.` : `Also: ${extra}.`) : '',
    ...frameSentences(frames),
    archviz && how.id !== 'handheld' ? (travels ? ARCHVIZ_SENTENCE : ARCHVIZ_LOCKED_SENTENCE) : '',
    how.id === 'handheld'
      ? 'High-end cinema camera footage with natural motion blur and film grain.'
      : 'Smooth, stable, high-end cinema camera footage with natural motion blur and film grain.',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * One small, unhurried action per person, lips closed, and the breeze in hair
 * and cloth: the pattern of a good locked-off portrait clip.
 */
export const PEOPLE_MOTION_SENTENCE =
  'The people already in the frame stay exactly the same people, with the same faces, hair, clothing and real-world scale, and their faces never change or morph. Each person makes one small, natural, feel-good movement at true real-time speed, as if unaware of the camera: a slow turn of the head, a glance up at the trees, a soft smile forming, a hand brushing hair back, or an unhurried step with weight on each foot. Lips stay closed: no talking, no mouth movement, no visible breath. Eyes blink naturally and look where the action leads, never into the lens. Loose strands of hair and the folds of linen and cotton lift and settle gently in the same light breeze that moves the leaves, and a few petals or leaves drift down. Real skin texture, pores and fine lines stay sharp and unchanged; hands keep five natural fingers; feet stay planted on the ground with matching shadows, never sliding; no one appears, disappears or changes size.';

export const ARCHVIZ_SENTENCE =
  'Shot as a high-end architectural film: the architecture is the hero. The horizon stays perfectly level and every vertical line stays truly vertical and parallel, with no tilt, roll, keystone or lens distortion. One deliberate, motion-control-smooth move from start to finish, no zooming, no shake, no sudden change of direction. Crisp, true material detail in stone, timber, glass, metal and planting, natural daylight behaviour, calm and premium like a luxury property film.';

/** The same film, for a locked-off or focus-only shot: no move to describe. */
export const ARCHVIZ_LOCKED_SENTENCE =
  'Shot as a high-end architectural film: the architecture is the hero. The horizon stays perfectly level and every vertical line stays truly vertical and parallel, with no tilt, roll, keystone or lens distortion. No zooming and no shake. Crisp, true material detail in stone, timber, glass, metal and planting, natural daylight behaviour, calm and premium like a luxury property film.';

export const STRICT_SENTENCE =
  'Strict rule: nothing appears that is not already visible in the photograph or the supplied frames. No new objects, buildings, furniture, plants, vehicles, people, animals, signs, text, sky features or light sources. The camera never reveals space beyond the edges of the image: keep the move small enough that every frame shows only what the photograph already contains.';

/** For the models that take a negative prompt, when the frame has people: no talking, morphing or sliding. */
export const PEOPLE_NEGATIVE_PROMPT =
  'talking, mouth moving, visible breath, face morphing, warped hands, extra fingers, sliding feet';

/** For the models that take a negative prompt, with the strict switch on. */
export const STRICT_NEGATIVE_PROMPT = `new objects, added buildings, added furniture, added plants or trees, added vehicles, new people, animals, birds, text, signage, logos, watermark, new light sources, objects appearing, objects disappearing, morphing, warping geometry, scene change, cut, invented areas beyond the frame, ${PEOPLE_NEGATIVE_PROMPT}`;

export function frameSentences(frames: { last?: boolean; middle?: number; refs?: number } | undefined): string[] {
  if (!frames) return [];
  const out: string[] = [];
  if (frames.last || frames.middle) {
    out.push(
      frames.middle
        ? 'The shot is one continuous camera move through the supplied frames in order, passing through each middle frame in turn and finishing on the last one; where the camera move above disagrees with the frames, the frames win.'
        : 'The shot is one continuous camera move from the opening photograph to the closing frame, arriving exactly on it; where the camera move above disagrees with the closing frame, the closing frame wins.'
    );
  }
  if (frames.refs) {
    out.push(
      `Image 1 is the opening photograph and the shot starts exactly on it; images 2 to ${frames.refs + 1} are references only: take from each one only what the direction says, and add nothing else from them.`
    );
  }
  return out;
}

/**
 * Trim a prompt to a model's length cap at a sentence boundary. The cinematic
 * prompt leads with what matters most (keep the design, then the look), so
 * the tail is what gives way.
 */
export function clampPrompt(prompt: string, max: number): string {
  if (prompt.length <= max) return prompt;
  const cut = prompt.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  return end > max * 0.6 ? cut.slice(0, end + 1) : cut;
}
