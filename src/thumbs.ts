import { headObject, presignGet } from '@runway/bay/storage';

import { imageSlot, MAX_INPUT_PIXELS, readCapped, sharp } from './imaging.ts';
import { putObject } from './storage.ts';

/** Wide enough for a picker card or a contact-sheet frame on a retina screen. */
const THUMB_WIDTH = 720;

export function thumbKey(owner: string, id: string): string {
  return `thumbs/${owner}/${id}.webp`;
}

export function viewKey(owner: string, id: string): string {
  return `views/${owner}/${id}.webp`;
}

// A page of thumbnails asks for many at once; one resize per still, however
// many requests arrive while it runs. The resizes themselves take turns with
// every other image job (src/imaging.ts), so a grid can't exhaust the pod.
const inFlight = new Map<string, Promise<string>>();

/** How a copy is cut: a small one for grids, a large one for the big screen. */
type CopySpec = { dir: string; width: number; quality: number };
const THUMB: CopySpec = { dir: 'thumbs', width: THUMB_WIDTH, quality: 78 };
/** Sharp on a 4K screen, and a few hundred KB instead of a raw render. */
const VIEW: CopySpec = { dir: 'views', width: 3840, quality: 90 };

function copyUrl(spec: CopySpec, owner: string, id: string, sourceUrl: string): Promise<string> {
  const key = `${spec.dir}/${owner}/${id}.webp`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const work = (async () => {
    if (!(await headObject(key))) {
      await imageSlot(async () => {
        const out = await sharp(await readCapped(sourceUrl, 'still'), { limitInputPixels: MAX_INPUT_PIXELS })
          .resize({ width: spec.width, withoutEnlargement: true })
          .webp({ quality: spec.quality })
          .toBuffer();
        await putObject(key, out, { contentType: 'image/webp' });
      });
    }
    return presignGet(key, { expiresIn: 900 });
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, work);
  return work;
}

/**
 * A small WebP of a still, made once from its full-size image and kept in
 * storage, so a grid of stills downloads and decodes kilobytes instead of
 * full renders. Returns a signed URL for it.
 */
export function thumbUrl(owner: string, id: string, sourceUrl: string): Promise<string> {
  return copyUrl(THUMB, owner, id, sourceUrl);
}

/**
 * A full-resolution WebP of a still for the big screen, compare and zoom
 * views, kept in the app's own storage like the thumbnail. A browser can
 * refuse the Runway file link itself (the preview does), so viewing never
 * depends on it; downloads still get the original file.
 */
export function viewUrl(owner: string, id: string, sourceUrl: string): Promise<string> {
  return copyUrl(VIEW, owner, id, sourceUrl);
}
