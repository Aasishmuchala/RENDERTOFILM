import { useEffect } from 'react';

/** Join a page title and brand name the same way for the hook and its tests. */
export function formatDocumentTitle(
  title: string | undefined,
  brandName?: string
): string {
  if (!brandName) return title ?? '';
  return title ? `${title} — ${brandName}` : brandName;
}

/**
 * Set `document.title` whenever `title` changes: `"<title> — <brandName>"`
 * when `brandName` is given, otherwise just `title`.
 */
export function useDocumentTitle(
  title: string | undefined,
  brandName?: string
): void {
  useEffect(() => {
    document.title = formatDocumentTitle(title, brandName);
  }, [title, brandName]);
}
