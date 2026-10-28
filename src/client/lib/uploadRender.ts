/** Longest edge sent to the model — plenty for a 2K result, and small to upload. */
const MAX_EDGE = 2560;

export type UploadFailure = { status: number; body: unknown; message: string };

/**
 * Downscale an image to a JPEG no larger than {@link MAX_EDGE} on its long
 * side, then upload it through `POST /api/upload` as a hosted URL the model
 * can read. Throws an {@link UploadFailure} whose `body` is the route's JSON,
 * so `signInRequiredFrom` / `consentRequiredFrom` can recognise it.
 */
export async function uploadRender(source: Blob): Promise<string> {
  return postImage('/api/upload', await toJpeg(source), 'url');
}

/**
 * Keep a copy of the render in the app's own storage, for a marked edit:
 * the server rebuilds the untouched area from it. Same JPEG the model gets,
 * so the two line up pixel for pixel. Returns the storage key.
 */
export async function storeRenderCopy(source: Blob): Promise<string> {
  return postImage('/api/render-copy', await toJpeg(source), 'key');
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

async function postImage(route: string, jpeg: Blob, field: 'url' | 'key'): Promise<string> {
  const res = await postWithRetry(route, 'image/jpeg', jpeg);
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
          : failureText(res.status, 'image'),
    } satisfies UploadFailure;
  }
  return (body as Record<string, string>)[field]!;
}

async function toJpeg(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
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
