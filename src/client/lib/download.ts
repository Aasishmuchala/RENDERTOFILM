import { useCallback, useState } from 'react';

/**
 * Save a file under `filename`. `onProgress` gets 0–1 while the bytes arrive
 * (when the size is known). Throws a readable error when the file can't be
 * fetched — a popup opened after an await would be blocked, so there is no
 * open-in-a-tab fallback.
 */
export async function download(url: string, filename: string, onProgress?: (fraction: number) => void) {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error('The download was cut off. Check your connection and try again.');
  }
  if (res.status === 404) throw new Error('This file is no longer in your library.');
  if (!res.ok) throw new Error(`The download failed (${res.status}). Try again.`);
  try {
    const total = Number(res.headers.get('content-length')) || 0;
    let blob: Blob;
    if (res.body && total && onProgress) {
      const reader = res.body.getReader();
      const chunks: BlobPart[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        onProgress(Math.min(1, received / total));
      }
      blob = new Blob(chunks, { type: res.headers.get('content-type') ?? '' });
    } else {
      blob = await res.blob();
    }
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  } catch {
    throw new Error('The download was cut off. Check your connection and try again.');
  }
}

/**
 * A download button's state: `start` fetches and saves, `pending` is true
 * until the file is saved, `label` reads "Downloading 42%" while it runs.
 */
export function useDownload() {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = useCallback((url: string, filename: string) => {
    setProgress(0);
    setError(null);
    // A file arrives in many small chunks; re-render once per percent, not per chunk.
    let shown = 0;
    const onProgress = (f: number) => {
      const pct = Math.floor(f * 100) / 100;
      if (pct !== shown) setProgress((shown = pct));
    };
    download(url, filename, onProgress)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'The download failed. Try again.'))
      .finally(() => setProgress(null));
  }, []);
  const pending = progress !== null;
  const label = (idle: string) =>
    pending ? (progress > 0 ? `Downloading ${Math.round(progress * 100)}%` : 'Starting download…') : idle;
  return { start, pending, label, error };
}

/** The stable app URL of a library still or clip, or an Edit tab copy or export (src/api-routes.ts). */
export function libraryUrl(kind: 'still' | 'clip' | 'edit', id: string): string {
  return `/api/library/${kind}/${encodeURIComponent(id)}`;
}

/** A small copy of a library still, for grids and pickers (src/thumbs.ts). */
export function stillThumbUrl(id: string): string {
  return `${libraryUrl('still', id)}?thumb`;
}

/**
 * A full-resolution copy of a library still kept in the app's storage, for
 * the big screen, compare and zoom views (src/thumbs.ts). Downloads use
 * `libraryUrl`, the original file.
 */
export function stillViewUrl(id: string): string {
  return `${libraryUrl('still', id)}?view`;
}

/** A neutral frame for a clip with no picture to show (no poster, and no still left). */
export const NO_POSTER = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><rect width="160" height="100" fill="#1e1b18"/><path d="M72 38v24l20-12z" fill="#a59c90"/></svg>'
)}`;

/**
 * A clip's poster: its own stored copy of the image it started on (src/thumbs.ts),
 * else a copy of the library still it was made from while `stills` still
 * has it (`view` for the big screen). `undefined` when it has neither — show
 * a placeholder, never a request that 404s.
 */
export function clipPosterUrl(
  clip: { id: string; stillId: string; posterKey?: string | undefined },
  stills: { has(id: string): boolean },
  size: 'thumb' | 'view' = 'thumb'
): string | undefined {
  if (clip.posterKey) return `${libraryUrl('clip', clip.id)}?poster`;
  if (!clip.stillId || !stills.has(clip.stillId)) return undefined;
  return size === 'view' ? stillViewUrl(clip.stillId) : stillThumbUrl(clip.stillId);
}
