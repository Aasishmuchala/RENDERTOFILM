import { Clapperboard, Download, ExternalLink, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { MOMENTS, momentById, type MomentId } from '../lifestyle.ts';
import {
  AGES,
  CROWDS,
  DEFAULT_PEOPLE_OPTIONS,
  ETHNICITIES,
  LOOKS,
  lookLabel,
  WARDROBES,
  type AgeId,
  type CrowdId,
  type EthnicityId,
  type LookId,
  type WardrobeId,
} from '../looks.ts';
import {
  aspectDims,
  castSheetModelNames,
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
} from '../models.ts';
import { CastSheetField, type CastSheet } from './CastSheetField.tsx';
import { Section } from './layouts/Section.tsx';
import { libraryUrl, stillThumbUrl, useDownload } from './lib/download.ts';
import { classifyRunwayError } from './lib/runwayErrors.ts';
import { isUploadFailure, uploadRender } from './lib/uploadRender.ts';
import { PeopleCheck } from './PeopleCheck.tsx';
import { trpc } from './trpc.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { ChoiceGroup } from './ui/ChoiceGroup.tsx';
import { CompareSlider } from './ui/CompareSlider.tsx';
import { EmptyState } from './ui/EmptyState.tsx';
import { ImageDropZone } from './ui/ImageDropZone.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { RenderingStatus } from './ui/RenderingStatus.tsx';
import { RunwayErrorNotice } from './ui/RunwayErrorNotice.tsx';
import { Select } from './ui/Select.tsx';
import { Switch } from './ui/Switch.tsx';
import { Text } from './ui/Text.tsx';
import { TextArea } from './ui/TextArea.tsx';
import { TextInput } from './ui/TextInput.tsx';
import { UpscaleStill, type UpscaleJob } from './UpscaleStill.tsx';
import own from './LifestylePage.module.css';
import styles from './Studio.module.css';

type Source = {
  src: string;
  name: string;
  width: number;
  height: number;
  /** Hosted URL from `/api/upload`, once uploaded — reused across takes. */
  hostedUrl?: string | undefined;
};

/** What a take was made with, so a fix re-take can repeat it exactly. */
type MomentSettings = {
  moment: MomentId;
  imageModel: ImageModelId;
  resolution: string;
  aspectRatio: string;
  look: LookId;
  onlyInImage: boolean;
  crowd: CrowdId;
  people: string;
  ethnicity: EthnicityId;
  age: AgeId;
  wardrobe: WardrobeId;
  castSheetUrl?: string | undefined;
  direction: string;
};

type Take = MomentSettings & { id: string; source: Source; fixed: boolean };

const SAMPLE: Source = {
  src: '/sample-render.jpg',
  name: 'sample-render.jpg',
  width: 2560,
  height: 1440,
};

/** Longest extra direction the server takes, in characters. */
const DIRECTION_MAX = 600;

/** Lodha light leads the list: it is this tab's own light. */
const LIGHTS = [...LOOKS.filter((l) => l.id === 'lodha-light'), ...LOOKS.filter((l) => l.id !== 'lodha-light')];

/** A lifestyle moment always has people in it. */
const PEOPLE_COUNTS = CROWDS.filter((c) => c.id !== 'none');

const FIRST_MOMENT = MOMENTS[0];

export type LifestylePageProps = {
  /** Open the Video tab with this still picked. */
  onAnimate: (stillId: string) => void;
};

/**
 * The Lifestyle tab: a render re-shot as a moment of the residents enjoying
 * the home, in the manner of a premium residential brand film. Every take is
 * a Stills take (`createShot` with a `moment`), so it uses the same models,
 * light presets (with Lodha light first), people options, cast sheet, people
 * check and upscale as the Stills tab, and lands in the library tagged
 * @lifestyle.
 */
export function LifestylePage({ onAnimate }: LifestylePageProps) {
  const saver = useDownload();
  const utils = trpc.useUtils();
  const library = trpc.library.useQuery(undefined, { refetchOnWindowFocus: false });
  const [source, setSource] = useState<Source>(SAMPLE);
  const [momentId, setMomentId] = useState<MomentId>(FIRST_MOMENT.id);
  const [imageModel, setImageModel] = useState<ImageModelId>('nano-banana-pro');
  const [resolution, setResolution] = useState(defaultImageResolution('nano-banana-pro'));
  const [aspectRatio, setAspectRatio] = useState<string>(MATCH_RENDER);
  const [look, setLook] = useState<LookId>(FIRST_MOMENT.look);
  const [onlyInImage, setOnlyInImage] = useState(true);
  const [crowd, setCrowd] = useState<CrowdId>(FIRST_MOMENT.crowd);
  const [people, setPeople] = useState('');
  const [ethnicity, setEthnicity] = useState<EthnicityId>(DEFAULT_PEOPLE_OPTIONS.ethnicity);
  const [age, setAge] = useState<AgeId>(FIRST_MOMENT.age);
  const [wardrobe, setWardrobe] = useState<WardrobeId>(FIRST_MOMENT.wardrobe);
  const [direction, setDirection] = useState('');
  const [cast, setCast] = useState<CastSheet | null>(null);
  const [castUploading, setCastUploading] = useState(false);
  const [castError, setCastError] = useState<unknown>(null);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'submitting'>('idle');
  const [fixing, setFixing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [take, setTake] = useState<Take | null>(null);
  const takeRef = useRef(take);
  takeRef.current = take;
  /** Upscales by the still they belong to, so one survives a newer take. */
  const [upscales, setUpscales] = useState<Record<string, UpscaleJob>>({});
  const setUpscaleJob = (stillId: string, job: UpscaleJob | null) =>
    setUpscales((cur) => {
      const next = { ...cur };
      if (job) next[stillId] = job;
      else delete next[stillId];
      return next;
    });

  const createShot = trpc.createShot.useMutation();
  const status = trpc.shotStatus.useQuery(
    { id: take?.id ?? '' },
    {
      enabled: take !== null,
      refetchInterval: (q) => (q.state.data?.done ? false : 2500),
      refetchOnWindowFocus: false,
      retry: 2,
    }
  );
  const finished = status.data?.done === true;
  const doneId = finished ? take?.id : undefined;
  useEffect(() => {
    // The library now has this take; the other tabs' lists should show it.
    if (doneId) void utils.library.invalidate();
  }, [doneId, utils]);

  // In flight until a final status arrives: a failed poll doesn't free the
  // button, or a second press would bill a second take.
  const rendering = take !== null && !finished;
  const statusErr = status.error ? classifyRunwayError(status.error) : null;
  const lostTrack = rendering && status.error !== null;
  const busy = phase !== 'idle' || rendering;
  const castSupported = imageModelTakesCastSheet(imageModel);
  const resultUrl = finished ? status.data?.url : undefined;
  const taskError =
    finished && !status.data?.url ? status.data?.error ?? 'The generation did not return an image. Try again.' : undefined;
  // A failed status check is shown on the take itself, not under the button.
  const shownError = error ?? (lostTrack ? null : status.error);
  const { planBlocked, unavailable } = classifyRunwayError(shownError);
  const directionTooLong = direction.length > DIRECTION_MAX;
  const moment = momentById(momentId) ?? FIRST_MOMENT;
  const takeMoment = take ? (momentById(take.moment) ?? FIRST_MOMENT) : moment;
  const earlierUpscales = Object.entries(upscales).filter(([stillId]) => stillId !== take?.id);
  const earlier = (library.data?.stills ?? [])
    .filter((s) => s.moment && s.status === 'succeeded' && s.id !== take?.id)
    .slice(0, 12);

  function chooseMoment(id: MomentId) {
    const m = momentById(id);
    if (!m) return;
    // A moment brings its own cast and light; any of them can be changed after.
    setMomentId(m.id);
    setCrowd(m.crowd);
    setAge(m.age);
    setWardrobe(m.wardrobe);
    setLook(m.look);
  }

  async function onFile(file: File) {
    setError(null);
    const src = URL.createObjectURL(file);
    try {
      const bitmap = await createImageBitmap(file);
      setSource((prev) => {
        // The finished take's compare slider may still show the old render.
        if (prev.src.startsWith('blob:') && prev.src !== takeRef.current?.source.src) URL.revokeObjectURL(prev.src);
        return { src, name: file.name, width: bitmap.width, height: bitmap.height };
      });
      bitmap.close();
    } catch {
      URL.revokeObjectURL(src);
      setError(new Error('That file could not be read as an image. Try a PNG, JPEG or WebP.'));
    }
  }

  async function onCastFile(file: File) {
    setCastError(null);
    const src = URL.createObjectURL(file);
    setCast((prev) => {
      if (prev?.src.startsWith('blob:')) URL.revokeObjectURL(prev.src);
      return { src, name: file.name };
    });
    setCastUploading(true);
    try {
      const hostedUrl = await uploadRender(file);
      setCast((cur) => (cur?.src === src ? { ...cur, hostedUrl } : cur));
    } catch (e) {
      setCast((cur) => {
        if (cur?.src !== src) return cur;
        URL.revokeObjectURL(src);
        return null;
      });
      // The route's body, so a sign-in or consent refusal shows its prompt.
      setCastError(
        isUploadFailure(e)
          ? classifyRunwayError(e.body).signIn || classifyRunwayError(e.body).consent
            ? e.body
            : { message: e.message }
          : e instanceof Error
            ? e
            : { message: 'The cast sheet could not be uploaded. Try again.' }
      );
    } finally {
      setCastUploading(false);
    }
  }

  function removeCast() {
    setCastError(null);
    setCast((prev) => {
      if (prev?.src.startsWith('blob:')) URL.revokeObjectURL(prev.src);
      return null;
    });
  }

  async function submit(settings: MomentSettings, from: Source, fixes = '') {
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
      setPhase('submitting');
      const { id } = await createShot.mutateAsync({
        imageUrl: hostedUrl,
        imageModel: settings.imageModel,
        resolution: settings.resolution,
        aspectRatio: settings.aspectRatio,
        look: settings.look,
        angle: 'as-rendered',
        onlyInImage: settings.onlyInImage,
        crowd: settings.crowd,
        people: settings.people,
        ethnicity: settings.ethnicity,
        age: settings.age,
        wardrobe: settings.wardrobe,
        castSheetUrl: imageModelTakesCastSheet(settings.imageModel) ? settings.castSheetUrl : undefined,
        direction: settings.direction,
        fixes,
        width: from.width,
        height: from.height,
        moment: settings.moment,
      });
      setTake({ ...settings, id, source: { ...from, hostedUrl }, fixed: fixes !== '' });
    } catch (e) {
      setError(isUploadFailure(e) ? e.body ?? e : e);
    } finally {
      setPhase('idle');
    }
  }

  const run = () =>
    submit(
      {
        moment: momentId,
        imageModel,
        resolution,
        aspectRatio,
        look,
        onlyInImage,
        crowd,
        people,
        ethnicity,
        age,
        wardrobe,
        castSheetUrl: cast?.hostedUrl,
        direction,
      },
      source
    );

  async function fix(fixes: string) {
    if (!take || busy) return;
    setFixing(true);
    try {
      await submit(take, take.source, fixes.slice(0, 2000));
    } finally {
      setFixing(false);
    }
  }

  const modelName = imageModelName(take && shownError === status.error ? take.imageModel : imageModel);

  return (
    <>
      <div className={styles.layout}>
        <div className={styles.controls}>
          <PageHeader
            title="Bring the home to life"
            description="Re-shoots your render as a quiet moment of the people who live there, like a residential brand film: photoreal residents enjoying the place, never posing for it."
          />
          <div className={styles.strictSwitch}>
            <Switch
              label="Only what's in the image"
              hint={
                onlyInImage
                  ? 'Nothing new appears but the residents and the few things they carry, like a teacup or a book.'
                  : "Off: the model may add or reveal things the render doesn't show."
              }
              checked={onlyInImage}
              onChange={setOnlyInImage}
              disabled={busy}
            />
          </div>
          <Section step={1} title="Source render" description="Drop an image here or replace it.">
            <ImageDropZone onFile={onFile} disabled={busy}>
              <figure className={styles.frame} style={{ aspectRatio: `${source.width} / ${source.height}` }}>
                <img className={styles.image} src={source.src} alt={`Source render: ${source.name}`} />
              </figure>
            </ImageDropZone>
            <Text tone="muted" size="sm" as="p" className={styles.meta}>
              {source.name}, {source.width} × {source.height}
            </Text>
          </Section>

          <Section
            step={2}
            title="Moment"
            description="What the residents are doing. Pick one that suits the space; it sets the people and light below."
          >
            <ChoiceGroup
              label="Lifestyle moment"
              choices={MOMENTS}
              value={momentId}
              onChange={(id) => chooseMoment(id as MomentId)}
              disabled={busy}
            />
            <Text tone="muted" size="sm" as="p" className={own.momentNote}>
              Works best in: {moment.space.toLowerCase()}.
            </Text>
          </Section>

          <Section step={3} title="Light" description="Lodha light is the soft, warm, backlit look of a residential brand film.">
            <ChoiceGroup label="Light" choices={LIGHTS} value={look} onChange={(id) => setLook(id as LookId)} disabled={busy} />
          </Section>

          <Section step={4} title="Residents" description="Who they are. A cast sheet keeps the same family across every moment.">
            <div className={styles.stack}>
              <ChoiceGroup
                label="How many"
                choices={PEOPLE_COUNTS}
                value={crowd}
                onChange={(id) => setCrowd(id as CrowdId)}
                disabled={busy}
              />
              <div className={styles.peopleGrid}>
                <Select
                  label="Ethnicity"
                  options={ETHNICITIES}
                  value={ethnicity}
                  onChange={(id) => setEthnicity(id as EthnicityId)}
                  disabled={busy}
                />
                <Select label="Age range" options={AGES} value={age} onChange={(id) => setAge(id as AgeId)} disabled={busy} />
                <Select
                  label="Wardrobe"
                  options={WARDROBES}
                  value={wardrobe}
                  onChange={(id) => setWardrobe(id as WardrobeId)}
                  disabled={busy}
                />
              </div>
              <TextInput
                label="Anything else about them"
                value={people}
                onChange={setPeople}
                maxLength={400}
                disabled={busy}
                placeholder="Optional, e.g. a grandmother in a cream shawl"
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
            </div>
          </Section>

          <Section step={5} title="Model" description="Which model develops the still, and how large.">
            <div className={styles.selectRow}>
              <Select
                label="Image model"
                options={IMAGE_MODELS}
                value={imageModel}
                onChange={(id) => {
                  const next = id as ImageModelId;
                  setImageModel(next);
                  setResolution(defaultImageResolution(next));
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
                value={aspectRatio}
                onChange={setAspectRatio}
                disabled={busy}
              />
            </div>
          </Section>

          <Section step={6} title="Extra direction" description="Optional. Anything the moment should add or change.">
            <TextArea
              aria-label="Extra direction"
              value={direction}
              onChange={setDirection}
              rows={3}
              maxLength={DIRECTION_MAX}
              disabled={busy}
              placeholder="e.g. she glances up and smiles, a light breeze in the curtains"
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
              disabled={busy || castUploading || planBlocked || unavailable || directionTooLong}
              onPress={() => void run()}
            >
              {phase === 'uploading'
                ? 'Uploading…'
                : phase === 'submitting'
                  ? 'Starting…'
                  : rendering
                    ? 'Rendering…'
                    : resultUrl
                      ? 'Make another moment'
                      : 'Bring it to life'}
            </Button>
            <Text tone="muted" size="sm" as="p" className={styles.meta}>
              Uses {imageModelName(imageModel)} at {imageResolutionName(imageModel, resolution)}
              {aspectRatio !== MATCH_RENDER ? `, ${aspectRatio}` : ''}, in {lookLabel(look).toLowerCase()}. Each take
              and its automatic people check are billed to your own Runway credits.
              {cast?.hostedUrl && castSupported && ' The cast sheet is sent as a second reference image.'}
            </Text>
            <RunwayErrorNotice
              error={shownError}
              modelName={modelName}
              onRetry={() => void (shownError === status.error ? status.refetch() : run())}
            />
          </div>
        </div>

        <div className={styles.result} data-stage>
          <Section title={take ? takeMoment.name : 'Lifestyle still'}>
            {resultUrl && take ? (
              <>
                <CompareSlider
                  before={take.source.src}
                  after={resultUrl}
                  beforeAlt="Original render"
                  afterAlt={`${takeMoment.name}: residents in the space, ${lookLabel(take.look).toLowerCase()}`}
                  aspectRatio={frameOf(take.aspectRatio, take.source)}
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
                    onPress={() => saver.start(libraryUrl('still', take.id), `lifestyle-${take.moment}.png`)}
                  >
                    {saver.label('Download')}
                  </Button>
                  <Button icon={<Clapperboard size={16} />} onPress={() => onAnimate(take.id)}>
                    Make a video
                  </Button>
                  <Button
                    variant="ghost"
                    icon={<ExternalLink size={16} />}
                    onPress={() => window.open(libraryUrl('still', take.id), '_blank', 'noopener')}
                  >
                    Open full size
                  </Button>
                  <Text tone="muted" size="sm" className={styles.resultNote}>
                    {imageModelName(take.imageModel)} at {imageResolutionName(take.imageModel, take.resolution)},{' '}
                    {lookLabel(take.look).toLowerCase()}
                    {take.fixed && ', with fixes'}. Drag the divider to compare.
                  </Text>
                </div>
                <PeopleCheck key={take.id} stillId={take.id} autoRun onFix={(f) => void fix(f)} fixing={fixing || busy} />
                <UpscaleStill
                  key={`up-${take.id}`}
                  stillId={take.id}
                  aspectRatio={frameOf(take.aspectRatio, take.source)}
                  name={`lifestyle-${take.moment}`}
                  job={upscales[take.id] ?? null}
                  onJob={(job) => setUpscaleJob(take.id, job)}
                />
              </>
            ) : (
              <div
                className={styles.resultFrame}
                style={{
                  aspectRatio: frameOf(aspectRatio, source),
                  ['--ar' as string]: frameOf(aspectRatio, source),
                }}
              >
                {lostTrack && (statusErr?.signIn || statusErr?.consent || statusErr?.credits) ? (
                  <div className={styles.frameAlert}>
                    <RunwayErrorNotice
                      error={status.error}
                      modelName={imageModelName(take?.imageModel ?? imageModel)}
                      onRetry={() => void status.refetch()}
                    />
                  </div>
                ) : lostTrack ? (
                  <div className={styles.frameAlert}>
                    <Alert tone="warning" title="Lost track of the take">
                      {statusErr?.message ?? 'The status check failed.'} The render may still be running, so check
                      again before starting another.
                    </Alert>
                    <div className={styles.resultActions}>
                      <Button size="sm" loading={status.isFetching} onPress={() => void status.refetch()}>
                        Check again
                      </Button>
                      <Button size="sm" variant="ghost" onPress={() => setTake(null)}>
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
                          : `Bringing in the residents: ${takeMoment.name.toLowerCase()}…`
                    }
                    progress={status.data?.progress}
                    runKey={take?.id}
                  />
                ) : taskError ? (
                  <div className={styles.frameAlert}>
                    <Alert tone="error" title="This take didn't render">
                      {taskError}
                    </Alert>
                  </div>
                ) : (
                  <EmptyState
                    title="Your lifestyle still will appear here"
                    hint="Pick a moment and a light, then press Bring it to life. A take usually lands in under a minute."
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
          {earlier.length > 0 && (
            <div className={styles.below}>
              <Section title="Earlier moments">
                <div className={own.earlier}>
                  {earlier.map((s) => {
                    const name = momentById(s.moment)?.name ?? 'Lifestyle still';
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={own.earlierCard}
                        onClick={() => window.open(libraryUrl('still', s.id), '_blank', 'noopener')}
                        aria-label={`Open ${name} full size`}
                      >
                        <img className={own.earlierThumb} src={stillThumbUrl(s.id)} alt="" loading="lazy" decoding="async" />
                        <Text tone="muted" size="sm">
                          {name}, {lookLabel(s.look).toLowerCase()}
                        </Text>
                      </button>
                    );
                  })}
                </div>
              </Section>
            </div>
          )}
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
