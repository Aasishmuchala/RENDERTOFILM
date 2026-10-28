import { Clapperboard, Download, ExternalLink, ListX, Maximize2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { inferRouterOutputs } from '@trpc/server';

import type { AppRouterType, Clip, Still } from '../api.ts';
import { momentById } from '../lifestyle.ts';
import { locationName } from '../location.ts';
import { litFromReference, LOOKS, lookLabel } from '../looks.ts';
import {
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
import { settingName } from '../surroundings.ts';
import { DeleteItemDialog, type DeleteTarget } from './DeleteItemDialog.tsx';
import { Section } from './layouts/Section.tsx';
import { libraryUrl, stillThumbUrl, stillViewUrl, useDownload } from './lib/download.ts';
import { classifyRunwayError } from './lib/runwayErrors.ts';
import { trpc } from './trpc.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { EmptyState } from './ui/EmptyState.tsx';
import { FilterChips } from './ui/FilterChips.tsx';
import { ImagePicker } from './ui/ImagePicker.tsx';
import { Lightbox } from './ui/Lightbox.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { Switch } from './ui/Switch.tsx';
import { RenderingStatus } from './ui/RenderingStatus.tsx';
import { RunwayErrorNotice } from './ui/RunwayErrorNotice.tsx';
import { SkeletonBlock } from './ui/Skeleton.tsx';
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
  stillId: string;
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

export type VideoPageProps = {
  /** True while the Video tab is on screen; polling slows down when it isn't. */
  active: boolean;
  /** A still picked from the Stills tab ("Make a video"). */
  pickedStillId: string | null;
  onPick: (stillId: string | null) => void;
  /** Go back to the Stills tab, when there are no stills yet. */
  onGoToStills: () => void;
};

export function VideoPage({ active, pickedStillId, onPick, onGoToStills }: VideoPageProps) {
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

  const frames = useVideoFrames();
  const createVideo = trpc.createVideo.useMutation();
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
        caption: stillCaption(s),
      })),
    [stills]
  );
  const stepOneItems = useMemo(
    () =>
      filtered.slice(0, shown).map((s) => ({
        id: s.id,
        src: stillThumbUrl(s.id),
        alt: stillLabel(s),
        caption: stillCaption(s),
      })),
    [filtered, shown]
  );
  const selected = stills.find((s) => s.id === pickedStillId) ?? null;
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

  useEffect(() => {
    // A new pick puts the shot being set up on the big screen; the takes keep
    // rendering in the strip.
    setFocusId(null);
  }, [pickedStillId]);

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

  const cameraTravels = motion !== 'still-life' && motion !== 'focus-pull';

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
  const directionTooLong = direction.length > DIRECTION_MAX;
  const duplicateFrames = duplicateMiddle(middleSent).size > 0;

  function insertHandle(handle: string) {
    setDirection((d) => `${d}${d && !/\s$/.test(d) ? ' ' : ''}${handle} `);
  }

  async function run() {
    if (!selected || handleProblem || directionTooLong || duplicateFrames || full) return;
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
      const { id } = await createVideo.mutateAsync({
        stillId: selected.id,
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
      });
      const take: Take = {
        id,
        stillId: selected.id,
        model: videoModel,
        resolution,
        seconds,
        ratio: previewRatio,
        title: `${MOTIONS.find((m) => m.id === motion)?.name ?? 'Shot'}, ${videoModelName(videoModel)}`,
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
    } catch {
      // Shown by RunwayErrorNotice from createVideo.error.
    }
  }

  const rollingIds = new Set(takes.filter((_, i) => !statuses[i]?.data?.done).map((t) => t.id));
  const allClips = (library.data?.clips ?? []).filter((c) => !rollingIds.has(c.id));
  const stripItems: TakeStripItem[] = takes.map((t, i) => ({
    id: t.id,
    thumb: stillThumbUrl(t.stillId),
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

  return (
    <>
      <div className={styles.layout}>
        <div className={styles.controls}>
          <PageHeader
            title="Bring a still to life"
            description="Pick one of your film stills and animate it: water, leaves and people move, the architecture stays exactly as it is."
          />
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
                hint="Make a still on the Stills tab first. Every finished take shows up here."
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
              </>
            )}
          </Section>

          <Section step={2} title="Model" description="Every model starts on your still as the first frame unless you choose another in the next step.">
            <div className={styles.selectRow}>
              <Select
                label="Video model"
                options={VIDEO_MODELS}
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
            description="Short moves only, so nothing outside the still has to be invented."
          >
            <div className={styles.stack}>
              <Select
                label="Camera move"
                options={MOTIONS}
                value={motion}
                onChange={(id) => setMotion(id as MotionId)}
              />
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

          <div className={styles.actionBar}>
          <Button
            variant="primary"
            icon={<Clapperboard size={16} />}
            className={styles.generate}
            loading={createVideo.isPending}
            disabled={
              createVideo.isPending ||
              full ||
              !selected ||
              frames.uploading ||
              handleProblem !== undefined ||
              directionTooLong ||
              duplicateFrames ||
              planBlocked ||
              unavailable
            }
            onPress={() => void run()}
          >
            {createVideo.isPending
              ? 'Starting…'
              : full
                ? `${MAX_IN_FLIGHT} videos rendering`
                : duplicateFrames
                  ? 'Move frames that share a point'
                  : frames.uploading
                    ? 'Uploading images…'
                    : !selected
                      ? 'Pick a still first'
                      : inFlight > 0
                        ? 'Make another video'
                        : 'Make the video'}
          </Button>
          <Text tone="muted" size="sm" as="p" className={styles.meta}>
            {videoModelName(videoModel)} at {videoResolutionName(videoModel, resolution)},{' '}
            {seconds} seconds,{' '}
            {(cameraTravels
              ? motionLabel(motion, moveStyle, speed)
              : motionLabel(motion, moveStyle === 'handheld' ? moveStyle : undefined)
            ).toLowerCase()}
            . Billed to your
            own Runway credits; video costs more than a still.
          </Text>
          <p className={styles.queueNote} role="status" aria-live="polite">
            {full
              ? `${MAX_IN_FLIGHT} videos are rendering. You can start another as soon as one finishes.`
              : inFlight > 0
                ? `${inFlight} video${inFlight === 1 ? '' : 's'} rendering. Change anything and start the next one; each take keeps its own settings.`
                : ''}
          </p>
          <RunwayErrorNotice
            error={shownError}
            modelName={videoModelName(videoModel)}
            onRetry={() => void run()}
          />
          </div>
        </div>

        <div className={styles.result} data-stage>
          <Section title={focus ? 'Video' : 'Next shot'}>
            {focus && focusStatus ? (
              <TakeView
                key={focus.id}
                take={focus}
                status={focusStatus}
                state={focusState!}
                active={active}
                upscale={upscales[focus.id] ?? null}
                onUpscale={(job) => setUpscale(focus.id, job)}
                onDismiss={() => dropTake(focus.id)}
              />
            ) : (
              <div className={styles.resultFrame} style={{ aspectRatio: previewRatio, ['--ar' as string]: previewRatio }}>
                {selected ? (
                  <img
                    className={styles.image}
                    src={
                      frames.first
                        ? frames.first.stillId
                          ? stillViewUrl(frames.first.stillId)
                          : frames.first.src
                        : stillViewUrl(selected.id)
                    }
                    alt={
                      frames.first
                        ? `First frame: ${frames.first.name}`
                        : `Selected still: ${stillLabel(selected)}`
                    }
                  />
                ) : (
                  <EmptyState
                    title="Your video will appear here"
                    hint="Pick a still, choose a model and camera move, then press Make the video."
                  />
                )}
              </div>
            )}
          </Section>
          {takes.length > 0 && (
            <Section
              title={
                <span className={styles.takesHead}>
                  <span>
                    Takes
                    {inFlight > 0 ? `, ${inFlight} rendering` : ''}
                  </span>
                  {readyCount > 0 && (
                    <Button size="sm" variant="ghost" icon={<ListX size={14} />} onPress={clearFinished}>
                      Clear finished
                    </Button>
                  )}
                </span>
              }
            >
              <TakeStrip
                label="Takes from this session"
                items={stripItems}
                value={focus ? focus.id : null}
                onChange={setFocusId}
                next={{
                  thumb: selected ? stillThumbUrl(selected.id) : undefined,
                  title: selected ? stillCaption(selected) : 'Pick a still',
                }}
              />
            </Section>
          )}
          <div className={styles.below}>
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
        </div>
      </div>

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
    </>
  );
}

/** The slice of a take's status query the big screen reads. */
type StatusQuery = {
  data?: inferRouterOutputs<AppRouterType>['videoStatus'] | undefined;
  error: unknown;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
};

/** One take on the big screen: rendering, the finished clip with its
 * actions and upscale, or why it didn't render. */
function TakeView({
  take,
  status,
  state,
  active,
  upscale,
  onUpscale,
  onDismiss,
}: {
  take: Take;
  status: StatusQuery;
  state: TakeState;
  active: boolean;
  upscale: UpscaleJob | null;
  onUpscale: (job: UpscaleJob | null) => void;
  onDismiss: () => void;
}) {
  const saver = useDownload();
  const style = { aspectRatio: take.ratio, ['--ar' as string]: take.ratio };
  const url = libraryUrl('clip', take.id);
  const pollFinal = FINAL_CODES.has(errorCode(status.error) ?? '');
  const special = status.error ? classifyRunwayError(status.error) : null;
  const needsPrompt = special && (special.signIn || special.credits || special.consent);

  if (state === 'ready') {
    return (
      <>
        <div className={styles.resultFrame} style={style}>
          <video
            src={url}
            poster={stillThumbUrl(take.stillId)}
            controls
            muted
            loop
            playsInline
            preload="metadata"
            aria-label={`Video: ${take.title}`}
          />
        </div>
        {saver.error && (
          <Alert tone="error" title="Download failed">
            {saver.error}
          </Alert>
        )}
        <div className={styles.resultActions}>
          <Button
            icon={<Download size={16} />}
            loading={saver.pending}
            onPress={() => saver.start(url, `film-clip-${take.model}.mp4`)}
          >
            {saver.label('Download')}
          </Button>
          <Button variant="ghost" icon={<ExternalLink size={16} />} onPress={() => window.open(url, '_blank', 'noopener')}>
            Open full size
          </Button>
          <Text tone="muted" size="sm" className={styles.resultNote}>
            {take.title}
            {videoResolutionName(take.model, take.resolution) && ` at ${videoResolutionName(take.model, take.resolution)}`},{' '}
            {take.seconds} seconds
          </Text>
        </div>
        <UpscaleClip
          clipId={take.id}
          aspectRatio={take.ratio}
          name={`film-clip-${take.model}`}
          active={active}
          fluxBlock={fluxUpscaleBlock({ videoModel: take.model, resolution: take.resolution, seconds: take.seconds || undefined })}
          job={upscale}
          onJob={onUpscale}
        />
      </>
    );
  }

  return (
    <>
      <div className={styles.resultFrame} style={style}>
        {state === 'lost' ? (
          <div className={styles.frameAlert}>
            <Alert tone="error" title="We lost touch with this video">
              {pollFinal
                ? `${special?.message ?? 'Runway could not find it.'} It may still appear under Your clips.`
                : `${special?.message ?? 'The check failed.'} It may still be rendering, so check again.`}
            </Alert>
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
        ) : state === 'failed' ? (
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
        ) : (
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
        )}
      </div>
      {needsPrompt && (
        <RunwayErrorNotice
          error={status.error}
          modelName={videoModelName(take.model)}
          onRetry={() => void status.refetch()}
        />
      )}
      {(state === 'rendering' || state === 'queued') && (
        <Text tone="muted" size="sm" as="p" className={styles.resultNote}>
          {take.title}, {take.seconds} seconds. Keep working: set up the next shot and it renders alongside this one.
        </Text>
      )}
    </>
  );
}

function ClipList({
  clips,
  stills,
  onDelete,
}: {
  clips: Clip[];
  stills: Still[];
  onDelete: (clip: Clip) => void;
}) {
  const [shown, setShown] = useState(6);
  return (
    <>
      <div className={styles.clips}>
        {clips.slice(0, shown).map((c) => {
          const still = stills.find((s) => s.id === c.stillId);
          const label = clipLabel(c);
          return (
            <figure key={c.id} className={styles.clipCard}>
              {c.status === 'succeeded' ? (
                <video
                  className={styles.clipFrame}
                  src={libraryUrl('clip', c.id)}
                  poster={still ? stillThumbUrl(still.id) : undefined}
                  controls
                  playsInline
                  preload="none"
                  aria-label={label}
                />
              ) : (
                <div className={styles.clipFailed}>
                  <Text tone="muted" size="sm">
                    {c.status === 'pending' ? 'Still rendering…' : c.error ?? 'This clip did not render.'}
                  </Text>
                </div>
              )}
              <figcaption className={styles.clipCaption}>
                <span className={styles.clipCaptionText}>
                  <Text size="sm">{label}</Text>
                  <Text tone="muted" size="sm">
                    {new Date(c.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </Text>
                </span>
                {c.status !== 'pending' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 size={14} />}
                    aria-label={`Delete ${label}`}
                    onPress={() => onDelete(c)}
                  />
                )}
              </figcaption>
            </figure>
          );
        })}
      </div>
      {clips.length > shown && (
        <Button size="sm" variant="ghost" className={styles.more} onPress={() => setShown((n) => n + 6)}>
          Show more clips
        </Button>
      )}
    </>
  );
}

function clipLabel(c: Clip): string {
  const motion = motionLabel(c.motion, c.moveStyle, c.speed).toLowerCase();
  const res = videoResolutionName(c.videoModel, c.resolution);
  const extras = [
    c.frameCount && c.frameCount > 1 ? `${c.frameCount} frames` : '',
    c.refCount ? `${c.refCount} extra image${c.refCount === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  const base = `${videoModelName(c.videoModel)}${res ? ` ${res}` : ''}, ${motion}${
    extras.length ? `, ${extras.join(' and ')}` : ''
  }`;
  return c.upscaleOf ? `${base}, upscaled ${c.scale ?? ''}× (${upscalerName(c.upscaler)})` : base;
}

function stillCaption(s: Still): string {
  const res = imageResolutionName(s.imageModel, s.resolution);
  const size = s.upscaleOf ? `, upscaled ${s.scale ?? ''}×` : res ? `, ${res}` : '';
  if (s.location) return `Location: ${locationName(s.location)}${size}`;
  if (s.surroundings) return `Surroundings: ${settingName(s.surroundings.setting)}${size}`;
  if (s.storyboard) return `Storyboard ${s.storyboard.order}: ${s.storyboard.title}${size}`;
  const look = lookLabel(s.look, litFromReference(s));
  const moment = momentById(s.moment);
  if (moment) return `Lifestyle: ${moment.name}, ${look}${size}`;
  return `${look}${s.crowd !== 'none' ? ', people' : ''}${size}`;
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
