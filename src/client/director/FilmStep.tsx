import { Clapperboard, Film, Scissors } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { Clip, Still } from '../../api.ts';
import {
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
  type VideoModelId,
  videoModelName,
  videoResolutions,
} from '../../models.ts';
import type { FramePlan, StoryboardJob } from '../../storyboard-api.ts';
import { Section } from '../layouts/Section.tsx';
import { libraryUrl, stillThumbUrl } from '../lib/download.ts';
import { trpc } from '../trpc.ts';
import { Alert } from '../ui/Alert.tsx';
import { Button } from '../ui/Button.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
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
};

/** Step two of the Director tab: the chosen frames, shot as clips in story order. */
export function FilmStep({ job, frames, takes, chosen, clips, onMade, onGoToEdit }: FilmStepProps) {
  const utils = trpc.useUtils();
  const [s, setS] = useFilmSettings(job.id);
  const [making, setMaking] = useState<number | null>(null);
  /** The frames the running batch makes, for its "clip N of M" count. */
  const [batch, setBatch] = useState<readonly number[]>([]);
  const [errors, setErrors] = useState<Record<number, unknown>>({});
  const [batchError, setBatchError] = useState<unknown>(null);
  const set = (patch: Partial<FilmSettings>) => setS((prev) => ({ ...prev, ...patch }));

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
  const seconds = snapVideoSeconds(s.videoModel, s.seconds);
  const moveOf = (frame: FramePlan, order: number) => s.moves[frame.image] ?? suggestedMove(frame, order, frames.length);
  const busy = making !== null;
  const madeAny = film.some(({ frame }) => clipFor.has(frame.image));
  const rendering = film.filter(({ frame }) => clipFor.get(frame.image)?.status === 'pending').length;
  const missing = film.filter(({ frame }) => {
    const c = clipFor.get(frame.image);
    return !c || c.status === 'failed';
  });

  async function make(list: typeof film) {
    setBatchError(null);
    setBatch(list.map(({ frame }) => frame.image));
    for (const { frame, order } of list) {
      const take = takes.get(frame.image);
      if (!take) continue;
      setMaking(frame.image);
      setErrors((e) => ({ ...e, [frame.image]: undefined }));
      try {
        const move = moveOf(frame, order);
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
        });
        await utils.client.storyboard.recordClip.mutate({ id: job.id, image: frame.image, clipId: id });
        await onMade();
      } catch (error) {
        // Out of credits, a plan refusal or a sign-in stops the run (the next
        // frame would fail the same way) and shows once, under the button.
        const code = (error as { data?: { code?: string } } | null)?.data?.code;
        if (code === 'FORBIDDEN' || code === 'UNAUTHORIZED') {
          setBatchError(error);
          break;
        }
        setErrors((e) => ({ ...e, [frame.image]: error }));
      }
    }
    setMaking(null);
  }

  const secondsOptions = durations.map((n) => ({ id: String(n), name: `${n} seconds` }));
  const anyTravel = film.some(({ frame, order }) => {
    const m = moveOf(frame, order);
    return m !== 'still-life' && m !== 'focus-pull';
  });

  return (
    <div className={own.film}>
      <Section
        title="Make the film"
        description="Each frame you chose becomes one clip, in story order, with the same camera presets as the Video tab."
      >
        {film.length === 0 ? (
          <EmptyState
            title="Choose the frames for your film"
            hint={
              chosen.size > 0
                ? 'The frames you chose are not shot yet. Shoot them, then come back here.'
                : 'Press Use in film on each shot frame you want, or Choose all shot frames above. They become clips here.'
            }
          />
        ) : (
          <div className={own.filmGrid}>
            <div className={own.filmControls}>
              <div className={own.filmRow}>
                <Select
                  label="Video model"
                  options={VIDEO_MODELS}
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
                <Button
                  variant="primary"
                  icon={<Clapperboard size={16} />}
                  loading={busy}
                  disabled={missing.length === 0 && !busy}
                  onPress={() => void make(missing)}
                >
                  {busy
                    ? `Starting clip ${batch.indexOf(making ?? -1) + 1} of ${batch.length}…`
                    : missing.length === 0
                      ? 'Every chosen frame has a clip'
                      : missing.length === film.length
                        ? `Make ${film.length} clip${film.length === 1 ? '' : 's'}`
                        : `Make the other ${missing.length} clip${missing.length === 1 ? '' : 's'}`}
                </Button>
                <Text tone="muted" size="sm" as="p">
                  {film.length} clip{film.length === 1 ? '' : 's'} of {seconds} seconds with {videoModelName(s.videoModel)}.
                  Each costs the same as one on the Video tab, billed to your own Runway credits.
                </Text>
                {madeAny && (
                  <Button icon={<Scissors size={16} />} onPress={onGoToEdit} disabled={rendering > 0}>
                    {rendering > 0 ? `${rendering} clip${rendering === 1 ? ' is' : 's are'} still rendering` : 'Cut them on the Edit tab'}
                  </Button>
                )}
                <RunwayErrorNotice
                  error={batchError}
                  modelName={videoModelName(s.videoModel)}
                  onRetry={busy ? undefined : () => void make(missing)}
                />
              </div>
            </div>

            <ol className={own.clips} aria-label="Clips in story order">
              {film.map(({ frame, order }) => {
                const take = takes.get(frame.image)!;
                const clip = clipFor.get(frame.image);
                const aspect = `${take.width} / ${take.height}`;
                const starting = making === frame.image;
                return (
                  <li key={frame.image} className={own.clip}>
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
                    <h3 className={own.clipTitle}>
                      <span className={own.cardNo}>{order}</span>
                      {frame.title}
                      {clip?.status === 'succeeded' && <span className={own.clipMeta}>{videoModelName(clip.videoModel)}</span>}
                    </h3>
                    <Select
                      label="Camera move"
                      options={MOTIONS}
                      value={moveOf(frame, order)}
                      onChange={(id) => set({ moves: { ...s.moves, [frame.image]: id as MotionId } })}
                      disabled={busy}
                    />
                    {clip?.status === 'failed' && !starting && (
                      <Alert tone="error" title="This clip didn't render">
                        {clip.error ?? 'Make it again.'}
                      </Alert>
                    )}
                    {clip?.status === 'succeeded' && (
                      <div className={own.cardActions}>
                        <Button size="sm" variant="ghost" icon={<Film size={14} />} onPress={() => void make([{ frame, order }])} disabled={busy}>
                          Make again
                        </Button>
                      </div>
                    )}
                    <RunwayErrorNotice
                      error={errors[frame.image]}
                      modelName={videoModelName(s.videoModel)}
                      onRetry={busy ? undefined : () => void make([{ frame, order }])}
                    />
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </Section>
    </div>
  );
}
