import { Clapperboard, Download, ExternalLink, Film, ImageUp, ListX, RotateCcw, ScanEye, Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { FileTrigger } from 'react-aria-components';

import type { inferRouterOutputs } from '@trpc/server';

import type { AppRouterType } from '../api.ts';
import { litFromReference, lookLabel } from '../looks.ts';
import { clipSeconds, upscalerName, videoModelName } from '../models.ts';
import {
  estimateRecreateCredits,
  RECREATE_NOTE_MAX,
  DEFAULT_RECREATE_ROUTE,
  OFFERED_RECREATE_ROUTES,
  RECREATE_ROUTES,
  recreateRoute,
  type RecreateRouteId,
  recreateSeconds,
  recreateTitle,
} from '../recreate.ts';
import type { ShotContext } from '../shot-director.ts';
import { DeleteItemDialog, type DeleteTarget } from './DeleteItemDialog.tsx';
import { Section } from './layouts/Section.tsx';
import { type CanvasState, usePhoneLayout } from './layouts/Workspace.tsx';
import { clipPosterUrl, libraryUrl, NO_POSTER, stillThumbUrl, stillViewUrl, useDownload } from './lib/download.ts';
import { classifyRunwayError, errorMessage } from './lib/runwayErrors.ts';
import { useCapabilities } from './lib/useCapabilities.ts';
import { isUploadFailure, uploadClip, uploadImageFull } from './lib/uploadRender.ts';
import { useInFlight } from './lib/useInFlight.ts';
import { useShotPlan } from './lib/useShotPlan.ts';
import { ShotDirector } from './ShotDirector.tsx';
import { trpc } from './trpc.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { CostLine } from './ui/CostLine.tsx';
import { EmptyState } from './ui/EmptyState.tsx';
import { ImagePicker } from './ui/ImagePicker.tsx';
import { BlockedTip, ModelUnavailable } from './ui/ModelUnavailable.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { RenderingStatus } from './ui/RenderingStatus.tsx';
import { RunwayErrorNotice } from './ui/RunwayErrorNotice.tsx';
import { Select } from './ui/Select.tsx';
import { SkeletonBlock } from './ui/Skeleton.tsx';
import { TakeStrip, type TakeState, type TakeStripItem } from './ui/TakeStrip.tsx';
import { Text } from './ui/Text.tsx';
import { TextArea } from './ui/TextArea.tsx';
import { CanvasView, ClipList, clipLabel, type CanvasViewId } from './VideoPage.tsx';
import styles from './Studio.module.css';
import own from './VideoPage.module.css';

const PAGE = 12;
/** Ids whose retry can't succeed: stop asking. */
const FINAL_CODES = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND']);
/** Takes kept in the strip; the oldest finished ones drop off first. */
const MAX_TAKES = 12;
const TAKES_KEY = 'render-to-film:recreate-takes';
/** A still at least this long on its long side counts as 4K; a shorter upload gets a note. */
const FOUR_K_EDGE = 3000;
/** Longest reference the server takes, in seconds. */
const REFERENCE_SECONDS_MAX = 600;
/** Long side of the small copy of an uploaded still kept for the take strip. */
const THUMB_EDGE = 320;

/** One recreation started from this tab, by its step-1 clip id (what `recreate.status` polls). */
type Take = {
  id: string;
  route: RecreateRouteId;
  seconds: number;
  /** The shape of the source still. */
  ratio: string;
  /** The source's thumbnail: a library still's, or a small copy of an upload. */
  thumb: string;
  since: number;
};

/** A reference clip uploaded from this computer; `url` is set once it is up. */
type ClipUpload = {
  key: string;
  name: string;
  /** Object URL, for the preview. */
  src: string;
  url?: string | undefined;
  seconds?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  uploading: boolean;
};

/** A source still uploaded from this computer, at full size; `url` is set once it is up. */
type ImageUpload = {
  key: string;
  name: string;
  /** Object URL, for the preview. */
  src: string;
  /** A small JPEG data URL, kept with the take. */
  thumb?: string | undefined;
  url?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  uploading: boolean;
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
        RECREATE_ROUTES.some((r) => r.id === (t as Take).route) &&
        typeof (t as Take).seconds === 'number' &&
        typeof (t as Take).ratio === 'string' &&
        typeof (t as Take).thumb === 'string' &&
        typeof (t as Take).since === 'number'
    );
  } catch {
    return [];
  }
}

function errorCode(e: unknown): string | undefined {
  return (e as { data?: { code?: string } } | null)?.data?.code;
}

let counter = 0;
const nextKey = () => `recreate-${Date.now().toString(36)}-${counter++}`;

export type RecreateWorkspaceProps = {
  /** True while this tab is on screen; polling slows down when it isn't. */
  active: boolean;
  /** The 4K source as a thumbnail (null with none), so the page can light the room with it. */
  onSourceThumb?: ((url: string | null) => void) | undefined;
  /** A clip the address named: it becomes the reference once, when the library has it. */
  referenceClipId?: string | undefined;
};

/** What the Recreate in 4K mode puts in the Video page's Workspace slots. */
export type RecreateSlots = {
  inspector: ReactNode;
  canvasState: CanvasState;
  canvas: ReactNode;
  aspectRatio: string;
  caption: ReactNode;
  canvasNote: ReactNode;
  canvasToolbar: ReactNode;
  canvasActions: ReactNode;
  strip: ReactNode;
  stripLabel: string;
  footer: ReactNode;
  empty: { title: string; hint: string; action: string; label: string };
  onDropFiles: ((files: File[]) => void) | undefined;
  /** The delete confirmation, mounted once by the page. */
  dialogs: ReactNode;
};

/**
 * The Video tab's Recreate in 4K: a reference clip says how the shot moves, a
 * 4K still is the scene, and the new clip repeats the reference from the
 * still (src/recreate-api.ts). Each take polls its own status, which moves a
 * Kling shot on to its 4K upscale on the server. A hook, not a component: the
 * page calls it on every render (it was always mounted), so its queries,
 * polls and guards run whichever mode is open, and it hands back the
 * Workspace slots for when Recreate is.
 */
export function useRecreateWorkspace({ active, onSourceThumb, referenceClipId }: RecreateWorkspaceProps): RecreateSlots {
  // On a phone the steps wait in the sheet under the picture, so the copy points there.
  const phone = usePhoneLayout();
  const utils = trpc.useUtils();
  const library = trpc.library.useQuery();
  const start = trpc.recreate.start.useMutation();
  const retry = trpc.recreate.retryUpscale.useMutation();
  // A double-click's second press arrives before isPending shows: 110 credits a run.
  const startGuard = useInFlight();
  const retryGuard = useInFlight();
  const saver = useDownload();

  const [refClipId, setRefClipId] = useState<string | null>(null);
  const [refUpload, setRefUpload] = useState<ClipUpload | null>(null);
  const [refError, setRefError] = useState<unknown>(null);
  const [refShown, setRefShown] = useState(PAGE);
  const [srcStillId, setSrcStillId] = useState<string | null>(null);
  const [srcUpload, setSrcUpload] = useState<ImageUpload | null>(null);
  const [srcError, setSrcError] = useState<unknown>(null);
  const [srcShown, setSrcShown] = useState(PAGE);
  const { allowedClipUpscalers, caps, modelBlocked, onBay, providerNote } = useCapabilities();
  const [route, setRoute] = useState<RecreateRouteId>(DEFAULT_RECREATE_ROUTE);
  const [note, setNote] = useState('');
  /** Every recreation started here, newest first; each polls on its own. */
  const [takes, setTakes] = useState<Take[]>(readTakes);
  /** The take on the big screen, or null for the one being set up. */
  const [focusId, setFocusId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  /** The canvas: the takes (the focused one, or the next shot), or every 4K recreation as a contact sheet. */
  const [view, setView] = useState<CanvasViewId>('takes');

  // The uploads as they stand, for the async steps and the unmount clean-up.
  const live = useRef<{ ref: ClipUpload | null; src: ImageUpload | null }>({ ref: null, src: null });
  live.current = { ref: refUpload, src: srcUpload };
  useEffect(
    () => () => {
      if (live.current.ref) URL.revokeObjectURL(live.current.ref.src);
      if (live.current.src) URL.revokeObjectURL(live.current.src.src);
    },
    []
  );

  const statuses = trpc.useQueries((t) =>
    takes.map((take) =>
      t.recreate.status(
        { id: take.id },
        {
          refetchInterval: (q) =>
            q.state.data?.done || FINAL_CODES.has(errorCode(q.state.error) ?? '')
              ? false
              : active
                ? 4000
                : 15_000,
          // The 4K upscale starts on a poll, so polling goes on with the browser tab in the background.
          refetchIntervalInBackground: true,
          refetchOnWindowFocus: false,
          retry: 2,
        }
      )
    )
  );
  // A take moving on to its upscale, or finishing, adds a clip to the library.
  const doneKey = takes
    .map((t, i) => {
      const d = statuses[i]?.data;
      return d && (d.done || d.step === 2) ? `${t.id}:${d.step}:${d.done ? 1 : 0}` : '';
    })
    .filter(Boolean)
    .join(',');
  useEffect(() => {
    if (doneKey) void utils.library.invalidate();
  }, [doneKey, utils]);

  useEffect(() => {
    try {
      sessionStorage.setItem(TAKES_KEY, JSON.stringify(takes));
    } catch {
      // Private mode: the strip just won't survive a reload.
    }
  }, [takes]);

  const finishedClips = useMemo(
    () => (library.data?.clips ?? []).filter((c) => c.status === 'succeeded'),
    [library.data]
  );
  const fourKStills = useMemo(
    () =>
      (library.data?.stills ?? []).filter(
        (s) => s.status === 'succeeded' && Math.max(s.width, s.height) >= FOUR_K_EDGE
      ),
    [library.data]
  );
  // Only a still that is in the library gets a thumbnail request; a deleted one would 404.
  const stillIds = useMemo(() => new Set((library.data?.stills ?? []).map((s) => s.id)), [library.data]);
  const refItems = useMemo(
    () =>
      finishedClips.slice(0, refShown).map((c) => ({
        id: c.id,
        src: clipPosterUrl(c, stillIds) ?? NO_POSTER,
        alt: `${clipLabel(c)}, made on ${new Date(c.createdAt).toLocaleString()}`,
        caption: clipLabel(c),
      })),
    [finishedClips, refShown, stillIds]
  );
  const srcItems = useMemo(
    () =>
      fourKStills.slice(0, srcShown).map((s) => {
        // Two lines: the look, then the size and when it was made; the tooltip holds both.
        const look = lookLabel(s.look, litFromReference(s));
        const when = new Date(s.createdAt).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
        const detail = `${s.width}×${s.height}${s.upscaleOf ? `, upscaled ${s.scale ?? ''}×` : ''}, ${when}`;
        return {
          id: s.id,
          src: stillThumbUrl(s.id),
          alt: `Still ${s.width}×${s.height}, made on ${new Date(s.createdAt).toLocaleString()}`,
          caption: look,
          detail,
          title: `${look}, ${detail}`,
        };
      }),
    [fourKStills, srcShown]
  );

  const refClip = refClipId ? (finishedClips.find((c) => c.id === refClipId) ?? null) : null;
  const srcStill = srcStillId ? (fourKStills.find((s) => s.id === srcStillId) ?? null) : null;
  const referenceSeconds = refClip
    ? clipSeconds(refClip.videoModel, refClip.length, refClip.seconds)
    : refUpload?.seconds;
  const seconds = recreateSeconds(route, referenceSeconds);
  const routeInfo = recreateRoute(route);
  const recreateOff = caps.recreate ? null : 'Recreate in 4K needs Higgsfield. Switch in Settings.';
  const modelOff = modelBlocked('video', routeInfo.model);
  const blocked = recreateOff ?? modelOff;
  // Its hint carries a credit guide for Bay; another provider prices the run itself.
  const routes = OFFERED_RECREATE_ROUTES.filter((r) => !modelBlocked('video', r.model)).map((r) => {
    const hint = onBay ? r.hint : r.hint.split(' About ')[0];
    const note = caps.notes[r.model];
    return { ...r, hint: note ? `${hint} ${note}.` : hint };
  });
  const uploading = !!refUpload?.uploading || !!srcUpload?.uploading;
  const reference = refClip
    ? { clipId: refClip.id }
    : refUpload?.url
      ? {
          uploadUrl: refUpload.url,
          ...(refUpload.seconds !== undefined
            ? { seconds: Math.min(REFERENCE_SECONDS_MAX, refUpload.seconds) }
            : {}),
        }
      : null;
  const sourceShape = srcStill
    ? { width: srcStill.width, height: srcStill.height }
    : srcUpload?.width && srcUpload.height
      ? { width: srcUpload.width, height: srcUpload.height }
      : null;
  const source = srcStill
    ? { stillId: srcStill.id }
    : srcUpload?.url && sourceShape
      ? { uploadUrl: srcUpload.url, ...sourceShape }
      : null;
  const noteTooLong = note.length > RECREATE_NOTE_MAX;
  const { planBlocked, unavailable } = classifyRunwayError(start.error);
  // The shot director reads the 4K source for what is in it and what may
  // move; the reference clip sets the camera, so any move is kept as named
  // and no crops are cut (src/recreate-api.ts adds only the inventory lock).
  const shotContext: ShotContext | null =
    source && sourceShape
      ? {
          videoModel: routeInfo.model,
          width: sourceShape.width,
          height: sourceShape.height,
          people: true,
          userKeyframes: true,
          canEndFrame: false,
        }
      : null;
  const shot = useShotPlan({
    page: 'recreate',
    first: source,
    videoModel: routeInfo.model,
    seconds,
    motion: 'still-life',
    direction: note,
    context: shotContext,
  });
  const directing = shot.enabled && shot.planning;
  // With the director on, the first press plans (a text call) and the second recreates.
  const directFirst = !directing && shot.needsPlan && source !== null;

  // A take is in flight until a final status arrives: a failed poll never
  // frees it, or "Check again" would turn into a second bill.
  const takeStates: TakeState[] = takes.map((_, i) => {
    const q = statuses[i];
    if (q?.data?.done) return q.data.url && q.data.finalId && !q.data.error ? 'ready' : 'failed';
    if (q?.error) return 'lost';
    return q?.data?.status === 'PENDING' || q?.data?.status === 'THROTTLED' ? 'queued' : 'rendering';
  });
  const inFlight = takeStates.filter((st) => st !== 'ready' && st !== 'failed').length;
  const readyCount = takes.length - inFlight;
  const focusIndex = focusId ? takes.findIndex((t) => t.id === focusId) : -1;
  const focus = focusIndex >= 0 ? takes[focusIndex]! : null;
  const focusStatus = focusIndex >= 0 ? statuses[focusIndex] : undefined;
  const focusState = focusIndex >= 0 ? takeStates[focusIndex] : undefined;

  function pickReference(id: string) {
    if (live.current.ref) URL.revokeObjectURL(live.current.ref.src);
    setRefUpload(null);
    setRefError(null);
    setRefClipId(id);
    setFocusId(null);
    start.reset();
  }

  const adopted = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!referenceClipId || adopted.current === referenceClipId) return;
    const at = finishedClips.findIndex((c) => c.id === referenceClipId);
    if (at < 0) return;
    adopted.current = referenceClipId;
    pickReference(referenceClipId);
    setRefShown((n) => Math.max(n, Math.ceil((at + 1) / PAGE) * PAGE));
  }, [referenceClipId, finishedClips]);

  function clearReferenceUpload() {
    if (live.current.ref) URL.revokeObjectURL(live.current.ref.src);
    setRefUpload(null);
  }

  async function addReferenceFile(file: File) {
    if (live.current.ref) URL.revokeObjectURL(live.current.ref.src);
    const key = nextKey();
    const src = URL.createObjectURL(file);
    setRefUpload({ key, name: file.name, src, uploading: true });
    setRefClipId(null);
    setRefError(null);
    setFocusId(null);
    start.reset();
    const patch = (p: Partial<ClipUpload>) => setRefUpload((u) => (u?.key === key ? { ...u, ...p } : u));
    void measureClip(src).then(patch);
    try {
      patch({ url: await uploadClip(file), uploading: false });
    } catch (e) {
      if (live.current.ref?.key !== key) return;
      URL.revokeObjectURL(src);
      setRefUpload(null);
      setRefError(uploadError(e, 'That clip could not be uploaded. Try again.'));
    }
  }

  function pickSource(id: string) {
    if (live.current.src) URL.revokeObjectURL(live.current.src.src);
    setSrcUpload(null);
    setSrcError(null);
    setSrcStillId(id);
    setFocusId(null);
    start.reset();
  }

  function clearSourceUpload() {
    if (live.current.src) URL.revokeObjectURL(live.current.src.src);
    setSrcUpload(null);
  }

  async function addSourceFile(file: File) {
    if (live.current.src) URL.revokeObjectURL(live.current.src.src);
    const key = nextKey();
    const src = URL.createObjectURL(file);
    setSrcUpload({ key, name: file.name, src, uploading: true });
    setSrcStillId(null);
    setSrcError(null);
    setFocusId(null);
    start.reset();
    const patch = (p: Partial<ImageUpload>) => setSrcUpload((u) => (u?.key === key ? { ...u, ...p } : u));
    try {
      patch(await readImage(file));
      patch({ url: await uploadImageFull(file), uploading: false });
    } catch (e) {
      if (live.current.src?.key !== key) return;
      URL.revokeObjectURL(src);
      setSrcUpload(null);
      setSrcError(uploadError(e, 'That image could not be uploaded. Try again.'));
    }
  }

  function dropTake(id: string) {
    setTakes((prev) => prev.filter((t) => t.id !== id));
    setFocusId((f) => (f === id ? null : f));
  }

  function clearFinished() {
    const keep = new Set(takes.filter((_, i) => takeStates[i] !== 'ready' && takeStates[i] !== 'failed').map((t) => t.id));
    setTakes((prev) => prev.filter((t) => keep.has(t.id)));
    setFocusId((f) => (f && keep.has(f) ? f : null));
  }

  async function run() {
    if (!reference || !source || uploading || noteTooLong || blocked) return;
    // With the director on, the recreation waits for a plan made for this still.
    if (shot.needsPlan) return;
    if (!startGuard.start()) return;
    try {
      const res = await start.mutateAsync({
        reference,
        source,
        route,
        note,
        ...(shot.sendable ? { shot: shot.sendable } : {}),
      });
      const take: Take = {
        id: res.id,
        route: res.route,
        seconds: res.seconds,
        ratio: frameRatio(sourceShape),
        thumb: srcStill ? stillThumbUrl(srcStill.id) : (srcUpload?.thumb ?? NO_POSTER),
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
        return oldDone ? next.filter((t) => t !== oldDone) : next;
      });
      setFocusId(res.id);
      setView('takes');
    } catch {
      // Shown by RunwayErrorNotice from start.error.
    } finally {
      startGuard.end();
    }
  }

  async function retryUpscale(id: string, refetch: () => Promise<unknown>) {
    if (!retryGuard.start()) return;
    try {
      await retry.mutateAsync({ id });
    } catch {
      // Shown on the take from retry.error.
      return;
    } finally {
      retryGuard.end();
    }
    await refetch();
  }

  // The clips the stage already shows rendering stay off the contact sheet.
  const rolling = new Set<string>();
  takes.forEach((t, i) => {
    const d = statuses[i]?.data;
    if (d?.done) return;
    rolling.add(t.id);
    if (d?.finalId) rolling.add(d.finalId);
  });
  const recreations = (library.data?.clips ?? []).filter(
    (c) => c.recreate && (c.recreate.route === 'seedance-4k' || c.recreate.step === 2) && !rolling.has(c.id)
  );
  /**
   * A take's picture: its library clip's poster, else the one kept with the
   * take, unless that is the thumbnail of a source still since deleted.
   */
  const takeThumb = (t: Take): string => {
    const clip = library.data?.clips.find((c) => c.id === t.id);
    if (!clip) return t.thumb;
    return clipPosterUrl(clip, stillIds) ?? (clip.stillId ? NO_POSTER : t.thumb);
  };
  const stripItems: TakeStripItem[] = takes.map((t, i) => ({
    id: t.id,
    thumb: takeThumb(t),
    title: recreateRoute(t.route).name,
    state: takeStates[i]!,
    progress: statuses[i]?.data?.progress,
    since: t.since,
  }));
  const refName = refClip ? clipLabel(refClip) : refUpload?.name;
  const srcName = srcStill
    ? `${srcStill.width}×${srcStill.height} still`
    : srcUpload?.name;
  const sourceThumb = srcStill ? stillThumbUrl(srcStill.id) : (srcUpload?.thumb ?? null);
  useEffect(() => {
    onSourceThumb?.(sourceThumb);
  }, [onSourceThumb, sourceThumb]);
  const smallSource =
    srcUpload?.width && srcUpload.height && Math.max(srcUpload.width, srcUpload.height) < FOUR_K_EDGE
      ? `${srcUpload.width}×${srcUpload.height}`
      : null;

  const inspector = (
    <>
      <PageHeader
        title="Recreate in 4K"
        description="Pick a clip to copy and a 4K still to shoot it from. The new clip repeats the reference's camera move and action, rendered from your still."
      />
      {recreateOff && <ModelUnavailable message={recreateOff} />}

      <Section
        step={1}
        title="Reference clip"
        description="How the shot moves: its camera move, action and timing. Upload it, or pick one of your clips."
      >
        <div className={styles.stack}>
          {refUpload && (
            <div className={styles.castBody}>
              <figure className={styles.castThumb}>
                <video
                  className={styles.image}
                  src={refUpload.src}
                  muted
                  loop
                  autoPlay
                  playsInline
                  aria-label={`Reference clip: ${refUpload.name}`}
                />
              </figure>
              <div className={styles.castSide}>
                <Text size="sm" as="p" className={styles.castName}>
                  {refUpload.name}
                </Text>
                <Text tone="muted" size="sm" as="p" className={styles.frameNote}>
                  {[
                    refUpload.seconds !== undefined
                      ? `${refUpload.seconds.toFixed(1)} seconds`
                      : refUpload.uploading
                        ? ''
                        : 'Length unknown, so 5 seconds',
                    refUpload.width && refUpload.height ? `${refUpload.width}×${refUpload.height}` : '',
                    refUpload.uploading ? 'Uploading…' : '',
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </Text>
                <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onPress={clearReferenceUpload}>
                  Remove
                </Button>
              </div>
            </div>
          )}
          <div>
            <FileTrigger
              acceptedFileTypes={['video/mp4', 'video/quicktime']}
              onSelect={(files) => {
                const file = files?.[0];
                if (file) void addReferenceFile(file);
              }}
            >
              <Button size="sm" icon={<Film size={14} />}>
                {refUpload ? 'Upload another clip' : 'Upload a clip'}
              </Button>
            </FileTrigger>
          </div>
          <UploadError error={refError} title="That clip didn't upload" />
          {library.isLoading ? (
            <SkeletonBlock height={180} />
          ) : library.error && !library.data ? (
            <RunwayErrorNotice error={library.error} modelName="your library" />
          ) : finishedClips.length > 0 ? (
            <>
              <Text tone="muted" size="sm" as="p" className={styles.frameNote}>
                Or pick one of your clips
              </Text>
              <ImagePicker
                label="Reference clip"
                value={refClip?.id ?? null}
                onChange={pickReference}
                items={refItems}
              />
              {finishedClips.length > refShown && (
                <div>
                  <Button size="sm" variant="ghost" onPress={() => setRefShown((n) => n + PAGE)}>
                    Show {Math.min(PAGE, finishedClips.length - refShown)} more
                  </Button>
                </div>
              )}
            </>
          ) : null}
        </div>
      </Section>

      <Section
        step={2}
        title="Source still (4K)"
        description="The first frame and the whole look. The clip is shot from it at full size."
      >
        <div className={styles.stack}>
          {srcUpload && (
            <div className={styles.castBody}>
              <figure className={styles.castThumb}>
                <img
                  className={styles.image}
                  src={srcUpload.src}
                  alt={`Source still: ${srcUpload.name}`}
                  data-dimmed={srcUpload.uploading ? '' : undefined}
                />
              </figure>
              <div className={styles.castSide}>
                <Text size="sm" as="p" className={styles.castName}>
                  {srcUpload.name}
                </Text>
                <Text tone="muted" size="sm" as="p" className={styles.frameNote}>
                  {[
                    srcUpload.width && srcUpload.height ? `${srcUpload.width}×${srcUpload.height}` : '',
                    srcUpload.uploading ? 'Uploading…' : '',
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </Text>
                <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onPress={clearSourceUpload}>
                  Remove
                </Button>
              </div>
            </div>
          )}
          {smallSource && (
            <Text tone="muted" size="sm" as="p" className={styles.frameNote}>
              This image is {smallSource}. A 4K still is 3840 px on its long side; the result will not be
              sharper than the source.
            </Text>
          )}
          <div>
            <FileTrigger
              acceptedFileTypes={['image/png', 'image/jpeg', 'image/webp']}
              onSelect={(files) => {
                const file = files?.[0];
                if (file) void addSourceFile(file);
              }}
            >
              <Button size="sm" icon={<ImageUp size={14} />}>
                {srcUpload ? 'Upload another image' : 'Upload a 4K image'}
              </Button>
            </FileTrigger>
          </div>
          <UploadError error={srcError} title="That image didn't upload" />
          {fourKStills.length > 0 && (
            <>
              <Text tone="muted" size="sm" as="p" className={styles.frameNote}>
                Or pick a 4K still from your library
              </Text>
              <ImagePicker
                label="Or pick a 4K still from your library"
                value={srcStill?.id ?? null}
                onChange={pickSource}
                items={srcItems}
              />
              {fourKStills.length > srcShown && (
                <div>
                  <Button size="sm" variant="ghost" onPress={() => setSrcShown((n) => n + PAGE)}>
                    Show {Math.min(PAGE, fourKStills.length - srcShown)} more
                  </Button>
                </div>
              )}
            </>
          )}
          {/* Under the source: what the still holds, and what in it may move. */}
          {source && (
            <ShotDirector
              shot={shot}
              context={shotContext}
              seconds={seconds}
              cameraLocked="The reference clip sets the camera."
              disabled={start.isPending || uploading || recreateOff !== null}
            />
          )}
        </div>
      </Section>

      <Section step={3} title="Route" description="How the 4K clip is made.">
        <div className={styles.stack}>
          <Select
            label="Route"
            options={routes}
            value={route}
            onChange={(id) => {
              setRoute(id as RecreateRouteId);
              start.reset();
            }}
          />
          {modelOff && !recreateOff && <ModelUnavailable message={modelOff} />}
          {onBay && (
            <Text tone="muted" size="sm" as="p" className={styles.frameNote}>
              {routeInfo.name}: about {estimateRecreateCredits(route, seconds)} credits for {seconds} seconds
              (Higgsfield quote).
            </Text>
          )}
        </div>
      </Section>

      <Section step={4} title="Note" description="Optional. Anything to keep or change, in a sentence.">
        <div className={styles.stack}>
          <TextArea
            aria-label="Note for the recreation"
            value={note}
            onChange={setNote}
            rows={3}
            maxLength={RECREATE_NOTE_MAX}
            placeholder="e.g. the people walk a little slower"
          />
          {noteTooLong && (
            <Alert tone="error" title="Your note is too long">
              Shorten it by {note.length - RECREATE_NOTE_MAX} characters to start.
            </Alert>
          )}
        </div>
      </Section>
    </>
  );

  const footer = (
    <>
      <BlockedTip message={blocked}>
        <Button
          variant="primary"
          size="lg"
          icon={directing || directFirst ? <ScanEye size={18} /> : <Clapperboard size={18} />}
          loading={start.isPending || directing}
          disabled={
            blocked !== null ||
            directing ||
            (directFirst
              ? uploading || noteTooLong
              : start.isPending || uploading || !reference || !source || noteTooLong || planBlocked || unavailable)
          }
          onPress={directFirst ? () => void shot.direct() : () => void run()}
        >
          {start.isPending
            ? 'Starting…'
            : uploading
              ? 'Uploading…'
              : directing
                ? 'Directing the shot…'
                : directFirst
                  ? 'Direct the shot'
                  : !reference
                    ? 'Pick a reference clip'
                    : !source
                      ? 'Add a 4K still'
                      : 'Recreate in 4K'}
        </Button>
      </BlockedTip>
      <CostLine
        summary={
          recreateOff ??
          (directing || directFirst
            ? 'Directing is one text call on your AI text provider (Settings); the video is not billed until you make it.'
            : route === 'kling-upscale'
              ? `Kling 4.0 at 1080p, then a 4K upscale${onBay ? '' : ` with ${upscalerName(allowedClipUpscalers[0]?.id)}`}, ${seconds} seconds${shot.sendable ? ', directed' : ''}.`
              : `Seedance 2.0 at 4K, ${seconds} seconds${shot.sendable ? ', directed' : ''}.`)
        }
        providerNote={recreateOff || directing || directFirst ? undefined : providerNote(routeInfo.model)}
      />
      <p className={styles.queueNote} role="status" aria-live="polite">
        {inFlight > 0
          ? `${inFlight} recreation${inFlight === 1 ? '' : 's'} rendering. You can set up the next one meanwhile.`
          : ''}
      </p>
      <RunwayErrorNotice error={start.error} modelName={videoModelName(routeInfo.model)} onRetry={() => void run()} />
    </>
  );

  // ---- The canvas: every 4K recreation, the focused take, or the next one being set up.
  const showClips = view === 'clips';
  const hasSource = srcStill !== null || srcUpload !== null;
  const canvasState: CanvasState = showClips ? 'free' : focus && focusStatus ? 'live' : hasSource ? 'preview' : 'empty';
  const focusFinal = focus && focusState === 'ready' ? (focusStatus?.data?.finalId ?? null) : null;
  const focusUrl = focusFinal ? libraryUrl('clip', focusFinal) : '';
  const focusTitle = focus ? recreateTitle({ route: focus.route, step: focus.route === 'kling-upscale' ? 2 : 1 }) : '';

  let canvas: ReactNode = null;
  if (showClips) {
    canvas = (
      <div className={own.sheet}>
        <Section title="Your 4K recreations" description="Every clip recreated here, newest first.">
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
          ) : recreations.length === 0 ? (
            <EmptyState
              title="No 4K recreations yet"
              hint="Every clip you recreate in 4K is kept here so you can watch or download it later."
            />
          ) : (
            <ClipList
              clips={recreations}
              stills={library.data?.stills ?? []}
              onDelete={(c) => setDeleting({ kind: 'clip', id: c.id, title: clipLabel(c) })}
            />
          )}
        </Section>
      </div>
    );
  } else if (focus && focusStatus) {
    canvas = (
      <TakeCanvas
        key={focus.id}
        take={{ ...focus, thumb: takeThumb(focus) }}
        status={focusStatus}
        state={focusState!}
        retrying={retry.isPending && retry.variables?.id === focus.id}
        retryError={retry.variables?.id === focus.id ? retry.error : null}
        onRetryUpscale={(refetch) => void retryUpscale(focus.id, refetch)}
        onDismiss={() => dropTake(focus.id)}
      />
    );
  } else if (hasSource) {
    canvas = (
      <>
        <img src={srcStill ? stillViewUrl(srcStill.id) : srcUpload!.src} alt={`Source still: ${srcName ?? ''}`} />
        {(refClip || refUpload) && (
          <figure className={own.pip}>
            <video
              key={refClip?.id ?? refUpload?.key}
              src={refClip ? libraryUrl('clip', refClip.id) : refUpload!.src}
              poster={refClip ? (clipPosterUrl(refClip, stillIds) ?? NO_POSTER) : undefined}
              muted
              loop
              autoPlay
              playsInline
              preload="metadata"
              aria-label={`Reference clip: ${refName ?? ''}`}
            />
          </figure>
        )}
      </>
    );
  }

  const caption: ReactNode = focus
    ? saver.error && focusFinal
      ? <span role="alert">Download failed. {saver.error}</span>
      : focusState === 'ready'
        ? [focusTitle, `${focus.seconds} seconds`]
        : focusState === 'rendering' || focusState === 'queued'
          ? [
              recreateRoute(focus.route).name,
              `${focus.seconds} seconds`,
              'Keep working: set up the next one and it renders alongside this one',
            ]
          : [recreateRoute(focus.route).name, `${focus.seconds} seconds`]
    : [refName ? `Reference: ${refName}` : 'Pick a reference clip', routeInfo.name, `${seconds} seconds`];

  const canvasActions = focusFinal ? (
    <>
      <Button
        variant="ghost"
        icon={<Download size={16} />}
        loading={saver.pending}
        onPress={() => saver.start(focusUrl, `recreate-4k-${focusFinal}.mp4`)}
      >
        {saver.label('Download')}
      </Button>
      <Button variant="ghost" icon={<ExternalLink size={16} />} onPress={() => window.open(focusUrl, '_blank', 'noopener')}>
        Open full size
      </Button>
    </>
  ) : undefined;

  const canvasToolbar = (
    <>
      <CanvasView view={view} onChange={setView} clipsLabel="Your 4K recreations" />
      {readyCount > 0 && view === 'takes' && (
        <Button size="sm" variant="ghost" icon={<ListX size={14} />} onPress={clearFinished}>
          Clear finished
        </Button>
      )}
    </>
  );

  const strip =
    takes.length > 0 ? (
      <div className={own.takes}>
        <TakeStrip
          label="Recreations from this session"
          items={stripItems}
          value={focus ? focus.id : null}
          onChange={(id) => {
            setFocusId(id);
            setView('takes');
          }}
          next={{
            thumb: srcStill ? stillThumbUrl(srcStill.id) : srcUpload?.thumb,
            title: srcName ?? 'Add a 4K still',
          }}
        />
      </div>
    ) : undefined;

  const dialogs = (
    <DeleteItemDialog
      target={deleting}
      onClose={() => setDeleting(null)}
      onDeleted={(t) => {
        if (t.kind !== 'clip') return;
        const gone = new Set(
          takes.filter((tk, i) => tk.id === t.id || statuses[i]?.data?.finalId === t.id).map((tk) => tk.id)
        );
        setTakes((prev) => prev.filter((tk) => !gone.has(tk.id)));
        setFocusId((f) => (f && gone.has(f) ? null : f));
      }}
    />
  );

  return {
    inspector,
    canvasState,
    canvas,
    aspectRatio: focus && !showClips ? focus.ratio : frameRatio(sourceShape),
    caption,
    canvasNote: 'Your 4K recreation will appear here',
    canvasToolbar,
    canvasActions,
    strip,
    stripLabel: 'Takes',
    footer,
    empty: {
      title: 'Drop a 4K still to begin',
      hint: phone
        ? 'PNG, JPEG or WebP, 3840 px on its long side: the first frame and the look. Pick the reference clip in the panel below.'
        : 'PNG, JPEG or WebP, 3840 px on its long side: the first frame and the look. Pick the reference clip in step 1.',
      action: 'Choose a 4K still',
      label: 'Drop or choose a 4K still',
    },
    onDropFiles: showClips
      ? undefined
      : (files) => {
          const file = files[0];
          if (file) void addSourceFile(file);
        },
    dialogs,
  };
}

/** The slice of a take's status query the big screen reads. */
type StatusQuery = {
  data?: inferRouterOutputs<AppRouterType>['recreate']['status'] | undefined;
  error: unknown;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
};

/** One recreation inside the canvas frame: its step while it renders, the 4K
 * clip, or why it stopped (its actions and caption are the page's slots). */
function TakeCanvas({
  take,
  status,
  state,
  retrying,
  retryError,
  onRetryUpscale,
  onDismiss,
}: {
  take: Take;
  status: StatusQuery;
  state: TakeState;
  retrying: boolean;
  retryError: unknown;
  onRetryUpscale: (refetch: () => Promise<unknown>) => void;
  onDismiss: () => void;
}) {
  const { caps } = useCapabilities();
  const data = status.data;
  const twoSteps = take.route === 'kling-upscale';
  const title = recreateTitle({ route: take.route, step: twoSteps ? 2 : 1 });
  const pollFinal = FINAL_CODES.has(errorCode(status.error) ?? '');
  const special = status.error ? classifyRunwayError(status.error) : null;
  const needsPrompt = special && (special.signIn || special.credits || special.consent);

  if (state === 'ready' && data?.finalId) {
    return (
      <video
        src={libraryUrl('clip', data.finalId)}
        poster={take.thumb}
        controls
        muted
        loop
        playsInline
        preload="metadata"
        aria-label={`Video: ${title}`}
      />
    );
  }

  const error = data?.error;
  const budget = error?.startsWith('Real-mode budget reached') ?? false;
  if (state === 'lost') {
    return (
      <div className={styles.frameAlert}>
        <Alert tone="error" title="We lost touch with this recreation">
          {pollFinal
            ? `${special?.message ?? `${caps.providerName} could not find it.`} It may still appear under Your 4K recreations.`
            : `${special?.message ?? 'The check failed.'} It may still be rendering, so check again.`}
        </Alert>
        {needsPrompt && (
          <RunwayErrorNotice
            error={status.error}
            modelName={videoModelName(recreateRoute(take.route).model)}
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
        {budget ? (
          <Alert tone="warning" title="Stopped by the real-mode budget">
            {error}
          </Alert>
        ) : data?.upscaleFailed ? (
          <Alert tone="error" title="The 4K upscale didn't start">
            {error ?? 'The upscale could not start. Try again.'}
          </Alert>
        ) : (
          <Alert tone="error" title={data?.step === 2 ? "The 4K upscale didn't render" : "This recreation didn't render"}>
            {error ?? 'The video did not render. Try again.'}
          </Alert>
        )}
        {data?.upscaleFailed && retryError ? <RunwayErrorNotice error={retryError} modelName="the 4K upscale" /> : null}
        <div className={styles.resultActions}>
          {data?.upscaleFailed && (
            <Button size="sm" icon={<RotateCcw size={14} />} loading={retrying} onPress={() => onRetryUpscale(status.refetch)}>
              Try the upscale again
            </Button>
          )}
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
        !twoSteps
          ? 'Shooting at 4K from your still…'
          : data?.step === 2
            ? 'Step 2 of 2: upscaling to 4K…'
            : 'Step 1 of 2: following the reference at 1080p…'
      }
      progress={data?.progress}
      runKey={`${take.id}:${data?.step ?? 1}`}
      since={take.since}
    />
  );
}

/** How the browser reads an upload error: a sign-in or consent refusal keeps its body, so it shows its prompt. */
function uploadError(e: unknown, fallback: string): unknown {
  if (isUploadFailure(e)) {
    const c = classifyRunwayError(e.body);
    return c.signIn || c.consent ? e.body : { message: e.message };
  }
  return e instanceof Error ? e : { message: fallback };
}

function UploadError({ error, title }: { error: unknown; title: string }) {
  if (error == null) return null;
  const c = classifyRunwayError(error);
  return c.signIn || c.consent ? (
    <RunwayErrorNotice error={error} modelName="Runway" />
  ) : (
    <Alert tone="error" title={title}>
      {errorMessage(error)}
    </Alert>
  );
}

/** A clip's length and pixel size as the browser reads them; empty when it can't. */
function measureClip(src: string): Promise<Pick<ClipUpload, 'seconds' | 'width' | 'height'>> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => {
      resolve({
        seconds: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined,
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
      });
      video.removeAttribute('src');
    };
    video.onerror = () => resolve({});
    video.src = src;
  });
}

/** An image's own pixel size, and a small JPEG of it for the take strip. */
async function readImage(file: Blob): Promise<Pick<ImageUpload, 'width' | 'height' | 'thumb'>> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That file could not be read as an image. Use a PNG, JPEG or WebP.');
  }
  const { width, height } = bitmap;
  const scale = Math.min(1, THUMB_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { width, height, thumb: canvas.toDataURL('image/jpeg', 0.8) };
}

function frameRatio(s: { width: number; height: number } | null): string {
  return s ? `${s.width} / ${s.height}` : '16 / 9';
}
