/** A name the plans keep for the page to show; a file can be named longer. */
export const MAX_FILE_NAME = 200;

/** An extension worth keeping: a dot and a short run with no spaces, at the very end. */
const EXTENSION = /\.[\p{L}\p{N}_-]{1,16}$/u;

/**
 * A file name cut to `max` characters, marked with an ellipsis, its extension
 * kept. A name that fits comes back unchanged, and a cut never splits a
 * character that takes two UTF-16 units. Pure.
 */
export function shortFileName(name: string, max = MAX_FILE_NAME): string {
  if (name.length <= max) return name;
  const extension = EXTENSION.exec(name)?.[0] ?? '';
  const stem = name.slice(0, max - extension.length - 1).replace(/[\uD800-\uDBFF]$/, '');
  return `${stem.trimEnd()}…${extension}`;
}
