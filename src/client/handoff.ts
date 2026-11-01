import { MOTIONS, MOVE_STYLES, SPEEDS, VIDEO_MODEL_IDS } from '../models.ts';
import type { PageId } from './nav.ts';
import type { VideoPreset } from './VideoPage.tsx';

/**
 * The address as a payload (`#lifestyle?job=abc&frame=3`): the page to open
 * and what to open it with, so a chat result or another page can send the user
 * anywhere with a selection loaded, and a reload lands in the same place.
 */
export type Handoff = { page: PageId; params: Record<string, string> };

/** Open a page with a selection loaded; what App hands to whoever links out. */
export type GoTo = (page: PageId, params?: Record<string, string>) => void;

/** Every page once. Listed here, not read from nav.ts, to keep this file free of its icons; the type keeps it whole. */
const PAGES: Record<PageId, true> = {
  chat: true,
  director: true,
  lifestyle: true,
  stills: true,
  video: true,
  edit: true,
  library: true,
  settings: true,
};

/** Old page addresses, now modes of Still; the links out there keep working. */
const STILL_MODES = new Map([
  ['closeups', 'closeups'],
  ['location', 'location'],
  ['surroundings', 'location'],
]);

/** What may ride in an address. Anything else is dropped on the way in. */
const KEYS = ['job', 'frame', 'still', 'clip', 'export', 'mode', 'preset', 'q', 'gallery'];

function isPage(id: string): id is PageId {
  return Object.hasOwn(PAGES, id);
}

/** The handoff in an address hash; no hash, or one naming no page, is the chat. */
export function parseHash(hash: string): Handoff {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const at = raw.indexOf('?');
  const id = at < 0 ? raw : raw.slice(0, at);
  const query = new URLSearchParams(at < 0 ? '' : raw.slice(at + 1));
  const params: Record<string, string> = {};
  for (const key of KEYS) {
    const value = query.get(key);
    if (value !== null) params[key] = value;
  }
  const mode = STILL_MODES.get(id);
  if (mode) return { page: 'stills', params: { ...params, mode } };
  return isPage(id) ? { page: id, params } : { page: 'chat', params: {} };
}

/** The address for a handoff: `#page`, or `#page?k=v` with the keys sorted, so one handoff is one address. */
export function formatHash(page: PageId, params: Record<string, string> = {}): string {
  const query = Object.keys(params)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key] ?? '')}`)
    .join('&');
  return query ? `#${page}?${query}` : `#${page}`;
}

/**
 * The Video page's preset in `params.preset`, whole or not at all: an address
 * can say anything, the page reads these fields without asking, and a crash
 * there would come back on every reload of the same address.
 */
export function parseVideoPreset(raw: string | undefined): VideoPreset | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as VideoPreset;
    const known =
      VIDEO_MODEL_IDS.includes(p.model) &&
      MOTIONS.some((m) => m.id === p.motion) &&
      MOVE_STYLES.some((m) => m.id === p.moveStyle) &&
      SPEEDS.some((s) => s.id === p.speed);
    return known && typeof p.seconds === 'number' && typeof p.direction === 'string' && typeof p.note === 'string'
      ? p
      : null;
  } catch {
    return null;
  }
}
