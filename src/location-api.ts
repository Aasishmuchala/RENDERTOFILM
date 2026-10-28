import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { buildLocationPrompt, LIGHT_IDS, VIEW_IDS } from './location.ts';
import { ownerKey, type Still, updateLibrary } from './library.ts';
import {
  defaultImageResolution,
  IMAGE_MODEL_IDS,
  imageModelPromptLimit,
  imageResolutions,
  snapMatchFrame,
} from './models.ts';
import { submitStill } from './still-submit.ts';
import { logRejection, toTrpcError } from './task-helpers.ts';
import { router, signedInProcedure } from './trpc.ts';

/**
 * The Location tab: a Google Earth screenshot of a spot, with its latitude and
 * longitude, becomes a photoreal aerial photograph. One take is one still in
 * the library, polled with `shotStatus` like any other.
 */
export const locationRouter = router({
  create: signedInProcedure
    .input(
      z.object({
        url: z.string().url(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        lat: z.number().min(-90, 'Latitude must be between -90 and 90.').max(90, 'Latitude must be between -90 and 90.'),
        lng: z.number().min(-180, 'Longitude must be between -180 and 180.').max(180, 'Longitude must be between -180 and 180.'),
        place: z.string().max(120, 'The place name is over 120 characters. Shorten it and try again.').default(''),
        view: z.enum(VIEW_IDS).default('match'),
        light: z.enum(LIGHT_IDS).default('match'),
        direction: z.string().max(600, 'The extra direction is over 600 characters. Shorten it and try again.').default(''),
        imageModel: z.enum(IMAGE_MODEL_IDS).default('nano-banana-pro'),
        resolution: z.string().max(16).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      const { url: imageUrl, width, height } = input;
      const place = input.place.trim();
      const resolution =
        input.resolution && imageResolutions(input.imageModel).some((r) => r.id === input.resolution)
          ? input.resolution
          : defaultImageResolution(input.imageModel);
      const prompt = buildLocationPrompt({
        lat: input.lat,
        lng: input.lng,
        place,
        view: input.view,
        light: input.light,
        direction: input.direction,
        maxLength: imageModelPromptLimit(input.imageModel) ?? 4000,
      });
      // The model's own ratio nearest the screenshot's: the shape the take comes back in.
      const frame = snapMatchFrame(input.imageModel, width, height);
      let id: string;
      try {
        ({ id } = await submitStill(
          ctx,
          { imageModel: input.imageModel, imageUrl, width, height, frame, resolution },
          prompt
        ));
      } catch (err) {
        logRejection('location', input.imageModel, err);
        throw toTrpcError(err);
      }
      const still: Still = {
        id,
        createdAt: new Date().toISOString(),
        status: 'pending',
        imageModel: input.imageModel,
        look: 'none',
        angle: 'as-rendered',
        crowd: 'none',
        people: '',
        direction: input.direction,
        width: frame.width,
        height: frame.height,
        sourceUrl: imageUrl,
        resolution,
        location: {
          lat: input.lat,
          lng: input.lng,
          ...(place ? { place } : {}),
          view: input.view,
          light: input.light,
        },
      };
      try {
        await updateLibrary(owner, (lib) => ({ ...lib, stills: [still, ...lib.stills.filter((s) => s.id !== id)] }));
      } catch (err) {
        console.warn('[location] could not save', id, err);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message:
            'Your take started on Runway, but your library could not save it, so this page cannot follow it. Look for it in your Runway account, and try again in a moment.',
          cause: err,
        });
      }
      return { id, width: frame.width, height: frame.height };
    }),
});
