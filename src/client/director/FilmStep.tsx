import { ACT_NAMES, actDirection, actOf, plannedShot } from '../../direction.ts';
import { Clapperboard, Film, ScanEye, Scissors, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';

import type { Clip, Still } from '../../api.ts';
import {
  ANIMATE_VIDEO_MODELS,
  defaultVideoResolution,
  defaultVideoSeconds,
  MOTIONS,
  type MotionId,
  MOVE_STYLES,
  type MoveStyleId,
  snapVideoSeconds,
  SPEEDS,
  type SpeedId,
  VIDEO_MODELS,
  videoDurations,
  videoKeyframeLimit,
  type VideoModelId,
  videoModelName,
  videoResolutions,
} from '../../models.ts';
import { type ShotContext, type ShotPlanRaw, shotSummary } from '../../shot-director.ts';
import type { FramePlan, StoryboardJob } from '../../storyboard-api.ts';
import { Section } from '../layouts/Section.tsx';
import { libraryUrl, stillThumbUrl } from '../lib/download.ts';
import { useCapabilities } from '../lib/useCapabilities.ts';
import { type ShotPlan, useShotPlan } from '../lib/useShotPlan.ts';
import { ShotDirector } from '../ShotDirector.tsx';
import { trpc } from '../trpc.ts';
import { Alert } from '../ui/Alert.tsx';
import { Button } from '../ui/Button.tsx';
import { BlockedTip, ModelUnavailable } from '../ui/ModelUnavailable.tsx';
import { RenderingStatus } from '../ui/RenderingStatus.tsx';
import { RunwayErrorNotice } from '../ui/RunwayErrorNotice.tsx';
import { Select } from '../ui/Select.tsx';
import { Switch } from '../ui/Switch.tsx';
import { Text } from '../ui/Text.tsx';
import { TextArea } from '../ui/TextArea.tsx';
import own from '../DirectorPage.module.css';

const DIRECTION_MAX = 600;

type FilmSettings = {
  videoModel: VideoModelId;
  resolution: string;
  seconds: number;
  moveStyle: MoveStyleId;
  speed: SpeedId;
  direction: string;
  onlyInImage: boolean;
  archviz: boolean;
  /** Plan each clip from its frame with the shot director (src/shot-director.ts) before it is made. */
  direct: boolean;
  /** A camera move per frame (its image index); unset frames use the suggested move. */
  moves: Record<number, MotionId>;
};

function defaults(): FilmSettings {
  return {
    videoModel: 'seedance-2',
    resolution: defaultVideoResolution('seedance-2'),
    seconds: defaultVideoSeconds('seedance-2'),
    moveStyle: 'steady',
    speed: 'slow',
    direction: '',
    onlyInImage: true,
    archviz: true,
    direct: true,
    moves: {},
  };
}

const settingsKey = (jobId: string) => `render-to-film:film:${jobId}`;

/** The film settings for a storyboard, kept in this browser so a reload keeps them. */
function useFilmSettings(jobId: string) {
  const [settings, setSettings] = useState<FilmSettings>(() => {
    try {
      const raw = localStorage.getItem(settingsKey(jobId));
      if (raw) {
        const d = defaults();
        const saved = { ...d, ...(JSON.parse(raw) as Partial<FilmSettings>) };
        if (VIDEO_MODELS.some((m) => m.id === saved.videoModel)) {
          // Anything an older version saved that this one no longer offers
          // falls back to the default, so no clip is refused for it.
          const moves: Record<number, MotionId> = {};
          if (saved.moves && typeof saved.moves === 'object') {
            for (const [k, v] of Object.entries(saved.moves)) {
              if (MOTIONS.some((m) => m.id === v)) moves[Number(k)] = v;
            }
          }
          return {
            ...saved,
            resolution: typeof saved.resolution === 'string' ? saved.resolution : d.resolution,
            seconds: typeof saved.seconds === 'number' ? saved.seconds : d.seconds,
            moveStyle: MOVE_STYLES.some((m) => m.id === saved.moveStyle) ? saved.moveStyle : d.moveStyle,
            speed: SPEEDS.some((m) => m.id === saved.speed) ? saved.speed : d.speed,
            direction: typeof saved.direction === 'string' ? saved.direction.slice(0, DIRECTION_MAX) : '',
            onlyInImage: typeof saved.onlyInImage === 'boolean' ? saved.onlyInImage : d.onlyInImage,
            archviz: typeof saved.archviz === 'boolean' ? saved.archviz : d.archviz,
            direct: true,
            moves,
          };
        }
      }
    } catch {
      // Unreadable or private mode: start from the defaults.
    }
    return defaults();
  });
  useEffect(() => {
    try {
      localStorage.setItem(settingsKey(jobId), JSON.stringify(settings));
    } catch {
      // Private mode: the settings just won't survive a reload.
    }
  }, [jobId, settings]);
  return [settings, setSettings] as const;
}

/**
 * A move that suits the frame's place in the story: the film opens by
 * pulling back to reveal, interiors push gently in, exteriors drift
 * sideways (alternating, so cuts don't repeat), and the last frame rises
 * away.
 */
export function suggestedMove(frame: FramePlan, order: number, count: number): MotionId {
  if (count > 1 && order === 1) return 'pull-out';
  if (count > 2 && order === count) return frame.space === 'interior' ? 'pull-out' : 'crane-up';
  if (frame.space === 'interior') return 'push-in';
  return order % 2 === 0 ? 'drift-left' : 'drift-right';
}

/** The film's next step, which the page's footer offers once every frame is shot. */
export type FilmNext =
  /** Clips to make for the frames chosen for the film, or a batch starting them. */
  | {
      kind: 'make';
      label: string;
      busy: boolean;
      cost: string;
      make: () => void;
      error: unknown;
      modelName: string;
      /** Why the clips can't be made on this provider, or null when they can. */
      blocked: string | null;
      /** `CostLine`'s last sentence. */
      providerNote: string | undefined;
    }
  /** Nothing to make: no frame is chosen yet, or every chosen frame has a clip (some may still render). */
  | { kind: 'edit'; film: number; rendering: number };

export type FilmStepProps = {
  job: StoryboardJob;
  frames: readonly FramePlan[];
  /** Each frame's take (the picked one, else the newest). */
  takes: ReadonlyMap<number, Still>;
  /** Frames chosen for the film. */
  chosen: ReadonlySet<number>;
  clips: readonly Clip[];
  onMade: () => Promise<unknown>;
  onGoToEdit: () => void;
  /** Told the film's next step as it changes, and null when this step goes. */
  onNext?: ((next: FilmNext | null) => void) | undefined;
  /** The page's footer offers the next step, so this section doesn't repeat it. */
  actionInFooter?: boolean | undefined;
};

/** How long the batch waits for a card to show how its director call went before it moves on. */
const REPORT_WAIT_MS = 5000;

/**
 * A storyboard's batch (directing or making). The page drops this step on
 * every hop between boards while the batch's loop runs on, so the claim and
 * what the loop is doing live out here, by job: a step that comes back shows
 * the batch busy and can't start a second one.
 */
type FilmBatch = {
  /** Claimed from the press until the batch's last frame is done. */
  running: boolean;
  /** The frame whose clip is being started. */
  making: number | null;
  /** The frame whose director call the batch is sending. */
  directing: number | null;
  /** The frames the batch makes or directs, for its "N of M" count. */
  images: readonly number[];
  errors: Record<number, unknown>;
  error: unknown;
  /** Whose refusal stopped the batch: the shot director's or the video model's. */
  from: 'direct' | 'make';
};

const NO_BATCH: FilmBatch = { running: false, making: null, directing: null, images: [], errors: {}, error: null, from: 'make' };
const filmBatches = new Map<string, FilmBatch>();
const batchListeners = new Set<() => void>();

const readBatch = (jobId: string) => filmBatches.get(jobId) ?? NO_BATCH;

function updateBatch(jobId: string, patch: Partial<FilmBatch>) {
  filmBatches.set(jobId, { ...readBatch(jobId), ...patch });
  for (const listener of batchListeners) listener();
}

function subscribeBatches(onChange: () => void): () => void {
  batchListeners.add(onChange);
  return () => batchListeners.delete(onChange);
}

/** Claim the job's batch; false when one is already running. */
function claimBatch(jobId: string): boolean {
  if (readBatch(jobId).running) return false;
  updateBatch(jobId, { running: true });
  return true;
}

/** What a card's shot director tells the step; each card reports after every render. */
type ShotReport = {
  /** Directing is on and this frame has no fresh plan yet. */
  needsPlan: boolean;
  /** Its director call is being sent or polled. */
  planning: boolean;
  /** Why its last director call could not be sent. */
  planError: unknown;
  /** The plan its clip is made with: set only with directing on and a fresh plan. */
  sendable: ShotPlanRaw | undefined;
  /** The plan's camera move, once the frame is directed. */
  move: MotionId | undefined;
  direct: () => Promise<void>;
};

/** The part of a report the step's labels read, kept in state so a change shows. */
type ShotView = Pick<ShotReport, 'needsPlan' | 'planning' | 'move'>;

function errorCode(e: unknown): string | undefined {
  return (e as { data?: { code?: string } } | null)?.data?.code;
}

/** Step two of the Director tab: the chosen frames, shot as clips in story order. */
export function FilmStep({ job, frames, takes, chosen, clips, onMade, onGoToEdit, onNext, actionInFooter = false }: FilmStepProps) {
  const utils = trpc.useUtils();
  // This section's button and the page's footer both start a batch (directing
  // or making); a double-click on either starts one.
  const filmBatch = useSyncExternalStore(subscribeBatches, () => readBatch(job.id));
  const { running: busy, making, directing, images: batch, errors, error: batchError, from: batchFrom } = filmBatch;
  const [s, setS] = useFilmSettings(job.id);
  /** The card whose plan is open; one at a time. */
  const [editing, setEditing] = useState<number | null>(null);
  const set = (patch: Partial<FilmSettings>) => setS((prev) => ({ ...prev, ...patch }));

  // Each card owns its frame's shot director (FilmFrameRow) and reports it
  // here: the batch reads the latest report from the ref, the labels from
  // `shots`, which changes only when what they read does.
  const reports = useRef(new Map<number, ShotReport & { seq: number }>());
  const reportSeq = useRef(0);
  const reportWaiters = useRef(new Set<() => void>());
  const [shots, setShots] = useState<Record<number, ShotView>>({});
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const onReport = useCallback((image: number, r: ShotReport | null) => {
    if (r) reports.current.set(image, { ...r, seq: ++reportSeq.current });
    else reports.current.delete(image);
    for (const wake of [...reportWaiters.current]) wake();
    setShots((prev) => {
      const was = prev[image];
      if (!r) return was ? Object.fromEntries(Object.entries(prev).filter(([k]) => Number(k) !== image)) : prev;
      if (was && was.needsPlan === r.needsPlan && was.planning === r.planning && was.move === r.move) return prev;
      return { ...prev, [image]: { needsPlan: r.needsPlan, planning: r.planning, move: r.move } };
    });
  }, []);
  /** Resolves once a card's report passes `done` (or the card is gone), or after `ms`. */
  const waitForReport = (image: number, done: (r: ShotReport & { seq: number }) => boolean, ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(finish, ms);
      function finish() {
        clearTimeout(timer);
        reportWaiters.current.delete(check);
        resolve();
      }
      function check() {
        const r = reports.current.get(image);
        if (!r || done(r)) finish();
      }
      reportWaiters.current.add(check);
      check();
    });

  const clipById = useMemo(() => new Map(clips.map((c) => [c.id, c])), [clips]);
  /** Each frame's newest clip of its current take that is still in the
   * library; a reshoot or a new pick needs a new clip. */
  const clipFor = useMemo(() => {
    const out = new Map<number, Clip>();
    for (const c of job.clips ?? []) {
      if (out.has(c.image)) continue;
      const clip = clipById.get(c.clipId);
      if (clip && clip.stillId === takes.get(c.image)?.id) out.set(c.image, clip);
    }
    return out;
  }, [job.clips, clipById, takes]);

  const ordered = frames.map((f, i) => ({ frame: f, order: i + 1 }));
  const film = ordered.filter(({ frame }) => chosen.has(frame.image) && takes.get(frame.image)?.status === 'succeeded');
  const durations = videoDurations(s.videoModel);
  const resolutions = videoResolutions(s.videoModel);
  const resolution = resolutions.some((r) => r.id === s.resolution) ? s.resolution : defaultVideoResolution(s.videoModel);
  const { allowedVideo, modelBlocked, onBay, providerNote } = useCapabilities();
  const blocked = modelBlocked('video', s.videoModel);
  const note = providerNote(s.videoModel);
  const seconds = snapVideoSeconds(s.videoModel, s.seconds);
  const moveOf = (frame: FramePlan, order: number) => s.moves[frame.image] ?? suggestedMove(frame, order, frames.length);
  /** The camera a frame's clip moves with: its plan's once directed, else its preset. */
  const cameraOf = (frame: FramePlan, order: number) => (s.direct ? shots[frame.image]?.move : undefined) ?? moveOf(frame, order);
  const madeAny = film.some(({ frame }) => clipFor.has(frame.image));
  const rendering = film.filter(({ frame }) => clipFor.get(frame.image)?.status === 'pending').length;
  const missing = film.filter(({ frame }) => {
    const c = clipFor.get(frame.image);
    return !c || c.status === 'failed';
  });
  // With directing on, each clip to make is directed first (a text call each).
  const toDirect = s.direct ? missing.filter(({ frame }) => shots[frame.image]?.needsPlan ?? true) : [];
  const planningNow = s.direct ? missing.filter(({ frame }) => shots[frame.image]?.planning).length : 0;
  const working = busy || planningNow > 0;

  /**
   * Direct the frames that have no fresh plan, one call at a time. Each is
   * one text call; no video is billed. A sign-in or plan refusal stops the
   * run (the next frame would be refused the same way) and shows once, under
   * the button; each plan comes back on its card.
   */
  async function direct(list: typeof film) {
    if (!claimBatch(job.id)) return;
    try {
      const todo = list.filter(({ frame }) => {
        const r = reports.current.get(frame.image);
        return r?.needsPlan && !r.planning;
      });
      updateBatch(job.id, { error: null, images: todo.map(({ frame }) => frame.image) });
      for (const { frame } of todo) {
        const r = reports.current.get(frame.image);
        if (!r?.needsPlan || r.planning) continue;
        updateBatch(job.id, { directing: frame.image });
        await r.direct();
        // Every render from here on shows how the call went: planning, or why it was refused.
        const since = reportSeq.current;
        rerender();
        await waitForReport(frame.image, (x) => x.seq > since, REPORT_WAIT_MS);
        const refused = reports.current.get(frame.image)?.planError;
        const code = errorCode(refused);
        if (code === 'FORBIDDEN' || code === 'UNAUTHORIZED') {
          updateBatch(job.id, { error: refused, from: 'direct' });
          break;
        }
      }
    } finally {
      updateBatch(job.id, { running: false, directing: null });
    }
  }

  async function make(list: typeof film) {
    if (!claimBatch(job.id)) return;
    try {
      updateBatch(job.id, { error: null, images: list.map(({ frame }) => frame.image) });
      // Each frame's plan as the press found it: a card goes with its report on
      // a hop, and the rest of the batch still sends what was directed.
      const plans = new Map<number, ShotPlanRaw | undefined>();
      for (const { frame } of list) plans.set(frame.image, s.direct ? reports.current.get(frame.image)?.sendable : undefined);
      for (const { frame, order } of list) {
        const take = takes.get(frame.image);
        if (!take) continue;
        updateBatch(job.id, { making: frame.image, errors: { ...readBatch(job.id).errors, [frame.image]: undefined } });
        try {
          const move = moveOf(frame, order);
          // A directed frame sends its plan; the server resolves it again for this clip.
          const shot = plans.get(frame.image);
          const { id } = await utils.client.createVideo.mutate({
            stillId: take.id,
            videoModel: s.videoModel,
            resolution,
            motion: move,
            moveStyle: s.moveStyle,
            speed: s.speed,
            seconds,
            direction: s.direction,
            onlyInImage: s.onlyInImage,
            archviz: s.archviz,
            ...(shot ? { shot } : {}),
          });
          await utils.client.storyboard.recordClip.mutate({ id: job.id, image: frame.image, clipId: id });
          await onMade();
        } catch (error) {
          // Out of credits, a plan refusal or a sign-in stops the run (the next
          // frame would fail the same way) and shows once, under the button.
          const code = (error as { data?: { code?: string } } | null)?.data?.code;
          if (code === 'FORBIDDEN' || code === 'UNAUTHORIZED') {
            updateBatch(job.id, { error, from: 'make' });
            break;
          }
          updateBatch(job.id, { errors: { ...readBatch(job.id).errors, [frame.image]: error } });
        }
      }
    } finally {
      updateBatch(job.id, { running: false, making: null });
    }
  }

  /** The batch's next press: direct the frames that still need a plan, else make the clips. */
  function advance(list: typeof film) {
    if (blocked) return;
    if (s.direct && list.some(({ frame }) => shots[frame.image]?.needsPlan ?? true)) void direct(list);
    else void make(list);
  }

  const makeLabel =
    making !== null
      ? `Starting clip ${batch.indexOf(making) + 1} of ${batch.length}…`
      : directing !== null
        ? `Directing shot ${batch.indexOf(directing) + 1} of ${batch.length}…`
        : planningNow > 0
          ? `Directing ${planningNow} shot${planningNow === 1 ? '' : 's'}…`
          : missing.length === 0
            ? 'Every chosen frame has a clip'
            : toDirect.length > 0
              ? `Direct ${toDirect.length} shot${toDirect.length === 1 ? '' : 's'}`
              : missing.length === film.length
                ? `Make ${film.length} clip${film.length === 1 ? '' : 's'}`
                : `Make the other ${missing.length} clip${missing.length === 1 ? '' : 's'}`;
  const directedAll = s.direct && missing.length > 0 && toDirect.length === 0;
  const clipCost = `${film.length} clip${film.length === 1 ? '' : 's'} of ${seconds} seconds with ${videoModelName(s.videoModel)}${directedAll ? ', directed' : ''}. Each costs the same as one on the Video tab${onBay ? ', billed to your own Runway credits' : ''}.`;
  const cost =
    toDirect.length > 0
      ? `${clipCost} Directing is ${toDirect.length} text call${toDirect.length === 1 ? '' : 's'}; clips are billed only when you make them.`
      : clipCost;
  const batchModel = batchFrom === 'direct' ? 'the shot director' : videoModelName(s.videoModel);
  const offersMake = film.length > 0 && (busy || missing.length > 0);
  const makeMissing = useRef(() => {});
  makeMissing.current = () => advance(missing);
  // Before paint, so the footer never shows a step this section has moved past.
  useLayoutEffect(() => {
    onNext?.(
      offersMake
        ? {
            kind: 'make',
            label: makeLabel,
            busy: working,
            cost,
            make: () => makeMissing.current(),
            error: batchError,
            modelName: batchModel,
            blocked,
            providerNote: note,
          }
        : { kind: 'edit', film: film.length, rendering }
    );
  }, [onNext, offersMake, makeLabel, working, cost, batchError, batchModel, blocked, note, film.length, rendering]);
  useLayoutEffect(() => () => onNext?.(null), [onNext]);

  const secondsOptions = durations.map((n) => ({ id: String(n), name: `${n} seconds` }));
  const anyTravel = film.some(({ frame, order }) => {
    const m = cameraOf(frame, order);
    return m !== 'still-life' && m !== 'focus-pull';
  });

  // A section of the inspector; its layout follows its own width (the film class), not the window's.
  return (
    <Section
      title="The sequence"
      description="Each shot was planned first, its still was shot to open that way, and its clip follows the same plan."
    >
      <div className={own.film}>
        {film.length === 0 ? (
          <div className={own.filmEmpty}>
            <Text as="p" className={own.filmEmptyTitle}>
              Choose the frames for your film
            </Text>
            <Text tone="muted" size="sm" as="p">
              {chosen.size > 0
                ? 'The frames you chose are not shot yet. Shoot them, then come back here.'
                : 'Press Use in film on each shot frame you want, or Choose all shot frames above. They become clips here.'}
            </Text>
          </div>
        ) : (
          <div className={own.filmGrid}>
            <div className={own.filmControls}>
              <div className={own.filmRow}>
                <Select
                  label="Video model"
                  options={allowedVideo(ANIMATE_VIDEO_MODELS)}
                  value={s.videoModel}
                  onChange={(id) => {
                    const m = id as VideoModelId;
                    set({ videoModel: m, resolution: defaultVideoResolution(m), seconds: snapVideoSeconds(m, s.seconds) });
                  }}
                  disabled={busy}
                />
                <Select
                  label="Resolution"
                  options={resolutions}
                  value={resolution}
                  onChange={(r) => set({ resolution: r })}
                  disabled={busy || resolutions.length < 2}
                  showHint={false}
                />
              </div>
              {blocked && <ModelUnavailable message={blocked} />}
              <div className={own.filmRow}>
                <Select
                  label="Movement style"
                  options={MOVE_STYLES}
                  value={s.moveStyle}
                  onChange={(id) => set({ moveStyle: id as MoveStyleId })}
                  disabled={busy}
                />
                <Select
                  label="Speed"
                  options={SPEEDS}
                  value={s.speed}
                  onChange={(id) => set({ speed: id as SpeedId })}
                  disabled={busy || !anyTravel}
                />
              </div>
              <Select
                label="Clip length"
                options={secondsOptions}
                value={String(seconds)}
                onChange={(id) => set({ seconds: Number(id) })}
                disabled={busy || durations.length < 2}
                showHint={false}
              />
              <Switch
                label="Architectural film style"
                hint={
                  s.archviz
                    ? 'True verticals, a level horizon and one smooth motion-control move, like a luxury property film.'
                    : 'Off: the clips move like the Video tab, without the architectural rules.'
                }
                checked={s.archviz}
                onChange={(archviz) => set({ archviz })}
                disabled={busy}
              />
              <Switch
                label="Only what's in the image"
                hint={
                  s.onlyInImage
                    ? 'Nothing new appears: no added objects, people or places beyond the frame.'
                    : "Off: the model may add or reveal things the image doesn't show."
                }
                checked={s.onlyInImage}
                onChange={(onlyInImage) => set({ onlyInImage })}
                disabled={busy}
              />
              <TextArea
                label="Direction for every clip (optional)"
                value={s.direction}
                onChange={(direction) => set({ direction })}
                rows={2}
                maxLength={DIRECTION_MAX}
                disabled={busy}
                placeholder="e.g. leaves stir in a light breeze, water ripples softly"
              />
              <div className={own.filmAction}>
                {!actionInFooter && (
                  <BlockedTip message={blocked}>
                    <Button
                      variant="primary"
                      size="lg"
                      className={own.filmMake}
                      icon={toDirect.length > 0 ? <ScanEye size={16} /> : <Clapperboard size={16} />}
                      loading={working}
                      disabled={(missing.length === 0 && !busy) || blocked !== null}
                      onPress={() => advance(missing)}
                    >
                      {makeLabel}
                    </Button>
                  </BlockedTip>
                )}
                <Text tone="muted" size="sm" as="p">
                  {cost}
                  {note ? ` ${note}` : ''}
                </Text>
                {/* Once the footer's next step is Edit, it is the way there. */}
                {madeAny && !(actionInFooter && !offersMake) && (
                  <Button icon={<Scissors size={16} />} onPress={onGoToEdit} disabled={rendering > 0}>
                    {rendering > 0 ? `${rendering} clip${rendering === 1 ? ' is' : 's are'} still rendering` : 'Cut them on the Edit tab'}
                  </Button>
                )}
                {/* A batch the footer started shows its refusal there, by its button. */}
                {!(actionInFooter && offersMake) && (
                  <RunwayErrorNotice
                    error={batchError}
                    modelName={batchModel}
                    onRetry={busy ? undefined : () => advance(missing)}
                  />
                )}
              </div>
            </div>

            <ol className={own.clips} aria-label="Clips in story order">
              {film.map(({ frame, order }) => (
                <FilmFrameRow
                  count={ordered.length}
                  key={frame.image}
                  job={job}
                  frame={frame}
                  order={order}
                  take={takes.get(frame.image)!}
                  clip={clipFor.get(frame.image)}
                  settings={s}
                  seconds={seconds}
                  move={moveOf(frame, order)}
                  starting={making === frame.image}
                  busy={busy}
                  error={errors[frame.image]}
                  editing={editing === frame.image}
                  onEditing={setEditing}
                  onMove={(m) => set({ moves: { ...s.moves, [frame.image]: m } })}
                  onDirect={(on) => set({ direct: on })}
                  onMake={() => advance([{ frame, order }])}
                  onReport={onReport}
                />
              ))}
            </ol>
          </div>
        )}
      </div>
    </Section>
  );
}

type FilmFrameRowProps = {
  count: number;
  job: StoryboardJob;
  frame: FramePlan;
  order: number;
  take: Still;
  clip: Clip | undefined;
  settings: FilmSettings;
  seconds: number;
  /** The frame's camera preset: its clip's move undirected, the director's hint directed. */
  move: MotionId;
  /** This frame's clip is being started. */
  starting: boolean;
  /** A batch is running. */
  busy: boolean;
  error: unknown;
  /** This card's plan is open. */
  editing: boolean;
  onEditing: (image: number | null) => void;
  onMove: (move: MotionId) => void;
  /** The film's directing switch, which the plan's own switch also sets. */
  onDirect: (on: boolean) => void;
  /** Make this frame's clip again; directing first when it has no fresh plan. */
  onMake: () => void;
  onReport: (image: number, report: ShotReport | null) => void;
};

/**
 * One frame of the film as a card: its clip (or its still), its camera and,
 * with directing on, its shot director. A component of its own so each frame
 * owns its director hook while frames come and go; it reports to the step
 * after every render.
 */
function FilmFrameRow({
  job,
  frame,
  order,
  count,
  take,
  clip,
  settings: s,
  seconds,
  move,
  starting,
  busy,
  error,
  editing,
  onEditing,
  onMove,
  onDirect,
  onMake,
  onReport,
}: FilmFrameRowProps) {
  const context: ShotContext = {
    videoModel: s.videoModel,
    width: take.width,
    height: take.height,
    people: take.crowd !== 'none',
    userKeyframes: false,
    canEndFrame: videoKeyframeLimit(s.videoModel) >= 2,
  };
  const plan = useShotPlan({
    page: 'director',
    // Per storyboard as well as per frame, so another storyboard's frame never shows this plan.
    slot: `${job.id}:${frame.image}`,
    first: { stillId: take.id },
    videoModel: s.videoModel,
    seconds,
    motion: move,
    direction: [s.direction, plannedShot(frame, job.choices?.[frame.image]), actDirection(order, count)].filter(Boolean).join(' ').slice(0, 600),
    directorStyle: job.directorStyle,
    context,
  });
  // The film's own switch decides, not the Video tab's: a storyboard directs its clips or it doesn't.
  const fresh = plan.state.kind === 'ready' && !plan.stale ? plan.state.raw : undefined;
  const shot: ShotPlan = {
    ...plan,
    enabled: s.direct,
    setEnabled: onDirect,
    needsPlan: s.direct && !fresh,
    sendable: s.direct ? fresh : undefined,
  };
  const resolved = shot.sendable ? plan.resolved : null;
  const plannedMove = resolved?.camera.move;

  useLayoutEffect(() => {
    onReport(frame.image, {
      needsPlan: shot.needsPlan,
      planning: plan.planning,
      planError: plan.planError,
      sendable: shot.sendable,
      move: plannedMove,
      direct: plan.direct,
    });
  });
  useLayoutEffect(() => () => onReport(frame.image, null), [frame.image, onReport]);

  const aspect = `${take.width} / ${take.height}`;
  const kind = plan.state.kind;
  const status = plan.planning
    ? 'Directing the shot…'
    : resolved
      ? shotSummary(resolved)
      : kind === 'ready'
        ? 'The frame, the video model or the clip length changed since this plan. Direct it again.'
        : kind === 'failed'
          ? 'The director could not plan this shot.'
          : 'Not directed yet: the director plans it from this frame before its clip is made.';
  // A refused sign-in or plan shows once, under the batch's button.
  const planErrorCode = errorCode(plan.planError);
  const cardPlanError = planErrorCode === 'FORBIDDEN' || planErrorCode === 'UNAUTHORIZED' ? null : plan.planError;

  return (
    <li className={own.clip}>
      <div className={own.clipFrame} style={{ aspectRatio: aspect }}>
        {starting || clip?.status === 'pending' ? (
          <RenderingStatus label={starting ? 'Starting the clip…' : 'Rendering the clip…'} runKey={clip?.id ?? `${job.id}-${frame.image}`} />
        ) : clip?.status === 'succeeded' ? (
          <video
            key={clip.id}
            className={own.clipVideo}
            src={libraryUrl('clip', clip.id)}
            poster={stillThumbUrl(take.id)}
            preload="none"
            playsInline
            controls
            aria-label={`Clip ${order}: ${frame.title}`}
          />
        ) : (
          <img className={own.clipVideo} src={stillThumbUrl(take.id)} alt={`Film still: ${frame.title}`} loading="lazy" decoding="async" />
        )}
      </div>
      <div className={own.clipBody}>
        <p className={own.clipAct}>{`${ACT_NAMES[actOf(order, count)]} · Shot ${order} of ${count}`}</p>
        <h3 className={own.clipTitle}>
          <span className={own.cardNo}>{order}</span>
          {frame.title}
          {clip?.status === 'succeeded' && <span className={own.clipMeta}>{videoModelName(clip.videoModel)}</span>}
        </h3>
        {/* A directed frame moves as its plan says (the line below, and the plan's own Select when open). */}
        {!resolved && (
          <Select
            label="Camera move"
            options={MOTIONS}
            value={move}
            onChange={(id) => onMove(id as MotionId)}
            disabled={busy}
          />
        )}
        {s.direct && (
          <div className={own.clipShot}>
            {!editing && (
              <div role="status" aria-live="polite">
                <Text tone={resolved ? 'secondary' : 'muted'} size="sm" as="p" className={own.clipShotLine}>
                  {status}
                </Text>
              </div>
            )}
            {(editing || ((kind === 'ready' || kind === 'failed') && !plan.planning)) && (
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<SlidersHorizontal size={14} />}
                  onPress={() => onEditing(editing ? null : frame.image)}
                >
                  {editing ? 'Hide the direction' : 'Edit the direction'}
                </Button>
              </div>
            )}
            {editing && <ShotDirector shot={shot} context={context} seconds={seconds} disabled={busy} />}
            {!editing && !plan.planning && (
              <RunwayErrorNotice error={cardPlanError} modelName="the shot director" onRetry={() => void plan.direct()} />
            )}
          </div>
        )}
        {clip?.status === 'failed' && !starting && (
          <Alert tone="error" title="This clip didn't render">
            {clip.error ?? 'Make it again.'}
          </Alert>
        )}
        {clip?.status === 'succeeded' && (
          <div className={own.cardActions}>
            {shot.needsPlan ? (
              <Button size="sm" variant="ghost" icon={<ScanEye size={14} />} onPress={onMake} disabled={busy || plan.planning}>
                Direct the shot
              </Button>
            ) : (
              <Button size="sm" variant="ghost" icon={<Film size={14} />} onPress={onMake} disabled={busy}>
                Make again
              </Button>
            )}
          </div>
        )}
        <RunwayErrorNotice error={error} modelName={videoModelName(s.videoModel)} onRetry={busy ? undefined : onMake} />
      </div>
    </li>
  );
}
