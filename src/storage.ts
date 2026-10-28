/**
 * Storage for this app's own S3 prefix.
 *
 * Use the `@runway/bay/storage` helpers re-exported here. They work in three
 * places with no change: the deployed pod, `bay dev` on a laptop (against the
 * local S3 — the Docker one, or the built-in store `bay dev` runs itself when
 * there is no Docker), and a Bay Studio preview — where the pod holds no
 * credentials and the helpers go through Bay's storage broker to the app's
 * *real* prefix. So an object the preview writes is one the deployed app
 * reads.
 *
 * `presignUpload` mints a URL the browser `PUT`s to directly, `putObject` /
 * `getObject` / `deleteObject` / `list` do the work from the pod, and every key is relative to
 * the app's prefix — never prepend `BAY_S3_PREFIX` yourself.
 *
 * `documentStore` is durable structured state for an app with no database:
 * one JSON object per document, and an `update()` that re-reads and retries
 * instead of overwriting a write that landed in between.
 *
 * Mark anything written only to check the plumbing with `{ test: true }`: it
 * lands under `.bay-preview/`, a reserved prefix Bay hides from the app's
 * storage listing and deletes when the Studio session ends, so a smoke test
 * never pollutes the user's files. It is the only `.bay-` path an app may
 * write to.
 *
 * Write through these helpers rather than a raw `@aws-sdk/client-s3` client.
 * The helpers are where Bay decides how a write reaches the bucket (through
 * the broker in a Studio preview today), and an SDK update carries that to
 * every app. A raw `PutObject` / `DeleteObject` picks up none of that and
 * reaches nothing in a preview. `bay deploy` warns when it finds one in the
 * app's source.
 */
export {
  deleteObject,
  documentStore,
  getObject,
  list,
  presignUpload,
  putObject,
  STORAGE_UPLOAD_FAILURE_HINT,
} from '@runway/bay/storage';
