import { Download, Focus, Maximize2, RotateCcw } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CloseupJob, CloseupShot } from '../closeups-api.ts';
import type { Still } from '../api.ts';
import {
  defaultImageResolution,
  IMAGE_MODELS,
  imageModelName,
  imageResolutions,
  motionLabel,
  videoModelName,
  type ImageModelId,
} from '../models.ts';
import { Section } from './layouts/Section.tsx';
import { libraryUrl, stillThumbUrl, stillViewUrl, useDownload } from './lib/download.ts';
import { classifyRunwayError } from './lib/runwayErrors.ts';
import { isUploadFailure, uploadRender } from './lib/uploadRender.ts';
import { trpc } from './trpc.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { EmptyState } from './ui/EmptyState.tsx';
import { FilterChips } from './ui/FilterChips.tsx';
import { ImageDropZone } from './ui/ImageDropZone.tsx';
import { ImagePicker } from './ui/ImagePicker.tsx';
import { Lightbox } from './ui/Lightbox.tsx';
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
};

export function CloseupsPage({ active, onGoToStills, onAnimate }: CloseupsPageProps) {
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
  const [imageModel, setImageModel] = useState<ImageModelId>('nano-banana-pro');
  const [resolution, setResolution] = useState(defaultImageResolution('nano-banana-pro'));
  const [direction, setDirection] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<{ id: string; title: string } | null>(null);

  const find = trpc.closeups.find.useMutation();
  const analyze = trpc.closeups.analyze.useMutation();
  const render = trpc.closeups.render.useMutation();

  const stalledRef = useRef(false);
  // With no search started here yet, this is the newest one, so a reload picks up where it was.
  const job = trpc.closeups.job.useQuery(jobId ? { id: jobId } : {}, {
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
  const analyzeMutate = analyze.mutate;
  const renderMutate = render.mutate;
  const refetchJob = job.refetch;
  // A search already running when the page loaded is picked up and watched.
  // One paused before a paid step waits for "Continue", so a reload never spends.
  useEffect(() => {
    if (!jobId && currentId && (currentStatus === 'capturing' || currentStatus === 'finding' || currentStatus === 'rendering')) {
      setJobId(currentId);
    }
  }, [jobId, currentId, currentStatus]);
  const startStep = useCallback(
    (id: string, status: CloseupJob['status'] | undefined) => {
      if (status === 'captured') {
        analyzeMutate({ id }, { onSettled: () => void refetchJob() });
      } else if (status === 'picked') {
        renderMutate(
          { id },
          {
            onSettled: () => {
              void refetchJob();
              void utils.library.invalidate();
            },
          }
        );
      }
    },
    [analyzeMutate, renderMutate, refetchJob, utils]
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
        src: stillThumbUrl(c.stillId),
        alt: `Video: ${clipCaption(c)}`,
        caption: clipCaption(c),
      })),
    [clips, shown]
  );
  const stillItems = useMemo(
    () =>
      stills.slice(0, shown).map((s) => ({
        id: s.id,
        src: stillThumbUrl(s.id),
        alt: `Still: ${stillCaption(s)}`,
        caption: stillCaption(s),
      })),
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
    if (!ready || working) return;
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
    }
  }

  /** Retry whichever step failed, or continue a paused search, with the same settings. */
  function retryStep() {
    if (!current) return;
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
      ? stillViewUrl(selectedClip.stillId)
      : kind === 'still' && selectedStill
        ? stillViewUrl(selectedStill.id)
        : kind === 'upload' && upload
          ? upload.src
          : null;

  return (
    <>
      <div className={styles.layout}>
        <div className={styles.controls}>
          <PageHeader
            title="Find the close-ups"
            description="Pick a video, a still or an image of your own. The app finds the most cinematic details in it and shoots each one as a close-up."
          />
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
                  <ImageDropZone onFile={(f) => void onFile(f)} disabled={working || uploading} actionLabel={upload ? 'Replace image' : 'Choose an image'}>
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
                options={IMAGE_MODELS}
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
            </div>
          </Section>

          <div className={styles.actionBar}>
            <Button
              variant="primary"
              className={styles.generate}
              icon={<Focus size={16} />}
              loading={working}
              disabled={!ready}
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
            <Text tone="muted" size="sm" as="p" className={styles.meta}>
              Claude looks for the shots, then {imageModelName(imageModel)} makes {count} close-ups. Billed to your
              own Runway credits: a few for the search, and each close-up costs the same as a still.
            </Text>
            <RunwayErrorNotice
              error={stepError}
              modelName={find.error || analyze.error ? 'Claude' : imageModelName(current?.imageModel ?? imageModel)}
              onRetry={() => (find.error ? void run() : retryStep())}
            />
          </div>
        </div>

        <div className={styles.result} data-stage>
          <Section title="Close-ups">
            {showShots && current ? (
              <>
                <div className={own.shots}>
                  {shots.map((shot, i) => (
                    <ShotCard
                      key={`${current.id}-${i}`}
                      shot={shot}
                      index={i}
                      jobId={current.id}
                      jobStatus={current.status}
                      aspect={`${current.width} / ${current.height}`}
                      still={shot.stillId ? stillById.get(shot.stillId) : undefined}
                      libraryLoaded={library.data !== undefined}
                      onZoom={openZoom}
                      onAnimate={onAnimate}
                    />
                  ))}
                </div>
                <Text tone="muted" size="sm" as="p" className={own.saved}>
                  Every close-up is saved to your library, tagged @close-up.
                </Text>
              </>
            ) : (
              <div className={styles.resultFrame} style={{ aspectRatio: aspect, ['--ar' as string]: aspect }}>
                {paused && current ? (
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
                ) : working ? (
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
                ) : current?.status === 'failed' && current.id === jobId ? (
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
                ) : sourcePreview ? (
                  <img className={styles.image} src={sourcePreview} alt="The source to search for close-ups" decoding="async" />
                ) : (
                  <EmptyState
                    title="Your close-ups will appear here"
                    hint="Pick a video, a still or an image, then press Find close-ups."
                  />
                )}
              </div>
            )}
          </Section>
          {job.error && (
            <div className={own.pollError}>
              <RunwayErrorNotice error={job.error} modelName="Claude" onRetry={() => void job.refetch()} />
            </div>
          )}
        </div>
      </div>

      <Lightbox
        src={zoom ? stillViewUrl(zoom.id) : null}
        alt={zoom ? `Close-up: ${zoom.title}` : ''}
        title={zoom?.title ?? ''}
        onClose={() => setZoom(null)}
      />
    </>
  );
}

type ShotCardProps = {
  shot: CloseupShot;
  index: number;
  jobId: string;
  jobStatus: CloseupJob['status'];
  aspect: string;
  still: Still | undefined;
  libraryLoaded: boolean;
  onZoom: (id: string, title: string) => void;
  onAnimate: (stillId: string) => void;
};

/** One close-up on the contact sheet. Memoised, with its own download state,
 * so a poll or one card's download doesn't re-render the others. */
const ShotCard = memo(function ShotCard({
  shot,
  index,
  jobId,
  jobStatus,
  aspect,
  still,
  libraryLoaded,
  onZoom,
  onAnimate,
}: ShotCardProps) {
  const removed = jobStatus === 'done' && shot.stillId !== undefined && still === undefined && libraryLoaded;
  const saver = useDownload();
  const title = shot.subject;
  return (
    <article className={own.shot}>
      <div className={own.shotFrame} style={{ aspectRatio: aspect }}>
        {still?.status === 'succeeded' ? (
          <button
            type="button"
            className={own.shotButton}
            onClick={() => onZoom(still.id, title)}
            aria-label={`Open full size: ${title}`}
          >
            <img
              className={styles.image}
              src={stillThumbUrl(still.id)}
              alt={`Close-up: ${title}`}
              loading="lazy"
              decoding="async"
            />
          </button>
        ) : removed ? (
          <div className={styles.frameAlert}>
            <Text tone="muted" size="sm" as="p">
              This close-up was removed from your library.
            </Text>
          </div>
        ) : still?.status === 'failed' || shot.error ? (
          <div className={styles.frameAlert}>
            <Alert tone="error" title="This close-up didn't render">
              {still?.error ?? shot.error ?? 'Try finding close-ups again.'}
            </Alert>
          </div>
        ) : (
          <RenderingStatus
            label={jobStatus === 'done' ? 'Shooting the close-up…' : 'Lining up the shot…'}
            runKey={`${jobId}-${index}`}
          />
        )}
      </div>
      <div className={own.shotText}>
        <Text size="sm" className={own.subject}>
          {shot.subject}
        </Text>
        {shot.why && (
          <Text tone="muted" size="sm" as="p">
            {shot.why}
          </Text>
        )}
      </div>
      {still?.status === 'succeeded' && (
        <div className={own.shotActions}>
          <Button
            size="sm"
            icon={<Download size={14} />}
            loading={saver.pending}
            onPress={() => saver.start(libraryUrl('still', still.id), `close-up-${index + 1}.png`)}
          >
            {saver.label('Download')}
          </Button>
          <Button size="sm" variant="ghost" icon={<Maximize2 size={14} />} onPress={() => onZoom(still.id, title)}>
            Full size
          </Button>
          <Button size="sm" variant="ghost" onPress={() => onAnimate(still.id)}>
            Make a video
          </Button>
        </div>
      )}
      {saver.error && (
        <Alert tone="error" title="Download failed">
          {saver.error}
        </Alert>
      )}
    </article>
  );
});

function clipCaption(c: { videoModel: Parameters<typeof videoModelName>[0]; motion: Parameters<typeof motionLabel>[0]; moveStyle?: Parameters<typeof motionLabel>[1]; speed?: Parameters<typeof motionLabel>[2] }): string {
  return `${motionLabel(c.motion, c.moveStyle, c.speed)}, ${videoModelName(c.videoModel)}`;
}

function stillCaption(s: Still): string {
  return s.closeup ? `Close-up: ${s.closeup.subject}` : s.direction?.trim() ? s.direction.trim().slice(0, 60) : `${imageModelName(s.imageModel)} still`;
}
