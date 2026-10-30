import { Clapperboard, Download, ExternalLink, ListX, Maximize2, Play, ScanEye, Trash2 } from 'lucide-react';
import { type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { TabListStateContext, TabPanel, ToggleButton } from 'react-aria-components';

import type { inferRouterOutputs } from '@trpc/server';

import type { AppRouterType, Clip, Still } from '../api.ts';
import { momentById } from '../lifestyle.ts';
import { locationName } from '../location.ts';
import { litFromReference, LOOKS, lookLabel } from '../looks.ts';
import {
  ANIMATE_VIDEO_MODELS,
  defaultVideoSeconds,
  fluxUpscaleBlock,
  snapVideoSeconds,
  videoDurations,
  videoExtraImageLimit,
  videoExtrasExcludeEnd,
  videoKeyframeLimit,
  videoModelsWith,
  extraImageHandles,
  defaultVideoResolution,
  imageModelName,
  imageResolutionName,
  upscalerName,
  motionLabel,
  MOTIONS,
  MOVE_STYLES,
  SPEEDS,
  VIDEO_MODELS,
  videoModelName,
  videoResolutionName,
  videoResolutions,
  type MotionId,
  type MoveStyleId,
  type SpeedId,
  type VideoModelId,
} from '../models.ts';
import { recreateTitle } from '../recreate.ts';
import { type ShotContext, shotSummary } from '../shot-director.ts';
import { settingName } from '../surroundings.ts';
import { DeleteItemDialog, type DeleteTarget } from './DeleteItemDialog.tsx';
import { DirectionStyleSelect, useDirectionStyle } from './director/DirectionStyle.tsx';
import { Section } from './layouts/Section.tsx';
import { type CanvasState, usePhoneLayout, Workspace, type WorkspaceProps } from './layouts/Workspace.tsx';
import { useAmbient } from './lib/ambient.tsx';
import { clipPosterUrl, libraryUrl, NO_POSTER, stillThumbUrl, stillViewUrl, useDownload } from './lib/download.ts';
import { classifyRunwayError } from './lib/runwayErrors.ts';
import { useInFlight } from './lib/useInFlight.ts';
import { useShotPlan } from './lib/useShotPlan.ts';
import { useRecreateWorkspace } from './RecreatePanel.tsx';
import { ShotDirector } from './ShotDirector.tsx';
import { trpc } from './trpc.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { CostLine } from './ui/CostLine.tsx';
import { EmptyState } from './ui/EmptyState.tsx';
import { FilterChips } from './ui/FilterChips.tsx';
import { ImagePicker } from './ui/ImagePicker.tsx';
import { Lightbox } from './ui/Lightbox.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { Switch } from './ui/Switch.tsx';
import { RenderingStatus } from './ui/RenderingStatus.tsx';
import { RunwayErrorNotice } from './ui/RunwayErrorNotice.tsx';
import { SkeletonBlock } from './ui/Skeleton.tsx';
import { Tab, TabList, Tabs } from './ui/Tabs.tsx';
import { TakeStrip, type TakeState, type TakeStripItem } from './ui/TakeStrip.tsx';
import { Text } from './ui/Text.tsx';
import { TextArea } from './ui/TextArea.tsx';
import { Select } from './ui/Select.tsx';
import { UpscaleClip, type UpscaleJob } from './UpscaleClip.tsx';
import {
  duplicateMiddle,
  firstFrameRef,
  frameRef,
  FramesField,
  RefsField,
  useVideoFrames,
} from './VideoFrames.tsx';
import styles from './Studio.module.css';
import own from './VideoPage.module.css';

const PAGE = 12;
/** Longest extra direction; the server refuses more. */
const DIRECTION_MAX = 600;
/** Ids whose retry can't succeed: stop asking. */
const FINAL_CODES = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND']);
/** Videos rendering at once; past this, wait for one to finish. */
const MAX_IN_FLIGHT = 6;
/** Takes kept in the strip; the oldest finished ones drop off first. */
const MAX_TAKES = 12;
const TAKES_KEY = 'render-to-film:video-takes';

/** One video started from this tab: what it was made with, for the stage. */
type Take = {
  id: string;
  /** The library still it starts on; '' when it starts on an uploaded image. */
  stillId: string;
  /** That uploaded image's small copy (a data URL), its picture until the clip has a poster. */
  thumb?: string | undefined;
  model: VideoModelId;
  resolution: string;
  seconds: number;
  /** The shape of the first frame it was made from. */
  ratio: string;
  title: string;
  since: number;
};

function readTakes(): Take[] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(TAKES_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (t): t is Take =>
        typeof t === 'object' &&
        t !== null &&
        typeof (t as Take).id === 'string' &&
        typeof (t as Take).stillId === 'string' &&
        VIDEO_MODELS.some((m) => m.id === (t as Take).model) &&
        typeof (t as Take).since === 'number'
    );
  } catch {
    return [];
  }
}

function errorCode(e: unknown): string | undefined {
  return (e as { data?: { code?: string } } | null)?.data?.code;
}

const DAY_FILTERS = [
  { id: 'all', name: 'All' },
  { id: 'today', name: 'Today' },
  { id: 'people', name: 'With people' },
  { id: 'night', name: 'Night' },
] as const;

type Filter = (typeof DAY_FILTERS)[number]['id'];

/** The Video tab's two tabs: animate a still, or recreate a clip in 4K. */
type VideoMode = 'animate' | 'recreate';

/** What a mode's canvas shows: its takes (the focused one, or the next shot), or every clip as a contact sheet. */
export type CanvasViewId = 'takes' | 'clips';

/**
 * A shot set up from another tab (the Lifestyle tab's "Animate"): it fills
 * the settings once, each stays editable, and nothing starts until Make the
 * video is pressed.
 */
export type VideoPreset = {
  model: VideoModelId;
  seconds: number;
  motion: MotionId;
  moveStyle: MoveStyleId;
  speed: SpeedId;
  direction: string;
  /** Where the settings came from, shown under the still while it stays picked. */
  note: string;
};

export type VideoPageProps = {
  /** True while the Video tab is on screen; polling slows down when it isn't. */
  active: boolean;
  /** A still picked from the Stills tab ("Make a video"). */
  pickedStillId: string | null;
  /** Settings that came with the pick; a new one replaces the current settings. */
  preset?: VideoPreset | null | undefined;
  onPick: (stillId: string | null) => void;
  /** Go back to the Stills tab, when there are no stills yet. */
  onGoToStills: () => void;
};

export function VideoPage({ active, pickedStillId, preset = null, onPick, onGoToStills }: VideoPageProps) {
  const utils = trpc.useUtils();
  const library = trpc.library.useQuery(undefined, {
    // Only while this tab is on screen; the clip being made polls itself below.
    refetchInterval: (q) =>
      active &&
      (q.state.data?.stills.some((s) => s.status === 'pending') ||
        q.state.data?.clips.some((c) => c.status === 'pending'))
        ? 10_000
        : false,
  });

  const [videoModel, setVideoModel] = useState<VideoModelId>('seedance-2');
  const [resolution, setResolution] = useState(defaultVideoResolution('seedance-2'));
  const [motion, setMotion] = useState<MotionId>('push-in');
  const [moveStyle, setMoveStyle] = useState<MoveStyleId>('steady');
  const [speed, setSpeed] = useState<SpeedId>('slow');
  const [seconds, setSeconds] = useState(defaultVideoSeconds('seedance-2'));
  const [direction, setDirection] = useState('');
  const [onlyInImage, setOnlyInImage] = useState(true);
  /** The shot director's lens (src/direction.ts), remembered in this browser. */
  const [directorStyle, setDirectorStyle] = useDirectionStyle('video');
  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState(PAGE);
  const [zoom, setZoom] = useState<Still | null>(null);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  /** Every video started here, newest first; each polls on its own. */
  const [takes, setTakes] = useState<Take[]>(readTakes);
  /** The take on the big screen, or null for the shot being set up. */
  const [focusId, setFocusId] = useState<string | null>(null);
  /**
   * Clip upscales by take id. They live here, not in the take view, so
   * focusing another take never loses one (and a second press never bills twice).
   */
  const [upscales, setUpscales] = useState<Readonly<Record<string, UpscaleJob>>>({});
  const [clipFilter, setClipFilter] = useState('all');
  /** The preset's note, for the still it came with. */
  const [presetNote, setPresetNote] = useState<{ stillId: string; note: string } | null>(null);
  /** Both tabs stay mounted, so switching never loses a take, an upscale or a poll. */
  const [mode, setMode] = useState<VideoMode>('animate');
  /** The Recreate tab's 4K source, as a thumbnail, for the room's light. */
  const [sourceThumb, setSourceThumb] = useState<string | null>(null);
  /** Animate's canvas: the takes, or All clips as a contact sheet. */
  const [view, setView] = useState<CanvasViewId>('takes');
  const saver = useDownload();

  const frames = useVideoFrames();
  const createVideo = trpc.createVideo.useMutation();
  // A double-click's second press arrives before createVideo.isPending shows.
  const startGuard = useInFlight();
  const statuses = trpc.useQueries((t) =>
    takes.map((take) =>
      t.videoStatus(
        { id: take.id },
        {
          refetchInterval: (q) =>
            q.state.data?.done || FINAL_CODES.has(errorCode(q.state.error) ?? '')
              ? false
              : active
                ? 4000
                : 15_000,
          refetchOnWindowFocus: false,
          retry: 2,
        }
      )
    )
  );
  const upscaleTakeIds = Object.keys(upscales);
  const upscaleStatuses = trpc.useQueries((t) =>
    upscaleTakeIds.map((takeId) =>
      t.videoStatus(
        { id: upscales[takeId]!.id },
        {
          refetchInterval: (q) =>
            q.state.data?.done || FINAL_CODES.has(errorCode(q.state.error) ?? '')
              ? false
              : active
                ? 4000
                : 15_000,
          refetchOnWindowFocus: false,
          retry: 2,
        }
      )
    )
  );
  // An upscale holds its take on hand until a final status arrives, even
  // while another take is on the big screen.
  const upscaling = new Set(upscaleTakeIds.filter((_, i) => !upscaleStatuses[i]?.data?.done));
  const doneKey = [
    ...takes.filter((_, i) => statuses[i]?.data?.done).map((t) => t.id),
    ...upscaleTakeIds.filter((_, i) => upscaleStatuses[i]?.data?.done).map((takeId) => upscales[takeId]!.id),
  ].join(',');
  useEffect(() => {
    // The library now has these takes; the other tabs' lists should show them.
    if (doneKey) void utils.library.invalidate();
  }, [doneKey, utils]);

  useEffect(() => {
    try {
      sessionStorage.setItem(TAKES_KEY, JSON.stringify(takes));
    } catch {
      // Private mode: the strip just won't survive a reload.
    }
  }, [takes]);

  const stills = useMemo(
    () => (library.data?.stills ?? []).filter((s) => s.status === 'succeeded'),
    [library.data]
  );
  const filtered = useMemo(() => {
    const today = new Date().toDateString();
    const nightLooks = new Set<string>(LOOKS.filter((l) => /night|moon|blue hour/i.test(l.name)).map((l) => l.id));
    return stills.filter((s) =>
      filter === 'today'
        ? new Date(s.createdAt).toDateString() === today
        : filter === 'people'
          ? s.crowd !== 'none'
          : filter === 'night'
            ? !litFromReference(s) && (nightLooks.has(s.look) || /night/.test(s.look))
            : true
    );
  }, [stills, filter]);

  const pickerItems = useMemo(
    () =>
      stills.map((s) => ({
        id: s.id,
        src: stillThumbUrl(s.id),
        alt: stillLabel(s),
        caption: stillCaption(s, false),
        detail: stillDetail(s),
        title: stillLabel(s),
      })),
    [stills]
  );
  const stepOneItems = useMemo(
    () =>
      filtered.slice(0, shown).map((s) => ({
        id: s.id,
        src: stillThumbUrl(s.id),
        alt: stillLabel(s),
        caption: stillCaption(s, false),
        detail: stillDetail(s),
        title: stillLabel(s),
      })),
    [filtered, shown]
  );
  const selected = stills.find((s) => s.id === pickedStillId) ?? null;
  // Only a still that is in the library gets a thumbnail request; a deleted
  // one would 404.
  const stillIds = useMemo(() => new Set((library.data?.stills ?? []).map((s) => s.id)), [library.data]);
  const clipById = useMemo(() => new Map((library.data?.clips ?? []).map((c) => [c.id, c])), [library.data]);
  // A take is in flight until a final status arrives: a failed poll never
  // frees its slot, or "Check again" would turn into a second bill.
  const takeStates: TakeState[] = takes.map((_, i) => {
    const q = statuses[i];
    if (q?.data?.done) return q.data.url ? 'ready' : 'failed';
    if (q?.error) return 'lost';
    return q?.data?.status === 'PENDING' || q?.data?.status === 'THROTTLED' ? 'queued' : 'rendering';
  });
  const inFlight = takeStates.filter((st) => st !== 'ready' && st !== 'failed').length;
  const full = inFlight >= MAX_IN_FLIGHT;
  const focusIndex = focusId ? takes.findIndex((t) => t.id === focusId) : -1;
  const focus = focusIndex >= 0 ? takes[focusIndex]! : null;
  const focusStatus = focusIndex >= 0 ? statuses[focusIndex] : undefined;
  const focusState = focusIndex >= 0 ? takeStates[focusIndex] : undefined;
  const shownError = createVideo.error;
  const { planBlocked, unavailable } = classifyRunwayError(shownError);

  // The frame on the big screen lights the room (DESIGN 2.5): the take's
  // still, else the first frame or the picked still; Recreate, its 4K source.
  const stillThumb = (id: string | undefined) => (id && stillIds.has(id) ? stillThumbUrl(id) : undefined);
  const animateAmbient = focus
    ? (stillThumb(focus.stillId) ?? focus.thumb)
    : frames.first
      ? (stillThumb(frames.first.stillId) ?? frames.first.thumb)
      : selected && stillThumbUrl(selected.id);
  useAmbient(mode === 'recreate' ? sourceThumb : animateAmbient);

  useEffect(() => {
    // A new pick puts the shot being set up on the big screen; the takes keep
    // rendering in the strip.
    setFocusId(null);
    setView('takes');
  }, [pickedStillId]);

  useEffect(() => {
    // Each new preset sets the shot up once, as if picked here by hand.
    if (!preset) return;
    setVideoModel(preset.model);
    setResolution(defaultVideoResolution(preset.model));
    setSeconds(snapVideoSeconds(preset.model, preset.seconds));
    setMotion(preset.motion);
    setMoveStyle(preset.moveStyle);
    setSpeed(preset.speed);
    setDirection(preset.direction.slice(0, DIRECTION_MAX));
    setPresetNote(pickedStillId ? { stillId: pickedStillId, note: preset.note } : null);
    setFocusId(null);
    createVideo.reset();
    // The still it came with may sit past the stills shown, or outside the filter.
    const at = stills.findIndex((s) => s.id === pickedStillId);
    if (at >= 0 && !filtered.slice(0, shown).some((s) => s.id === pickedStillId)) {
      setFilter('all');
      setShown((n) => Math.max(n, Math.ceil((at + 1) / PAGE) * PAGE));
    }
    // Only a new preset applies; the pick and the lists are read as they stand.
  }, [preset]);

  const setUpscale = useCallback((takeId: string, job: UpscaleJob | null) => {
    setUpscales((prev) => {
      const { [takeId]: _old, ...rest } = prev;
      return job ? { ...rest, [takeId]: job } : rest;
    });
  }, []);

  function dropTake(id: string) {
    setTakes((prev) => prev.filter((t) => t.id !== id));
    setFocusId((f) => (f === id ? null : f));
  }

  function clearFinished() {
    const keep = new Set(
      takes.filter((t, i) => (takeStates[i] !== 'ready' && takeStates[i] !== 'failed') || upscaling.has(t.id)).map((t) => t.id)
    );
    setTakes((prev) => prev.filter((t) => keep.has(t.id)));
    setFocusId((f) => (f && keep.has(f) ? f : null));
  }

  // The first frame decides the clip's shape: an upload's own size, a chosen
  // still's, or else the still picked in step 1.
  const firstShape = (() => {
    const f = frames.first;
    if (f?.width && f.height) return { width: f.width, height: f.height };
    const own = f?.stillId ? stills.find((x) => x.id === f.stillId) : undefined;
    return own ?? selected;
  })();
  const previewRatio = frameRatio(firstShape);
  // Whether the first frame may show people, as createVideo reads it: that
  // still's crowd, or true for an upload (its contents aren't known).
  const firstPeople = (() => {
    const f = frames.first;
    if (f && !f.stillId) return true;
    const still = (f?.stillId ? stills.find((x) => x.id === f.stillId) : undefined) ?? selected;
    return still ? still.crowd !== 'none' : true;
  })();

  // What the chosen model can take from the frames and extra-images areas.
  const keyframeLimit = videoKeyframeLimit(videoModel);
  const extraLimit = videoExtraImageLimit(videoModel);
  const extrasUsed = extraLimit > 0 ? frames.refs.slice(0, extraLimit) : [];
  const exclusive = videoExtrasExcludeEnd(videoModel);
  // Seedance and MiniMax H3 take a last frame or extra images, not both: a
  // last frame that is set wins and the extras wait until it is removed.
  const lastSent = keyframeLimit >= 2 ? frames.last : null;
  const extrasBlocked = exclusive && lastSent !== null;
  const lastBlocked = exclusive && extrasUsed.length > 0 && lastSent === null;
  const middleSent = frames.middle.slice(0, Math.max(0, keyframeLimit - 2));
  const refsSent = extrasBlocked ? [] : extrasUsed;
  const handleProblem = unknownHandle(direction, refsSent.length, videoModelName(videoModel));

  // The shot director plans from the first frame (or the picked still), the
  // frames it must pass through, and what this model can end on.
  const shotFirst = frames.first ? firstFrameRef(frames.first) : selected ? { stillId: selected.id } : null;
  const shotContext: ShotContext | null =
    shotFirst && firstShape
      ? {
          videoModel,
          width: firstShape.width,
          height: firstShape.height,
          people: firstPeople,
          userKeyframes: Boolean(lastSent) || middleSent.length > 0,
          canEndFrame: keyframeLimit >= 2 && !(refsSent.length > 0 && exclusive),
        }
      : null;
  const shot = useShotPlan({
    page: 'video',
    first: shotFirst,
    last: lastSent ? frameRef(lastSent) : null,
    middle: middleSent.map(frameRef).filter((m) => m !== null),
    refs: refsSent.length,
    videoModel,
    seconds,
    motion,
    direction,
    directorStyle,
    context: shotContext,
  });
  // A directed shot's camera is the plan's; otherwise the preset's.
  const shownMotion = shot.sendable && shot.resolved ? shot.resolved.camera.move : motion;
  const cameraTravels = shownMotion !== 'still-life' && shownMotion !== 'focus-pull';
  const directing = shot.enabled && shot.planning;
  const directFirst = !directing && shot.needsPlan;
  const directionTooLong = direction.length > DIRECTION_MAX;
  const duplicateFrames = duplicateMiddle(middleSent).size > 0;

  function insertHandle(handle: string) {
    setDirection((d) => `${d}${d && !/\s$/.test(d) ? ' ' : ''}${handle} `);
  }

  async function run() {
    // A first frame of your own needs no still picked in step 1.
    if ((!selected && !frames.first) || handleProblem || directionTooLong || duplicateFrames || full) return;
    // With the director on, the video waits for a plan made for this picture.
    if (shot.needsPlan) return;
    if (!startGuard.start()) return;
    try {
      const refs = refsSent.map(frameRef);
      const middle = middleSent.map((m) => {
        const r = frameRef(m);
        return r ? { ...r, at: m.at } : null;
      });
      const first = frames.first ? firstFrameRef(frames.first) : null;
      const last = lastSent ? frameRef(lastSent) : null;
      if (
        refs.some((r) => r === null) ||
        middle.some((m) => m === null) ||
        (frames.first && !first) ||
        (lastSent && !last)
      ) {
        return;
      }
      const directed = shot.sendable;
      const summary = directed && shot.resolved ? shotSummary(shot.resolved) : undefined;
      const { id } = await createVideo.mutateAsync({
        ...(selected ? { stillId: selected.id } : {}),
        videoModel,
        resolution,
        motion,
        moveStyle,
        speed,
        seconds,
        direction,
        onlyInImage,
        ...(first ? { firstFrame: first } : {}),
        ...(last ? { lastFrame: last } : {}),
        ...(middle.length ? { middleFrames: middle.filter((m) => m !== null) } : {}),
        ...(refs.length ? { refs: refs.filter((r) => r !== null) } : {}),
        ...(directed ? { shot: directed } : {}),
      });
      const take: Take = {
        id,
        // What it starts on, as the server records it: the first frame when
        // one is set (a still, or an upload with no still), else the pick.
        stillId: frames.first ? (frames.first.stillId ?? '') : (selected?.id ?? ''),
        ...(frames.first && !frames.first.stillId ? { thumb: frames.first.thumb } : {}),
        model: videoModel,
        resolution,
        seconds,
        ratio: previewRatio,
        title: summary ?? `${MOTIONS.find((m) => m.id === motion)?.name ?? 'Shot'}, ${videoModelName(videoModel)}`,
        since: Date.now(),
      };
      setTakes((prev) => {
        const next = [take, ...prev];
        if (next.length <= MAX_TAKES) return next;
        // Over the cap: drop the oldest finished take, never one still rendering.
        const states = new Map(takes.map((t, i) => [t.id, takeStates[i]]));
        const oldDone = [...next]
          .reverse()
          .find((t) => states.get(t.id) === 'ready' || states.get(t.id) === 'failed');
        return oldDone && !upscaling.has(oldDone.id) ? next.filter((t) => t !== oldDone) : next;
      });
      setFocusId(id);
      setView('takes');
    } catch {
      // Shown by RunwayErrorNotice from createVideo.error.
    } finally {
      startGuard.end();
    }
  }

  /** A take's picture: its clip's poster once the library has it, else the still or upload it started on. */
  const takePoster = (t: Take): string => {
    const clip = clipById.get(t.id);
    return (
      (clip && clipPosterUrl(clip, stillIds)) ??
      (t.stillId && stillIds.has(t.stillId) ? stillThumbUrl(t.stillId) : t.thumb) ??
      NO_POSTER
    );
  };
  const rollingIds = new Set(takes.filter((_, i) => !statuses[i]?.data?.done).map((t) => t.id));
  const allClips = (library.data?.clips ?? []).filter((c) => !rollingIds.has(c.id));
  const stripItems: TakeStripItem[] = takes.map((t, i) => ({
    id: t.id,
    thumb: takePoster(t),
    title: t.title,
    state: takeStates[i]!,
    progress: statuses[i]?.data?.progress,
    since: t.since,
    note: upscaling.has(t.id) ? 'Upscaling…' : undefined,
  }));
  const readyCount = takeStates.filter((st) => st === 'ready' || st === 'failed').length;
  const clipModels = [...new Set(allClips.map((c) => c.videoModel))];
  const activeClipFilter = clipModels.includes(clipFilter as VideoModelId) ? clipFilter : 'all';
  const clips =
    activeClipFilter === 'all' ? allClips : allClips.filter((c) => c.videoModel === activeClipFilter);
  const durations = videoDurations(videoModel);
  const secondsOptions = durations.map((s) => ({ id: String(s), name: `${s} seconds` }));

  const recreate = useRecreateWorkspace({ active: active && mode === 'recreate', onSourceThumb: setSourceThumb });

  const motionText = (
    cameraTravels
      ? motionLabel(shownMotion, moveStyle, speed)
      : motionLabel(shownMotion, moveStyle === 'handheld' ? moveStyle : undefined)
  ).toLowerCase();
  const focusReady = focus !== null && focusState === 'ready';
  const focusUrl = focus ? libraryUrl('clip', focus.id) : '';

  const animateInspector = (
    <>
      <PageHeader
        title="Bring a still to life"
        description="Pick one of your film stills and animate it: water, leaves and people move, the architecture stays exactly as it is."
      />
      {focus && focusReady && (
        <Section title="This take">
          <div className={own.thisTake}>
            <UpscaleClip
              key={focus.id}
              clipId={focus.id}
              aspectRatio={focus.ratio}
              name={`film-clip-${focus.model}`}
              active={active}
              fluxBlock={fluxUpscaleBlock({ videoModel: focus.model, resolution: focus.resolution, seconds: focus.seconds || undefined })}
              job={upscales[focus.id] ?? null}
              onJob={(job) => setUpscale(focus.id, job)}
            />
          </div>
        </Section>
      )}
      <div className={styles.strictSwitch}>
        <Switch
          label="Only what's in the image"
          hint={
            onlyInImage
              ? 'Nothing new appears: no added objects, people or places beyond the frame.'
              : 'Off: the model may add or reveal things the image doesn\'t show.'
          }
          checked={onlyInImage}
          onChange={setOnlyInImage}
        />
      </div>
      <Section step={1} title="Film still" description="From the takes you made on the Stills tab.">
        {library.isLoading ? (
          <SkeletonBlock height={180} />
        ) : library.error ? (
          <RunwayErrorNotice error={library.error} modelName="your library" />
        ) : stills.length === 0 ? (
          <EmptyState
            title="No film stills yet"
            hint="Make a still on the Stills tab, or start from an image of your own: choose a first frame in step 3."
            action={<Button onPress={onGoToStills}>Go to Stills</Button>}
          />
        ) : (
          <>
            {stills.length > 6 && (
              <FilterChips
                label="Filter stills"
                options={DAY_FILTERS}
                value={filter}
                onChange={(id) => {
                  setFilter(id as Filter);
                  setShown(PAGE);
                }}
              />
            )}
            {filtered.length === 0 ? (
              <Text tone="muted" size="sm" as="p">
                No stills match this filter.
              </Text>
            ) : (
              <ImagePicker
                label="Film still to animate"
                value={selected?.id ?? null}
                onChange={onPick}
                items={stepOneItems}
              />
            )}
            <div className={styles.pickerTools}>
              {filtered.length > shown ? (
                <Button size="sm" variant="ghost" onPress={() => setShown((n) => n + PAGE)}>
                  Show {Math.min(PAGE, filtered.length - shown)} more
                </Button>
              ) : (
                <span />
              )}
              {selected && (
                <span className={styles.pickerActions}>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Maximize2 size={14} />}
                    onPress={() => setZoom(selected)}
                  >
                    View full size
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 size={14} />}
                    disabled={takes.some((t, i) => t.stillId === selected.id && takeStates[i] !== 'ready' && takeStates[i] !== 'failed')}
                    onPress={() => setDeleting({ kind: 'still', id: selected.id, title: stillCaption(selected) })}
                  >
                    Remove
                  </Button>
                </span>
              )}
            </div>
            {selected && presetNote?.stillId === selected.id && (
              <Text tone="muted" size="sm" as="p" className={styles.frameNote}>
                {presetNote.note}
              </Text>
            )}
          </>
        )}
      </Section>

      <Section step={2} title="Model" description="Every model starts on your still as the first frame unless you choose another in the next step.">
        <div className={styles.selectRow}>
          <Select
            label="Video model"
            options={ANIMATE_VIDEO_MODELS}
            value={videoModel}
            onChange={(id) => {
              const next = id as VideoModelId;
              setVideoModel(next);
              setResolution(defaultVideoResolution(next));
              // Keep the chosen length when the new model can run it.
              setSeconds((s) => snapVideoSeconds(next, s));
              createVideo.reset();
            }}
          />
          <Select
            label="Resolution"
            options={videoResolutions(videoModel)}
            value={resolution}
            onChange={setResolution}
            disabled={videoResolutions(videoModel).length < 2}
          />
        </div>
      </Section>

      <Section
        step={3}
        title="Frames"
        description="Optional. The shot starts on your still; add a first, in-between or last frame only if you need one."
      >
        <FramesField
          frames={frames}
          modelName={videoModelName(videoModel)}
          limit={keyframeLimit}
          seconds={seconds}
          picked={selected ? { src: stillThumbUrl(selected.id), name: stillCaption(selected) } : null}
          items={pickerItems}
          endModels={videoModelsWith('end')}
          middleModels={videoModelsWith('middle')}
          lastBlockedByExtras={lastBlocked}
          disabled={false}
        />
      </Section>

      <Section
        step={4}
        title="Camera"
        description="Directed from the image, or set by hand. Short moves only, so nothing outside the still has to be invented."
      >
        <div className={styles.stack}>
          <ShotDirector
            shot={shot}
            context={shotContext}
            seconds={seconds}
            disabled={createVideo.isPending}
            styleField={
              <DirectionStyleSelect value={directorStyle} onChange={setDirectorStyle} disabled={shot.planning} />
            }
          />
          {/* While the director is on, the plan's camera Select replaces this one. */}
          {!shot.enabled && (
            <Select
              label="Camera move"
              options={MOTIONS}
              value={motion}
              onChange={(id) => setMotion(id as MotionId)}
            />
          )}
          <div className={styles.cameraRow}>
            <Select
              label="Movement style"
              options={MOVE_STYLES}
              value={moveStyle}
              onChange={(id) => setMoveStyle(id as MoveStyleId)}
            />
            <Select
              label="Speed"
              options={SPEEDS}
              value={speed}
              onChange={(id) => setSpeed(id as SpeedId)}
              disabled={!cameraTravels}
            />
          </div>
          {!cameraTravels && (
            <Text tone="muted" size="sm" as="p" className={styles.meta}>
              The camera holds its position, so speed doesn't apply
              {moveStyle === 'handheld' ? '; handheld adds a slight natural sway' : ''}.
            </Text>
          )}
        </div>
      </Section>

      <Section
        step={5}
        title="Length"
        description={`${videoModelName(videoModel)} runs ${durations[0]} to ${durations[durations.length - 1]} seconds. Longer clips cost more credits.`}
      >
        <Select
          label="Clip length"
          options={secondsOptions}
          value={String(seconds)}
          onChange={(id) => setSeconds(Number(id))}
          disabled={durations.length < 2}
          showHint={false}
        />
      </Section>

      <Section
        step={6}
        title="Extra images"
        description="Optional. Add pictures of things to bring into the shot; each is named @img1, @img2 and so on."
      >
        <RefsField
          frames={frames}
          modelName={videoModelName(videoModel)}
          limit={extraLimit}
          items={pickerItems}
          extraModels={videoModelsWith('extra')}
          blockedReason={
            extrasBlocked
              ? `${videoModelName(videoModel)} can use a last frame or extra images, not both. Remove the last frame to add extra images.`
              : undefined
          }
          disabled={false}
          onInsert={insertHandle}
        />
      </Section>

      <Section step={7} title="Extra direction" description="Optional. What should move, and how.">
        <div className={styles.stack}>
          <TextArea
            aria-label="Extra video direction"
            value={direction}
            onChange={setDirection}
            rows={3}
            maxLength={DIRECTION_MAX}
            placeholder="e.g. the couple walks slowly toward the water wall, leaves drift across the pool"
          />
          <Text tone="muted" size="sm" as="p" className={styles.frameNote}>
            {refsSent.length > 0
              ? `Name your extra images in the direction, e.g. "use the bench from @img2". You have @img1 to @img${refsSent.length}.`
              : 'With extra images added, you can name them here, e.g. "use the bench from @img2".'}
          </Text>
          {directionTooLong && (
            <Alert tone="error" title="Your direction is too long">
              Shorten it by {direction.length - DIRECTION_MAX} characters to make the video.
            </Alert>
          )}
          {handleProblem && (
            <Alert tone="error" title="Check the image names in your direction">
              {handleProblem}
            </Alert>
          )}
        </div>
      </Section>
    </>
  );

  // The primary's two presses (src/client/ShotDirector.tsx): with the director
  // on and no plan for this picture it directs (a text call); else it makes.
  const directLabel = frames.uploading
    ? 'Uploading images…'
    : shotFirst === null
      ? 'Pick a still or an image'
      : 'Direct the shot';
  const makeLabel = full
    ? `${MAX_IN_FLIGHT} videos rendering`
    : duplicateFrames
      ? 'Move frames that share a point'
      : frames.uploading
        ? 'Uploading images…'
        : !selected && !frames.first
          ? 'Pick a still or an image'
          : inFlight > 0
            ? 'Make another video'
            : 'Make the video';
  const animateFooter = (
    <>
      <Button
        variant="primary"
        size="lg"
        icon={directing || directFirst ? <ScanEye size={18} /> : <Clapperboard size={18} />}
        loading={createVideo.isPending || directing}
        disabled={
          directing ||
          (directFirst
            ? shotFirst === null || frames.uploading
            : createVideo.isPending ||
              full ||
              (!selected && !frames.first) ||
              frames.uploading ||
              handleProblem !== undefined ||
              directionTooLong ||
              duplicateFrames ||
              planBlocked ||
              unavailable)
        }
        onPress={directFirst ? () => void shot.direct() : () => void run()}
      >
        {createVideo.isPending
          ? 'Starting…'
          : directing
            ? 'Directing the shot…'
            : directFirst
              ? directLabel
              : makeLabel}
      </Button>
      <CostLine
        summary={
          directing || directFirst
            ? 'Directing is one text call on your AI text provider (Settings); the video is not billed until you make it.'
            : `${videoModelName(videoModel)} at ${videoResolutionName(videoModel, resolution)}, ${seconds} seconds, ${motionText}${shot.sendable ? ', directed' : ''}. Billed to your own Runway credits; video costs more than a still.`
        }
      />
      <p className={styles.queueNote} role="status" aria-live="polite">
        {full
          ? `${MAX_IN_FLIGHT} videos are rendering. You can start another as soon as one finishes.`
          : inFlight > 0
            ? `${inFlight} video${inFlight === 1 ? '' : 's'} rendering. Change anything and start the next one; each take keeps its own settings.`
            : ''}
      </p>
      <RunwayErrorNotice error={shownError} modelName={videoModelName(videoModel)} onRetry={() => void run()} />
    </>
  );

  // ---- Animate's canvas: All clips, the focused take, or the shot being set up.
  const showClips = view === 'clips';
  const setupSrc = frames.first
    ? frames.first.stillId
      ? stillViewUrl(frames.first.stillId)
      : frames.first.src
    : selected
      ? stillViewUrl(selected.id)
      : null;
  const animateState: CanvasState = showClips ? 'free' : focus && focusStatus ? 'live' : setupSrc ? 'preview' : 'empty';
  const animateCanvas = showClips ? (
    <div className={own.sheet}>
      <Section title="Your clips" description="Every video you make, newest first.">
        {library.isLoading ? (
          <SkeletonBlock height={140} />
        ) : library.error && !library.data ? (
          <div className={styles.stack}>
            <Alert tone="error" title="Your clips didn't load">
              {library.error.message}
            </Alert>
            <div>
              <Button size="sm" onPress={() => void library.refetch()}>
                Try again
              </Button>
            </div>
          </div>
        ) : allClips.length === 0 ? (
          <EmptyState
            title="No clips yet"
            hint="Every video you make is kept here so you can watch or download it later."
          />
        ) : (
          <div className={styles.stack}>
            {clipModels.length > 1 && (
              <FilterChips
                label="Filter clips by model"
                options={[
                  { id: 'all', name: 'All' },
                  ...clipModels.map((m) => ({ id: m, name: videoModelName(m) })),
                ]}
                value={activeClipFilter}
                onChange={setClipFilter}
              />
            )}
            <ClipList
              key={activeClipFilter}
              clips={clips}
              stills={library.data?.stills ?? []}
              onDelete={(c) => setDeleting({ kind: 'clip', id: c.id, title: clipLabel(c) })}
            />
          </div>
        )}
      </Section>
    </div>
  ) : focus && focusStatus ? (
    <TakeCanvas
      key={focus.id}
      take={focus}
      poster={takePoster(focus)}
      status={focusStatus}
      state={focusState!}
      onDismiss={() => dropTake(focus.id)}
    />
  ) : setupSrc ? (
    <img
      src={setupSrc}
      alt={frames.first ? `First frame: ${frames.first.name}` : selected ? `Selected still: ${stillLabel(selected)}` : ''}
    />
  ) : null;
  const focusRes = focus ? videoResolutionName(focus.model, focus.resolution) : '';
  const animateCaption = focus
    ? saver.error && focusReady
      ? <span role="alert">Download failed. {saver.error}</span>
      : focusReady
        ? [focus.title, focusRes, `${focus.seconds} seconds`]
        : focusState === 'rendering' || focusState === 'queued'
          ? [focus.title, `${focus.seconds} seconds`, 'Keep working: set up the next shot and it renders alongside this one']
          : [focus.title, `${focus.seconds} seconds`]
    : [
        videoModelName(videoModel),
        videoResolutionName(videoModel, resolution),
        `${seconds} seconds`,
        shot.needsPlan ? 'camera directed from the image' : shot.sendable ? `${motionText}, directed` : motionText,
      ];
  const animateActions = focus && focusReady ? (
    <>
      <Button
        variant="ghost"
        icon={<Download size={16} />}
        loading={saver.pending}
        onPress={() => saver.start(focusUrl, `film-clip-${focus.model}.mp4`)}
      >
        {saver.label('Download')}
      </Button>
      <Button variant="ghost" icon={<ExternalLink size={16} />} onPress={() => window.open(focusUrl, '_blank', 'noopener')}>
        Open full size
      </Button>
    </>
  ) : undefined;
  const animateToolbar = (
    <>
      <CanvasView view={view} onChange={setView} clipsLabel="All clips" />
      {readyCount > 0 && view === 'takes' && (
        <Button size="sm" variant="ghost" icon={<ListX size={14} />} onPress={clearFinished}>
          Clear finished
        </Button>
      )}
    </>
  );
  const animateStrip =
    takes.length > 0 ? (
      <div className={own.takes}>
        <TakeStrip
          label="Takes from this session"
          items={stripItems}
          value={focus ? focus.id : null}
          onChange={(id) => {
            setFocusId(id);
            setView('takes');
          }}
          next={{
            thumb: frames.first?.src ?? (selected ? stillThumbUrl(selected.id) : undefined),
            title: frames.first ? frames.first.name : selected ? stillCaption(selected) : 'Pick a still',
          }}
        />
      </div>
    ) : undefined;

  // On a phone the steps wait in the sheet under the picture, so the copy points there.
  const phone = usePhoneLayout();
  const animate = {
    canvasState: animateState,
    canvas: animateCanvas,
    aspectRatio: focus && !showClips ? focus.ratio : previewRatio,
    caption: animateCaption,
    canvasNote: 'Your video will appear here',
    canvasToolbar: animateToolbar,
    canvasActions: animateActions,
    strip: animateStrip,
    stripLabel: 'Takes',
    footer: animateFooter,
    empty: {
      title: 'Drop a frame to begin',
      hint: phone
        ? 'PNG, JPEG or WebP: the shot starts on it. Or pick a still in the panel below.'
        : 'PNG, JPEG or WebP: the shot starts on it. Or pick one of your film stills in step 1.',
      action: 'Choose a frame',
      label: 'Drop or choose a frame',
    },
    onDropFiles: showClips
      ? undefined
      : (files: File[]) => {
          const file = files[0];
          if (file) void frames.addFile('first', file);
        },
  };
  const slots = mode === 'animate' ? animate : recreate;

  return (
    <>
      <Tabs selectedKey={mode} onSelectionChange={(key) => setMode(key as VideoMode)}>
        <VideoWorkspace
          canvasState={slots.canvasState}
          canvas={slots.canvas}
          aspectRatio={slots.aspectRatio}
          caption={slots.caption}
          canvasNote={slots.canvasNote}
          canvasToolbar={slots.canvasToolbar}
          canvasActions={slots.canvasActions}
          onDropFiles={slots.onDropFiles}
          empty={slots.empty}
          strip={slots.strip}
          stripLabel={slots.stripLabel}
          footer={slots.footer}
          tabs={
            <div className={own.modeBar}>
              <TabList aria-label="Video">
                <Tab id="animate">Animate a still</Tab>
                <Tab id="recreate">Recreate in 4K</Tab>
              </TabList>
            </div>
          }
          inspector={
            <>
              <TabPanel id="animate" shouldForceMount className={own.panel}>
                {animateInspector}
              </TabPanel>
              <TabPanel id="recreate" shouldForceMount className={own.panel}>
                {recreate.inspector}
              </TabPanel>
            </>
          }
        />
      </Tabs>

      <Lightbox
        src={zoom ? stillViewUrl(zoom.id) : null}
        alt={zoom ? stillLabel(zoom) : ''}
        title={zoom ? stillCaption(zoom) : ''}
        onClose={() => setZoom(null)}
      />
      <DeleteItemDialog
        target={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(t) => {
          if (t.kind === 'still' && t.id === pickedStillId) onPick(null);
          if (t.kind === 'clip') dropTake(t.id);
        }}
      />
      {recreate.dialogs}
    </>
  );
}

/**
 * The Workspace inside the mode Tabs. React Aria renders Tabs' children twice:
 * once in a hidden pass that only collects the tabs (no tab list state yet),
 * then for real. The hidden pass gets the tab list alone, so the Workspace,
 * its effects (the `i` shortcut) and anything it portals mount once.
 */
function VideoWorkspace({ tabs, ...props }: Omit<WorkspaceProps, 'page' | 'inspectorHead'> & { tabs: ReactNode }) {
  const collecting = useContext(TabListStateContext) === null;
  if (collecting) return <>{tabs}</>;
  return <Workspace page="video" inspectorHead={tabs} {...props} />;
}

/** The canvas's view toggle: a mode's takes, or every clip as a contact sheet. */
export function CanvasView({
  view,
  onChange,
  clipsLabel,
}: {
  view: CanvasViewId;
  onChange: (view: CanvasViewId) => void;
  /** "All clips", or "Your 4K recreations". */
  clipsLabel: string;
}) {
  return (
    <div className={own.view} role="group" aria-label="Show on the canvas">
      <ToggleButton className={own.viewItem} isSelected={view === 'takes'} onChange={() => onChange('takes')}>
        Takes
      </ToggleButton>
      <ToggleButton className={own.viewItem} isSelected={view === 'clips'} onChange={() => onChange('clips')}>
        {clipsLabel}
      </ToggleButton>
    </div>
  );
}

/** The slice of a take's status query the big screen reads. */
type StatusQuery = {
  data?: inferRouterOutputs<AppRouterType>['videoStatus'] | undefined;
  error: unknown;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
};

/** One take inside the canvas frame: rendering, the finished clip, or why it
 * didn't render (its actions, caption and upscale are the page's slots). */
function TakeCanvas({
  take,
  poster,
  status,
  state,
  onDismiss,
}: {
  take: Take;
  /** Its poster: the frame it started on. */
  poster: string;
  status: StatusQuery;
  state: TakeState;
  onDismiss: () => void;
}) {
  const pollFinal = FINAL_CODES.has(errorCode(status.error) ?? '');
  const special = status.error ? classifyRunwayError(status.error) : null;
  const needsPrompt = special && (special.signIn || special.credits || special.consent);

  if (state === 'ready') {
    // The big screen's player keeps the browser's own controls (the clip cards wait for a press).
    return (
      <video
        src={libraryUrl('clip', take.id)}
        poster={poster}
        controls
        muted
        loop
        playsInline
        preload="metadata"
        aria-label={`Video: ${take.title}`}
      />
    );
  }
  if (state === 'lost') {
    return (
      <div className={styles.frameAlert}>
        <Alert tone="error" title="We lost touch with this video">
          {pollFinal
            ? `${special?.message ?? 'Runway could not find it.'} It may still appear under Your clips.`
            : `${special?.message ?? 'The check failed.'} It may still be rendering, so check again.`}
        </Alert>
        {needsPrompt && (
          <RunwayErrorNotice
            error={status.error}
            modelName={videoModelName(take.model)}
            onRetry={() => void status.refetch()}
          />
        )}
        <div className={styles.resultActions}>
          <Button size="sm" loading={status.isFetching} onPress={() => void status.refetch()}>
            Check again
          </Button>
          {pollFinal && (
            <Button size="sm" variant="ghost" onPress={onDismiss}>
              Stop waiting
            </Button>
          )}
        </div>
      </div>
    );
  }
  if (state === 'failed') {
    return (
      <div className={styles.frameAlert}>
        <Alert tone="error" title="This video didn't render">
          {status.data?.error ?? 'The video did not render. Try again.'}
        </Alert>
        <div className={styles.resultActions}>
          <Button size="sm" variant="ghost" onPress={onDismiss}>
            Remove from takes
          </Button>
        </div>
      </div>
    );
  }
  return (
    <RenderingStatus
      label={
        state === 'queued'
          ? 'Waiting for a camera at Runway…'
          : 'Rolling camera. Video usually takes one to a few minutes…'
      }
      progress={status.data?.progress}
      runKey={take.id}
      since={take.since}
    />
  );
}

/** Clips as a contact sheet, six at a time (also the Recreate in 4K tab's list). */
export function ClipList({
  clips,
  stills,
  onDelete,
}: {
  clips: Clip[];
  stills: Still[];
  onDelete: (clip: Clip) => void;
}) {
  const [shown, setShown] = useState(6);
  const stillIds = useMemo(() => new Set(stills.map((s) => s.id)), [stills]);
  return (
    <>
      <div className={own.sheetGrid}>
        {clips.slice(0, shown).map((c) => (
          <ClipCard key={c.id} clip={c} stillIds={stillIds} onDelete={onDelete} />
        ))}
      </div>
      {clips.length > shown && (
        <Button size="sm" variant="ghost" className={styles.more} onPress={() => setShown((n) => n + 6)}>
          Show more clips
        </Button>
      )}
    </>
  );
}

/**
 * One clip on the contact sheet: its poster with a play button. The player's
 * own controls appear, and the clip loads and plays, only after that press.
 */
function ClipCard({
  clip,
  stillIds,
  onDelete,
}: {
  clip: Clip;
  stillIds: ReadonlySet<string>;
  onDelete: (clip: Clip) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const label = clipLabel(clip);
  return (
    <figure className={styles.clipCard}>
      {clip.status === 'succeeded' ? (
        <div className={own.clipPlayer}>
          <video
            ref={video}
            className={styles.clipFrame}
            src={libraryUrl('clip', clip.id)}
            poster={clipPosterUrl(clip, stillIds) ?? NO_POSTER}
            controls={playing}
            autoPlay={playing}
            playsInline
            preload={playing ? 'auto' : 'none'}
            aria-label={label}
          />
          {!playing && (
            <button
              type="button"
              className={own.play}
              aria-label={`Play ${label}`}
              onClick={() => {
                setPlaying(true);
                void video.current?.play().catch(() => undefined);
              }}
            >
              <Play size={20} aria-hidden />
            </button>
          )}
        </div>
      ) : (
        <div className={styles.clipFailed}>
          <Text tone="muted" size="sm">
            {clip.status === 'pending' ? 'Still rendering…' : clip.error ?? 'This clip did not render.'}
          </Text>
        </div>
      )}
      <figcaption className={styles.clipCaption}>
        <span className={styles.clipCaptionText}>
          <Text size="sm">{label}</Text>
          <Text tone="muted" size="sm">
            {new Date(clip.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </Text>
        </span>
        {clip.status !== 'pending' && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 size={14} />}
            aria-label={`Delete ${label}`}
            onPress={() => onDelete(clip)}
          />
        )}
      </figcaption>
    </figure>
  );
}

/** A clip's one-line caption: model, resolution and camera move, or what a recreation is. */
export function clipLabel(c: Clip): string {
  // A recreation's title already says whether it was upscaled.
  if (c.recreate) return `${recreateTitle(c.recreate)}${c.seconds ? `, ${c.seconds} s` : ''}`;
  const motion = motionLabel(c.motion, c.moveStyle, c.speed).toLowerCase();
  const res = videoResolutionName(c.videoModel, c.resolution);
  const extras = [
    c.frameCount && c.frameCount > 1 ? `${c.frameCount} frames` : '',
    c.refCount ? `${c.refCount} extra image${c.refCount === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  const base = `${videoModelName(c.videoModel)}${res ? ` ${res}` : ''}, ${motion}${
    extras.length ? `, ${extras.join(' and ')}` : ''
  }${c.shot ? ', directed' : ''}`;
  return c.upscaleOf ? `${base}, upscaled ${c.scale ?? ''}× (${upscalerName(c.upscaler)})` : base;
}

function stillCaption(s: Still, withSize = true): string {
  const size = withSize ? stillSize(s) : '';
  if (s.location) return `Location: ${locationName(s.location)}${size}`;
  if (s.surroundings) return `Surroundings: ${settingName(s.surroundings.setting)}${size}`;
  if (s.storyboard) return `Storyboard ${s.storyboard.order}: ${s.storyboard.title}${size}`;
  const look = lookLabel(s.look, litFromReference(s));
  const moment = momentById(s.moment);
  if (moment) return `Lifestyle: ${moment.name}, ${look}${size}`;
  return `${look}${s.crowd !== 'none' ? ', people' : ''}${size}`;
}

/** A still's size as a caption clause: ", 4K" or ", upscaled 2×"; empty when unknown. */
function stillSize(s: Still): string {
  const res = imageResolutionName(s.imageModel, s.resolution);
  return s.upscaleOf ? `, upscaled ${s.scale ?? ''}×` : res ? `, ${res}` : '';
}

/** A picker card's second line: the model, the size and when it was made. */
function stillDetail(s: Still): string {
  const when = new Date(s.createdAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${imageModelName(s.imageModel)}${stillSize(s)}, ${when}`;
}

function stillLabel(s: Still): string {
  return `${stillCaption(s)}, made with ${imageModelName(s.imageModel)} on ${new Date(s.createdAt).toLocaleString()}`;
}

/** An @imgN in the direction that the clip won't have, in words. */
function unknownHandle(direction: string, sent: number, model: string): string | undefined {
  const used = extraImageHandles(direction);
  if (used.length === 0) return undefined;
  if (sent === 0) {
    return `Your direction mentions @img${used[0]}, but no extra images will be sent with ${model}. Add an image, or remove the name.`;
  }
  const bad = used.find((n) => n < 1 || n > sent);
  return bad === undefined
    ? undefined
    : `Your direction mentions @img${bad}, but you only have @img1 to @img${sent}.`;
}

function frameRatio(s: { width: number; height: number } | null): string {
  return s ? `${s.width} / ${s.height}` : '16 / 9';
}
