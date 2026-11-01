import { CircleAlert, Clock, Download, Focus, Maximize2, RotateCcw } from 'lucide-react';
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Label, Radio, RadioGroup } from 'react-aria-components';

import type { CloseupJob, CloseupShot } from '../closeups-api.ts';
import type { Still } from '../api.ts';
import { litFromReference, lookLabel } from '../looks.ts';
import {
  defaultImageResolution,
  IMAGE_MODELS,
  imageModelName,
  imageResolutionName,
  imageResolutions,
  motionLabel,
  videoModelName,
  type ImageModelId,
} from '../models.ts';
import { type Handoff, parseHash } from './handoff.ts';
import { Section } from './layouts/Section.tsx';
import { type CanvasState, Workspace } from './layouts/Workspace.tsx';
import { useAmbient } from './lib/ambient.tsx';
import { clipPosterUrl, libraryUrl, stillThumbUrl, stillViewUrl, useDownload } from './lib/download.ts';
import { classifyRunwayError } from './lib/runwayErrors.ts';
import { useCapabilities } from './lib/useCapabilities.ts';
import { isUploadFailure, uploadRender } from './lib/uploadRender.ts';
import { useInFlight } from './lib/useInFlight.ts';
import { trpc } from './trpc.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { CostLine } from './ui/CostLine.tsx';
import { EmptyState } from './ui/EmptyState.tsx';
import { FilterChips } from './ui/FilterChips.tsx';
import { ImageDropZone } from './ui/ImageDropZone.tsx';
import { ImagePicker } from './ui/ImagePicker.tsx';
import { ImagePlaceholder } from './ui/ImagePlaceholder.tsx';
import { Lightbox } from './ui/Lightbox.tsx';
import { BlockedTip, ModelUnavailable } from './ui/ModelUnavailable.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { RenderingStatus } from './ui/RenderingStatus.tsx';
import { RunwayErrorNotice } from './ui/RunwayErrorNotice.tsx';
import { Select } from './ui/Select.tsx';
import { SkeletonBlock } from './ui/Skeleton.tsx';
import { Text } from './ui/Text.tsx';
import { TextInput } from './ui/TextInput.tsx';
import styles from './Studio.module.css';
import own from './CloseupsPage.module.css';

const PAGE = 12;

const SOURCES = [
  { id: 'clip', name: 'A video' },
  { id: 'still', name: 'A still' },
  { id: 'upload', name: 'Upload an image' },
] as const;

type SourceKind = (typeof SOURCES)[number]['id'];

const COUNTS = [2, 3, 4, 5, 6].map((n) => ({ id: String(n), name: `${n} close-ups` }));

/** Steps the server is working through on its own; the page keeps polling. */
const WORKING = new Set(['capturing', 'captured', 'finding', 'picked', 'rendering']);

type Upload = { src: string; name: string; width: number; height: number; hostedUrl?: string | undefined };

export type CloseupsPageProps = {
  /** Whether this tab is on screen; a hidden tab polls slowly and skips the library. */
  active: boolean;
  /** Go to the Stills tab, when there is nothing to search yet. */
  onGoToStills: () => void;
  /** Animate a finished close-up on the Video tab. */
  onAnimate: (stillId: string) => void;
  /** What the address opened the page with (`#stills?mode=closeups&job=abc`); read from the address itself when not given. */
  handoff?: Handoff | undefined;
};

export function CloseupsPage({ active, onGoToStills, onAnimate, handoff }: CloseupsPageProps) {
  const address = handoff ?? parseHash(window.location.hash);
  const addressed = address.page === 'stills' && address.params['mode'] === 'closeups';
  const addressedJob = addressed ? address.params['job'] : undefined;
  // A job in the address wins over a source to pick.
  const addressedClip = addressed && !addressedJob ? address.params['clip'] : undefined;
  const addressedStill = addressed && !addressedJob ? address.params['still'] : undefined;
  const utils = trpc.useUtils();
  const library = trpc.library.useQuery(undefined, {
    refetchInterval: (q) => (active && q.state.data?.stills.some((s) => s.status === 'pending') ? 8_000 : false),
  });

  const [kind, setKind] = useState<SourceKind>('clip');
  const [clipId, setClipId] = useState<string | null>(null);
  const [stillId, setStillId] = useState<string | null>(null);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<unknown>(null);
  const [shown, setShown] = useState(PAGE);
  const [count, setCount] = useState(4);
  const { allowedImage, modelBlocked, onBay, providerNote } = useCapabilities();
  const [imageModel, setImageModel] = useState<ImageModelId>('nano-banana-pro');
  const [resolution, setResolution] = useState(defaultImageResolution('nano-banana-pro'));
  const blocked = modelBlocked('image', imageModel);
  const [direction, setDirection] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  /** The search the address named, shown until one of this page's own takes over. */
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<{ id: string; title: string } | null>(null);
  /** The close-up on the canvas, per search; the first until one is picked in the strip. */
  const [picked, setPicked] = useState<{ job: string; index: number } | null>(null);

  const find = trpc.closeups.find.useMutation();
  const analyze = trpc.closeups.analyze.useMutation();
  const render = trpc.closeups.render.useMutation();
  // A double-click's second press arrives before isPending shows: each paid
  // step is sent once however fast it is pressed.
  const findGuard = useInFlight();
  const analyzeGuard = useInFlight();
  const renderGuard = useInFlight();

  const stalledRef = useRef(false);
  // With no search started here yet, this is the newest one, so a reload picks up where it was.
  const job = trpc.closeups.job.useQuery(jobId ? { id: jobId } : openedId ? { id: openedId } : {}, {
    // Hidden, it still checks in now and then so the next step starts on time.
    refetchInterval: (q) =>
      q.state.data && WORKING.has(q.state.data.status) && !stalledRef.current ? (active ? 4000 : 15_000) : false,
    refetchOnWindowFocus: false,
    retry: 2,
  });
  const current = job.data ?? null;
  // A step that failed to start leaves the search waiting at `captured` or
  // `picked`; nothing is running until "Try again".
  const stalled =
    (analyze.isError && current?.status === 'captured') || (render.isError && current?.status === 'picked');
  stalledRef.current = stalled;

  // The server records each finished step; the next paid step starts from here,
  // once per search, so its error lands next to the button.
  const advanced = useRef(new Set<string>());
  const currentId = current?.id;
  const currentStatus = current?.status;
  const analyzeAsync = analyze.mutateAsync;
  const renderAsync = render.mutateAsync;
  const refetchJob = job.refetch;
  // A search already running when the page loaded is picked up and watched.
  // One paused before a paid step waits for "Continue", so a reload never spends.
  useEffect(() => {
    if (!jobId && currentId && (currentStatus === 'capturing' || currentStatus === 'finding' || currentStatus === 'rendering')) {
      setJobId(currentId);
    }
  }, [jobId, currentId, currentStatus]);
  // A search the address names is looked at the same way, so it joins the page
  // once per arrival; one paused before a paid step still waits for "Continue".
  const openedJob = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (openedJob.current === addressedJob) return;
    openedJob.current = addressedJob;
    if (!addressedJob) return;
    setOpenedId(addressedJob);
    setJobId(null);
  }, [addressedJob]);
  // A clip or still the address names is the source to search, once per arrival.
  const openedSource = useRef<string | undefined>(undefined);
  useEffect(() => {
    const key = addressedClip ? `clip:${addressedClip}` : addressedStill ? `still:${addressedStill}` : undefined;
    if (openedSource.current === key) return;
    openedSource.current = key;
    if (addressedClip) {
      setKind('clip');
      setClipId(addressedClip);
    } else if (addressedStill) {
      setKind('still');
      setStillId(addressedStill);
    }
  }, [addressedClip, addressedStill]);
  const startStep = useCallback(
    (id: string, status: CloseupJob['status'] | undefined) => {
      if (status === 'captured') {
        if (!analyzeGuard.start()) return;
        analyzeAsync({ id })
          // Shown by RunwayErrorNotice from analyze.error.
          .catch(() => undefined)
          .finally(() => {
            analyzeGuard.end();
            void refetchJob();
          });
      } else if (status === 'picked') {
        if (!renderGuard.start()) return;
        renderAsync({ id })
          // Shown by RunwayErrorNotice from render.error.
          .catch(() => undefined)
          .finally(() => {
            renderGuard.end();
            void refetchJob();
            void utils.library.invalidate();
          });
      }
    },
    [analyzeAsync, renderAsync, analyzeGuard, renderGuard, refetchJob, utils]
  );
  useEffect(() => {
    if (!currentId || currentId !== jobId) return;
    const key = `${currentId}:${currentStatus}`;
    if (advanced.current.has(key)) return;
    if (currentStatus === 'captured' || currentStatus === 'picked') {
      advanced.current.add(key);
      startStep(currentId, currentStatus);
    }
  }, [currentId, currentStatus, jobId, startStep]);
  const paused =
    current !== null && current.id !== jobId && (current.status === 'captured' || current.status === 'picked');

  const clips = useMemo(() => (library.data?.clips ?? []).filter((c) => c.status === 'succeeded'), [library.data]);
  const stills = useMemo(() => (library.data?.stills ?? []).filter((s) => s.status === 'succeeded'), [library.data]);
  const stillById = useMemo(() => new Map((library.data?.stills ?? []).map((s) => [s.id, s])), [library.data]);

  const clipItems = useMemo(
    () =>
      clips.slice(0, shown).map((c) => ({
        id: c.id,
        // A clip with no poster and no still left shows a plain frame.
        src: clipPosterUrl(c, stillById) ?? '',
        alt: `Video: ${clipCaption(c)}`,
        caption: clipCaption(c),
      })),
    [clips, shown, stillById]
  );
  const stillItems = useMemo(
    () =>
      stills.slice(0, shown).map((s) => {
        // Two lines: the look, then model, resolution and time; the tooltip holds both in full.
        const [look, detail] = stillLines(s);
        return {
          id: s.id,
          src: stillThumbUrl(s.id),
          alt: `Still: ${look}. ${detail}`,
          caption: look,
          detail,
          title: `${look}, ${detail}`,
        };
      }),
    [stills, shown]
  );
  const openZoom = useCallback((id: string, title: string) => setZoom({ id, title }), []);

  const selectedClip = clips.find((c) => c.id === clipId) ?? null;
  const selectedStill = stills.find((s) => s.id === stillId) ?? null;
  const clipStill = selectedClip ? stillById.get(selectedClip.stillId) : undefined;

  const working =
    find.isPending ||
    analyze.isPending ||
    render.isPending ||
    (current !== null && WORKING.has(current.status) && current.id === jobId && !stalled);
  const ready =
    kind === 'clip' ? selectedClip !== null : kind === 'still' ? selectedStill !== null : Boolean(upload?.hostedUrl);

  async function onFile(file: File) {
    setUploadError(null);
    const src = URL.createObjectURL(file);
    let width: number;
    let height: number;
    try {
      const bitmap = await createImageBitmap(file);
      ({ width, height } = bitmap);
      bitmap.close();
    } catch {
      URL.revokeObjectURL(src);
      setUploadError(new Error('That file could not be read as an image. Try a PNG, JPEG or WebP.'));
      return;
    }
    setUpload((prev) => {
      if (prev) URL.revokeObjectURL(prev.src);
      return { src, name: file.name, width, height };
    });
    setUploading(true);
    try {
      const hostedUrl = await uploadRender(file);
      setUpload((cur) => (cur?.src === src ? { ...cur, hostedUrl } : cur));
    } catch (e) {
      setUpload((cur) => {
        if (cur?.src !== src) return cur;
        URL.revokeObjectURL(src);
        return null;
      });
      // The route's body, so a sign-in or consent refusal shows its prompt.
      setUploadError(
        isUploadFailure(e)
          ? classifyRunwayError(e.body).signIn || classifyRunwayError(e.body).consent
            ? e.body
            : { message: e.message }
          : e instanceof Error
            ? e
            : { message: 'The image could not be uploaded. Try again.' }
      );
    } finally {
      setUploading(false);
    }
  }

  async function run() {
    if (!ready || working || blocked) return;
    if (!findGuard.start()) return;
    analyze.reset();
    render.reset();
    const settings = { count, imageModel, resolution, direction };
    try {
      const { id } =
        kind === 'clip'
          ? await find.mutateAsync({ kind: 'clip', id: selectedClip!.id, ...settings })
          : kind === 'still'
            ? await find.mutateAsync({ kind: 'still', id: selectedStill!.id, ...settings })
            : await find.mutateAsync({
                kind: 'upload',
                url: upload!.hostedUrl!,
                width: upload!.width,
                height: upload!.height,
                ...settings,
              });
      setJobId(id);
    } catch {
      // Shown by RunwayErrorNotice from find.error.
    } finally {
      findGuard.end();
    }
  }

  /** Retry whichever step failed, or continue a paused search, with the same settings. */
  function retryStep() {
    // A step already on its way is not reset or sent again.
    if (!current || analyzeGuard.busy() || renderGuard.busy()) return;
    analyze.reset();
    render.reset();
    setJobId(current.id);
    advanced.current.add(`${current.id}:${current.status}`);
    startStep(current.id, current.status);
  }

  const stepError = find.error ?? analyze.error ?? render.error ?? null;
  const aspect = current
    ? `${current.width} / ${current.height}`
    : kind === 'clip' && clipStill
      ? `${clipStill.width} / ${clipStill.height}`
      : kind === 'still' && selectedStill
        ? `${selectedStill.width} / ${selectedStill.height}`
        : kind === 'upload' && upload
          ? `${upload.width} / ${upload.height}`
          : '16 / 9';
  const shots = useMemo(
    () => current?.shots ?? current?.picks?.map((p) => ({ ...p, stillId: undefined, error: undefined })) ?? [],
    [current?.shots, current?.picks]
  );
  const showShots =
    current !== null &&
    !paused &&
    (current.status === 'picked' || current.status === 'rendering' || current.status === 'done');

  const sourcePreview =
    kind === 'clip' && selectedClip
      ? (clipPosterUrl(selectedClip, stillById, 'view') ?? null)
      : kind === 'still' && selectedStill
        ? stillViewUrl(selectedStill.id)
        : kind === 'upload' && upload
          ? upload.src
          : null;

  // The room takes the light of the first finished close-up, else of the
  // source being searched (thumbnails; an unsent upload is its local copy).
  const firstShot = showShots ? shots.find((s) => s.stillId && stillById.get(s.stillId)?.status === 'succeeded') : undefined;
  const sourceThumb =
    kind === 'clip' && selectedClip
      ? (clipPosterUrl(selectedClip, stillById) ?? null)
      : kind === 'still' && selectedStill
        ? stillThumbUrl(selectedStill.id)
        : kind === 'upload' && upload
          ? upload.src
          : null;
  useAmbient(firstShot?.stillId ? stillThumbUrl(firstShot.stillId) : sourceThumb);

  const libraryLoaded = library.data !== undefined;
  // The close-up on the canvas: the one picked in the strip, else the first.
  const pickedIndex =
    showShots && current && picked?.job === current.id ? Math.min(picked.index, Math.max(0, shots.length - 1)) : 0;
  const pickedShot = showShots && current ? shots[pickedIndex] : undefined;
  const pickedStill = pickedShot?.stillId ? stillById.get(pickedShot.stillId) : undefined;
  const pickedState = pickedShot && current ? shotState(pickedShot, pickedStill, current.status, libraryLoaded) : null;
  // A close-up not in yet is being shot while the search runs, or while its still is at Runway.
  const shooting = current !== null && (working || current.status === 'done');
  const jobAspect = current ? `${current.width} / ${current.height}` : aspect;
  const sourceAspect =
    kind === 'clip' && clipStill
      ? `${clipStill.width} / ${clipStill.height}`
      : kind === 'still' && selectedStill
        ? `${selectedStill.width} / ${selectedStill.height}`
        : kind === 'upload' && upload
          ? `${upload.width} / ${upload.height}`
          : aspect;

  // The picture the search looked in, for close-ups not shot yet.
  const allClips = library.data?.clips;
  const jobSource = useMemo(() => {
    const src = current?.source;
    if (!src) return null;
    if (src.kind === 'still' && src.id) return { thumb: stillThumbUrl(src.id), view: stillViewUrl(src.id) };
    if (src.kind === 'clip' && src.id) {
      const clip = allClips?.find((c) => c.id === src.id);
      return clip
        ? { thumb: clipPosterUrl(clip, stillById) ?? null, view: clipPosterUrl(clip, stillById, 'view') ?? null }
        : null;
    }
    if (src.kind === 'upload' && src.url) {
      const local = upload?.hostedUrl === src.url ? upload.src : src.url;
      return { thumb: local, view: local };
    }
    return null;
  }, [current?.source, allClips, stillById, upload]);

  const saver = useDownload();
  const [savingId, setSavingId] = useState<string | null>(null);
  const onPick = useCallback((job: string, index: number) => setPicked({ job, index }), []);

  const planned = (n: number, model: ImageModelId, res: string) => {
    const resName = imageResolutionName(model, res);
    return `${n} close-ups · ${imageModelName(model)}${resName ? ` · ${resName}` : ''}`;
  };

  let canvasState: CanvasState;
  let canvas: ReactNode = null;
  let canvasAspect = aspect;
  let canvasNote: string | undefined;
  let caption: string | undefined = current ? planned(current.count, current.imageModel, current.resolution) : undefined;
  let canvasActions: ReactNode;

  if (showShots && current && pickedShot && pickedState) {
    const title = sentenceCase(pickedShot.subject);
    canvasAspect = jobAspect;
    caption = `Close-up ${pickedIndex + 1} of ${shots.length} · ${title}${pickedShot.why ? ` · ${pickedShot.why}` : ''}`;
    if (pickedState === 'done' && pickedStill) {
      const id = pickedStill.id;
      canvasState = 'live';
      canvas = <img key={id} src={stillViewUrl(id)} alt={`Close-up: ${title}`} decoding="async" />;
      canvasActions = (
        <>
          <Button
            size="sm"
            variant="ghost"
            icon={<Download size={14} />}
            loading={saver.pending && savingId === id}
            onPress={() => {
              setSavingId(id);
              saver.start(libraryUrl('still', id), `close-up-${pickedIndex + 1}.png`);
            }}
          >
            {savingId === id ? saver.label('Download') : 'Download'}
          </Button>
          <Button size="sm" variant="ghost" icon={<Maximize2 size={14} />} onPress={() => openZoom(id, title)}>
            Full size
          </Button>
          <Button size="sm" variant="ghost" onPress={() => onAnimate(id)}>
            Make a video
          </Button>
        </>
      );
    } else if (pickedState === 'removed') {
      canvasState = 'live';
      canvas = (
        <div className={styles.frameAlert}>
          <Text tone="muted" size="sm" as="p">
            This close-up was removed from your library.
          </Text>
        </div>
      );
    } else if (pickedState === 'failed') {
      canvasState = 'live';
      canvas = (
        <div className={styles.frameAlert}>
          <Alert tone="error" title="This close-up didn't render">
            {pickedStill?.error ?? pickedShot.error ?? 'Try finding close-ups again.'}
          </Alert>
        </div>
      );
    } else if (shooting) {
      canvasState = 'live';
      canvas = (
        <RenderingStatus
          label={current.status === 'done' ? 'Shooting the close-up…' : 'Lining up the shot…'}
          runKey={`${current.id}-${pickedIndex}`}
        />
      );
    } else {
      // Found, not shot: the frame it was found in, dimmed.
      canvasState = 'preview';
      canvas = jobSource?.view ? (
        <img src={jobSource.view} alt="" decoding="async" />
      ) : (
        <ImagePlaceholder label={`Close-up: ${title}`} aspectRatio={jobAspect} />
      );
      canvasNote = 'Not rendered yet';
    }
  } else if (paused && current) {
    canvasState = 'live';
    canvas = (
      <div className={styles.frameAlert}>
        <Alert tone="info" title="Your last search is waiting">
          {current.status === 'captured'
            ? 'The frames are in. Continue to look for the close-ups in them.'
            : `${current.picks?.length ?? current.count} close-ups were found. Continue to shoot them.`}
        </Alert>
        <div className={own.retry}>
          <Button size="sm" variant="primary" onPress={retryStep}>
            Continue
          </Button>
        </div>
      </div>
    );
  } else if (working) {
    canvasState = 'live';
    canvas = (
      <RenderingStatus
        label={
          find.isPending
            ? 'Starting the search…'
            : current?.status === 'capturing'
              ? 'Taking frames from the video…'
              : 'Looking for the most cinematic details…'
        }
        runKey={current?.id}
      />
    );
    if (find.isPending) caption = planned(count, imageModel, resolution);
  } else if (current?.status === 'failed' && current.id === jobId) {
    canvasState = 'live';
    canvas = (
      <div className={styles.frameAlert}>
        <Alert tone="error" title="The search didn't finish">
          {current.error ?? 'Try finding close-ups again.'}
        </Alert>
        <div className={own.retry}>
          <Button size="sm" icon={<RotateCcw size={14} />} onPress={() => void run()} disabled={!ready}>
            Try again
          </Button>
        </div>
      </div>
    );
  } else if (sourcePreview) {
    canvasState = 'preview';
    canvasAspect = sourceAspect;
    canvas = <img src={sourcePreview} alt="The source to search for close-ups" decoding="async" />;
    canvasNote = 'The close-ups you find will appear here';
    caption = planned(count, imageModel, resolution);
  } else if (kind === 'clip' && selectedClip) {
    canvasState = 'preview';
    canvasAspect = sourceAspect;
    canvas = <ImagePlaceholder label={`Video: ${clipCaption(selectedClip)}`} aspectRatio={sourceAspect} />;
    canvasNote = 'The close-ups you find will appear here';
    caption = planned(count, imageModel, resolution);
  } else {
    canvasState = 'empty';
  }

  return (
    <>
      <Workspace
        page="closeups"
        canvasState={canvasState}
        canvas={canvas}
        aspectRatio={canvasAspect}
        caption={caption}
        canvasNote={canvasNote}
        canvasActions={canvasActions}
        onDropFiles={
          working || uploading
            ? undefined
            : (files) => {
                const file = files[0];
                if (!file) return;
                setKind('upload');
                setShown(PAGE);
                void onFile(file);
              }
        }
        empty={{
          title: 'Drop an image to find its close-ups',
          hint: 'Or pick a video or a still in the controls. PNG, JPEG or WebP.',
          action: 'Choose an image',
          label: 'Drop or choose an image',
        }}
        stripLabel="Close-ups"
        strip={
          showShots && current ? (
            <ShotStrip
              shots={shots}
              jobId={current.id}
              jobStatus={current.status}
              aspect={jobAspect}
              stillById={stillById}
              libraryLoaded={libraryLoaded}
              sourceThumb={jobSource?.thumb ?? null}
              shooting={shooting}
              value={pickedIndex}
              onPick={onPick}
            />
          ) : undefined
        }
        inspector={
          <>
            <PageHeader
              title="Find the close-ups"
              description="Pick a video, a still or an image of your own. The app finds the most cinematic details in it and shoots each one as a close-up."
            />
            {showShots && (
              <Text tone="muted" size="sm" as="p" className={own.saved}>
                Every close-up is saved to your library, tagged @close-up.
              </Text>
            )}
            <Section step={1} title="Source" description="Where to look for close-ups.">
              <div className={styles.stack}>
                <FilterChips
                  label="Look in"
                  options={SOURCES}
                  value={kind}
                  onChange={(id) => {
                    setKind(id as SourceKind);
                    setShown(PAGE);
                  }}
                />
                {kind === 'upload' ? (
                  <>
                    <ImageDropZone
                      onFile={(f) => void onFile(f)}
                      disabled={working || uploading}
                      actionLabel={upload ? 'Replace image' : 'Choose an image'}
                      label="Drop or choose an image"
                    >
                      {upload ? (
                        <figure className={styles.frame} style={{ aspectRatio: `${upload.width} / ${upload.height}` }}>
                          <img className={styles.image} src={upload.src} alt={`Uploaded image: ${upload.name}`} />
                        </figure>
                      ) : (
                        <div className={own.dropEmpty}>
                          <Focus size={20} aria-hidden />
                          <Text tone="secondary" size="sm">
                            Drop a render, a film still or a photo here. PNG, JPEG or WebP.
                          </Text>
                        </div>
                      )}
                    </ImageDropZone>
                    {uploading && (
                      <Text tone="muted" size="sm" as="p">
                        Uploading the image…
                      </Text>
                    )}
                    <RunwayErrorNotice error={uploadError} modelName="the upload" onRetry={() => setUploadError(null)} />
                  </>
                ) : library.isLoading ? (
                  <SkeletonBlock height={180} />
                ) : library.error ? (
                  <RunwayErrorNotice error={library.error} modelName="your library" />
                ) : kind === 'clip' ? (
                  clips.length === 0 ? (
                    <EmptyState
                      title="No videos yet"
                      hint="Make a video on the Video tab, or look in a still or an uploaded image instead."
                      action={<Button onPress={() => setKind('still')}>Use a still</Button>}
                    />
                  ) : (
                    <ImagePicker
                      label="Video to search"
                      value={clipId}
                      onChange={setClipId}
                      disabled={working}
                      items={clipItems}
                    />
                  )
                ) : stills.length === 0 ? (
                  <EmptyState
                    title="No film stills yet"
                    hint="Make a still on the Stills tab, or upload an image instead."
                    action={<Button onPress={onGoToStills}>Go to Stills</Button>}
                  />
                ) : (
                  <ImagePicker
                    label="Still to search"
                    value={stillId}
                    onChange={setStillId}
                    disabled={working}
                    items={stillItems}
                  />
                )}
                {kind !== 'upload' && (kind === 'clip' ? clips : stills).length > shown && (
                  <div>
                    <Button size="sm" variant="ghost" onPress={() => setShown((n) => n + PAGE)}>
                      Show {Math.min(PAGE, (kind === 'clip' ? clips : stills).length - shown)} more
                    </Button>
                  </div>
                )}
                {kind === 'clip' && (
                  <Text tone="muted" size="sm" as="p">
                    Six frames are taken across the video, and the best moments are picked from them.
                  </Text>
                )}
              </div>
            </Section>

            <Section step={2} title="Shots" description="How many close-ups to make, and anything to look for.">
              <div className={styles.stack}>
                <Select
                  label="Number of close-ups"
                  options={COUNTS}
                  value={String(count)}
                  onChange={(id) => setCount(Number(id))}
                  disabled={working}
                  showHint={false}
                />
                <TextInput
                  label="Look for (optional)"
                  value={direction}
                  onChange={setDirection}
                  maxLength={400}
                  disabled={working}
                  placeholder="e.g. stone and timber textures, the people at the pool"
                  onPressEnter={() => void run()}
                />
              </div>
            </Section>

            <Section step={3} title="Model" description="Shoots each close-up from the frame it was found in.">
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
                  disabled={working}
                />
                {imageResolutions(imageModel).length > 1 && (
                  <Select
                    label="Resolution"
                    options={imageResolutions(imageModel)}
                    value={resolution}
                    onChange={setResolution}
                    disabled={working}
                    showHint={false}
                  />
                )}
                {blocked && <ModelUnavailable message={blocked} />}
              </div>
            </Section>
          </>
        }
        footer={
          <>
            <BlockedTip message={blocked}>
              <Button
                variant="primary"
                size="lg"
                icon={<Focus size={16} />}
                loading={working}
                disabled={!ready || blocked !== null}
                onPress={() => void run()}
              >
                {working
                  ? 'Finding close-ups…'
                  : uploading
                    ? 'Uploading the image…'
                    : ready
                      ? 'Find close-ups'
                      : kind === 'upload'
                        ? 'Upload an image first'
                        : kind === 'clip'
                          ? 'Pick a video first'
                          : 'Pick a still first'}
              </Button>
            </BlockedTip>
            <CostLine
              summary={`Claude looks for the shots, then ${imageModelName(imageModel)} makes ${count} close-ups.`}
              providerNote={providerNote(imageModel)}
              details={
                onBay
                  ? 'Billed to your own Runway credits: a few for the search, and each close-up costs the same as a still.'
                  : undefined
              }
            />
            <RunwayErrorNotice
              error={stepError}
              modelName={find.error || analyze.error ? 'Claude' : imageModelName(current?.imageModel ?? imageModel)}
              onRetry={() => (find.error ? void run() : retryStep())}
            />
            {job.error && (
              <RunwayErrorNotice error={job.error} modelName="Claude" onRetry={() => void job.refetch()} />
            )}
            {saver.error && (
              <Alert tone="error" title="Download failed">
                {saver.error}
              </Alert>
            )}
          </>
        }
      />

      <Lightbox
        src={zoom ? stillViewUrl(zoom.id) : null}
        alt={zoom ? `Close-up: ${zoom.title}` : ''}
        title={zoom?.title ?? ''}
        onClose={() => setZoom(null)}
      />
    </>
  );
}

type ShotState = 'done' | 'pending' | 'failed' | 'removed';

const SHOT_TEXT: Record<ShotState, string> = {
  done: 'Ready',
  pending: 'Not rendered yet',
  failed: "Didn't render",
  removed: 'Removed from your library',
};

function shotState(
  shot: CloseupShot,
  still: Still | undefined,
  jobStatus: CloseupJob['status'],
  libraryLoaded: boolean
): ShotState {
  if (still?.status === 'succeeded') return 'done';
  if (jobStatus === 'done' && shot.stillId !== undefined && still === undefined && libraryLoaded) return 'removed';
  if (still?.status === 'failed' || shot.error) return 'failed';
  return 'pending';
}

type ShotStripProps = {
  shots: readonly CloseupShot[];
  jobId: string;
  jobStatus: CloseupJob['status'];
  aspect: string;
  stillById: ReadonlyMap<string, Still>;
  libraryLoaded: boolean;
  /** The picture the search looked in, under a close-up not shot yet. */
  sourceThumb: string | null;
  shooting: boolean;
  value: number;
  onPick: (job: string, index: number) => void;
};

/** The close-ups found, as a row of cards in the strip. A radio group: arrow
 * keys move, the chosen card is the one on the canvas. Memoised, so a poll
 * that changes nothing here doesn't re-render it. */
const ShotStrip = memo(function ShotStrip({
  shots,
  jobId,
  jobStatus,
  aspect,
  stillById,
  libraryLoaded,
  sourceThumb,
  shooting,
  value,
  onPick,
}: ShotStripProps) {
  return (
    <RadioGroup
      className={own.strip}
      aria-label="Close-ups found"
      value={String(value)}
      onChange={(v) => onPick(jobId, Number(v))}
      orientation="horizontal"
    >
      {shots.map((shot, i) => {
        const still = shot.stillId ? stillById.get(shot.stillId) : undefined;
        const state = shotState(shot, still, jobStatus, libraryLoaded);
        const text = state === 'pending' && shooting ? 'Shooting' : SHOT_TEXT[state];
        const thumb = state === 'done' && still ? stillThumbUrl(still.id) : sourceThumb;
        return (
          <Radio
            key={`${jobId}-${i}`}
            value={String(i)}
            className={own.card}
            data-shot={state}
            aria-label={`Close-up ${i + 1}: ${sentenceCase(shot.subject)}, ${text.toLowerCase()}`}
          >
            <span className={own.thumb} style={{ aspectRatio: aspect }}>
              {thumb && <img src={thumb} alt="" loading="lazy" decoding="async" />}
              {state !== 'done' && (
                <span className={own.badge} aria-hidden>
                  {state === 'pending' ? <Clock size={12} /> : <CircleAlert size={12} />}
                </span>
              )}
            </span>
            <span className={own.cardText} aria-hidden>
              <span className={own.cardTitle}>{sentenceCase(shot.subject)}</span>
              <span className={own.cardSub}>{text}</span>
            </span>
          </Radio>
        );
      })}
    </RadioGroup>
  );
});

/** The planner writes subjects as phrases ("the bronze crane…"); labels start with a capital, the stored text unchanged. */
function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function clipCaption(c: { videoModel: Parameters<typeof videoModelName>[0]; motion: Parameters<typeof motionLabel>[0]; moveStyle?: Parameters<typeof motionLabel>[1]; speed?: Parameters<typeof motionLabel>[2] }): string {
  return `${motionLabel(c.motion, c.moveStyle, c.speed)}, ${videoModelName(c.videoModel)}`;
}

/** A still picker card's two lines: its look, then its model, resolution and time. */
function stillLines(s: Still): [string, string] {
  const res = imageResolutionName(s.imageModel, s.resolution);
  const when = new Date(s.createdAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return [lookLabel(s.look, litFromReference(s)), `${imageModelName(s.imageModel)}${res ? `, ${res}` : ''}, ${when}`];
}
