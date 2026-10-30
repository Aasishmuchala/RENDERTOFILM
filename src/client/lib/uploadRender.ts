/** Longest edge sent to the model — plenty for a 2K result, and small to upload. */
const MAX_EDGE = 2560;
/** Largest image `POST /api/upload` takes. */
const IMAGE_LIMIT = 25 * 1024 * 1024;
/** Largest clip `POST /api/upload-clip` takes. */
const CLIP_LIMIT = 100 * 1024 * 1024;
const CLIP_TYPES = new Set(['video/mp4', 'video/quicktime']);

export type UploadFailure = { status: number; body: unknown; message: string };

/**
 * Downscale an image to a JPEG no larger than {@link MAX_EDGE} on its long
 * side, then upload it through `POST /api/upload` as a hosted URL the model
 * can read. Throws an {@link UploadFailure} whose `body` is the route's JSON,
 * so `signInRequiredFrom` / `consentRequiredFrom` can recognise it.
 */
export async function uploadRender(source: Blob): Promise<string> {
  return postFile('/api/upload', 'image/jpeg', await toJpeg(source), 'url', 'image');
}

/**
 * Upload an image at its full size (Recreate in 4K's source still): the
 * original bytes when they fit the 25 MB limit, else a JPEG at the same pixel
 * size. Never downsized, unlike {@link uploadRender}. Throws an
 * {@link UploadFailure} like it.
 */
export async function uploadImageFull(file: File): Promise<string> {
  if (file.size <= IMAGE_LIMIT && file.type.startsWith('image/')) {
    return postFile('/api/upload', file.type, file, 'url', 'image');
  }
  return postFile('/api/upload', 'image/jpeg', await toJpeg(file, Infinity), 'url', 'image');
}

/**
 * Upload a reference clip (MP4 or MOV, as is) through `POST /api/upload-clip`
 * as a hosted URL the model can read. Throws an {@link UploadFailure}.
 */
export async function uploadClip(file: File): Promise<string> {
  if (!CLIP_TYPES.has(file.type)) {
    throw { status: 415, body: null, message: 'Upload an MP4 or MOV clip.' } satisfies UploadFailure;
  }
  if (file.size > CLIP_LIMIT) {
    throw { status: 413, body: null, message: 'That clip is over 100 MB.' } satisfies UploadFailure;
  }
  return postFile('/api/upload-clip', file.type, file, 'url', 'clip');
}

/**
 * Keep a copy of the render in the app's own storage, for a marked edit:
 * the server rebuilds the untouched area from it. Same JPEG the model gets,
 * so the two line up pixel for pixel. Returns the storage key.
 */
export async function storeRenderCopy(source: Blob): Promise<string> {
  return postFile('/api/render-copy', 'image/jpeg', await toJpeg(source), 'key', 'image');
}

/** A server that is waking up or briefly overloaded answers one of these. */
const RETRYABLE = new Set([502, 503, 504]);

/**
 * POST the bytes, trying once more after a dropped connection or a gateway
 * timeout, so a server that was slow to wake doesn't cost the visitor a click.
 */
async function postWithRetry(route: string, contentType: string, bytes: Blob): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(route, { method: 'POST', headers: { 'Content-Type': contentType }, body: bytes });
      // The app's own 504 has already retried server-side; only a proxy's
      // non-JSON timeout page is worth another try from here.
      const fromApp = res.headers.get('content-type')?.includes('json') ?? false;
      if (attempt < 2 && RETRYABLE.has(res.status) && !fromApp) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      return res;
    } catch {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw {
        status: 0,
        body: null,
        message: 'The upload was cut off. Check your connection and try again.',
      } satisfies UploadFailure;
    }
  }
}

function failureText(status: number, what: string): string {
  if (RETRYABLE.has(status)) return `The server took too long to take the ${what}. Wait a moment, then try again.`;
  if (status === 413) return `That ${what} is too large. Use a smaller file.`;
  return `The ${what} could not be uploaded (${status}). Try again.`;
}

async function postFile(
  route: string,
  contentType: string,
  bytes: Blob,
  field: 'url' | 'key',
  what: string
): Promise<string> {
  const res = await postWithRetry(route, contentType, bytes);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (body as { message?: unknown; error?: unknown } | null)?.message ??
      (body as { error?: unknown } | null)?.error;
    throw {
      status: res.status,
      body,
      message:
        typeof message === 'string' && message !== 'sign_in_required'
          ? message
          : failureText(res.status, what),
    } satisfies UploadFailure;
  }
  return (body as Record<string, string>)[field]!;
}

/** A JPEG of the image, no larger than `maxEdge` on its long side (`Infinity` keeps its size). */
async function toJpeg(source: Blob, maxEdge = MAX_EDGE): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  // A JPEG has no alpha: left unpainted, the transparent part of a PNG is
  // black. White, as a render on paper.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not read that image.'))),
      'image/jpeg',
      0.92
    )
  );
}

export function isUploadFailure(e: unknown): e is UploadFailure {
  return typeof e === 'object' && e !== null && 'status' in e && 'body' in e;
}

/**
 * Store a marked area (the black-and-white PNG from `exportMaskPng`) through
 * `POST /api/mask`; `createShot` takes the returned key. Throws an
 * {@link UploadFailure} like {@link uploadRender}.
 */
export async function uploadMask(png: Blob): Promise<string> {
  const res = await postWithRetry('/api/mask', 'image/png', png);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (body as { message?: unknown; error?: unknown } | null)?.message ??
      (body as { error?: unknown } | null)?.error;
    throw {
      status: res.status,
      body,
      message:
        typeof message === 'string' && message !== 'sign_in_required'
          ? message
          : failureText(res.status, 'marked area'),
    } satisfies UploadFailure;
  }
  return (body as { key: string }).key;
}
