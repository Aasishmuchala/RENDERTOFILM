import { CircleCheck, Clapperboard, Download, Expand, Image as ImageIcon, Projector, RotateCcw, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Still } from '../api.ts';
import {
  defaultImageResolution,
  IMAGE_MODELS,
  imageModelName,
  imageResolutions,
  type ImageModelId,
} from '../models.ts';
import type { FrameChoice, FramePlan, StoryboardJob } from '../storyboard-api.ts';
import { MAX_STORYBOARD_IMAGES, STORYLINES, type StorylineId, storylineName } from '../storyboard.ts';
import { FilmStep } from './director/FilmStep.tsx';
import { FrameControls } from './director/FrameControls.tsx';
import { FrameViewer } from './director/FrameViewer.tsx';
import { slugify } from './director/shared.ts';
import { TakeImage } from './director/TakeImage.tsx';
import { Section } from './layouts/Section.tsx';
import { libraryUrl, useDownload } from './lib/download.ts';
import { classifyRunwayError } from './lib/runwayErrors.ts';
import { isUploadFailure, uploadRender } from './lib/uploadRender.ts';
import { trpc } from './trpc.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { EmptyState } from './ui/EmptyState.tsx';
import { ImageDropZone } from './ui/ImageDropZone.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { RenderingStatus } from './ui/RenderingStatus.tsx';
import { RunwayErrorNotice } from './ui/RunwayErrorNotice.tsx';
import { Select } from './ui/Select.tsx';
import { Text } from './ui/Text.tsx';
import { TextArea } from './ui/TextArea.tsx';
import { ToggleButton } from './ui/ToggleButton.tsx';
import own from './DirectorPage.module.css';
import styles from './Studio.module.css';

const STORY_MAX = 1500;
const UPLOADS_AT_ONCE = 3;

type Upload = {
  key: string;
  src: string;
  name: string;
  width: number;
  height: number;
  hostedUrl?: string | undefined;
  error?: unknown;
};

type SaveState = 'saving' | 'saved' | { error: unknown };

export type DirectorPageProps = {
  /** Whether this tab is on screen; a hidden tab polls slowly and skips the library. */
  active: boolean;
  /** Animate a finished frame on the Video tab. */
  onAnimate: (stillId: string) => void;
  /** Cut the film's clips on the Edit tab. */
  onGoToEdit: () => void;
};

function uploadErrorFrom(e: unknown): unknown {
  // The route's body, so a sign-in or consent refusal shows its prompt.
  if (isUploadFailure(e)) {
    const kind = classifyRunwayError(e.body);
    return kind.signIn || kind.consent ? e.body : { message: e.message };
  }
  return e instanceof Error ? e : { message: 'The image could not be uploaded. Try again.' };
}

export function DirectorPage({ active, onAnimate, onGoToEdit }: DirectorPageProps) {
  const utils = trpc.useUtils();
  // A take or clip rendering, or one the board knows of that the library
  // hasn't caught up with yet, keeps the library fresh.
  const boardWaiting = useRef(false);
  const library = trpc.library.useQuery(undefined, {
    refetchInterval: (q) =>
      active &&
      (boardWaiting.current ||
        q.state.data?.stills.some((s) => s.status === 'pending') ||
        q.state.data?.clips.some((c) => c.status === 'pending'))
        ? 8_000
        : false,
  });

  const [uploads, setUploads] = useState<Upload[]>([]);
  const [overflow, setOverflow] = useState(0);
  const [storyline, setStoryline] = useState<StorylineId>('day-in-the-life');
  const [story, setStory] = useState('');
  const [imageModel, setImageModel] = useState<ImageModelId>('nano-banana-pro');
  const [resolution, setResolution] = useState(defaultImageResolution('nano-banana-pro'));
  const [jobId, setJobId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);

  const plan = trpc.storyboard.plan.useMutation();
  // With no plan made here yet, this is the newest one, so a reload picks up where it was.
  const job = trpc.storyboard.job.useQuery(jobId ? { id: jobId } : {}, {
    refetchInterval: (q) => (q.state.data?.status === 'planning' ? (active ? 4000 : 15_000) : false),
    refetchOnWindowFocus: false,
    retry: 2,
  });
  const current = job.data ?? null;

  // ---- Project images: each uploads as soon as it is added, a few at a time.
  const queue = useRef<{ key: string; file: File }[]>([]);
  const running = useRef(0);
  const pump = useCallback(() => {
    while (running.current < UPLOADS_AT_ONCE && queue.current.length > 0) {
      const next = queue.current.shift()!;
      running.current += 1;
      uploadRender(next.file)
        .then((hostedUrl) => setUploads((list) => list.map((u) => (u.key === next.key ? { ...u, hostedUrl } : u))))
        .catch((e: unknown) =>
          setUploads((list) => list.map((u) => (u.key === next.key ? { ...u, error: uploadErrorFrom(e) } : u)))
        )
        .finally(() => {
          running.current -= 1;
          pump();
        });
    }
  }, []);

  const filesRef = useRef(new Map<string, File>());
  // Images kept or on their way in, counted at once so two quick drops can't
  // both take the same free room.
  const taken = useRef(0);
  async function addFiles(files: File[]) {
    const room = Math.max(0, MAX_STORYBOARD_IMAGES - taken.current);
    setOverflow(Math.max(0, files.length - room));
    const accepted = files.slice(0, room);
    taken.current += accepted.length;
    const added: Upload[] = [];
    for (const file of accepted) {
      const src = URL.createObjectURL(file);
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        const bitmap = await createImageBitmap(file);
        added.push({ key, src, name: file.name, width: bitmap.width, height: bitmap.height });
        bitmap.close();
        filesRef.current.set(key, file);
        queue.current.push({ key, file });
      } catch {
        added.push({
          key,
          src,
          name: file.name,
          width: 16,
          height: 9,
          error: { message: 'This file could not be read as an image. Try a PNG, JPEG or WebP.' },
        });
      }
    }
    setUploads((list) => [...list, ...added].slice(0, MAX_STORYBOARD_IMAGES));
    pump();
  }

  function removeUpload(key: string) {
    if (uploads.some((u) => u.key === key)) taken.current = Math.max(0, taken.current - 1);
    queue.current = queue.current.filter((q) => q.key !== key);
    filesRef.current.delete(key);
    setUploads((list) => {
      const gone = list.find((u) => u.key === key);
      if (gone) URL.revokeObjectURL(gone.src);
      return list.filter((u) => u.key !== key);
    });
    setOverflow(0);
  }

  function retryUpload(key: string) {
    const file = filesRef.current.get(key);
    if (!file) return;
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, error: undefined } : u)));
    queue.current.push({ key, file });
    pump();
  }

  const pendingUploads = uploads.filter((u) => !u.hostedUrl && !u.error).length;
  const failedUploads = uploads.filter((u) => u.error).length;
  // Until the new plan's first poll lands there is no job to show, and the
  // button must not start (and bill) a second plan meanwhile.
  const planning = plan.isPending || (jobId !== null && job.isPending) || current?.status === 'planning';
  const storyTooLong = story.length > STORY_MAX;
  const ready = uploads.length > 0 && pendingUploads === 0 && failedUploads === 0 && !storyTooLong;

  async function runPlan() {
    if (!ready || planning) return;
    try {
      const { id } = await plan.mutateAsync({
        images: uploads.map((u) => ({ url: u.hostedUrl!, width: u.width, height: u.height, name: u.name })),
        storyline,
        story,
        imageModel,
        resolution,
      });
      setJobId(id);
      void utils.storyboard.job.invalidate();
    } catch {
      // Shown by RunwayErrorNotice from plan.error.
    }
  }

  // ---- The board: the person's picks per frame, saved as they change them.
  const [drafts, setDrafts] = useState<Record<number, FrameChoice>>({});
  const [saves, setSaves] = useState<Record<number, SaveState>>({});
  const [shooting, setShooting] = useState<Record<number, boolean>>({});
  const [shootErrors, setShootErrors] = useState<Record<number, unknown>>({});
  const boardId = current?.status === 'planned' ? current.id : undefined;
  const loadedBoard = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!boardId || loadedBoard.current === boardId || !current) return;
    loadedBoard.current = boardId;
    const initial: Record<number, FrameChoice> = {};
    for (const [k, v] of Object.entries(current.choices ?? {})) initial[Number(k)] = v;
    setDrafts(initial);
    setSaves({});
    setShooting({});
    setShootErrors({});
  }, [boardId, current]);

  const noteTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  // One frame's saves go one after another, so a quick run of changes is
  // stored in the order it was made.
  const saveChains = useRef(new Map<number, Promise<unknown>>());
  const save = useCallback(
    (id: string, image: number, patch: FrameChoice) => {
      setSaves((s) => ({ ...s, [image]: 'saving' }));
      const chains = saveChains.current;
      const next = (chains.get(image) ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => utils.client.storyboard.choose.mutate({ id, image, ...patch }))
        .then(() => {
          if (chains.get(image) === next) setSaves((s) => ({ ...s, [image]: 'saved' }));
        })
        .catch((error: unknown) => setSaves((s) => ({ ...s, [image]: { error } })));
      chains.set(image, next);
    },
    [utils]
  );
  const onChoose = useCallback(
    (image: number, patch: FrameChoice) => {
      if (!boardId) return;
      setDrafts((d) => ({ ...d, [image]: { ...d[image], ...patch } }));
      const timers = noteTimers.current;
      if (patch.note !== undefined) {
        clearTimeout(timers.get(image));
        setSaves((s) => ({ ...s, [image]: 'saving' }));
        timers.set(
          image,
          setTimeout(() => {
            timers.delete(image);
            save(boardId, image, patch);
          }, 800)
        );
      } else {
        save(boardId, image, patch);
      }
    },
    [boardId, save]
  );

  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const refetchJob = job.refetch;
  const shoot = useCallback(
    async (image: number) => {
      if (!boardId) return;
      // A note still waiting to save rides along with the shoot instead.
      const noteWaiting = noteTimers.current.has(image);
      clearTimeout(noteTimers.current.get(image));
      noteTimers.current.delete(image);
      setShooting((s) => ({ ...s, [image]: true }));
      setShootErrors((e) => ({ ...e, [image]: undefined }));
      try {
        // The current picks ride along, so a change a moment ago is never lost.
        await utils.client.storyboard.shoot.mutate({ id: boardId, image, ...draftsRef.current[image], take: undefined });
        // The new take is the one the frame uses from now on.
        setDrafts((d) => ({ ...d, [image]: { ...d[image], take: undefined } }));
        if (noteWaiting) setSaves((s) => ({ ...s, [image]: 'saved' }));
        await Promise.all([refetchJob(), utils.library.invalidate()]);
      } catch (error) {
        setShootErrors((e) => ({ ...e, [image]: error }));
        // The shoot didn't go, so the note it carried is saved on its own.
        const note = draftsRef.current[image]?.note;
        if (noteWaiting && note !== undefined) save(boardId, image, { note });
      } finally {
        setShooting((s) => ({ ...s, [image]: false }));
      }
    },
    [boardId, utils, refetchJob, save]
  );

  const stillById = useMemo(() => new Map((library.data?.stills ?? []).map((s) => [s.id, s])), [library.data]);
  /** Every take of each frame that is in the library, newest first. */
  const allTakes = useMemo(() => {
    const out = new Map<number, Still[]>();
    for (const shot of current?.shots ?? []) {
      const still = stillById.get(shot.stillId);
      if (!still) continue;
      out.set(shot.image, [...(out.get(shot.image) ?? []), still]);
    }
    return out;
  }, [current?.shots, stillById]);
  /** Each frame's take: the one picked in the viewer, else the newest. */
  const takes = useMemo(() => {
    const out = new Map<number, Still>();
    for (const [image, list] of allTakes) {
      const picked = drafts[image]?.take;
      const take = (picked ? list.find((s) => s.id === picked && s.status === 'succeeded') : undefined) ?? list[0];
      if (take) out.set(image, take);
    }
    return out;
  }, [allTakes, drafts]);
  // A shot whose take the library doesn't list yet (the server puts lost ones
  // back as it loads the board) waits for the next library refresh.
  const missingTake = (current?.shots ?? []).some((shot) => !allTakes.has(shot.image));
  boardWaiting.current =
    missingTake || Object.values(shooting).some(Boolean) || [...takes.values()].some((t) => t.status === 'pending');
  const frames = current?.status === 'planned' ? (current.plan ?? []) : [];
  const shotFrames = frames.filter((f) => takes.get(f.image)?.status === 'succeeded');
  const chosen = useMemo(
    () => new Set(frames.filter((f) => drafts[f.image]?.selected).map((f) => f.image)),
    [frames, drafts]
  );
  const allChosen = shotFrames.length > 0 && shotFrames.every((f) => chosen.has(f.image));
  const [pickError, setPickError] = useState<unknown>(undefined);
  function chooseAll() {
    if (!boardId) return;
    // Choosing all keeps frames already chosen that are being re-shot.
    const images = allChosen ? [] : [...new Set([...chosen, ...shotFrames.map((f) => f.image)])];
    const set = new Set(images);
    setDrafts((d) => {
      const out = { ...d };
      for (const f of frames) out[f.image] = { ...out[f.image], selected: set.has(f.image) };
      return out;
    });
    setPickError(undefined);
    utils.client.storyboard.pick.mutate({ id: boardId, images }).catch((error: unknown) => setPickError(error));
  }
  const onMade = useCallback(() => Promise.all([refetchJob(), utils.library.invalidate()]), [refetchJob, utils]);
  const unshot = frames.filter((f) => {
    const t = takes.get(f.image);
    return !shooting[f.image] && (!t || t.status === 'failed');
  });
  const [shootingAll, setShootingAll] = useState(false);
  async function shootAll() {
    setShootingAll(true);
    try {
      for (const f of unshot) await shoot(f.image);
    } finally {
      setShootingAll(false);
    }
  }

  const openFrame = useCallback((image: number) => setViewing(image), []);

  return (
    <>
      <div className={styles.layout}>
        <div className={styles.controls}>
          <PageHeader
            title="Direct the film"
            description="Upload every image of the project and pick a story. The app plans each frame's light, camera and people, then shoots them true to what is in your images."
          />
          <Section step={1} title="Project images" description={`Renders or photos of one project, up to ${MAX_STORYBOARD_IMAGES}.`}>
            <div className={styles.stack}>
              <ImageDropZone
                onFiles={(files) => void addFiles(files)}
                disabled={planning || uploads.length >= MAX_STORYBOARD_IMAGES}
                actionLabel={uploads.length ? 'Add images' : 'Choose images'}
              >
                <div className={own.dropEmpty}>
                  <ImageIcon size={20} aria-hidden />
                  <Text tone="secondary" size="sm">
                    {uploads.length >= MAX_STORYBOARD_IMAGES
                      ? `That is the full ${MAX_STORYBOARD_IMAGES}. Remove one to add another.`
                      : 'Drop your project images here, several at once. PNG, JPEG or WebP.'}
                  </Text>
                </div>
              </ImageDropZone>
              {overflow > 0 && (
                <Alert tone="warning" title={`${overflow} image${overflow === 1 ? ' was' : 's were'} left out`}>
                  A storyboard takes up to {MAX_STORYBOARD_IMAGES} images. Remove one to add another.
                </Alert>
              )}
              {uploads.length > 0 && (
                <ul className={own.thumbs} aria-label="Project images">
                  {uploads.map((u) => (
                    <li key={u.key} className={own.thumb}>
                      <img className={own.thumbImg} src={u.src} alt={u.name} data-dimmed={!u.hostedUrl || undefined} />
                      {!u.hostedUrl && !u.error && (
                        <span className={own.thumbState} role="status">
                          Uploading…
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className={own.thumbRemove}
                        icon={<X size={14} />}
                        aria-label={`Remove ${u.name}`}
                        onPress={() => removeUpload(u.key)}
                        disabled={planning}
                      />
                    </li>
                  ))}
                </ul>
              )}
              {uploads
                .filter((u) => u.error)
                .map((u) => (
                  <div key={u.key} className={own.uploadError}>
                    <RunwayErrorNotice
                      error={u.error}
                      modelName={`the upload of ${u.name}`}
                      onRetry={filesRef.current.has(u.key) ? () => retryUpload(u.key) : () => removeUpload(u.key)}
                    />
                  </div>
                ))}
            </div>
          </Section>

          <Section step={2} title="Story" description="The narrative the frames are ordered, lit and peopled for.">
            <div className={styles.stack}>
              <Select
                label="Storyline"
                options={STORYLINES}
                value={storyline}
                onChange={(id) => setStoryline(id as StorylineId)}
                disabled={planning}
              />
              <TextArea
                label="Your story (optional)"
                value={story}
                onChange={setStory}
                rows={3}
                maxLength={STORY_MAX}
                disabled={planning}
                placeholder="e.g. A young family's first weekend at their new villa: arriving Friday evening, a lazy Saturday by the pool, dinner on the terrace"
                onSubmit={() => void runPlan()}
              />
            </div>
          </Section>

          <Section step={3} title="Model" description="Shoots each frame from its image.">
            <div className={styles.selectRow}>
              <Select
                label="Image model"
                options={IMAGE_MODELS}
                value={imageModel}
                onChange={(id) => {
                  const m = id as ImageModelId;
                  setImageModel(m);
                  setResolution(defaultImageResolution(m));
                }}
                disabled={planning}
              />
              {imageResolutions(imageModel).length > 1 && (
                <Select
                  label="Resolution"
                  options={imageResolutions(imageModel)}
                  value={resolution}
                  onChange={setResolution}
                  disabled={planning}
                  showHint={false}
                />
              )}
            </div>
          </Section>

          <div className={styles.actionBar}>
            <Button
              variant="primary"
              className={styles.generate}
              icon={<Projector size={16} />}
              loading={planning}
              disabled={!ready}
              onPress={() => void runPlan()}
            >
              {planning
                ? 'Planning the storyboard…'
                : uploads.length === 0
                  ? 'Add project images first'
                  : pendingUploads > 0
                    ? 'Uploading the images…'
                    : failedUploads > 0
                      ? 'Retry or remove the failed upload'
                      : storyTooLong
                        ? 'Shorten your story first'
                        : `Plan ${uploads.length} frame${uploads.length === 1 ? '' : 's'}`}
            </Button>
            <Text tone="muted" size="sm" as="p" className={styles.meta}>
              Claude plans the storyboard, a few credits for every six images. Nothing is shot until you say so; each
              frame you shoot with {imageModelName(imageModel)} costs the same as a still. Billed to your own Runway
              credits.
            </Text>
            <RunwayErrorNotice error={plan.error} modelName="Claude" onRetry={() => void runPlan()} />
          </div>
        </div>

        <div className={styles.result} data-stage>
          {current?.status === 'planned' ? (
            <Section title={`Storyboard: ${storylineName(current.storyline)}`}>
              <div className={own.boardHead}>
                <Text tone="muted" size="sm" as="p">
                  {frames.length} frame{frames.length === 1 ? '' : 's'} in story order, shot with{' '}
                  {imageModelName(current.imageModel)}. Each list puts the recommended choice first; change any of them
                  before you shoot.
                </Text>
                <div className={own.cardActions}>
                  {shotFrames.length > 0 && (
                    <Button variant="ghost" icon={<CircleCheck size={16} />} onPress={chooseAll}>
                      {allChosen ? 'Clear the film choice' : 'Choose all shot frames'}
                    </Button>
                  )}
                  {unshot.length > 0 && (
                    <Button
                      icon={<Clapperboard size={16} />}
                      loading={shootingAll}
                      onPress={() => void shootAll()}
                    >
                      {shootingAll
                        ? 'Shooting the frames…'
                        : unshot.length === frames.length
                          ? `Shoot all ${frames.length} frames`
                          : `Shoot the other ${unshot.length} frame${unshot.length === 1 ? '' : 's'}`}
                    </Button>
                  )}
                </div>
              </div>
              {current.warning && (
                <div className={own.pollError}>
                  <Alert tone="warning" title="Part of the storyboard wasn't planned">
                    {current.warning}
                  </Alert>
                </div>
              )}
              {pickError !== undefined && (
                <div className={own.pollError}>
                  <RunwayErrorNotice error={pickError} modelName="your storyboard" onRetry={chooseAll} />
                </div>
              )}
              <ol className={own.frames}>
                {frames.map((f, i) => (
                  <FrameCard
                    key={`${current.id}-${f.image}`}
                    order={i + 1}
                    frame={f}
                    job={current}
                    choice={drafts[f.image]}
                    save={saves[f.image]}
                    take={takes.get(f.image)}
                    shooting={Boolean(shooting[f.image])}
                    shootError={shootErrors[f.image]}
                    onChoose={onChoose}
                    onShoot={shoot}
                    onOpen={openFrame}
                    onAnimate={onAnimate}
                  />
                ))}
              </ol>
              <Text tone="muted" size="sm" as="p" className={own.saved}>
                Every frame is saved to your library, tagged @storyboard. Shoot within a day or so of planning: the
                uploaded images are only kept that long.
              </Text>
              <FilmStep
                job={current}
                frames={frames}
                takes={takes}
                chosen={chosen}
                clips={library.data?.clips ?? []}
                onMade={onMade}
                onGoToEdit={onGoToEdit}
              />
            </Section>
          ) : (
            <Section title="Storyboard">
              <div className={styles.resultFrame} style={{ aspectRatio: '16 / 9', ['--ar' as string]: '16 / 9' }}>
                {planning ? (
                  <RenderingStatus
                    label={
                      plan.isPending
                        ? 'Sending the images to Claude…'
                        : `Planning ${current?.images.length ?? uploads.length} frames: order, light, camera and people…`
                    }
                    runKey={current?.id}
                  />
                ) : current?.status === 'failed' ? (
                  <div className={styles.frameAlert}>
                    <Alert tone="error" title="The storyboard wasn't planned">
                      {current.error ?? 'Plan the storyboard again.'}
                    </Alert>
                    <div className={own.retry}>
                      <Button size="sm" icon={<RotateCcw size={14} />} onPress={() => void runPlan()} disabled={!ready}>
                        {ready ? 'Plan again' : 'Add the images again to plan'}
                      </Button>
                    </div>
                  </div>
                ) : job.isLoading ? (
                  <RenderingStatus label="Loading your storyboard…" />
                ) : (
                  <EmptyState
                    title="Your storyboard will appear here"
                    hint="Upload the project's images, pick a storyline, then press Plan. Each frame comes back with a recommended light, camera move and people, ready to shoot."
                  />
                )}
              </div>
            </Section>
          )}
          {job.error && (
            <div className={own.pollError}>
              <RunwayErrorNotice error={job.error} modelName="Claude" onRetry={() => void job.refetch()} />
            </div>
          )}
        </div>
      </div>

      {current?.status === 'planned' && (
        <FrameViewer
          job={current}
          frames={frames}
          image={viewing}
          onImage={setViewing}
          takes={takes}
          allTakes={allTakes}
          drafts={drafts}
          saves={saves}
          shooting={shooting}
          shootErrors={shootErrors}
          onChoose={onChoose}
          onShoot={shoot}
        />
      )}
    </>
  );
}

type FrameCardProps = {
  order: number;
  frame: FramePlan;
  job: StoryboardJob;
  choice: FrameChoice | undefined;
  save: SaveState | undefined;
  take: Still | undefined;
  shooting: boolean;
  shootError: unknown;
  onChoose: (image: number, patch: FrameChoice) => void;
  onShoot: (image: number) => Promise<void>;
  onOpen: (image: number) => void;
  onAnimate: (stillId: string) => void;
};

/** One frame of the storyboard. Memoised, with its own download state, so a
 * poll or one card's download doesn't re-render the others. */
const FrameCard = memo(function FrameCard({
  order,
  frame,
  job,
  choice,
  save,
  take,
  shooting,
  shootError,
  onChoose,
  onShoot,
  onOpen,
  onAnimate,
}: FrameCardProps) {
  const saver = useDownload();
  const [sourceBroken, setSourceBroken] = useState(false);
  const img = job.images[frame.image];
  const aspect = img ? `${img.width} / ${img.height}` : '16 / 9';
  const title = `${order}. ${frame.title}`;
  const rendering = shooting || take?.status === 'pending';
  const done = take?.status === 'succeeded' ? take : undefined;
  const selected = Boolean(choice?.selected);

  return (
    <li className={own.card}>
      <div className={own.cardFrame} style={{ aspectRatio: aspect }} data-chosen={(done && selected) || undefined}>
        {rendering ? (
          <RenderingStatus label={shooting ? 'Starting the take…' : 'Shooting the frame…'} runKey={take?.id ?? `${job.id}-${frame.image}`} />
        ) : done ? (
          <TakeImage
            key={done.id}
            stillId={done.id}
            alt={`Film still: ${frame.title}`}
            className={styles.image}
            onOpen={() => onOpen(frame.image)}
            openLabel={`Open on the big screen: ${title}`}
            openClassName={own.frameButton}
          />
        ) : img && !sourceBroken ? (
          <>
            <img
              className={`${styles.image} ${own.source}`}
              src={img.url}
              alt={`Project image: ${img.name || frame.title}`}
              loading="lazy"
              decoding="async"
              onError={() => setSourceBroken(true)}
            />
            <span className={own.sourceChip}>Your image</span>
          </>
        ) : (
          <div className={styles.frameAlert}>
            <Text tone="muted" size="sm" as="p">
              This uploaded image is no longer kept. Plan a new storyboard to shoot it.
            </Text>
          </div>
        )}
      </div>

      {take?.status === 'failed' && !shooting && (
        <Alert tone="error" title="This frame didn't render">
          {take.error ?? 'Shoot it again.'}
        </Alert>
      )}

      <div className={own.cardText}>
        <h3 className={own.cardTitle}>
          <span className={own.cardNo}>{order}</span>
          {frame.title}
          <span className={own.space}>{frame.space === 'interior' ? 'Interior' : 'Exterior'}</span>
        </h3>
        {frame.beat && (
          <Text tone="secondary" size="sm" as="p">
            {frame.beat}
          </Text>
        )}
      </div>

      <FrameControls frame={frame} choice={choice} disabled={rendering} onChoose={onChoose} onShoot={(i) => void onShoot(i)} />

      <div className={own.cardActions}>
        {done && (
          <ToggleButton selected={selected} onChange={(next) => onChoose(frame.image, { selected: next })}>
            {selected ? 'In the film' : 'Use in film'}
          </ToggleButton>
        )}
        <Button
          size="sm"
          variant={done ? 'default' : 'primary'}
          icon={<Clapperboard size={14} />}
          loading={rendering}
          onPress={() => void onShoot(frame.image)}
        >
          {rendering ? 'Shooting…' : done || take?.status === 'failed' ? 'Shoot again' : 'Shoot this frame'}
        </Button>
        {done && (
          <>
            <Button size="sm" variant="ghost" icon={<Expand size={14} />} onPress={() => onOpen(frame.image)}>
              Compare
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Download size={14} />}
              loading={saver.pending}
              aria-label={saver.pending ? undefined : `Download ${title}`}
              onPress={() => saver.start(libraryUrl('still', done.id), `storyboard-${order}-${slugify(frame.title)}.png`)}
            >
              {saver.label('Download')}
            </Button>
            <Button size="sm" variant="ghost" onPress={() => onAnimate(done.id)}>
              Video tab
            </Button>
          </>
        )}
        <span className={own.saveState} role="status">
          {save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved' : ''}
        </span>
      </div>
      {save && typeof save === 'object' && (
        <RunwayErrorNotice error={save.error} modelName="your storyboard" />
      )}
      <RunwayErrorNotice error={shootError} modelName={imageModelName(job.imageModel)} onRetry={() => void onShoot(frame.image)} />
      {saver.error && (
        <Alert tone="error" title="Download failed">
          {saver.error}
        </Alert>
      )}
    </li>
  );
});
