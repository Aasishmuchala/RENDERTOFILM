import { headObject, presignGet } from '@runway/bay/storage';

import { imageSlot, MAX_INPUT_PIXELS, readCapped, sharp } from './imaging.ts';
import { safeFetch } from './safe-fetch.ts';
import { type Clip, patchClip } from './library.ts';
import { getObject, putObject } from './storage.ts';

/** Wide enough for a picker card or a contact-sheet frame on a retina screen. */
const THUMB_WIDTH = 720;

export function thumbKey(owner: string, id: string): string {
  return `thumbs/${owner}/${id}.webp`;
}

export function viewKey(owner: string, id: string): string {
  return `views/${owner}/${id}.webp`;
}

/** A clip's own poster (`Clip.posterKey`), by the clip's id or, once deleted, its still's. */
export function posterKey(owner: string, id: string): string {
  return `posters/${owner}/${id}.webp`;
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
/** A clip's poster: a card in a grid, and the frame a player shows before it plays. */
const POSTER: CopySpec = { dir: 'posters', width: 1280, quality: 80 };

/** Cut the copy of `sourceUrl` into `key`, unless it is already there. */
async function writeCopy(spec: CopySpec, key: string, sourceUrl: string): Promise<void> {
  if (await headObject(key)) return;
  await imageSlot(async () => {
    // The source can be a visitor's own upload: never read a private address.
    const out = await sharp(await readCapped(sourceUrl, 'still', safeFetch), { limitInputPixels: MAX_INPUT_PIXELS })
      .resize({ width: spec.width, withoutEnlargement: true })
      .webp({ quality: spec.quality })
      .toBuffer();
    await putObject(key, out, { contentType: 'image/webp' });
  });
}

function copyUrl(spec: CopySpec, owner: string, id: string, sourceUrl: string): Promise<string> {
  const key = `${spec.dir}/${owner}/${id}.webp`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const work = (async () => {
    await writeCopy(spec, key, sourceUrl);
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

/** A signed URL for a clip's stored poster (`Clip.posterKey`). */
export function posterUrl(key: string): Promise<string> {
  return presignGet(key, { expiresIn: 900 });
}

/**
 * Give a clip that started on an uploaded image its own poster: a copy of
 * that image kept in the app's storage and recorded as `posterKey`, so the
 * clip shows the frame it really started on long after the upload expires.
 * Made when the clip starts and checked again when it finishes (a pod
 * replaced in between loses the first try). Best effort: a clip without a
 * poster shows a placeholder.
 */
export async function ensureClipPoster(
  owner: string,
  clip: Pick<Clip, 'id' | 'firstFrameUrl' | 'posterKey'>
): Promise<void> {
  const source = clip.firstFrameUrl;
  if (!source || clip.posterKey) return;
  const key = posterKey(owner, clip.id);
  try {
    let pending = inFlight.get(key);
    if (!pending) {
      pending = writeCopy(POSTER, key, source)
        .then(() => key)
        .finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    await pending;
    await patchClip(owner, clip.id, () => ({ posterKey: key }));
  } catch (err) {
    console.warn('[poster]', clip.id, err);
  }
}

/**
 * A still's stored thumbnail, copied as a poster for the clips made from it
 * before the still and its thumbnail are deleted. `undefined` when the still
 * never had a thumbnail made.
 */
export async function posterFromThumb(owner: string, stillId: string): Promise<string | undefined> {
  const bytes = await getObject(thumbKey(owner, stillId));
  if (!bytes) return undefined;
  const key = posterKey(owner, stillId);
  await putObject(key, bytes, { contentType: 'image/webp' });
  return key;
}
