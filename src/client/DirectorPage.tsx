import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clapperboard,
  Download,
  Expand,
  Film,
  Image as ImageIcon,
  LayoutGrid,
  Projector,
  RectangleHorizontal,
  RotateCcw,
  Scissors,
  X,
} from 'lucide-react';
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
import { directedLine, DirectionStyleSelect, useDirectionStyle } from './director/DirectionStyle.tsx';
import { type FilmNext, FilmStep } from './director/FilmStep.tsx';
import { FrameControls } from './director/FrameControls.tsx';
import { FrameViewer, useImageLoads } from './director/FrameViewer.tsx';
import { slugify } from './director/shared.ts';
import { TakeImage } from './director/TakeImage.tsx';
import { Section } from './layouts/Section.tsx';
import { type CanvasState, Workspace } from './layouts/Workspace.tsx';
import { useAmbient } from './lib/ambient.tsx';
import { libraryUrl, stillThumbUrl, stillViewUrl, useDownload } from './lib/download.ts';
import { classifyRunwayError } from './lib/runwayErrors.ts';
import { useCapabilities } from './lib/useCapabilities.ts';
import { isUploadFailure, uploadRender } from './lib/uploadRender.ts';
import { useInFlight } from './lib/useInFlight.ts';
import { trpc } from './trpc.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { CompareSlider } from './ui/CompareSlider.tsx';
import { CostLine } from './ui/CostLine.tsx';
import { ImageDropZone } from './ui/ImageDropZone.tsx';
import { BlockedTip, ModelUnavailable } from './ui/ModelUnavailable.tsx';
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
const DROP_LABEL = 'Drop or choose project images';

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

/** What the inspector and the canvas are about: the storyboard itself, or one frame (its image index). */
type Selection = 'job' | number;

/** A frame's state as the strip and the contact sheet badge it. */
type FrameState = 'unshot' | 'shooting' | 'shot' | 'failed';

const STATE_LABEL: Record<FrameState, string> = {
  unshot: 'Not shot',
  shooting: 'Shooting',
  shot: 'Shot',
  failed: 'Failed',
};

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

function frameState(take: Still | undefined, shooting: boolean): FrameState {
  if (shooting || take?.status === 'pending') return 'shooting';
  if (take?.status === 'succeeded') return 'shot';
  if (take?.status === 'failed') return 'failed';
  return 'unshot';
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
  const [directorStyle, setDirectorStyle] = useDirectionStyle('director');
  const { allowedImage, modelBlocked, onBay, providerNote } = useCapabilities();
  const [imageModel, setImageModel] = useState<ImageModelId>('nano-banana-pro');
  const blocked = modelBlocked('image', imageModel);
  const [resolution, setResolution] = useState(defaultImageResolution('nano-banana-pro'));
  const [jobId, setJobId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [selected, setSelected] = useState<Selection>('job');
  /** The contact sheet on the canvas while a frame is selected. */
  const [grid, setGrid] = useState(false);

  const plan = trpc.storyboard.plan.useMutation();
  // A double-click's second press arrives before plan.isPending shows, and a
  // second plan would leave an orphan job stuck in "planning".
  const planGuard = useInFlight();
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
    if (!ready || planning || blocked || !planGuard.start()) return;
    try {
      const { id } = await plan.mutateAsync({
        images: uploads.map((u) => ({ url: u.hostedUrl!, width: u.width, height: u.height, name: u.name })),
        storyline,
        story,
        directorStyle,
        imageModel,
        resolution,
      });
      setJobId(id);
      void utils.storyboard.job.invalidate();
    } catch {
      // Shown by RunwayErrorNotice from plan.error.
    } finally {
      planGuard.end();
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
    // A new board opens on its setup and contact sheet.
    setSelected('job');
    setGrid(false);
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

  // ---- The selection: the storyboard, or one frame of it.
  const selIndex = typeof selected === 'number' ? frames.findIndex((f) => f.image === selected) : -1;
  const selFrame = selIndex >= 0 ? frames[selIndex] : undefined;
  const showGrid = current?.status === 'planned' && (!selFrame || grid);
  const selImg = selFrame && current ? current.images[selFrame.image] : undefined;
  const sourceOk = useImageLoads(selImg?.url);
  const selTake = selFrame ? takes.get(selFrame.image) : undefined;
  const selRendering = selFrame ? Boolean(shooting[selFrame.image]) || selTake?.status === 'pending' : false;
  const selDone = selTake?.status === 'succeeded' ? selTake : undefined;
  const selChoice = selFrame ? drafts[selFrame.image] : undefined;
  const selSave = selFrame ? saves[selFrame.image] : undefined;
  const saver = useDownload();
  const selectFrame = useCallback((image: number) => {
    setSelected(image);
    setGrid(false);
  }, []);

  // The room takes the light of the frame on the big screen (the viewer, or
  // the canvas), else of the first project image; a reload (no uploads left)
  // falls back to the first shot frame.
  const onScreen = viewing ?? (selFrame && !showGrid ? selFrame.image : null);
  const viewedTake = onScreen === null ? undefined : takes.get(onScreen);
  const firstShot = shotFrames[0] ? takes.get(shotFrames[0].image) : undefined;
  useAmbient(
    viewedTake?.status === 'succeeded'
      ? stillThumbUrl(viewedTake.id)
      : (uploads[0]?.src ?? (firstShot ? stillThumbUrl(firstShot.id) : null))
  );
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
  // Every frame has its take: the footer moves on to the film.
  const allShot =
    frames.length > 0 &&
    !shootingAll &&
    frames.every((f) => !shooting[f.image] && takes.get(f.image)?.status === 'succeeded');
  /** The film step's next step, which the footer offers once every frame is shot. */
  const [filmNext, setFilmNext] = useState<FilmNext | null>(null);
  async function shootAll() {
    setShootingAll(true);
    try {
      for (const f of unshot) await shoot(f.image);
    } finally {
      setShootingAll(false);
    }
  }

  // The viewer's arrows move the selection with it, so closing it lands on the frame last seen.
  const onViewerImage = useCallback((image: number | null) => {
    setViewing(image);
    if (image !== null) {
      setSelected(image);
      setGrid(false);
    }
  }, []);

  const planLabel = planning
    ? 'Planning the storyboard…'
    : uploads.length === 0
      ? 'Add project images first'
      : pendingUploads > 0
        ? 'Uploading the images…'
        : failedUploads > 0
          ? 'Retry or remove the failed upload'
          : storyTooLong
            ? 'Shorten your story first'
            : `Plan ${uploads.length} frame${uploads.length === 1 ? '' : 's'}`;
  const planned = current?.status === 'planned' ? current : null;
  // A storyboard keeps the model it was planned with, so a provider that hides it stops the shoot.
  const shootBlocked = planned ? modelBlocked('image', planned.imageModel) : null;
  const directed = directedLine(planned?.directorStyle);

  // ---- The canvas.
  let canvasState: CanvasState;
  let canvas: ReactNode = null;
  let aspectRatio: string | undefined = '16 / 9';
  let caption: ReactNode;
  let canvasNote: ReactNode;
  let canvasActions: ReactNode;
  let empty: { title: string; hint: string; action: string; label: string } | undefined;
  if (planned && (showGrid || !selFrame)) {
    canvasState = 'free';
    aspectRatio = undefined;
    canvas = (
      <ol className={own.sheet} aria-label="Storyboard frames">
        {frames.map((f, i) => (
          <SheetCard
            key={`${planned.id}-${f.image}`}
            order={i + 1}
            frame={f}
            job={planned}
            take={takes.get(f.image)}
            shooting={Boolean(shooting[f.image])}
            chosen={chosen.has(f.image)}
            current={selected === f.image}
            onSelect={selectFrame}
          />
        ))}
      </ol>
    );
  } else if (planned && selFrame) {
    const order = selIndex + 1;
    const title = `${order}. ${selFrame.title}`;
    aspectRatio = selDone
      ? `${selDone.width} / ${selDone.height}`
      : selImg
        ? `${selImg.width} / ${selImg.height}`
        : '16 / 9';
    caption = `Frame ${order} of ${frames.length} · ${selFrame.space === 'interior' ? 'Interior' : 'Exterior'} · ${imageModelName(planned.imageModel)}`;
    if (selRendering) {
      canvasState = 'live';
      canvas = (
        <RenderingStatus
          label={shooting[selFrame.image] ? 'Starting the take…' : 'Shooting the frame…'}
          runKey={selTake?.id ?? `${planned.id}-${selFrame.image}`}
        />
      );
    } else if (selDone) {
      canvasState = 'live';
      canvas =
        selImg && sourceOk === true ? (
          <CompareSlider
            key={selDone.id}
            className={own.canvasCompare}
            before={selImg.url}
            after={stillViewUrl(selDone.id)}
            afterFallback={stillThumbUrl(selDone.id)}
            beforeAlt={`Your image: ${selImg.name || selFrame.title}`}
            afterAlt={`Film still: ${selFrame.title}`}
            aspectRatio={aspectRatio}
          />
        ) : (
          <TakeImage key={selDone.id} full stillId={selDone.id} alt={`Film still: ${selFrame.title}`} className={own.canvasImage} />
        );
      canvasActions = (
        <>
          <ToggleButton
            selected={Boolean(selChoice?.selected)}
            onChange={(next) => onChoose(selFrame.image, { selected: next })}
          >
            {selChoice?.selected ? 'In the film' : 'Use in film'}
          </ToggleButton>
          <Button
            size="sm"
            variant="ghost"
            icon={<Download size={14} />}
            loading={saver.pending}
            aria-label={saver.pending ? undefined : `Download ${title}`}
            onPress={() => saver.start(libraryUrl('still', selDone.id), `storyboard-${order}-${slugify(selFrame.title)}.png`)}
          >
            {saver.label('Download')}
          </Button>
          <Button size="sm" variant="ghost" icon={<Film size={14} />} onPress={() => onAnimate(selDone.id)}>
            Animate
          </Button>
        </>
      );
    } else if (selTake?.status === 'failed') {
      canvasState = 'live';
      canvas = (
        <div className={styles.frameAlert}>
          <Alert tone="error" title="This frame didn't render">
            {selTake.error ?? 'Shoot it again.'}
          </Alert>
        </div>
      );
    } else if (selImg && sourceOk !== false) {
      canvasState = 'preview';
      canvas = <img src={selImg.url} alt={`Your image: ${selImg.name || selFrame.title}`} decoding="async" />;
      canvasNote = 'This frame will appear here once shot';
    } else {
      canvasState = 'live';
      canvas = (
        <div className={styles.frameAlert}>
          <Text tone="muted" size="sm" as="p">
            This frame isn't shot yet, and its uploaded image is no longer kept. Plan a new storyboard to shoot it.
          </Text>
        </div>
      );
    }
  } else if (planning) {
    canvasState = 'live';
    canvas = (
      <RenderingStatus
        label={
          plan.isPending
            ? 'Sending the images to Claude…'
            : `Planning ${current?.images.length ?? uploads.length} frames: order, light, camera and people…`
        }
        runKey={current?.id}
      />
    );
  } else if (current?.status === 'failed' && uploads.length > 0) {
    canvasState = 'live';
    canvas = (
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
    );
  } else if (job.isLoading && uploads.length === 0) {
    canvasState = 'live';
    canvas = <RenderingStatus label="Loading your storyboard…" />;
  } else if (uploads[0]) {
    canvasState = 'preview';
    aspectRatio = `${uploads[0].width} / ${uploads[0].height}`;
    canvas = <img src={uploads[0].src} alt={`Project image: ${uploads[0].name}`} decoding="async" />;
    canvasNote = 'Your storyboard will appear here';
    caption = `${uploads.length} project image${uploads.length === 1 ? '' : 's'} · ${storylineName(storyline)}`;
  } else {
    // Nothing to show yet, or a plan that failed after a reload emptied the
    // uploader: the frame is where the images go (never a stale error).
    canvasState = 'empty';
    empty = {
      title: current?.status === 'failed' ? 'Drop your project images again' : 'Drop your project images',
      hint:
        current?.status === 'failed'
          ? 'Add the images again to plan.'
          : `Renders or photos of one project, up to ${MAX_STORYBOARD_IMAGES}. Then pick a story and plan the frames.`,
      action: 'Choose project images',
      label: DROP_LABEL,
    };
  }

  // ---- The canvas toolbar: contact sheet or one frame, step through, full screen.
  const prevFrame = selIndex > 0 ? frames[selIndex - 1] : undefined;
  const nextFrame = selFrame ? frames[selIndex + 1] : frames[0];
  const canvasToolbar = planned ? (
    <>
      <button type="button" className={own.tool} aria-pressed={showGrid} onClick={() => setGrid(true)}>
        <LayoutGrid size={16} aria-hidden />
        <span>Grid</span>
      </button>
      <button
        type="button"
        className={own.tool}
        aria-pressed={!showGrid}
        disabled={frames.length === 0}
        onClick={() => {
          const first = frames[0];
          if (selFrame) setGrid(false);
          else if (first) selectFrame(first.image);
        }}
      >
        <RectangleHorizontal size={16} aria-hidden />
        <span>Frame</span>
      </button>
      <span className={own.toolSep} aria-hidden />
      <button
        type="button"
        className={own.tool}
        aria-label="Previous frame"
        title="Previous frame"
        disabled={!prevFrame}
        onClick={() => prevFrame && selectFrame(prevFrame.image)}
      >
        <ChevronLeft size={16} aria-hidden />
      </button>
      <button
        type="button"
        className={own.tool}
        aria-label="Next frame"
        title="Next frame"
        disabled={!nextFrame}
        onClick={() => nextFrame && selectFrame(nextFrame.image)}
      >
        <ChevronRight size={16} aria-hidden />
      </button>
      <span className={own.toolSep} aria-hidden />
      <button
        type="button"
        className={own.tool}
        disabled={frames.length === 0}
        onClick={() => setViewing(selFrame?.image ?? frames[0]?.image ?? null)}
      >
        <Expand size={16} aria-hidden />
        <span>Full screen</span>
      </button>
    </>
  ) : undefined;

  // ---- The strip: the storyboard's setup, then every frame in story order.
  const strip = planned ? (
    <>
      <button
        type="button"
        className={own.jobCard}
        aria-pressed={!selFrame}
        aria-label="Storyboard: setup and film"
        onClick={() => {
          setSelected('job');
          setGrid(false);
        }}
      >
        <Projector size={18} aria-hidden />
        <span className={own.jobCardTitle}>Storyboard</span>
        <span className={own.jobCardMeta}>
          {frames.length} frame{frames.length === 1 ? '' : 's'}
        </span>
      </button>
      <ol className={own.strip} aria-label="Frames in story order">
        {frames.map((f, i) => (
          <StripCard
            key={`${planned.id}-${f.image}`}
            order={i + 1}
            frame={f}
            job={planned}
            take={takes.get(f.image)}
            shooting={Boolean(shooting[f.image])}
            chosen={chosen.has(f.image)}
            current={selected === f.image}
            onSelect={selectFrame}
          />
        ))}
      </ol>
    </>
  ) : undefined;

  // ---- The inspector and its footer.
  const header = (
    <PageHeader
      title="Direct the film"
      description="Upload every image of the project and pick a story. The app plans each frame's light, camera and people, then shoots them true to what is in your images."
    />
  );

  let inspector: ReactNode;
  let footer: ReactNode;
  if (planned && selFrame) {
    const order = selIndex + 1;
    const failed = selTake?.status === 'failed' && !shooting[selFrame.image];
    inspector = (
      <>
        {header}
        <Section title={`Frame ${order}: ${selFrame.title}`}>
          <div className={styles.stack}>
            <div className={own.cardText}>
              <Text tone="muted" size="sm" as="p">
                Frame {order} of {frames.length}, {selFrame.space === 'interior' ? 'interior' : 'exterior'}
              </Text>
              {selFrame.beat && (
                <Text tone="secondary" size="sm" as="p">
                  {selFrame.beat}
                </Text>
              )}
            </div>
            {failed && (
              <Alert tone="error" title="This frame didn't render">
                {selTake?.error ?? 'Shoot it again.'}
              </Alert>
            )}
            <FrameControls
              key={`${planned.id}-${selFrame.image}`}
              frame={selFrame}
              choice={selChoice}
              disabled={selRendering}
              onChoose={onChoose}
              onShoot={(i) => void shoot(i)}
            />
            <span className={own.saveState} role="status">
              {selSave === 'saving' ? 'Saving…' : selSave === 'saved' ? 'Saved' : ''}
            </span>
            {selSave && typeof selSave === 'object' && (
              <RunwayErrorNotice error={selSave.error} modelName="your storyboard" />
            )}
            <RunwayErrorNotice
              error={shootErrors[selFrame.image]}
              modelName={imageModelName(planned.imageModel)}
              onRetry={() => void shoot(selFrame.image)}
            />
            {saver.error && (
              <Alert tone="error" title="Download failed">
                {saver.error}
              </Alert>
            )}
          </div>
        </Section>
      </>
    );
    footer = (
      <>
        <BlockedTip message={shootBlocked}>
          <Button
            variant="primary"
            size="lg"
            className={styles.generate}
            icon={<Clapperboard size={16} />}
            loading={selRendering}
            disabled={shootBlocked !== null}
            onPress={() => void shoot(selFrame.image)}
          >
            {selRendering ? 'Shooting…' : selDone || selTake?.status === 'failed' ? 'Shoot again' : 'Shoot this frame'}
          </Button>
        </BlockedTip>
        {shootBlocked && <ModelUnavailable message={shootBlocked} />}
        <CostLine
          summary={`Each take with ${imageModelName(planned.imageModel)} costs the same as a still${onBay ? ', billed to your own Runway credits' : ''}. Earlier takes stay under Full screen.`}
          providerNote={providerNote(planned.imageModel)}
        />
      </>
    );
  } else {
    inspector = (
      <>
        {header}
        <Section step={1} title="Project images" description={`Renders or photos of one project, up to ${MAX_STORYBOARD_IMAGES}.`}>
          <div className={styles.stack}>
            <ImageDropZone
              onFiles={(files) => void addFiles(files)}
              disabled={planning || uploads.length >= MAX_STORYBOARD_IMAGES}
              actionLabel={uploads.length ? 'Add images' : 'Choose images'}
              label={DROP_LABEL}
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
            <DirectionStyleSelect value={directorStyle} onChange={setDirectorStyle} disabled={planning} />
          </div>
        </Section>

        <Section step={3} title="Model" description="Shoots each frame from its image.">
          <div className={styles.stack}>
            <div className={styles.selectRow}>
              <Select
                label="Image model"
                options={allowedImage(IMAGE_MODELS)}
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
              {blocked && <ModelUnavailable message={blocked} />}
            </div>
            {/* With a storyboard on the board, planning a new one is the secondary action here. */}
            {planned && uploads.length > 0 && (
              <div className={own.replan}>
                <BlockedTip message={blocked}>
                  <Button
                    icon={<Projector size={16} />}
                    loading={planning}
                    disabled={!ready || blocked !== null}
                    onPress={() => void runPlan()}
                  >
                    {planLabel}
                  </Button>
                </BlockedTip>
                <Text tone="muted" size="sm" as="p">
                  Plans a new storyboard from these images; this one stays in your library.
                </Text>
              </div>
            )}
            <RunwayErrorNotice error={plan.error} modelName="Claude" onRetry={() => void runPlan()} />
            {job.error && (
              <RunwayErrorNotice error={job.error} modelName="Claude" onRetry={() => void job.refetch()} />
            )}
          </div>
        </Section>

        {planned && (
          <Section title={`Storyboard: ${storylineName(planned.storyline)}`}>
            <div className={styles.stack}>
              <Text tone="muted" size="sm" as="p">
                {frames.length} frame{frames.length === 1 ? '' : 's'} in story order, shot with{' '}
                {imageModelName(planned.imageModel)}.{directed ? ` ${directed}.` : ''} Pick a frame in the strip to
                change its light, camera or people before you shoot; each list puts the recommended choice first.
              </Text>
              {shotFrames.length > 0 && (
                <div className={own.cardActions}>
                  <Button variant="ghost" icon={<CircleCheck size={16} />} onPress={chooseAll}>
                    {allChosen ? 'Clear the film choice' : 'Choose all shot frames'}
                  </Button>
                </div>
              )}
              {planned.warning && (
                <Alert tone="warning" title="Part of the storyboard wasn't planned">
                  {planned.warning}
                </Alert>
              )}
              {pickError !== undefined && (
                <RunwayErrorNotice error={pickError} modelName="your storyboard" onRetry={chooseAll} />
              )}
              <Text tone="muted" size="sm" as="p">
                Every frame is saved to your library, tagged @storyboard. Shoot within a day or so of planning: the
                uploaded images are only kept that long.
              </Text>
            </div>
          </Section>
        )}
        {planned && (
          <FilmStep
            job={planned}
            frames={frames}
            takes={takes}
            chosen={chosen}
            clips={library.data?.clips ?? []}
            onMade={onMade}
            onGoToEdit={onGoToEdit}
            onNext={setFilmNext}
            actionInFooter={allShot}
          />
        )}
      </>
    );
    if (!planned) {
      footer = (
        <>
          <BlockedTip message={blocked}>
            <Button
              variant="primary"
              size="lg"
              className={styles.generate}
              icon={<Projector size={16} />}
              loading={planning}
              disabled={!ready || blocked !== null}
              onPress={() => void runPlan()}
            >
              {planLabel}
            </Button>
          </BlockedTip>
          <CostLine
            summary={
              onBay
                ? 'Claude plans the storyboard, a few credits for every six images. Nothing is shot until you say so.'
                : 'Your AI text provider plans the storyboard. Nothing is shot until you say so.'
            }
            details={`Each frame you shoot with ${imageModelName(imageModel)} costs the same as a still.${onBay ? ' Billed to your own Runway credits.' : ''}`}
            providerNote={providerNote(imageModel)}
          />
        </>
      );
    } else if (allShot && filmNext?.kind === 'make') {
      // Every frame is shot: the film's clips are the next step.
      footer = (
        <>
          <BlockedTip message={filmNext.blocked}>
            <Button
              variant="primary"
              size="lg"
              className={styles.generate}
              icon={<Clapperboard size={16} />}
              loading={filmNext.busy}
              disabled={filmNext.blocked !== null}
              onPress={filmNext.make}
            >
              {filmNext.label}
            </Button>
          </BlockedTip>
          <CostLine
            summary="Every frame is shot. Next, a clip of each frame chosen for the film."
            details={filmNext.cost}
            providerNote={filmNext.providerNote}
          />
          <RunwayErrorNotice
            error={filmNext.error}
            modelName={filmNext.modelName}
            onRetry={filmNext.busy ? undefined : filmNext.make}
          />
        </>
      );
    } else if (allShot) {
      footer = (
        <>
          <Button variant="primary" size="lg" className={styles.generate} icon={<Scissors size={16} />} onPress={onGoToEdit}>
            Open the film in Edit
          </Button>
          <CostLine
            summary={
              !filmNext || filmNext.kind !== 'edit' || filmNext.film === 0
                ? 'Every frame is shot. Choose the frames for your film to make their clips here first.'
                : filmNext.rendering > 0
                  ? `Every frame is shot and every chosen frame has a clip; ${filmNext.rendering} still rendering.`
                  : 'Every frame is shot and every chosen frame has a clip.'
            }
          />
        </>
      );
    } else {
      footer = (
        <>
          <BlockedTip message={shootBlocked}>
            <Button
              variant="primary"
              size="lg"
              className={styles.generate}
              icon={<Clapperboard size={16} />}
              // Nothing is left to send while the last frames render: it waits for them.
              loading={shootingAll || unshot.length === 0}
              disabled={shootBlocked !== null}
              onPress={() => void shootAll()}
            >
              {shootingAll || unshot.length === 0
                ? 'Shooting the frames…'
                : unshot.length === frames.length
                  ? frames.length === 1
                    ? 'Shoot the frame'
                    : `Shoot all ${frames.length} frames`
                  : `Shoot the other ${unshot.length} frame${unshot.length === 1 ? '' : 's'}`}
            </Button>
          </BlockedTip>
          {shootBlocked && <ModelUnavailable message={shootBlocked} />}
          <CostLine
            summary={`Each frame with ${imageModelName(planned.imageModel)} costs the same as a still${onBay ? ', billed to your own Runway credits' : ''}.`}
            providerNote={providerNote(planned.imageModel)}
          />
        </>
      );
    }
  }

  return (
    <>
      <Workspace
        page="director"
        canvasState={canvasState}
        canvas={canvas}
        aspectRatio={aspectRatio}
        caption={caption}
        canvasNote={canvasNote}
        canvasToolbar={canvasToolbar}
        canvasActions={canvasActions}
        onDropFiles={!planned && !planning ? (files) => void addFiles(files) : undefined}
        empty={empty ?? { title: 'Drop your project images', hint: '', action: 'Choose project images', label: DROP_LABEL }}
        inspector={inspector}
        footer={footer}
        strip={strip}
        stripLabel="Frames"
        raiseSheet={selected}
      />

      {planned && (
        <FrameViewer
          job={planned}
          frames={frames}
          image={viewing}
          onImage={onViewerImage}
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
  take: Still | undefined;
  shooting: boolean;
  chosen: boolean;
  /** The selected frame. */
  current: boolean;
  onSelect: (image: number) => void;
};

/** A frame's picture for the strip and the contact sheet: the take once shot, else its project image, dimmed. */
function FrameThumb({ frame, job, take }: Pick<FrameCardProps, 'frame' | 'job' | 'take'>) {
  const [broken, setBroken] = useState(false);
  const img = job.images[frame.image];
  if (take?.status === 'succeeded') {
    return <TakeImage key={take.id} quiet stillId={take.id} alt="" className={own.thumbPicture} />;
  }
  if (img && !broken) {
    return (
      <img
        className={`${own.thumbPicture} ${own.source}`}
        src={img.url}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
      />
    );
  }
  return <span className={own.thumbBlank} aria-hidden />;
}

/** One frame in the filmstrip: its picture, its number, its state and the film tick. Pressing it selects it. */
const StripCard = memo(function StripCard({ order, frame, job, take, shooting, chosen, current, onSelect }: FrameCardProps) {
  const state = frameState(take, shooting);
  const done = state === 'shot';
  return (
    <li className={own.stripItem} data-frame={frame.image} data-state={state}>
      <button
        type="button"
        className={own.stripCard}
        aria-pressed={current}
        aria-label={`Frame ${order}: ${frame.title}, ${STATE_LABEL[state].toLowerCase()}${done && chosen ? ', in the film' : ''}`}
        data-chosen={(done && chosen) || undefined}
        onClick={() => onSelect(frame.image)}
      >
        <FrameThumb frame={frame} job={job} take={take} />
        <span className={own.stripNo} aria-hidden>
          {order}
        </span>
        {!done && (
          <span className={own.badge} data-state={state} aria-hidden>
            {STATE_LABEL[state]}
          </span>
        )}
        {done && chosen && (
          <span className={own.tick} aria-hidden>
            <Check size={12} strokeWidth={3} />
          </span>
        )}
      </button>
    </li>
  );
});

/** One frame on the contact sheet: picture, number, title and state. Pressing it opens the frame. */
const SheetCard = memo(function SheetCard({ order, frame, job, take, shooting, chosen, current, onSelect }: FrameCardProps) {
  const state = frameState(take, shooting);
  const done = state === 'shot';
  const img = job.images[frame.image];
  const aspect = done && take ? `${take.width} / ${take.height}` : img ? `${img.width} / ${img.height}` : '16 / 9';
  return (
    <li className={own.sheetItem}>
      <button
        type="button"
        className={own.sheetCard}
        aria-current={current || undefined}
        data-chosen={(done && chosen) || undefined}
        onClick={() => onSelect(frame.image)}
      >
        <span className={own.sheetFrame} style={{ aspectRatio: aspect }}>
          <FrameThumb frame={frame} job={job} take={take} />
          {!done && (
            <span className={own.badge} data-state={state}>
              {STATE_LABEL[state]}
            </span>
          )}
          {done && chosen && (
            <span className={own.tick}>
              <Check size={12} strokeWidth={3} aria-hidden />
              <span className={own.srOnly}>In the film</span>
            </span>
          )}
        </span>
        <span className={own.sheetText}>
          <span className={own.cardNo}>{order}</span>
          <span className={own.sheetTitle}>{frame.title}</span>
          <span className={own.space}>{frame.space === 'interior' ? 'Interior' : 'Exterior'}</span>
        </span>
      </button>
    </li>
  );
});
