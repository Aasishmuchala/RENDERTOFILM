import { useCallback, useRef, useState } from 'react';

import { classifyRunwayError } from './runwayErrors.ts';
import { isUploadFailure, uploadRender } from './uploadRender.ts';

const UPLOADS_AT_ONCE = 3;

export type Upload = {
  key: string;
  src: string;
  name: string;
  width: number;
  height: number;
  hostedUrl?: string | undefined;
  error?: unknown;
};

function uploadErrorFrom(e: unknown): unknown {
  // The route's body, so a sign-in or consent refusal shows its prompt.
  if (isUploadFailure(e)) {
    const kind = classifyRunwayError(e.body);
    return kind.signIn || kind.consent ? e.body : { message: e.message };
  }
  return e instanceof Error ? e : { message: 'The image could not be uploaded. Try again.' };
}

/**
 * A project's images, each uploaded as soon as it is added, a few at a time.
 * At most `max` are kept; the rest of a drop is counted in `overflow`.
 */
export function useProjectUploads(max: number): {
  uploads: Upload[];
  overflow: number;
  addFiles: (files: File[]) => Promise<void>;
  remove: (key: string) => void;
  retry: (key: string) => void;
  canRetry: (key: string) => boolean;
  pending: number;
  failed: number;
} {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [overflow, setOverflow] = useState(0);

  const queue = useRef<{ key: string; file: File }[]>([]);
  const running = useRef(0);
  const pump = useCallback(() => {
    while (running.current < UPLOADS_AT_ONCE && queue.current.length > 0) {
      const next = queue.current.shift()!;
      running.current += 1;
      uploadRender(next.file)
        .then((hostedUrl) => setUploads((list) => list.map((u) => (u.key === next.key ? { ...u, hostedUrl } : u))))
        .catch((e: unknown) =>
          setUploads((list) => list.map((u) => (u.key === next.key ? { ...u, error: uploadErrorFrom(e) } : u)))
        )
        .finally(() => {
          running.current -= 1;
          pump();
        });
    }
  }, []);

  const filesRef = useRef(new Map<string, File>());
  // Images kept or on their way in, counted at once so two quick drops can't
  // both take the same free room.
  const taken = useRef(0);
  async function addFiles(files: File[]) {
    const room = Math.max(0, max - taken.current);
    setOverflow(Math.max(0, files.length - room));
    const accepted = files.slice(0, room);
    taken.current += accepted.length;
    const added: Upload[] = [];
    for (const file of accepted) {
      const src = URL.createObjectURL(file);
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        const bitmap = await createImageBitmap(file);
        added.push({ key, src, name: file.name, width: bitmap.width, height: bitmap.height });
        bitmap.close();
        filesRef.current.set(key, file);
        queue.current.push({ key, file });
      } catch {
        added.push({
          key,
          src,
          name: file.name,
          width: 16,
          height: 9,
          error: { message: 'This file could not be read as an image. Try a PNG, JPEG or WebP.' },
        });
      }
    }
    setUploads((list) => [...list, ...added].slice(0, max));
    pump();
  }

  function remove(key: string) {
    if (uploads.some((u) => u.key === key)) taken.current = Math.max(0, taken.current - 1);
    queue.current = queue.current.filter((q) => q.key !== key);
    filesRef.current.delete(key);
    setUploads((list) => {
      const gone = list.find((u) => u.key === key);
      if (gone) URL.revokeObjectURL(gone.src);
      return list.filter((u) => u.key !== key);
    });
    setOverflow(0);
  }

  function retry(key: string) {
    const file = filesRef.current.get(key);
    if (!file) return;
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, error: undefined } : u)));
    queue.current.push({ key, file });
    pump();
  }

  // A file that could not be read has nothing to send again; it can only be removed.
  const canRetry = (key: string) => filesRef.current.has(key);

  const pending = uploads.filter((u) => !u.hostedUrl && !u.error).length;
  const failed = uploads.filter((u) => u.error).length;

  return { uploads, overflow, addFiles, remove, retry, canRetry, pending, failed };
}
