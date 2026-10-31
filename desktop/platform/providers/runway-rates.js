// Runway developer API rate card, for the cost line beside a model. Pure.
//
// Source: https://docs.dev.runwayml.com/guides/pricing (the only page Runway
// says carries credit costs), read 2026-10-31, $0.01 per credit.
//
// Kling 4.0 is listed at list price. The page has it 20% off through November
// 30, 2026 UTC (12.56 and 18.8 credits per second without an input video, 7.52
// and 11.28 per second with one), so a run before then costs less than quoted.
import { publicModel, runwaySeconds, runwayTier } from './runway-mapping.js';
import { refsOf, videoRefsOf } from '../realgen/mapping.js';

export const RATES_AS_OF = '2026-10-31';
export const USD_PER_CREDIT = 0.01;

/** One line per public model, as the Cost line shows it. */
export const RUNWAY_RATES = {
  'gen4.5': '12 credits per second',
  gen4_turbo: '5 credits per second',
  'veo3.1': '20 credits per second (no audio)',
  'veo3.1_fast': '10 credits per second (no audio)',
  'kling3.0_pro': '12 credits per second (no audio)',
  'kling3.0_4k': '43 credits per second',
  klingO3_pro: '17 credits per second',
  kling_4: '15.7 credits per second at 720p, 23.5 at 1080p; with a source clip about 18.8 at 720p, 28.2 at 1080p',
  seedance2: '14 credits per second at 480p, 30 at 720p, 40 at 1080p, 150 at 4K (56 credit minimum)',
  seedance2_fast: '11 credits per second at 480p, 24 at 720p (44 credit minimum)',
  seedance2_5: '20 credits per second at 480p, 30 at 720p, 68 at 1080p, plus input video (80 credit minimum)',
  hailuo3: '10 credits per second at 768p, 15 at 2K, plus 2 per reference image',
  aleph2: '28 credits per second (56 credit minimum)',
  gen4_image: '5 credits per 720p image, 8 per 1080p',
  gemini_image3_pro: '20 credits per 1K or 2K image, 40 per 4K',
  'gemini_image3.1_flash': '7 credits per 1K image, 11 per 2K, 16 per 4K',
  'nano_banana_2.1': '4 credits per 1K image, 6 per 2K, 12 per 4K',
  gpt_image_2: '1 to 41 credits per image, by quality and resolution',
  gpt_image_2_5_sunburst: '1 to 75 credits per image, by quality, resolution and aspect ratio, plus 1 per reference image',
  gpt_image_2_5_flare: '1 to 75 credits per image, by quality, resolution and aspect ratio, plus 1 per reference image',
  seedream5_pro: '5 credits per 1K image, 9 per 2K',
  grok_imagine_image_2: '4 to 8 credits per image, plus 1 per reference image',
  magnific_precision_upscaler_v2: '25 credits per image (150 when the output exceeds 4096 px)',
  magnific_video_upscaler_creative: '1.2 credits per frame at 4K (about 360 for 10 seconds at 30 fps)',
};

/** Bay alias → one rate line (`Capabilities.rates`). Veo's two models share an alias. */
export const RUNWAY_RATES_BY_ALIAS = {
  gemini_3_pro: RUNWAY_RATES.gemini_image3_pro,
  nano_banana_2_1: RUNWAY_RATES['nano_banana_2.1'],
  gemini_3_1_flash_image: RUNWAY_RATES['gemini_image3.1_flash'],
  gpt_image_2_5_sunburst: RUNWAY_RATES.gpt_image_2_5_sunburst,
  gpt_image_2_5_flare: RUNWAY_RATES.gpt_image_2_5_flare,
  gpt_image_2: RUNWAY_RATES.gpt_image_2,
  seedream_5_pro: RUNWAY_RATES.seedream5_pro,
  grok_imagine_image_2: RUNWAY_RATES.grok_imagine_image_2,
  ref_image_to_image: RUNWAY_RATES.gen4_image,
  seedance_2: RUNWAY_RATES.seedance2,
  seedance_2_fast: RUNWAY_RATES.seedance2_fast,
  seedance_2_5: RUNWAY_RATES.seedance2_5,
  kling_3_0_pro: RUNWAY_RATES['kling3.0_pro'],
  kling_3_0_4k: RUNWAY_RATES['kling3.0_4k'],
  kling_o3_pro: RUNWAY_RATES.klingO3_pro,
  kling_4_0: RUNWAY_RATES.kling_4,
  veo3_1: '20 credits per second (no audio), 10 on Veo 3.1 Fast',
  'gen4.5': RUNWAY_RATES['gen4.5'],
  gen4_turbo: RUNWAY_RATES.gen4_turbo,
  minimax_hailuo_3_0: RUNWAY_RATES.hailuo3,
  workflow_aleph_2: RUNWAY_RATES.aleph2,
  magnific_precision_upscaler_v2: RUNWAY_RATES.magnific_precision_upscaler_v2,
  magnific_video_upscaler_creative: RUNWAY_RATES.magnific_video_upscaler_creative,
};

/** Credits per second, by tier where the model has tiers, with the per-generation minimum. */
const PER_SECOND = {
  'gen4.5': { rate: 12 },
  gen4_turbo: { rate: 5 },
  'veo3.1': { rate: 20 },
  'veo3.1_fast': { rate: 10 },
  'kling3.0_pro': { rate: 12 },
  'kling3.0_4k': { rate: 43 },
  klingO3_pro: { rate: 17 },
  aleph2: { rate: 28, minimum: 56 },
  seedance2: { tiers: { '480p': 14, '720p': 30, '1080p': 40, '4k': 150 }, minimum: 56 },
  seedance2_fast: { tiers: { '480p': 11, '720p': 24 }, minimum: 44 },
  seedance2_5: { tiers: { '480p': 20, '720p': 30, '1080p': 68 }, minimum: 80 },
  hailuo3: { tiers: { '768p': 10, '2k': 15 }, perReference: 2 },
  kling_4: { tiers: { '720p': 15.7, '1080p': 23.5 }, videoTiers: { '720p': 18.8, '1080p': 28.2 } },
};

const PER_IMAGE = {
  gen4_image: { '720p': 5, '1080p': 8 },
  gemini_image3_pro: { '1k': 20, '2k': 20, '4k': 40 },
  'gemini_image3.1_flash': { '1k': 7, '2k': 11, '4k': 16 },
  'nano_banana_2.1': { '1k': 4, '2k': 6, '4k': 12 },
  seedream5_pro: { '1k': 5, '2k': 9 },
};

/**
 * The cost line for one task: `about N credits` for a per-second model, `N
 * credits` for a per-image one, the rate line for a range, null for a task the
 * API does not run.
 */
export function quoteRunway(type, options) {
  const o = options && typeof options === 'object' ? options : {};
  const model = publicModel(type, o);
  if (!model) return null;

  const clip = PER_SECOND[model];
  if (clip) {
    const tier = runwayTier(type, o);
    const tiers = videoRefsOf(o).length > 0 && clip.videoTiers ? clip.videoTiers : clip.tiers;
    const rate = clip.rate ?? tiers[tier];
    const references = clip.perReference ? clip.perReference * Math.max(1, refsOf(o).length) : 0;
    const total = rate * runwaySeconds(type, o) + references;
    return `about ${Math.ceil(Math.max(total, clip.minimum ?? 0))} credits`;
  }
  const still = PER_IMAGE[model]?.[runwayTier(type, o)];
  return still !== undefined ? `${still} credits` : RUNWAY_RATES[model];
}
