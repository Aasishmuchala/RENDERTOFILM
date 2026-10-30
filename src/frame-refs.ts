import { z } from 'zod';

/**
 * A frame or reference image for a clip: one of the visitor's own library
 * stills (signed server-side, never a client URL) or an image they uploaded
 * through `POST /api/upload`. Shared by `createVideo` (src/api.ts) and the
 * shot director (src/shot-director-api.ts).
 */
export const frameRef = z.union([
  z.object({ stillId: z.string().min(1).max(200) }),
  z.object({ uploadUrl: z.url().max(4000) }),
]);
export type FrameRef = z.infer<typeof frameRef>;

/**
 * The first frame of a clip. An upload carries its real pixel size (read by
 * the browser from the file), because the clip's shape follows the frame it
 * starts on, not the still picked in step 1.
 */
export const firstFrameRef = z.union([
  z.object({ stillId: z.string().min(1).max(200) }),
  z.object({
    uploadUrl: z.url().max(4000),
    width: z.number().int().min(1).max(20000),
    height: z.number().int().min(1).max(20000),
  }),
]);

/** A frame between first and last; `at` is how far into the clip (0 to 1). */
export const middleFrameRef = z.union([
  z.object({ stillId: z.string().min(1).max(200), at: z.number().min(0.05).max(0.95) }),
  z.object({ uploadUrl: z.url().max(4000), at: z.number().min(0.05).max(0.95) }),
]);
