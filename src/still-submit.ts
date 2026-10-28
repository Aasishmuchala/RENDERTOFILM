import { snapAspectRatio } from '@runway/bay/runway';

import { clampPrompt, gen4ImageSize, type ImageModelId } from './models.ts';
import type { RunwayCtx } from './task-helpers.ts';

/** Submitting one still to an image model, shared by the Stills and Close-ups tabs. */

/** Prompt cap for models with no documented limit; the Google models take it whole. */
const SAFE_PROMPT = 4000;

/** The image-model preset mapped onto that model's own task options. */
export function submitStill(
  ctx: RunwayCtx,
  input: {
    imageModel: ImageModelId;
    imageUrl: string;
    /** Cast sheet, already filtered to models that take a second reference. */
    castSheetUrl?: string | undefined;
    /** Lighting reference, always the last reference image. */
    lightRefUrl?: string | undefined;
    /** The render's own size, for the reference image. */
    width: number;
    height: number;
    /** The output's shape: the chosen ratio, or the render's own. */
    frame: { width: number; height: number };
    resolution: string;
  },
  fullPrompt: string
) {
  const { imageModel, imageUrl, width, height, resolution, castSheetUrl, lightRefUrl } = input;
  const { width: fw, height: fh } = input.frame;
  // Reference images, render first. Each model names its list differently, so
  // these build every shape it accepts: `tagged` for models whose elements
  // require a `tag`, `plain` for the ones with only a `url`.
  const tagged = (extra?: { width: number; height: number }) => [
    { tag: 'render', url: imageUrl, ...extra },
    ...(castSheetUrl ? [{ tag: 'cast', url: castSheetUrl }] : []),
    ...(lightRefUrl ? [{ tag: 'light', url: lightRefUrl }] : []),
  ];
  const plain = [
    { url: imageUrl },
    ...(castSheetUrl ? [{ url: castSheetUrl }] : []),
    ...(lightRefUrl ? [{ url: lightRefUrl }] : []),
  ];
  const name = 'render-to-film';
  const prompt = clampPrompt(fullPrompt, SAFE_PROMPT);
  switch (imageModel) {
    case 'nano-banana-pro':
      return ctx.runway.createTask('gemini_3_pro', {
        name,
        text_prompt: fullPrompt,
        reference_images: tagged(),
        aspect_ratio: snapAspectRatio(fw, fh, 'gemini_3_pro') ?? '16:9',
        image_size: pick(resolution, ['1K', '2K', '4K'] as const, '2K'),
      });
    case 'nano-banana-2':
      return ctx.runway.createTask('gemini_3_1_flash_image', {
        name,
        text_prompt: fullPrompt,
        reference_images: tagged(),
        aspect_ratio:
          snapAspectRatio(fw, fh, 'gemini_3_1_flash_image') ?? '16:9',
        image_size: pick(resolution, ['1K', '2K', '4K'] as const, '2K'),
      });
    case 'nano-banana-2-1':
      return ctx.runway.createTask('nano_banana_2_1', {
        name,
        prompt: clampPrompt(fullPrompt, 5500),
        referenceImages: tagged(),
        aspectRatio: snapAspectRatio(fw, fh, 'nano_banana_2_1') ?? '16:9',
        resolution: pick(resolution, ['1k', '2k', '4k'] as const, '2k'),
      });
    case 'gpt-image-2-5-sunburst':
    case 'gpt-image-2-5-flare': {
      const alias =
        imageModel === 'gpt-image-2-5-sunburst'
          ? 'gpt_image_2_5_sunburst'
          : 'gpt_image_2_5_flare';
      return ctx.runway.createTask(alias, {
        name,
        prompt,
        referenceImages: tagged({ width, height }),
        size: pick(resolution, ['1', '2', '4'] as const, '2'),
        aspectRatio: snapAspectRatio(fw, fh, alias) ?? '16:9',
        quality: 'high',
      });
    }
    case 'gpt-image-2':
      return ctx.runway.createTask('gpt_image_2', {
        name,
        prompt,
        referenceImages: tagged({ width, height }),
        size: pick(resolution, ['1', '2', '4'] as const, '2'),
        aspectRatio: snapAspectRatio(fw, fh, 'gpt_image_2') ?? '16:9',
        quality: 'high',
      });
    case 'seedream-5-pro':
      return ctx.runway.createTask('seedream_5_pro', {
        name,
        prompt,
        referenceImages: plain,
        aspectRatio: snapAspectRatio(fw, fh, 'seedream_5_pro') ?? '16:9',
        resolution: pick(resolution, ['1k', '2k'] as const, '2k'),
      });
    case 'seedream-5':
      return ctx.runway.createTask('seedream_5', {
        name,
        prompt,
        referenceImages: plain,
        aspectRatio: snapAspectRatio(fw, fh, 'seedream_5') ?? '16:9',
        resolution: pick(resolution, ['2k', '3k'] as const, '2k'),
      });
    case 'flux-2-max':
      return ctx.runway.createTask('bfl_flux_2_max', {
        name,
        prompt,
        referenceImages: tagged(),
        aspectRatio: snapAspectRatio(fw, fh, 'bfl_flux_2_max') ?? '16:9',
        resolution: pick(resolution, ['1', '2', '4'] as const, '2'),
      });
    case 'grok-imagine-2':
      return ctx.runway.createTask('grok_imagine_image_2', {
        name,
        textPrompt: prompt,
        referenceImages: tagged(),
        edit: true,
        aspectRatio:
          snapAspectRatio(fw, fh, 'grok_imagine_image_2') ?? '16:9',
        resolution: pick(resolution, ['1k', '2k'] as const, '2k'),
      });
    case 'krea-image-3':
      return ctx.runway.createTask('krea_image_3', {
        name,
        textPrompt: clampPrompt(fullPrompt, 5000),
        referenceImages: tagged(),
        aspectRatio: snapAspectRatio(fw, fh, 'krea_image_3') ?? '16:9',
        resolution: '2k',
      });
    case 'gen-4-image':
      // Gen-4 Image takes only fixed size pairs (gen4ImageSize), and the
      // cast sheet rides along as a second tagged reference.
      return ctx.runway.createTask('ref_image_to_image', {
        name,
        text_prompt: prompt,
        reference_images: tagged(),
        ...gen4ImageSize(resolution, fw, fh),
      });
  }
}

/** `value` when it is one of `allowed`, else `fallback`. */
export function pick<T extends string>(
  value: string,
  allowed: readonly T[],
  fallback: T
): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

