/**
 * How many entries a document keeps. The caps exist for Bay's shared document
 * store; on the desktop the data is the person's own, so nothing they made is
 * dropped to make room.
 */
export function docLimit(web: number): number {
  return process.env.BAY_ENV === 'desktop' ? Infinity : web;
}
