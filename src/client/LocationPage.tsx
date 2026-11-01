import { Clapperboard, Download, ExternalLink, MapPinned } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Still } from '../api.ts';
import {
  formatCoords,
  LIGHTS,
  type LocationLightId,
  type LocationViewId,
  locationName,
  VIEWS,
} from '../location.ts';
import {
  defaultImageResolution,
  IMAGE_MODELS,
  imageModelName,
  imageResolutions,
  type ImageModelId,
  type StillUpscalerId,
  UPSCALE_FACTORS,
  type UpscaleFactor,
  upscalerName,
} from '../models.ts';
import { type Handoff, parseHash } from './handoff.ts';
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
import { Switch } from './ui/Switch.tsx';
import { Text } from './ui/Text.tsx';
import { TextArea } from './ui/TextArea.tsx';
import { TextInput } from './ui/TextInput.tsx';
import { UpscaleStill, type UpscaleJob } from './UpscaleStill.tsx';
import own from './LocationPage.module.css';
import styles from './Studio.module.css';

const DIRECTION_MAX = 600;
const PLACE_MAX = 120;
const TAKE_KEY = 'render-to-film:location-take';

type Upload = { src: string; name: string; width: number; height: number; hostedUrl?: string | undefined };

/** The take on the stage: its id, the screenshot it was made from, and its automatic upscale. */
type Take = {
  id: string;
  before?: string | undefined;
  width: number;
  height: number;
  place: string;
  /** Set on a fresh take when "upscale automatically" was on: what to upscale it with. */
  auto?: { upscaler: StillUpscalerId; factor: UpscaleFactor } | undefined;
  /** The automatic upscale's job id, kept so a reload resumes it. */
  upscale?: { id: string } | undefined;
};

export type LocationPageProps = {
  /** Whether this tab is on screen; a hidden tab skips the library poll. */
  active: boolean;
  /** Animate a finished take on the Video tab. */
  onAnimate: (stillId: string) => void;
  /** What the address opened the page with (`#stills?mode=location&still=abc`); read from the address itself when not given. */
  handoff?: Handoff | undefined;
};

function readTake(): Take | null {
  try {
    const raw = sessionStorage.getItem(TAKE_KEY);
    return raw ? (JSON.parse(raw) as Take) : null;
  } catch {
    return null;
  }
}

/** A model's largest resolution: the biggest numeric id ("4K"), else the last listed. */
function highestResolution(model: ImageModelId): string {
  const list = imageResolutions(model);
  let best = list[list.length - 1]?.id ?? defaultImageResolution(model);
  let bestN = -1;
  for (const r of list) {
    const n = Number.parseFloat(r.id);
    if (Number.isFinite(n) && n > bestN) {
      bestN = n;
      best = r.id;
    }
  }
  return best;
}

const NUM = String.raw`(-?\d+(?:\.\d+)?)`;
// Between the two numbers: a comma with a space after it, a semicolon or a space. A bare comma
// counts only between two decimals ("12.97,77.59"), so a decimal comma ("12,9716") stays one number.
const SEP = String.raw`(?:\s*,\s+|\s*;\s*|\s+|(?<=\.\d+)\s*,(?=\s*-?\d+\.))`;
const PAIR = new RegExp(String.raw`^\s*${NUM}\s*°?\s*([NSns])?${SEP}${NUM}\s*°?\s*([EWew])?\s*$`);

/** "12.9716, 77.5946" (the Google Earth and Maps copy format) as two numbers, or null. */
function parsePair(text: string): { lat: string; lng: string } | null {
  const m = PAIR.exec(text);
  if (!m) return null;
  const [, a = '', ns = '', b = '', ew = ''] = m;
  const lat = ns.toUpperCase() === 'S' && !a.startsWith('-') ? `-${a}` : a;
  const lng = ew.toUpperCase() === 'W' && !b.startsWith('-') ? `-${b}` : b;
  return { lat, lng };
}

/** The number typed, or null when empty or not a number. */
function toNumber(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function rangeError(text: string, min: number, max: number, name: string): string | null {
  if (!text.trim()) return null;
  const n = toNumber(text);
  if (n === null) return `${name} must be a number, like 12.9716.`;
  if (n < min || n > max) return `${name} must be between ${min} and ${max}.`;
  return null;
}

export function LocationPage({ active, onAnimate, handoff }: LocationPageProps) {
  const address = handoff ?? parseHash(window.location.hash);
  const addressedStill =
    address.page === 'stills' && address.params['mode'] === 'location' ? address.params['still'] : undefined;
  const utils = trpc.useUtils();
  const library = trpc.library.useQuery(undefined, {
    refetchInterval: (q) => (active && q.state.data?.stills.some((s) => s.status === 'pending') ? 8_000 : false),
  });
  const saver = useDownload();

  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [place, setPlace] = useState('');
  const [upload, setUpload] = useState<Upload | null>(null);
  const uploadSrc = useRef<string | undefined>(undefined);
  uploadSrc.current = upload?.src;
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<unknown>(null);
  const [view, setView] = useState<LocationViewId>('match');
  const [light, setLight] = useState<LocationLightId>('match');
  const [direction, setDirection] = useState('');
  const { allowedImage, allowedStillUpscalers, modelBlocked, noneOffered, onBay, providerNote } = useCapabilities();
  const [imageModel, setImageModel] = useState<ImageModelId>('nano-banana-pro');
  const [resolution, setResolution] = useState(() => highestResolution('nano-banana-pro'));
  const canUpscale = allowedStillUpscalers.length > 0;
  const [autoUpscaleOn, setAutoUpscale] = useState(true);
  const autoUpscale = autoUpscaleOn && canUpscale;
  // Nothing picked yet follows this provider's list, Creative first; a pick stays, offered or not.
  const [pickedUpscaler, setUpscaler] = useState<StillUpscalerId | null>(null);
  const upscaler: StillUpscalerId =
    pickedUpscaler ?? allowedStillUpscalers.find((u) => u.id === 'creative')?.id ?? allowedStillUpscalers[0]?.id ?? 'creative';
  const [factor, setFactor] = useState<UpscaleFactor>(2);
  const [take, setTake] = useState<Take | null>(readTake);
  const [manualJob, setManualJob] = useState<UpscaleJob | null>(null);
  const upscaleStarted = useRef<string | null>(null);
  // Screenshots picked since the page loaded; a blob from an earlier visit is gone after a reload.
  const liveBlobs = useRef(new Set<string>());
  const takeBefore = useRef<string | undefined>(undefined);

  // When the take moves on, free its screenshot unless it's still the current upload.
  useEffect(() => {
    const prev = takeBefore.current;
    takeBefore.current = take?.before;
    if (prev && prev !== take?.before && prev !== uploadSrc.current && liveBlobs.current.delete(prev)) {
      URL.revokeObjectURL(prev);
    }
  }, [take?.before]);

  useEffect(() => {
    try {
      if (take) sessionStorage.setItem(TAKE_KEY, JSON.stringify(take));
      else sessionStorage.removeItem(TAKE_KEY);
    } catch {
      // Private mode: the take just won't survive a reload.
    }
  }, [take]);

  const create = trpc.location.create.useMutation();
  const upscale = trpc.upscaleStill.useMutation();
  // A double-click's second press arrives before isPending shows.
  const createGuard = useInFlight();
  const upscaleGuard = useInFlight();
  const status = trpc.shotStatus.useQuery(
    { id: take?.id ?? '' },
    {
      enabled: take !== null,
      refetchInterval: (q) => (q.state.data?.done ? false : 2500),
      refetchOnWindowFocus: false,
      retry: 2,
    }
  );
  const upscaleId = take?.upscale?.id;
  const upscaleStatus = trpc.shotStatus.useQuery(
    { id: upscaleId ?? '' },
    {
      enabled: upscaleId !== undefined,
      refetchInterval: (q) => (q.state.data?.done ? false : 2500),
      refetchOnWindowFocus: false,
      retry: 2,
    }
  );

  const finished = status.data?.done === true;
  const resultUrl = finished ? status.data?.url : undefined;
  const upscaleDone = upscaleStatus.data?.done === true;
  const upscaledUrl = upscaleDone ? upscaleStatus.data?.url : undefined;

  const doneId = finished ? take?.id : undefined;
  useEffect(() => {
    if (doneId) void utils.library.invalidate();
  }, [doneId, utils]);
  const upscaleDoneId = upscaledUrl ? upscaleId : undefined;
  useEffect(() => {
    if (upscaleDoneId) void utils.library.invalidate();
  }, [upscaleDoneId, utils]);

  const startUpscale = useCallback(
    async (t: Take) => {
      if (!t.auto || !upscaleGuard.start()) return;
      try {
        const { id } = await upscale.mutateAsync({ stillId: t.id, upscaler: t.auto.upscaler, factor: t.auto.factor });
        setTake((cur) => (cur && cur.id === t.id ? { ...cur, upscale: { id } } : cur));
      } catch {
        // Shown by RunwayErrorNotice from upscale.error.
      } finally {
        upscaleGuard.end();
      }
    },
    [upscale, upscaleGuard]
  );

  // Once the render is done, upscale it once: the ref is keyed on the take id.
  useEffect(() => {
    if (!take || !take.auto || take.upscale || !finished || !resultUrl) return;
    if (upscaleStarted.current === take.id) return;
    upscaleStarted.current = take.id;
    void startUpscale(take);
  }, [take, finished, resultUrl, startUpscale]);

  function retryUpscale() {
    // An upscale already being sent is not reset or sent again.
    if (!take?.auto || upscaleGuard.busy()) return;
    upscale.reset();
    upscaleStarted.current = take.id;
    const next: Take = { ...take, upscale: undefined };
    setTake(next);
    void startUpscale(next);
  }

  const earlier = useMemo(
    () =>
      (library.data?.stills ?? [])
        .filter((s) => s.location && !s.upscaleOf && s.status === 'succeeded' && s.id !== take?.id)
        .slice(0, 8),
    [library.data, take?.id]
  );
  const libUpscale = take
    ? library.data?.stills.find((s) => s.upscaleOf === take.id && s.status === 'succeeded')
    : undefined;

  const latError = rangeError(lat, -90, 90, 'Latitude');
  const lngError = rangeError(lng, -180, 180, 'Longitude');
  const latNum = toNumber(lat);
  const lngNum = toNumber(lng);
  const coordsOk = latNum !== null && lngNum !== null && !latError && !lngError;
  const directionTooLong = direction.length > DIRECTION_MAX;
  // A 4K render upscaled 4× is past what the stored copies can be made from, so 4K stops at 2×.
  const modelOff = modelBlocked('image', imageModel);
  const upscalerOff = autoUpscale ? modelBlocked('stillUpscaler', upscaler) : null;
  const blocked = modelOff ?? upscalerOff;
  const fourK = imageResolutions(imageModel).find((r) => r.id === resolution)?.name === '4K';
  const factorChoices = fourK ? UPSCALE_FACTORS.filter((f) => f.id === '2') : UPSCALE_FACTORS;
  const useFactor: UpscaleFactor = fourK ? 2 : factor;
  const rendering = take !== null && !finished;
  const statusErr = status.error ? classifyRunwayError(status.error) : null;
  const busy = create.isPending || rendering;
  const ready = coordsOk && Boolean(upload?.hostedUrl);
  const takeError = finished && !resultUrl ? (status.data?.error ?? 'The take did not return an image. Try again.') : undefined;

  const upscaleFailed = upscaleDone && !upscaledUrl;
  const upscaleError = upscale.error ?? upscaleStatus.error;
  // Only the status check failed: the upscale may still be running, so check again rather than pay twice.
  const upscalePollError = !upscale.error && upscaleStatus.error !== null && !upscaleDone;
  const upscaling =
    take?.auto !== undefined &&
    finished &&
    Boolean(resultUrl) &&
    !upscaledUrl &&
    !upscaleFailed &&
    !upscaleError;
  const bestId = upscaledUrl && upscaleId ? upscaleId : (libUpscale?.id ?? take?.id);
  const bestIsUpscale = bestId !== undefined && bestId !== take?.id;
  const bestFactor = upscaledUrl ? take?.auto?.factor : libUpscale?.scale;

  function setCoord(which: 'lat' | 'lng', value: string) {
    // Split a pair only when it arrives at once (a paste), not while it is typed key by key.
    const prev = which === 'lat' ? lat : lng;
    const pair = value.length - prev.length > 1 ? parsePair(value) : null;
    if (pair) {
      setLat(pair.lat);
      setLng(pair.lng);
    } else if (which === 'lat') setLat(value);
    else setLng(value);
  }

  async function onFile(file: File) {
    setUploadError(null);
    const src = URL.createObjectURL(file);
    liveBlobs.current.add(src);
    let width: number;
    let height: number;
    try {
      const bitmap = await createImageBitmap(file);
      ({ width, height } = bitmap);
      bitmap.close();
    } catch {
      liveBlobs.current.delete(src);
      URL.revokeObjectURL(src);
      setUploadError(new Error('That file could not be read as an image. Try a PNG, JPEG or WebP.'));
      return;
    }
    setUpload((prev) => {
      if (prev && prev.src !== take?.before && liveBlobs.current.delete(prev.src)) URL.revokeObjectURL(prev.src);
      return { src, name: file.name, width, height };
    });
    setUploading(true);
    try {
      const hostedUrl = await uploadRender(file);
      setUpload((cur) => (cur?.src === src ? { ...cur, hostedUrl } : cur));
    } catch (e) {
      setUpload((cur) => {
        if (cur?.src !== src) return cur;
        if (src !== takeBefore.current && liveBlobs.current.delete(src)) URL.revokeObjectURL(src);
        return null;
      });
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
    if (!ready || busy || directionTooLong || blocked || !upload?.hostedUrl || latNum === null || lngNum === null) return;
    if (!createGuard.start()) return;
    upscale.reset();
    try {
      const { id, width, height } = await create.mutateAsync({
        url: upload.hostedUrl,
        width: upload.width,
        height: upload.height,
        lat: latNum,
        lng: lngNum,
        place: place.trim(),
        view,
        light,
        direction,
        imageModel,
        resolution,
      });
      setManualJob(null);
      setTake({
        id,
        before: upload.src,
        width,
        height,
        place: locationName({ lat: latNum, lng: lngNum, place }),
        auto: autoUpscale ? { upscaler, factor: useFactor } : undefined,
      });
      void utils.library.invalidate();
    } catch {
      // Shown by RunwayErrorNotice from create.error.
    } finally {
      createGuard.end();
    }
  }

  const showEarlier = useCallback((s: Still) => {
    upscale.reset();
    setManualJob(null);
    setTake({
      id: s.id,
      width: s.width,
      height: s.height,
      place: s.location ? locationName(s.location) : 'Location',
    });
  }, [upscale]);

  // A location still the address names becomes the current take, once per arrival, when it is in the library.
  const openedStill = useRef<string | undefined>(undefined);
  const addressed = addressedStill ? library.data?.stills.find((s) => s.id === addressedStill && s.location) : undefined;
  useEffect(() => {
    if (!addressedStill) {
      openedStill.current = undefined;
      return;
    }
    if (!addressed || openedStill.current === addressedStill) return;
    openedStill.current = addressedStill;
    showEarlier(addressed);
  }, [addressedStill, addressed, showEarlier]);

  const aspect = take
    ? `${take.width} / ${take.height}`
    : upload
      ? `${upload.width} / ${upload.height}`
      : '16 / 9';
  // A blob from an earlier visit is gone after a reload; compare only with a live source.
  const before =
    take?.before && (!take.before.startsWith('blob:') || liveBlobs.current.has(take.before)) ? take.before : undefined;
  const shownName = take?.place ?? 'Location';
  const factorLabel = bestFactor ? `-${bestFactor}x` : '';
  const hasUpscaleCopy = bestIsUpscale;

  // A picked card moves to the front of the strip as the current take; the strip keeps its scroll, so bring it back.
  const currentCard = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    currentCard.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [take?.id]);

  // The room takes the light of the finished take (its first-pass thumbnail,
  // which the upscale matches), else of the screenshot being rendered.
  useAmbient(take && resultUrl ? stillThumbUrl(take.id) : (upload?.src ?? before ?? null));

  const buttonLabel = create.isPending
    ? 'Starting the render…'
    : rendering
      ? 'Rendering the location…'
      : uploading
        ? 'Uploading the screenshot…'
        : directionTooLong
          ? 'Shorten the direction first'
          : !coordsOk
            ? 'Enter the coordinates first'
            : !upload
              ? 'Upload a screenshot first'
              : 'Render location';

  // The finished take (or its upscale) on the canvas; while it upscales automatically, the status shows instead.
  const showResult = take !== null && Boolean(resultUrl) && !upscaling && bestId !== undefined;
  const canvasState: CanvasState = take || create.isPending ? 'live' : upload ? 'preview' : 'empty';
  const resolutionName = imageResolutions(imageModel).find((r) => r.id === resolution)?.name ?? resolution;

  function dropFiles(files: File[]) {
    // The step 2 zone is disabled while busy; a drop on the canvas waits the same way.
    const file = files[0];
    if (!file || busy || uploading) return;
    void onFile(file);
  }

  let canvas: ReactNode = null;
  if (showResult && bestId) {
    canvas = (
      <>
        {before ? (
          <CompareSlider
            before={before}
            after={stillViewUrl(bestId)}
            afterFallback={stillThumbUrl(bestId)}
            beforeAlt="The Google Earth screenshot"
            afterAlt={`Photoreal aerial photograph of ${shownName}`}
            aspectRatio={aspect}
          />
        ) : (
          <img src={stillViewUrl(bestId)} alt={`Photoreal aerial photograph of ${shownName}`} decoding="async" />
        )}
        {saver.error && (
          <div className={own.pictureAlert}>
            <Alert tone="error" title="Download failed">
              {saver.error}
            </Alert>
          </div>
        )}
      </>
    );
  } else if (rendering && status.error && (statusErr?.signIn || statusErr?.consent)) {
    canvas = (
      <div className={styles.frameAlert}>
        <RunwayErrorNotice error={status.error} modelName="the image model" onRetry={() => void status.refetch()} />
      </div>
    );
  } else if (rendering && status.error) {
    canvas = (
      <div className={styles.frameAlert}>
        <Alert tone="warning" title="Lost track of the take">
          {statusErr?.message ?? 'The status check failed.'} The render may still be
          running, so check again before starting another.
        </Alert>
        <div className={own.alertActions}>
          <Button size="sm" loading={status.isFetching} onPress={() => void status.refetch()}>
            Check again
          </Button>
          <Button size="sm" variant="ghost" onPress={() => setTake(null)}>
            Stop waiting
          </Button>
        </div>
      </div>
    );
  } else if (rendering || create.isPending) {
    canvas = (
      <RenderingStatus
        label={create.isPending ? 'Starting the take…' : 'Rendering the location…'}
        progress={status.data?.progress}
        runKey={take?.id}
      />
    );
  } else if (upscaling) {
    canvas = (
      <RenderingStatus
        label={`Upscaling ${take?.auto?.factor ?? useFactor}× for detailed textures…`}
        progress={upscaleStatus.data?.progress}
        runKey={upscaleId ?? take?.id}
      />
    );
  } else if (takeError) {
    canvas = (
      <div className={styles.frameAlert}>
        <Alert tone="error" title="The take didn't finish">
          {takeError}
        </Alert>
      </div>
    );
  } else if (upload) {
    canvas = <img src={upload.src} alt="The screenshot to render" decoding="async" />;
  }

  const caption = take
    ? showResult
      ? [shownName, 'Saved to your library, tagged @location']
      : shownName
    : [imageModelName(imageModel), resolutionName];

  const canvasActions =
    showResult && bestId ? (
      <>
        <Button
          variant="ghost"
          icon={<Download size={16} />}
          loading={saver.pending}
          onPress={() => saver.start(libraryUrl('still', bestId), `location-${slugify(shownName)}${factorLabel}.png`)}
        >
          {saver.label(hasUpscaleCopy ? 'Download upscaled' : 'Download')}
        </Button>
        <Button
          variant="ghost"
          icon={<ExternalLink size={16} />}
          onPress={() => window.open(libraryUrl('still', bestId), '_blank', 'noopener')}
        >
          Open full size
        </Button>
        <Button variant="ghost" icon={<Clapperboard size={16} />} onPress={() => onAnimate(bestId)}>
          Make a video
        </Button>
      </>
    ) : undefined;

  // The current take leads the strip (it is on the canvas); the earlier ones follow and put themselves there.
  const takeThumb = take && resultUrl ? stillThumbUrl(take.id) : before;
  const strip =
    take || earlier.length > 0 ? (
      <>
        {take && (
          <div className={own.card} data-current="" ref={currentCard}>
            <span className={own.cardFrame}>
              {takeThumb && <img className={own.cardThumb} src={takeThumb} alt="" decoding="async" />}
            </span>
            <span className={own.cardName} title={shownName}>
              {shownName}
            </span>
          </div>
        )}
        {earlier.map((s) => {
          const name = s.location ? locationName(s.location) : 'this take';
          return (
            <button
              key={s.id}
              type="button"
              className={own.card}
              onClick={() => showEarlier(s)}
              aria-label={`Show ${name}`}
              title={name}
            >
              <span className={own.cardFrame}>
                <img className={own.cardThumb} src={stillThumbUrl(s.id)} alt="" loading="lazy" decoding="async" />
              </span>
              <span className={own.cardName}>{name}</span>
            </button>
          );
        })}
      </>
    ) : undefined;

  const inspector = (
    <>
      <PageHeader
        title="Render a location"
        description="Turn a Google Earth screenshot into a photoreal aerial photograph of the same place, then upscale it for detailed textures."
      />
      <Section step={1} title="Location" description="Where the screenshot was taken, in decimal degrees.">
        <div className={styles.stack}>
          <div className={own.coords}>
            <div className={styles.stack}>
              <TextInput
                label="Latitude"
                value={lat}
                onChange={(v) => setCoord('lat', v)}
                placeholder="12.9716"
                disabled={busy}
              />
              {latError && (
                <p className={own.fieldError} role="alert">
                  {latError}
                </p>
              )}
            </div>
            <div className={styles.stack}>
              <TextInput
                label="Longitude"
                value={lng}
                onChange={(v) => setCoord('lng', v)}
                placeholder="77.5946"
                disabled={busy}
              />
              {lngError && (
                <p className={own.fieldError} role="alert">
                  {lngError}
                </p>
              )}
            </div>
          </div>
          <TextInput
            label="Place name (optional)"
            value={place}
            onChange={setPlace}
            maxLength={PLACE_MAX}
            placeholder="e.g. Koramangala, Bengaluru"
            disabled={busy}
          />
          <Text tone="muted" size="sm" as="p">
            {coordsOk && latNum !== null && lngNum !== null
              ? formatCoords(latNum, lngNum)
              : 'Paste "12.9716, 77.5946" into either field to fill both.'}
          </Text>
        </div>
      </Section>

      <Section
        step={2}
        title="Satellite image"
        description="Take a screenshot in Google Earth of that spot, with labels and UI turned off if possible."
      >
        <div className={styles.stack}>
          <ImageDropZone
            onFile={(f) => void onFile(f)}
            disabled={busy || uploading}
            actionLabel={upload ? 'Replace screenshot' : 'Choose a screenshot'}
            label="Drop or choose the map screenshot"
          >
            {upload ? (
              <figure className={styles.frame} style={{ aspectRatio: `${upload.width} / ${upload.height}` }}>
                <img className={styles.image} src={upload.src} alt={`Uploaded screenshot: ${upload.name}`} />
              </figure>
            ) : (
              <div className={own.dropEmpty}>
                <MapPinned size={20} aria-hidden />
                <Text tone="secondary" size="sm">
                  Drop your Google Earth screenshot here. PNG, JPEG or WebP.
                </Text>
              </div>
            )}
          </ImageDropZone>
          {uploading && (
            <Text tone="muted" size="sm" as="p">
              Uploading the screenshot…
            </Text>
          )}
          <RunwayErrorNotice error={uploadError} modelName="the upload" onRetry={() => setUploadError(null)} />
        </div>
      </Section>

      <Section step={3} title="View and light" description="Small moves only. Nothing new is added to the site.">
        <div className={styles.stack}>
          <Select
            label="View"
            options={VIEWS}
            value={view}
            onChange={(id) => setView(id as LocationViewId)}
            disabled={busy}
          />
          <Select
            label="Light"
            options={LIGHTS}
            value={light}
            onChange={(id) => setLight(id as LocationLightId)}
            disabled={busy}
          />
          <TextArea
            label="Extra direction (optional)"
            value={direction}
            onChange={setDirection}
            rows={3}
            maxLength={DIRECTION_MAX}
            disabled={busy}
            placeholder="e.g. monsoon season, dry paddy fields, tiled roofs"
            onSubmit={() => void run()}
          />
        </div>
      </Section>

      <Section step={4} title="Model" description="Re-draws the screenshot as a photograph.">
        <div className={styles.selectRow}>
          <Select
            label="Image model"
            options={allowedImage(IMAGE_MODELS)}
            value={imageModel}
            onChange={(id) => {
              const m = id as ImageModelId;
              setImageModel(m);
              setResolution(highestResolution(m));
            }}
            disabled={busy}
          />
          {imageResolutions(imageModel).length > 1 && (
            <Select
              label="Resolution"
              options={imageResolutions(imageModel)}
              value={resolution}
              onChange={setResolution}
              disabled={busy}
              showHint={false}
            />
          )}
          {modelOff && <ModelUnavailable message={modelOff} />}
        </div>
      </Section>

      <Section step={5} title="Upscale" description="Adds fine texture to the finished render.">
        <div className={styles.stack}>
          <Switch
            label="Upscale automatically when the render is done"
            hint="Off: you can upscale the result by hand."
            checked={autoUpscale}
            onChange={setAutoUpscale}
            disabled={busy || !canUpscale}
          />
          {!canUpscale && <ModelUnavailable message={noneOffered} />}
          {autoUpscale && (
            <div className={own.upscaleRow}>
              <Select
                label="Upscaler"
                options={allowedStillUpscalers}
                value={upscaler}
                onChange={(id) => setUpscaler(id as StillUpscalerId)}
                disabled={busy}
              />
              <Select
                label="Scale"
                options={factorChoices}
                value={String(useFactor)}
                onChange={(id) => setFactor(id === '4' ? 4 : 2)}
                disabled={busy}
                showHint={false}
              />
              {upscalerOff && <ModelUnavailable message={upscalerOff} />}
            </div>
          )}
        </div>
        {showResult && take && (upscaleError || upscaleFailed) ? (
          <div className={styles.upscale}>
            <RunwayErrorNotice
              error={upscaleError ?? { message: upscaleStatus.data?.error ?? 'The upscale did not return an image.' }}
              modelName={upscalerName(take.auto?.upscaler ?? upscaler)}
              onRetry={upscalePollError ? () => void upscaleStatus.refetch() : retryUpscale}
            />
            {upscalePollError ? (
              <Button size="sm" loading={upscaleStatus.isFetching} onPress={() => void upscaleStatus.refetch()}>
                Check again
              </Button>
            ) : (
              <Button size="sm" onPress={retryUpscale}>
                Retry the upscale
              </Button>
            )}
          </div>
        ) : null}
        {showResult && take && !take.auto && !hasUpscaleCopy && canUpscale && (
          <UpscaleStill
            stillId={take.id}
            aspectRatio={aspect}
            name={`location-${slugify(shownName)}`}
            job={manualJob}
            onJob={setManualJob}
          />
        )}
      </Section>
    </>
  );

  const footer = (
    <>
      <BlockedTip message={blocked}>
        <Button
          variant="primary"
          size="lg"
          icon={<MapPinned size={16} />}
          loading={busy}
          disabled={!ready || directionTooLong || blocked !== null}
          onPress={() => void run()}
        >
          {buttonLabel}
        </Button>
      </BlockedTip>
      <CostLine
        summary={`${imageModelName(imageModel)}${
          autoUpscale ? `, then upscaled ${useFactor}× with ${upscalerName(upscaler)}` : ''
        }.${onBay ? ' Billed to your own Runway credits.' : ''}`}
        providerNote={autoUpscale ? providerNote(imageModel, upscaler) : providerNote(imageModel)}
      />
      <RunwayErrorNotice error={create.error} modelName={imageModelName(imageModel)} onRetry={() => void run()} />
    </>
  );

  return (
    <Workspace
      page="location"
      canvasState={canvasState}
      canvas={canvas}
      aspectRatio={aspect}
      caption={caption}
      canvasNote="Your photoreal location will appear here"
      canvasActions={canvasActions}
      onDropFiles={dropFiles}
      empty={{
        title: 'Drop a Google Earth screenshot to begin',
        hint: 'PNG, JPEG or WebP. Enter the coordinates, then press Render location.',
        action: 'Choose a map screenshot',
        label: 'Drop or choose the map screenshot',
      }}
      inspector={inspector}
      footer={footer}
      strip={strip}
      stripLabel="Earlier locations"
    />
  );
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'location';
}
