import { mediaRedirect } from '@runway/bay/storage';

/**
 * `/media/<key>` — one stable URL per stored object, which 302s to a
 * short-lived presigned S3 GET.
 *
 * Give the browser this URL, never a presigned one: a presigned URL rotates,
 * so re-rendering a `<video src>` with a fresh one makes the browser download
 * the whole file again. Redirecting (rather than piping the object through
 * this pod) also keeps `Range` requests on S3, which is what makes seeking
 * work — Safari refuses to play a video whose source doesn't support it.
 *
 * Mount it on a wildcard route and add your own authorization in front of it
 * if the objects aren't visible to everyone who can reach the app:
 *
 * ```ts
 * app.get('/media/{*key}', media);
 * ```
 *
 * A Download button points at the same URL with `?download` — that request is
 * signed to save the file under the key's name, so there is never a reason to
 * stream the object through this pod to attach a filename.
 */
export const media = mediaRedirect((ctx) => {
  const key = ctx.params['key'];
  return Array.isArray(key) ? key.join('/') : key;
});
