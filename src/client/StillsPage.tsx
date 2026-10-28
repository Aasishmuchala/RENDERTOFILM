import { Clapperboard, Download, ExternalLink, Pencil, Sparkles, SquareDashedMousePointer, SunMedium, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import {
  ACTIVITIES,
  AGES,
  ANGLES,
  CROWDS,
  DEFAULT_PEOPLE_OPTIONS,
  ETHNICITIES,
  LOOKS,
  litFromReference,
  lookLabel,
  WARDROBES,
  type ActivityId,
  type AgeId,
  type AngleId,
  type CrowdId,
  type EthnicityId,
  type LookId,
  type WardrobeId,
} from '../looks.ts';
import {
  castSheetModelNames,
  aspectDims,
  defaultImageResolution,
  imageAspectOptions,
  imageModelHasAspect,
  IMAGE_MODELS,
  imageModelName,
  imageModelTakesCastSheet,
  imageResolutionName,
  imageResolutions,
  MATCH_RENDER,
  type ImageModelId,
  maskedEditFit,
} from '../models.ts';
import type { Still } from '../api.ts';
import { CastSheetField, type CastSheet } from './CastSheetField.tsx';
import { Section } from './layouts/Section.tsx';
import { LightReferenceField } from './LightReferenceField.tsx';
import { libraryUrl, stillThumbUrl, useDownload } from './lib/download.ts';
import { classifyRunwayError } from './lib/runwayErrors.ts';
import { exportMaskPng, maskCoverage, type MaskStroke } from './lib/mask.ts';
import { isUploadFailure, storeRenderCopy, uploadMask, uploadRender } from './lib/uploadRender.ts';
import { PeopleCheck } from './PeopleCheck.tsx';
import { trpc } from './trpc.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { ChoiceGroup } from './ui/ChoiceGroup.tsx';
import { CompareSlider } from './ui/CompareSlider.tsx';
import { EmptyState } from './ui/EmptyState.tsx';
import { ImageDropZone } from './ui/ImageDropZone.tsx';
import { MaskOverlay, MaskPainter } from './ui/MaskPainter.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { RenderingStatus } from './ui/RenderingStatus.tsx';
import { RunwayErrorNotice } from './ui/RunwayErrorNotice.tsx';
import { Switch } from './ui/Switch.tsx';
import { Text } from './ui/Text.tsx';
import { TextArea } from './ui/TextArea.tsx';
import { TextInput } from './ui/TextInput.tsx';
import { Select } from './ui/Select.tsx';
import { UpscaleStill, type UpscaleJob } from './UpscaleStill.tsx';
import styles from './Studio.module.css';

type Source = {
  src: string;
  name: string;
  width: number;
  height: number;
  /** Hosted URL from `/api/upload`, once uploaded — reused across takes. */
  hostedUrl?: string | undefined;
  /** The app's stored copy, for marked edits — reused across takes. */
  renderKey?: string | undefined;
};

/** What a take was made with, so a fix re-take can repeat it exactly. */
type ShotSettings = {
  imageModel: ImageModelId;
  resolution: string;
  /** "match" or a ratio the model offers, e.g. "9:16". */
  aspectRatio: string;
  look: LookId;
  angle: AngleId;
  /** "Only what's in the image": nothing new appears but the people asked for. */
  onlyInImage: boolean;
  crowd: CrowdId;
  people: string;
  ethnicity: EthnicityId;
  age: AgeId;
  wardrobe: WardrobeId;
  activity: ActivityId;
  /** Hosted cast sheet URL, when one was uploaded; re-takes send it again. */
  castSheetUrl?: string | undefined;
  /** Hosted lighting reference; while set, the look preset is not used. */
  lightRefUrl?: string | undefined;
  /** Or one of the visitor's finished stills, for a matching series. */
  lightFromStillId?: string | undefined;
  direction: string;
  /**
   * A marked edit: the stored mask and the strokes it was drawn from. Only
   * that area changes; re-takes send the same mask.
   */
  maskKey?: string | undefined;
  maskStrokes?: readonly MaskStroke[] | undefined;
};

type Shot = ShotSettings & { id: string; source: Source; fixed: boolean };

const SAMPLE: Source = {
  src: '/sample-render.jpg',
  name: 'sample-render.jpg',
  width: 2560,
  height: 1440,
};

/** Longest extra direction the server takes, in characters. */
const DIRECTION_MAX = 600;

/** How long a finished marked take keeps retrying its restore before the error is final. */
const COMPOSITE_RETRY_MS = 60_000;

export type StillsPageProps = {
  /** Open the Video tab with this still picked. */
  onAnimate: (stillId: string) => void;
};

export function StillsPage({ onAnimate }: StillsPageProps) {
  const saver = useDownload();
  const utils = trpc.useUtils();
  const [source, setSource] = useState<Source>(SAMPLE);
  const [imageModel, setImageModel] = useState<ImageModelId>('nano-banana-pro');
  const [resolution, setResolution] = useState(defaultImageResolution('nano-banana-pro'));
  const [aspectRatio, setAspectRatio] = useState<string>(MATCH_RENDER);
  const [look, setLook] = useState<LookId>('golden-hour');
  const [direction, setDirection] = useState('');
  const [angle, setAngle] = useState<AngleId>('as-rendered');
  const [onlyInImage, setOnlyInImage] = useState(true);
  const [crowd, setCrowd] = useState<CrowdId>('none');
  const [people, setPeople] = useState('');
  const [ethnicity, setEthnicity] = useState<EthnicityId>(DEFAULT_PEOPLE_OPTIONS.ethnicity);
  const [age, setAge] = useState<AgeId>(DEFAULT_PEOPLE_OPTIONS.age);
  const [wardrobe, setWardrobe] = useState<WardrobeId>(DEFAULT_PEOPLE_OPTIONS.wardrobe);
  const [activity, setActivity] = useState<ActivityId>(DEFAULT_PEOPLE_OPTIONS.activity);
  const [cast, setCast] = useState<CastSheet | null>(null);
  const [castUploading, setCastUploading] = useState(false);
  const [castError, setCastError] = useState<unknown>(null);
  const [lightRef, setLightRef] = useState<CastSheet | null>(null);
  const [lightUploading, setLightUploading] = useState(false);
  const [lightError, setLightError] = useState<unknown>(null);
  /** A finished still whose light every new view matches (a series). */
  const [matchStillId, setMatchStillId] = useState<string | null>(null);
  const library = trpc.library.useQuery(undefined, { refetchOnWindowFocus: false });
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'submitting'>('idle');
  const [marking, setMarking] = useState(false);
  const [strokes, setStrokes] = useState<MaskStroke[]>([]);
  /** The stored mask for exactly these strokes on this source, once uploaded. */
  const [savedMask, setSavedMask] = useState<{ src: string; strokes: readonly MaskStroke[]; key: string } | null>(null);
  const markedShare = useMemo(
    () => maskCoverage(strokes, source.width, source.height),
    [strokes, source.width, source.height]
  );
  const hasMark = markedShare > 0;
  const [fixing, setFixing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const shotRef = useRef(shot);
  shotRef.current = shot;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  /**
   * Upscales by the still they belong to. Kept here, not in the panel, so an
   * upscale keeps running and stays visible when a new take replaces its still.
   */
  const [upscales, setUpscales] = useState<Record<string, UpscaleJob>>({});
  const setUpscaleJob = (stillId: string, job: UpscaleJob | null) =>
    setUpscales((cur) => {
      const next = { ...cur };
      if (job) next[stillId] = job;
      else delete next[stillId];
      return next;
    });

  // A take's compare slider keeps its render's object URL alive; free it once
  // a newer take replaces it and it is no longer the picked source either.
  const prevShotSrc = useRef<string | undefined>(undefined);
  const shotSrc = shot?.source.src;
  useEffect(() => {
    const prev = prevShotSrc.current;
    prevShotSrc.current = shotSrc;
    if (prev && prev !== shotSrc && prev.startsWith('blob:') && prev !== sourceRef.current.src) {
      URL.revokeObjectURL(prev);
    }
  }, [shotSrc]);

  // When this take first came back finished but not yet restored.
  const compositeSince = useRef<{ id: string; at: number } | null>(null);
  const compositeGaveUp = (at: number) => {
    if (!shot) return true;
    if (compositeSince.current?.id !== shot.id) compositeSince.current = { id: shot.id, at };
    return at - compositeSince.current.at > COMPOSITE_RETRY_MS;
  };
  const createShot = trpc.createShot.useMutation();
  const status = trpc.shotStatus.useQuery(
    { id: shot?.id ?? '' },
    {
      enabled: shot !== null,
      // A marked take whose untouched area is still being restored keeps polling.
      refetchInterval: (q) =>
        q.state.data?.done && (!q.state.data.compositePending || compositeGaveUp(q.state.dataUpdatedAt))
          ? false
          : 2500,
      refetchOnWindowFocus: false,
      retry: 2,
    }
  );
  const finished =
    status.data?.done === true &&
    (!status.data.compositePending || compositeGaveUp(status.dataUpdatedAt));
  const doneId = finished ? shot?.id : undefined;
  useEffect(() => {
    // The library now has this take; the other tab's lists should show it.
    if (doneId) void utils.library.invalidate();
  }, [doneId, utils]);

  // In flight until a final status arrives: a failed poll doesn't free the
  // button, or a second press would bill a second take.
  const rendering = shot !== null && !finished;
  const statusErr = status.error ? classifyRunwayError(status.error) : null;
  const lostTrack = rendering && status.error !== null;
  const busy = phase !== 'idle' || rendering;
  const castSupported = imageModelTakesCastSheet(imageModel);
  const resultUrl = finished ? status.data?.url : undefined;
  const maskFit = hasMark ? maskedEditFit(imageModel, source.width, source.height) : ({ ok: true } as const);
  const taskError = finished && !status.data?.url
    ? status.data?.error ?? 'The generation did not return an image. Try again.'
    : undefined;
  // A failed status check is shown on the take itself, not under the button.
  const shownError = error ?? (lostTrack ? null : status.error);
  /** Upscales of takes that a newer take has since replaced. */
  const earlierUpscales = Object.entries(upscales).filter(([stillId]) => stillId !== shot?.id);
  const directionTooLong = direction.length > DIRECTION_MAX;

  async function onFile(file: File) {
    setError(null);
    const src = URL.createObjectURL(file);
    try {
      const bitmap = await createImageBitmap(file);
      setSource((prev) => {
        // The finished take's compare slider may still show the old render.
        if (prev.src.startsWith('blob:') && prev.src !== shotRef.current?.source.src) {
          URL.revokeObjectURL(prev.src);
        }
        return { src, name: file.name, width: bitmap.width, height: bitmap.height };
      });
      bitmap.close();
      // A mark belongs to the render it was drawn on.
      setStrokes([]);
      setSavedMask(null);
      setMarking(false);
    } catch {
      URL.revokeObjectURL(src);
      setError(new Error('That file could not be read as an image. Try a PNG, JPEG or WebP.'));
    }
  }

  /** Upload an extra reference photo (cast sheet or lighting) into its own slot. */
  async function uploadReference(
    file: File,
    slot: {
      set: Dispatch<SetStateAction<CastSheet | null>>;
      setUploading: (v: boolean) => void;
      setError: (e: unknown) => void;
      what: string;
    }
  ) {
    slot.setError(null);
    const src = URL.createObjectURL(file);
    slot.set((prev) => {
      if (prev?.src.startsWith('blob:')) URL.revokeObjectURL(prev.src);
      return { src, name: file.name };
    });
    slot.setUploading(true);
    try {
      const hostedUrl = await uploadRender(file);
      slot.set((cur) => (cur?.src === src ? { ...cur, hostedUrl } : cur));
    } catch (e) {
      slot.set((cur) => {
        if (cur?.src !== src) return cur;
        URL.revokeObjectURL(src);
        return null;
      });
      // The route's body, so a sign-in or consent refusal shows its prompt.
      slot.setError(
        isUploadFailure(e)
          ? classifyRunwayError(e.body).signIn || classifyRunwayError(e.body).consent
            ? e.body
            : { message: e.message }
          : e instanceof Error
            ? e
            : { message: `The ${slot.what} could not be uploaded. Try again.` }
      );
    } finally {
      slot.setUploading(false);
    }
  }

  const onCastFile = (file: File) =>
    uploadReference(file, {
      set: setCast,
      setUploading: setCastUploading,
      setError: setCastError,
      what: 'cast sheet',
    });

  const onLightFile = (file: File) =>
    uploadReference(file, {
      set: setLightRef,
      setUploading: setLightUploading,
      setError: setLightError,
      what: 'lighting reference',
    });

  function removeCast() {
    setCastError(null);
    setCast((prev) => {
      if (prev?.src.startsWith('blob:')) URL.revokeObjectURL(prev.src);
      return null;
    });
  }

  function removeLightRef() {
    setLightError(null);
    setLightRef((prev) => {
      if (prev?.src.startsWith('blob:')) URL.revokeObjectURL(prev.src);
      return null;
    });
  }

  async function submit(settings: ShotSettings, from: Source, fixes = '') {
    setError(null);
    try {
      let hostedUrl = from.hostedUrl;
      if (!hostedUrl) {
        setPhase('uploading');
        const blob = await fetch(from.src).then((r) => r.blob());
        hostedUrl = await uploadRender(blob);
        const uploaded = { ...from, hostedUrl };
        setSource((cur) => (cur.src === from.src ? uploaded : cur));
      }
      let maskKey = settings.maskKey;
      if (!maskKey && settings.maskStrokes && settings.maskStrokes.length > 0) {
        setPhase('uploading');
        maskKey = await uploadMask(await exportMaskPng(settings.maskStrokes, from.width, from.height));
        const stored = { src: from.src, strokes: settings.maskStrokes, key: maskKey };
        setSavedMask(stored);
      }
      let renderKey = from.renderKey;
      if (maskKey && !renderKey) {
        setPhase('uploading');
        const blob = await fetch(from.src).then((r) => r.blob());
        renderKey = await storeRenderCopy(blob);
        const kept = renderKey;
        setSource((cur) => (cur.src === from.src ? { ...cur, hostedUrl, renderKey: kept } : cur));
      }
      setPhase('submitting');
      const { id } = await createShot.mutateAsync({
        ...settings,
        imageUrl: hostedUrl,
        people: settings.crowd === 'none' ? '' : settings.people,
        castSheetUrl:
          settings.crowd !== 'none' && imageModelTakesCastSheet(settings.imageModel)
            ? settings.castSheetUrl
            : undefined,
        lightRefUrl: maskKey ? undefined : settings.lightRefUrl,
        lightFromStillId: maskKey ? undefined : settings.lightFromStillId,
        fixes,
        width: from.width,
        height: from.height,
        maskKey,
        renderKey: maskKey ? renderKey : undefined,
        ...(maskKey ? { aspectRatio: MATCH_RENDER, angle: 'as-rendered' as const } : {}),
      });
      setShot({
        ...settings,
        ...(maskKey ? { aspectRatio: MATCH_RENDER, angle: 'as-rendered' as const } : {}),
        maskKey,
        id,
        source: { ...from, hostedUrl, renderKey },
        fixed: fixes !== '',
      });
    } catch (e) {
      setError(isUploadFailure(e) ? e.body ?? e : e);
    } finally {
      setPhase('idle');
    }
  }

  const run = () =>
    submit(
      {
        imageModel,
        resolution,
        aspectRatio,
        look,
        angle,
        onlyInImage,
        crowd,
        people,
        ethnicity,
        age,
        wardrobe,
        activity,
        castSheetUrl: cast?.hostedUrl,
        lightRefUrl: hasMark || matchedStill ? undefined : lightRef?.hostedUrl,
        lightFromStillId: hasMark ? undefined : matchedStill?.id,
        direction,
        ...(hasMark
          ? {
              maskStrokes: strokes,
              maskKey:
                savedMask && savedMask.src === source.src && savedMask.strokes === strokes
                  ? savedMask.key
                  : undefined,
            }
          : {}),
      },
      source
    );

  async function fix(fixes: string) {
    if (!shot || busy) return;
    setFixing(true);
    try {
      await submit(shot, shot.source, fixes.slice(0, 2000));
    } finally {
      setFixing(false);
    }
  }

  const { planBlocked, unavailable } = classifyRunwayError(shownError);
  const modelName = imageModelName(shot && shownError === status.error ? shot.imageModel : imageModel);

  const lookName = shot ? lookLabel(shot.look, litFromReference(shot)) : lookLabel(look);
  const finishedStills = (library.data?.stills ?? []).filter((s) => s.status === 'succeeded');
  const stillItem = (s: Still) => ({
    id: s.id,
    src: stillThumbUrl(s.id),
    alt: `${lookLabel(s.look, litFromReference(s))} still from ${new Date(s.createdAt).toLocaleString()}`,
    caption: lookLabel(s.look, litFromReference(s)),
  });
  const matchedStill = finishedStills.find((s) => s.id === matchStillId);
  /** A lighting reference is in and will be sent: the presets step aside. */
  const usingLightRef = (lightRef !== null || matchedStill !== undefined) && !hasMark;

  return (
    <>
      <div className={styles.layout}>
        <div className={styles.controls}>
          <PageHeader
            title="Turn a render into a film still"
            description="Keeps your composition and design, replaces the CG look with photoreal materials, light and lens."
          />
          <div className={styles.strictSwitch}>
            <Switch
              label="Only what's in the image"
              hint={
                onlyInImage
                  ? 'Nothing new appears: no added objects, buildings or places beyond the frame. People you ask for are the only addition.'
                  : 'Off: the model may add or reveal things the render doesn\'t show.'
              }
              checked={onlyInImage}
              onChange={setOnlyInImage}
              disabled={busy}
            />
          </div>
          <Section
            step={1}
            title="Source render"
            description={
              marking
                ? 'Paint the area that may change. Everything outside it stays exactly as rendered.'
                : 'Drop an image here or replace it.'
            }
          >
            {marking ? (
              <MaskPainter
                src={source.src}
                alt={`Source render: ${source.name}. Paint to mark the area to edit.`}
                width={source.width}
                height={source.height}
                strokes={strokes}
                onChange={setStrokes}
                onDone={() => setMarking(false)}
                disabled={busy}
              />
            ) : (
              <ImageDropZone onFile={onFile} disabled={busy}>
                <figure className={styles.frame} style={{ aspectRatio: `${source.width} / ${source.height}` }}>
                  <img className={styles.image} src={source.src} alt={`Source render: ${source.name}`} />
                  {hasMark && <MaskOverlay strokes={strokes} />}
                </figure>
              </ImageDropZone>
            )}
            {!marking && (
              <div className={styles.markRow}>
                <Button
                  size="sm"
                  variant={hasMark ? 'default' : 'ghost'}
                  icon={hasMark ? <Pencil size={14} /> : <SquareDashedMousePointer size={14} />}
                  disabled={busy}
                  onPress={() => setMarking(true)}
                >
                  {hasMark ? 'Edit marked area' : 'Mark an area to edit'}
                </Button>
                {hasMark && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<X size={14} />}
                    disabled={busy}
                    onPress={() => setStrokes([])}
                  >
                    Remove mark
                  </Button>
                )}
              </div>
            )}
            <Text tone="muted" size="sm" as="p" className={styles.meta}>
              {source.name}, {source.width} × {source.height}
              {hasMark &&
                `. About ${Math.max(1, Math.round(markedShare * 100))}% marked: only that area will change, the rest is kept pixel for pixel.`}
            </Text>
          </Section>

          <Section step={2} title="Model" description="Which model develops the still, and how large.">
            <div className={styles.selectRow}>
              <Select
                label="Image model"
                options={IMAGE_MODELS}
                value={imageModel}
                onChange={(id) => {
                  const next = id as ImageModelId;
                  setImageModel(next);
                  setResolution(defaultImageResolution(next));
                  // Keep the frame shape when the new model offers it.
                  if (!imageModelHasAspect(next, aspectRatio)) setAspectRatio(MATCH_RENDER);
                  setError(null);
                }}
                disabled={busy}
              />
              <Select
                label="Resolution"
                options={imageResolutions(imageModel)}
                value={resolution}
                onChange={setResolution}
                disabled={busy || imageResolutions(imageModel).length < 2}
              />
            </div>
            <div className={styles.aspectField}>
              <Select
                label="Aspect ratio"
                options={imageAspectOptions(imageModel)}
                value={hasMark ? MATCH_RENDER : aspectRatio}
                onChange={setAspectRatio}
                disabled={busy || hasMark}
              />
              {hasMark ? (
                <Text tone="muted" size="sm" as="p" className={styles.meta}>
                  A marked edit keeps the render's own frame.
                </Text>
              ) : aspectRatio !== MATCH_RENDER && (
                <Text tone="muted" size="sm" as="p" className={styles.meta}>
                  A different shape crops in, or continues only what is already at the render's edges.
                </Text>
              )}
            </div>
          </Section>

          <Section
            step={3}
            title="Look"
            description={
              hasMark
                ? 'With a marked area, the look only shapes what changes inside it; the rest keeps the render’s light.'
                : usingLightRef
                  ? 'Lit from your lighting reference. Remove it to pick a preset look.'
                  : 'The light and grade the scene is shot in, from a preset or your own reference photo.'
            }
          >
            <LightReferenceField
              image={lightRef}
              uploading={lightUploading}
              error={lightError}
              lockedReason={
                hasMark
                  ? 'Not used while an area is marked: the rest of the frame keeps the render’s own light.'
                  : undefined
              }
              modelName={imageModelName(imageModel)}
              disabled={busy}
              onFile={(f) => void onLightFile(f)}
              onRemove={removeLightRef}
              stills={finishedStills.slice(0, 24).map(stillItem)}
              stillsLoading={library.isLoading}
              stillsError={library.error}
              onRetryStills={() => void library.refetch()}
              matched={matchedStill ? stillItem(matchedStill) : null}
              onMatch={(id) => {
                setMatchStillId(id);
                if (id) removeLightRef();
              }}
            />
            <ChoiceGroup
              label="Cinematic look"
              choices={LOOKS}
              value={look}
              onChange={(id) => setLook(id as LookId)}
              disabled={busy || usingLightRef}
            />
          </Section>

          <Section
            step={4}
            title="Camera angle"
            description={
              hasMark
                ? 'A marked edit keeps the camera where it is, so the unmarked area can stay untouched.'
                : "Small moves around your render's own viewpoint, so only what is in the image appears."
            }
          >
            <ChoiceGroup
              label="Camera angle"
              choices={ANGLES}
              value={hasMark ? 'as-rendered' : angle}
              onChange={(id) => setAngle(id as AngleId)}
              disabled={busy || hasMark}
            />
          </Section>

          <Section step={5} title="People" description="Optional. Adds photoreal people, lit and scaled to match the scene.">
            <div className={styles.stack}>
              <ChoiceGroup
                label="People in the shot"
                choices={CROWDS}
                value={crowd}
                onChange={(id) => setCrowd(id as CrowdId)}
                disabled={busy}
              />
              {crowd !== 'none' && (
                <>
                  <div className={styles.peopleGrid}>
                    <Select
                      label="Ethnicity"
                      options={ETHNICITIES}
                      value={ethnicity}
                      onChange={(id) => setEthnicity(id as EthnicityId)}
                      disabled={busy}
                    />
                    <Select
                      label="Age range"
                      options={AGES}
                      value={age}
                      onChange={(id) => setAge(id as AgeId)}
                      disabled={busy}
                    />
                    <Select
                      label="Wardrobe"
                      options={WARDROBES}
                      value={wardrobe}
                      onChange={(id) => setWardrobe(id as WardrobeId)}
                      disabled={busy}
                    />
                    <Select
                      label="Activity"
                      options={ACTIVITIES}
                      value={activity}
                      onChange={(id) => setActivity(id as ActivityId)}
                      disabled={busy}
                    />
                  </div>
                  <TextInput
                    label="Anything else about them"
                    value={people}
                    onChange={setPeople}
                    maxLength={400}
                    disabled={busy}
                    placeholder="Optional, e.g. a woman reading on the pool edge"
                  />
                  <CastSheetField
                    sheet={cast}
                    uploading={castUploading}
                    error={castError}
                    supported={castSupported}
                    modelName={imageModelName(imageModel)}
                    alternatives={castSheetModelNames()}
                    disabled={busy}
                    onFile={(f) => void onCastFile(f)}
                    onRemove={removeCast}
                  />
                </>
              )}
            </div>
          </Section>

          <Section
            step={6}
            title="Extra direction"
            description={
              hasMark
                ? 'What should happen inside the marked area, e.g. replace the paving with wet stone.'
                : 'Optional. Anything the shot should add or change.'
            }
          >
            <TextArea
              aria-label="Extra direction"
              value={direction}
              onChange={setDirection}
              rows={3}
              maxLength={DIRECTION_MAX}
              disabled={busy}
              placeholder="e.g. a light breeze moving the leaves, warmer water reflections"
            />
            {directionTooLong && (
              <Alert tone="warning" title="Your extra direction is too long">
                Your extra direction is over {DIRECTION_MAX} characters. Shorten it and try again.
              </Alert>
            )}
          </Section>

          <div className={styles.actionBar}>
          <Button
            variant="primary"
            icon={<Sparkles size={16} />}
            className={styles.generate}
            loading={busy}
            disabled={busy || castUploading || lightUploading || planBlocked || unavailable || !maskFit.ok || directionTooLong}
            onPress={() => void run()}
          >
            {phase === 'uploading'
              ? 'Uploading…'
              : phase === 'submitting'
                ? 'Starting…'
                : rendering
                  ? 'Rendering…'
                  : hasMark
                    ? 'Edit the marked area'
                    : resultUrl
                      ? 'Make another take'
                      : 'Make it cinematic'}
          </Button>
          <Text tone="muted" size="sm" as="p" className={styles.meta}>
            Uses {imageModelName(imageModel)} at {imageResolutionName(imageModel, resolution)}
            {aspectRatio !== MATCH_RENDER && !hasMark ? `, ${aspectRatio}` : ''}
            {hasMark ? ', changing only the marked area' : ''}. Each take is billed to your own Runway
            credits{crowd !== 'none' ? ', and so is the automatic people check' : ''}.
            {crowd !== 'none' && cast?.hostedUrl && castSupported && ' The cast sheet is sent as a second reference image.'}
            {usingLightRef &&
              (matchedStill
                ? ' Lit to match your chosen still, for a matching series.'
                : ' Lit from your lighting reference; only its light is used.')}
          </Text>

          {!maskFit.ok && (
            <Alert tone="warning" title="This model can't keep the render's frame">
              {maskFit.reason}
            </Alert>
          )}
          <RunwayErrorNotice
            error={shownError}
            modelName={modelName}
            onRetry={() => void (shownError === status.error ? status.refetch() : run())}
          />
          </div>
        </div>

        <div className={styles.result} data-stage>
          <Section title="Film still">
            {resultUrl && shot ? (
              <>
                <CompareSlider
                  before={shot.source.src}
                  after={resultUrl}
                  beforeAlt="Original render"
                  afterAlt={`Photoreal ${lookName.toLowerCase()} version of the render`}
                  aspectRatio={shotFrame(shot)}
                />
                {saver.error && (
                  <Alert tone="error" title="Download failed">
                    {saver.error}
                  </Alert>
                )}
                <div className={styles.resultActions}>
                  <Button
                    icon={<Download size={16} />}
                    loading={saver.pending}
                    onPress={() => saver.start(libraryUrl('still', shot.id), `film-still-${shot.look}.png`)}
                  >
                    {saver.label('Download')}
                  </Button>
                  <Button icon={<Clapperboard size={16} />} onPress={() => onAnimate(shot.id)}>
                    Make a video
                  </Button>
                  {!shot.maskKey && matchStillId !== shot.id && (
                    <Button
                      icon={<SunMedium size={16} />}
                      onPress={() => {
                        removeLightRef();
                        setMatchStillId(shot.id);
                      }}
                    >
                      Use this light for other views
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    icon={<ExternalLink size={16} />}
                    onPress={() => window.open(libraryUrl('still', shot.id), '_blank', 'noopener')}
                  >
                    Open full size
                  </Button>
                  <Text tone="muted" size="sm" className={styles.resultNote}>
                    {imageModelName(shot.imageModel)} at{' '}
                    {imageResolutionName(shot.imageModel, shot.resolution)}
                    {shot.aspectRatio !== MATCH_RENDER && ` ${shot.aspectRatio}`}, {lookName.toLowerCase()}
                    {shot.fixed && ', with fixes'}
                    {shot.maskKey && ', only the marked area changed'}
                    {shot.angle !== 'as-rendered' &&
                      `, ${ANGLES.find((a) => a.id === shot.angle)?.name.toLowerCase()}`}
                    . Drag the divider to compare.
                  </Text>
                </div>
                {shot.crowd !== 'none' && (
                  <PeopleCheck key={shot.id} stillId={shot.id} autoRun onFix={(f) => void fix(f)} fixing={fixing || busy} />
                )}
                <UpscaleStill
                  key={`up-${shot.id}`}
                  stillId={shot.id}
                  aspectRatio={shotFrame(shot)}
                  name={`film-still-${shot.look}`}
                  job={upscales[shot.id] ?? null}
                  onJob={(job) => setUpscaleJob(shot.id, job)}
                />
              </>
            ) : (
              <div
                className={styles.resultFrame}
                style={{
                  aspectRatio: frameOf(hasMark ? MATCH_RENDER : aspectRatio, source),
                  ['--ar' as string]: frameOf(hasMark ? MATCH_RENDER : aspectRatio, source),
                }}
              >
                {lostTrack && (statusErr?.signIn || statusErr?.consent || statusErr?.credits) ? (
                  <div className={styles.frameAlert}>
                    <RunwayErrorNotice
                      error={status.error}
                      modelName={imageModelName(shot?.imageModel ?? imageModel)}
                      onRetry={() => void status.refetch()}
                    />
                  </div>
                ) : lostTrack ? (
                  <div className={styles.frameAlert}>
                    <Alert tone="warning" title="Lost track of the take">
                      {statusErr?.message ?? 'The status check failed.'} The render may still be running, so
                      check again before starting another.
                    </Alert>
                    <div className={styles.resultActions}>
                      <Button size="sm" loading={status.isFetching} onPress={() => void status.refetch()}>
                        Check again
                      </Button>
                      <Button size="sm" variant="ghost" onPress={() => setShot(null)}>
                        Stop waiting
                      </Button>
                    </div>
                  </div>
                ) : busy ? (
                  <RenderingStatus
                    label={
                      phase === 'uploading'
                        ? 'Uploading your render…'
                        : phase === 'submitting'
                          ? fixing
                            ? 'Starting the corrected take…'
                            : 'Starting the take…'
                          : 'Lighting the scene and developing the frame…'
                    }
                    progress={status.data?.progress}
                    runKey={shot?.id}
                  />
                ) : taskError ? (
                  <div className={styles.frameAlert}>
                    <Alert tone="error" title="This take didn't render">
                      {taskError}
                    </Alert>
                  </div>
                ) : (
                  <EmptyState
                    title="Your film still will appear here"
                    hint="Pick a look and press Make it cinematic. A take usually lands in under a minute."
                  />
                )}
              </div>
            )}
            {earlierUpscales.map(([stillId, job]) => (
              <UpscaleStill
                key={`up-${stillId}`}
                stillId={stillId}
                aspectRatio={job.aspectRatio}
                name={job.name}
                job={job}
                onJob={(next) => setUpscaleJob(stillId, next)}
                earlier
              />
            ))}
          </Section>
        </div>
      </div>
    </>
  );
}

/** The CSS aspect-ratio of a take: its chosen ratio, else the render's own. */
function frameOf(ratio: string, source: Source): string {
  const dims = ratio === MATCH_RENDER ? undefined : aspectDims(ratio);
  return dims ? `${dims.width} / ${dims.height}` : `${source.width} / ${source.height}`;
}

function shotFrame(shot: Shot): string {
  return frameOf(shot.aspectRatio, shot.source);
}
