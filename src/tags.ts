/**
 * Library @tags, shared by the server (src/api.ts `setTags`) and the Library
 * tab. A tag is stored without its `@`: lowercase letters, digits and
 * hyphens. Every item also carries automatic tags derived from how it was
 * made (`autoTags`); those are never stored, so they stay right if a name
 * changes.
 */
import { litFromReference, LOOKS, REFERENCE_LIGHT_NAME } from './looks.ts';
import type { Clip, Still } from './library.ts';
import { chapterById } from './lifestyle.ts';
import { IMAGE_MODELS, VIDEO_MODELS } from './models.ts';
import { settingName } from './surroundings.ts';

export const MAX_TAGS = 12;
export const MAX_TAG_LENGTH = 32;

/** `"@Night Shot!"` → `"night-shot"`; `null` when nothing usable is left. */
export function normalizeTag(raw: string): string | null {
  const tag = raw
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_TAG_LENGTH)
    .replace(/-$/, '');
  return tag || null;
}

/** Normalized, de-duplicated, capped at `MAX_TAGS`. */
export function normalizeTags(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const r of raw) {
    const t = normalizeTag(r);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

function slug(name: string): string {
  return normalizeTag(name) ?? '';
}

const NIGHT_LOOKS = new Set<string>(['night-lit', 'moonlit']);

/** `@series-1a2b3c`: every view shot in one matched light carries the same one. */
export function seriesTag(seriesId: string): string {
  return `series-${seriesId.replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase()}`;
}

/** Tags every still gets from its settings: kind, look, model, people, upscale. */
export function stillAutoTags(s: Still): string[] {
  const look = LOOKS.find((l) => l.id === s.look);
  const model = IMAGE_MODELS.find((m) => m.id === s.imageModel);
  return normalizeTags([
    'image',
    s.surroundings || s.location ? '' : litFromReference(s) ? slug(REFERENCE_LIGHT_NAME) : look ? slug(look.name) : s.look,
    s.surroundings || s.location || litFromReference(s) || s.look === 'none' ? '' : NIGHT_LOOKS.has(s.look) ? 'night' : 'day',
    s.seriesId ? seriesTag(s.seriesId) : '',
    s.crowd !== 'none' ? 'people' : '',
    model ? slug(model.name) : '',
    s.upscaleOf ? 'upscaled' : '',
    s.closeup ? 'close-up' : '',
    s.surroundings ? 'surroundings' : '',
    s.storyboard ? 'storyboard' : '',
    s.moment || s.lifestyle ? 'lifestyle' : '',
    s.lifestyle?.kind === 'cast' ? 'cast-sheet' : '',
    s.lifestyle?.pass === 1 ? 'pass-1' : '',
    s.lifestyle ? slug(chapterById(s.lifestyle.chapter).name) : '',
    s.location ? 'location' : '',
    s.location ? 'aerial' : '',
    s.surroundings ? slug(settingName(s.surroundings.setting)) : '',
  ]);
}

/** Tags every clip gets: kind, the look of its still, model, upscale. */
export function clipAutoTags(c: Clip, still: Still | undefined): string[] {
  const model = VIDEO_MODELS.find((m) => m.id === c.videoModel);
  const look = still ? LOOKS.find((l) => l.id === still.look) : undefined;
  // A location or surroundings take has no look of its own, so it gets no look or day/night tag.
  const placed = Boolean(still?.location || still?.surroundings);
  return normalizeTags([
    'video',
    !still || placed ? '' : litFromReference(still) ? slug(REFERENCE_LIGHT_NAME) : look ? slug(look.name) : '',
    !still || placed || litFromReference(still) || still.look === 'none'
      ? ''
      : NIGHT_LOOKS.has(still.look)
        ? 'night'
        : 'day',
    still?.location ? 'location' : '',
    still?.location ? 'aerial' : '',
    still?.surroundings ? 'surroundings' : '',
    still?.seriesId ? seriesTag(still.seriesId) : '',
    still && still.crowd !== 'none' ? 'people' : '',
    model ? slug(model.name) : '',
    c.upscaleOf ? 'upscaled' : '',
    c.recreate ? 'recreate-4k' : '',
  ]);
}
