import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type { DirectorLensId } from '../../direction.ts';
import type { MotionId, VideoModelId } from '../../models.ts';
import { type ResolvedShot, resolveShotPlan, type ShotContext, type ShotPlanRaw } from '../../shot-director.ts';
import { trpc } from '../trpc.ts';
import { errorMessage } from './runwayErrors.ts';
import { useInFlight } from './useInFlight.ts';

/**
 * The shot director on a video page (src/shot-director.ts): one plan per
 * page (and per Director frame, through `slot`). `direct()` sends the one
 * text call (`shot.plan`, nothing billed) and polls `shot.status` until the
 * plan is back; the page shows it, the visitor edits it, and `sendable` goes
 * to `createVideo` (or `recreate.start`), where the server resolves it again.
 * A plan is pinned to the frames, model and clip length it was made for:
 * change any and it is stale until directed again. The switch is one setting
 * for the browser, shared live by every mounted page that uses it (Animate
 * and Recreate stay in step); the plan (or the poll for one) survives a
 * reload of the tab.
 */

/** A frame on the wire: a library still or an uploaded image (src/frame-refs.ts). */
export type FrameRefInput = { stillId: string } | { uploadUrl: string };

/** The clip's first frame: an upload carries its size, as `createVideo` takes it. */
export type FirstFrameInput = { stillId: string } | { uploadUrl: string; width: number; height: number };

export type ShotState =
  | { kind: 'idle' }
  /** `forKey`: the frames and model the plan is being made for, so a change meanwhile marks it stale. */
  | { kind: 'planning'; taskId: string; forKey: string }
  | { kind: 'ready'; raw: ShotPlanRaw; forKey: string }
  | { kind: 'failed'; error: string };

export type UseShotPlanArgs = {
  page: 'video' | 'director' | 'recreate';
  /** The Director frame index as a string, so each frame keeps its own plan. */
  slot?: string | undefined;
  first: FirstFrameInput | null;
  last?: FrameRefInput | null | undefined;
  middle?: FrameRefInput[] | undefined;
  /** How many extra images the clip carries (they decide whether it can end on a crop). */
  refs?: number | undefined;
  videoModel: VideoModelId;
  seconds: number;
  /** The camera preset: a hint the planner keeps unless the picture argues for another move. */
  motion: MotionId;
  direction: string;
  directorStyle?: DirectorLensId | undefined;
  /** What the clip can do with this image; null while there is no first image. */
  context: ShotContext | null;
};

export type ShotPlan = {
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  state: ShotState;
  /** A plan is on screen but the image, frames, model or clip length changed since. */
  stale: boolean;
  /** The plan as the clip would use it here, with its notes; null until ready (or without an image). */
  resolved: ResolvedShot | null;
  direct: () => Promise<void>;
  /** An edit to the plan on screen; it stays pinned to the frames it was made for. */
  update: (raw: ShotPlanRaw) => void;
  /** The plan to send with the video: set only when on, ready and fresh. */
  sendable: ShotPlanRaw | undefined;
  /** On, and no fresh plan yet: the primary button directs before it makes. */
  needsPlan: boolean;
  /** The text call is being sent or polled. */
  planning: boolean;
  /** Why the text call could not be sent (sign in, credits, the provider); shown through RunwayErrorNotice. */
  planError: unknown;
};

const ENABLED_KEY = 'render-to-film:shot-director';
/** The server's limit on the direction the planner reads. */
const DIRECTION_MAX = 600;
/** Beats the editor offers; the resolver keeps at most this many. */
const MAX_BEATS = 5;
/** A poll that can never succeed: stop and say so (Try again sends a new plan). */
const FINAL_CODES = new Set(['BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND']);

const stateKey = (page: string, slot: string | undefined) =>
  `render-to-film:shot:${page}${slot !== undefined ? `:${slot}` : ''}`;

/** The switch when storage can't be read (private mode): this tab's last choice. */
let enabledFallback = true;
/** Everything in this tab showing the switch; another tab's change arrives as a storage event. */
const enabledListeners = new Set<() => void>();

function readEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== 'off';
  } catch {
    return enabledFallback;
  }
}

function writeEnabled(on: boolean) {
  enabledFallback = on;
  try {
    localStorage.setItem(ENABLED_KEY, on ? 'on' : 'off');
  } catch {
    // Private mode: the fallback above carries it for this visit.
  }
  for (const listener of enabledListeners) listener();
}

function subscribeEnabled(onChange: () => void): () => void {
  enabledListeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === ENABLED_KEY || e.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    enabledListeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** A stored state, or idle when it is missing or not one this code wrote. */
function readState(key: string): ShotState {
  try {
    const v = JSON.parse(sessionStorage.getItem(key) ?? 'null') as unknown;
    if (!isObject(v)) return { kind: 'idle' };
    if (v.kind === 'planning' && typeof v.taskId === 'string' && v.taskId && typeof v.forKey === 'string') {
      return { kind: 'planning', taskId: v.taskId, forKey: v.forKey };
    }
    if (
      v.kind === 'ready' &&
      typeof v.forKey === 'string' &&
      isObject(v.raw) &&
      Array.isArray(v.raw.inventory) &&
      isObject(v.raw.people) &&
      isObject(v.raw.camera) &&
      Array.isArray(v.raw.moving) &&
      Array.isArray(v.raw.beats)
    ) {
      return { kind: 'ready', raw: v.raw as ShotPlanRaw, forKey: v.forKey };
    }
    if (v.kind === 'failed' && typeof v.error === 'string') return { kind: 'failed', error: v.error };
  } catch {
    // Private mode or a broken entry: start over.
  }
  return { kind: 'idle' };
}

/**
 * The planner's beats as the editor shows them: in the clip, in order, with
 * something said, at most five (the resolver keeps the same ones). Nothing
 * else in the plan is touched, so the notes about it stay as they were.
 */
function tidyBeats(beats: ShotPlanRaw['beats']): ShotPlanRaw['beats'] {
  return beats
    .filter((b) => Number.isFinite(b.at) && b.at >= 0 && b.at <= 1 && b.what.trim())
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_BEATS);
}

function errorCode(e: unknown): string | undefined {
  return (e as { data?: { code?: string } } | null)?.data?.code;
}

export function useShotPlan(args: UseShotPlanArgs): ShotPlan {
  const { page, slot, first, last, middle, refs, videoModel, seconds, motion, direction, directorStyle, context } = args;
  const enabled = useSyncExternalStore(subscribeEnabled, readEnabled, () => true);
  const key = stateKey(page, slot);
  const [held, setHeld] = useState<{ key: string; state: ShotState }>(() => ({ key, state: readState(key) }));
  // A new slot reads its own plan (a render-time reset, not an effect, so no frame shows the old one).
  if (held.key !== key) setHeld({ key, state: readState(key) });
  const state = held.key === key ? held.state : readState(key);
  const set = useCallback((next: ShotState) => setHeld((h) => ({ key: h.key, state: next })), []);

  const plan = trpc.shot.plan.useMutation();
  const guard = useInFlight();

  // The beats are timed against the clip's length, so a new length needs a new plan too.
  const currentKey = JSON.stringify({ first, last: last ?? null, middle: middle ?? [], videoModel, seconds });

  useEffect(() => {
    try {
      if (held.state.kind === 'idle') sessionStorage.removeItem(held.key);
      else sessionStorage.setItem(held.key, JSON.stringify(held.state));
    } catch {
      // Private mode: the plan just won't survive a reload.
    }
  }, [held]);

  const taskId = state.kind === 'planning' ? state.taskId : '';
  const status = trpc.shot.status.useQuery(
    { taskId },
    {
      enabled: state.kind === 'planning',
      refetchInterval: 2000,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: false,
      retry: 2,
    }
  );

  useEffect(() => {
    if (state.kind !== 'planning') return;
    const data = status.data;
    if (data?.status === 'done') {
      set({ kind: 'ready', raw: { ...(data.raw as ShotPlanRaw), beats: tidyBeats(data.raw.beats) }, forKey: state.forKey });
    } else if (data?.status === 'failed') {
      set({ kind: 'failed', error: data.error });
    } else if (status.error && FINAL_CODES.has(errorCode(status.error) ?? '')) {
      set({ kind: 'failed', error: errorMessage(status.error) ?? 'The director could not be reached. Try again.' });
    }
  }, [state, status.data, status.error, set]);

  const direct = useCallback(async () => {
    if (!first || state.kind === 'planning') return;
    if (!guard.start()) return;
    try {
      const { taskId: id } = await plan.mutateAsync({
        first,
        ...(last ? { last } : {}),
        middle: middle ?? [],
        refs: refs ?? 0,
        videoModel,
        seconds,
        motion,
        direction: direction.slice(0, DIRECTION_MAX),
        ...(directorStyle ? { directorStyle } : {}),
      });
      set({ kind: 'planning', taskId: id, forKey: currentKey });
    } catch {
      // Shown by RunwayErrorNotice from planError.
    } finally {
      guard.end();
    }
  }, [first, last, middle, refs, videoModel, seconds, motion, direction, directorStyle, currentKey, state.kind, guard, plan, set]);

  const update = useCallback(
    (raw: ShotPlanRaw) => setHeld((h) => (h.state.kind === 'ready' ? { key: h.key, state: { ...h.state, raw } } : h)),
    []
  );

  const setEnabled = useCallback((on: boolean) => writeEnabled(on), []);

  const ready = state.kind === 'ready';
  const stale = ready && state.forKey !== currentKey;
  const raw = ready ? state.raw : undefined;
  const {
    videoModel: cModel,
    width: cWidth,
    height: cHeight,
    people: cPeople,
    userKeyframes: cUser,
    canEndFrame: cEnd,
  } = context ?? {};
  const resolved = useMemo(
    () =>
      raw && cModel !== undefined
        ? resolveShotPlan(raw, {
            videoModel: cModel,
            width: cWidth ?? 0,
            height: cHeight ?? 0,
            people: cPeople ?? true,
            userKeyframes: cUser ?? false,
            canEndFrame: cEnd ?? false,
          })
        : null,
    [raw, cModel, cWidth, cHeight, cPeople, cUser, cEnd]
  );

  return {
    enabled,
    setEnabled,
    state,
    stale,
    resolved,
    direct,
    update,
    sendable: enabled && ready && !stale ? state.raw : undefined,
    needsPlan: enabled && (!ready || stale),
    planning: plan.isPending || state.kind === 'planning',
    planError: plan.error,
  };
}
