import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import { getRunwayClient, getRunwayToken } from '@runway/bay/runway';
import { decodeJwtPayload } from '@runway/bay/runway/cookie';
import { TRPCError } from '@trpc/server';

import type { CheckReport } from './checks.ts';
import type { MomentId } from './lifestyle.ts';
import type {
  ActivityId,
  AgeId,
  AngleId,
  CrowdId,
  EthnicityId,
  LookId,
  WardrobeId,
} from './looks.ts';
import type {
  ImageModelId,
  LengthId,
  MotionId,
  MoveStyleId,
  SpeedId,
  VideoModelId,
} from './models.ts';
import { documentStore } from './storage.ts';
import type { LocationLightId, LocationViewId } from './location.ts';
import type { ScopeId, SettingId } from './surroundings.ts';
import { UserSymbol } from './trpc.ts';

export type TaskState = 'pending' | 'succeeded' | 'failed';

export type StillCheck =
  | { status: 'running'; taskId: string }
  | { status: 'done'; taskId: string; report: CheckReport }
  | { status: 'failed'; taskId: string; error: string };

/** One generated still. `id` is its Runway task id. */
export type Still = {
  id: string;
  createdAt: string;
  status: TaskState;
  error?: string | undefined;
  imageModel: ImageModelId;
  look: LookId;
  angle: AngleId;
  crowd: CrowdId;
  people: string;
  /** The people dropdowns; older stills have none and read as the defaults. */
  ethnicity?: EthnicityId | undefined;
  age?: AgeId | undefined;
  wardrobe?: WardrobeId | undefined;
  activity?: ActivityId | undefined;
  /** Cast sheet it was made with — an ephemeral Runway upload, like `sourceUrl`. */
  castSheetUrl?: string | undefined;
  /** Lighting reference it was lit from (ephemeral upload); its look is then unused. */
  lightRefUrl?: string | undefined;
  /** The still whose light it was matched to; its look is then unused. */
  lightFromStillId?: string | undefined;
  /** Stills shot in one matched light share this id (the first still's). */
  seriesId?: string | undefined;
  direction: string;
  width: number;
  height: number;
  /** The render it was made from — an ephemeral Runway upload (1–2 days). */
  sourceUrl: string;
  check?: StillCheck | undefined;
  /** The model's resolution id it was made at (older stills have none). */
  resolution?: string | undefined;
  /** The frame shape picked ("9:16"); unset when it matched the render. */
  aspectRatio?: string | undefined;
  /** Set on an upscaled copy: the still it was upscaled from. */
  upscaleOf?: string | undefined;
  upscaler?: string | undefined;
  scale?: number | undefined;
  /** The visitor's own @tags, stored without the `@` (src/tags.ts). */
  tags?: string[] | undefined;
  /**
   * Marked edit: the stored mask (white = may change) and, once built, the
   * render-plus-result composite that is this still's real image
   * (src/composite.ts).
   */
  maskKey?: string | undefined;
  compositeKey?: string | undefined;
  /** Marked edit: a stored copy of the render, so the composite outlives `sourceUrl`. */
  renderKey?: string | undefined;
  /** Made on the Close-ups tab: what it frames, and the search that found it. */
  closeup?: { subject: string; jobId: string } | undefined;
  /** Made on the Surroundings tab: the landscape it was set in, and the still it came from. */
  surroundings?:
    | { setting: SettingId; scope: ScopeId; keepLight: boolean; fromStillId?: string | undefined }
    | undefined;
  /** Made on the Location tab: the spot (decimal degrees), its optional name, and the view and light asked for. */
  location?:
    | {
        lat: number;
        lng: number;
        place?: string | undefined;
        view: LocationViewId;
        light: LocationLightId;
      }
    | undefined;
  /** Made on the Director tab: the storyboard, its place in the story and its title. */
  storyboard?: { jobId: string; order: number; title: string } | undefined;
  /** Made on the Lifestyle tab: the residents' moment it shows (src/lifestyle.ts). */
  moment?: MomentId | undefined;
};

/** One generated clip. `id` is its Runway task id. */
export type Clip = {
  id: string;
  stillId: string;
  createdAt: string;
  status: TaskState;
  error?: string | undefined;
  videoModel: VideoModelId;
  motion: MotionId;
  /** Older clips have no style or speed. */
  moveStyle?: MoveStyleId | undefined;
  speed?: SpeedId | undefined;
  /** Older clips stored only Short/Long; newer ones store `seconds`. */
  length?: LengthId | undefined;
  seconds?: number | undefined;
  direction: string;
  resolution?: string | undefined;
  /** Keyframes sent (first + middle + last); unset for a plain first-frame clip. */
  frameCount?: number | undefined;
  /** The library still used as the last frame (unset when uploaded or none). */
  lastFrameStillId?: string | undefined;
  /** Extra reference images sent (the @img1, @img2 … in the direction). */
  refCount?: number | undefined;
  /** Set on an upscaled copy: the clip it was upscaled from. */
  upscaleOf?: string | undefined;
  upscaler?: string | undefined;
  scale?: number | undefined;
  /** The visitor's own @tags, stored without the `@` (src/tags.ts). */
  tags?: string[] | undefined;
};

export type Library = { stills: Still[]; clips: Clip[] };

/** Enough that a busy project's storyboard takes don't fall off the end. */
const MAX_ITEMS = 600;

/**
 * One JSON document per person under `library/` in the app's storage. The
 * media itself stays in their Runway account: `/api/library/<kind>/<id>`
 * (src/api-routes.ts) redirects to a freshly signed artifact URL each time,
 * so nothing here expires. This records what each task was, so the Video tab
 * can list stills and clips across sessions.
 */
const store = documentStore<Library>({ prefix: 'library/' });

/**
 * A stable, opaque key for the signed-in Runway account, from the raw request
 * so tRPC procedures and the `/media` route agree on it. `null` when the
 * request carries no identity at all.
 */
export async function ownerFromRequest(
  req: IncomingMessage
): Promise<string | null> {
  const token = getRunwayToken(req);
  const payload = token ? decodeJwtPayload(token) : null;
  let raw: string | undefined =
    payload?.id != null ? `id:${payload.id}` : payload?.email;
  const runway = getRunwayClient(req);
  if (!raw && runway) {
    try {
      raw = `id:${(await runway.getProfile()).id}`;
    } catch {
      raw = undefined;
    }
  }
  raw ??= req[UserSymbol]?.email;
  if (!raw) return null;
  return createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

export async function ownerKey(req: IncomingMessage): Promise<string> {
  const owner = await ownerFromRequest(req);
  if (!owner) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Sign in to Runway to keep your stills and clips.',
    });
  }
  return owner;
}

export async function readLibrary(owner: string): Promise<Library> {
  const doc = await store.get(`${owner}.json`);
  return { stills: doc?.value.stills ?? [], clips: doc?.value.clips ?? [] };
}

/** Read-modify-write; `mutate` must return new arrays, as it can be retried. */
export function updateLibrary(
  owner: string,
  mutate: (lib: Library) => Library
): Promise<Library> {
  return store.update(`${owner}.json`, (current) => {
    const next = mutate({
      stills: current?.stills ?? [],
      clips: current?.clips ?? [],
    });
    return {
      stills: next.stills.slice(0, MAX_ITEMS),
      clips: next.clips.slice(0, MAX_ITEMS),
    };
  });
}

export function patchStill(
  owner: string,
  id: string,
  patch: (still: Still) => Partial<Still>
): Promise<Library> {
  return updateLibrary(owner, (lib) => ({
    ...lib,
    stills: lib.stills.map((s) => (s.id === id ? { ...s, ...patch(s) } : s)),
  }));
}

export function patchClip(
  owner: string,
  id: string,
  patch: (clip: Clip) => Partial<Clip>
): Promise<Library> {
  return updateLibrary(owner, (lib) => ({
    ...lib,
    clips: lib.clips.map((c) => (c.id === id ? { ...c, ...patch(c) } : c)),
  }));
}
