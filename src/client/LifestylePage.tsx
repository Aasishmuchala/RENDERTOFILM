import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Download,
  Expand,
  Film,
  Image as ImageIcon,
  LayoutGrid,
  Link2,
  Projector,
  RectangleHorizontal,
  RotateCcw,
  Users,
  X,
} from 'lucide-react';
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button as AriaButton, ToggleButton as AriaToggleButton, ToggleButtonGroup } from 'react-aria-components';

import type { inferRouterOutputs } from '@trpc/server';

import type { AppRouterType, Still } from '../api.ts';
import type { AiTextProvider } from '../connections.ts';
import type {
  LifestyleCast,
  LifestyleChoice,
  LifestyleFrame,
  LifestyleImage,
  LifestyleJob,
  LifestyleShot,
} from '../lifestyle-api.ts';
import {
  CAST_ROLE_IDS,
  CAST_ROLES,
  CAST_SHEET_MODEL,
  CHAPTER_IDS,
  CHAPTERS,
  chapterById,
  DEFAULT_HERITAGE,
  DEPTH_PRESETS,
  FOCUS_TARGETS,
  GRAMMARS,
  grammarById,
  LIGHTING_PRESETS,
  lightingPresetById,
  momentById,
  presetSun,
  presetSunIds,
  SUN_POSITIONS,
  type CastRoleId,
  type ChapterId,
  type DepthId,
  type FocusId,
  type GrammarId,
  type LightingPresetId,
  type SunPositionId,
} from '../lifestyle.ts';
import { ETHNICITIES, litFromReference, lookLabel, type EthnicityId } from '../looks.ts';
import {
  castSheetModelNames,
  defaultImageResolution,
  IMAGE_MODELS,
  imageModelName,
  imageModelTakesCastSheet,
  imageResolutionName,
  imageResolutions,
  type ImageModelId,
} from '../models.ts';
import { CastSheetField, type CastSheet } from './CastSheetField.tsx';
import { directedLine, DirectionStyleSelect, useDirectionStyle } from './director/DirectionStyle.tsx';
import { slugify, withPick } from './director/shared.ts';
import { TakeImage } from './director/TakeImage.tsx';
import { formatHash, type Handoff, parseHash } from './handoff.ts';
import { Section } from './layouts/Section.tsx';
import { type CanvasState, Workspace } from './layouts/Workspace.tsx';
import { useAmbient } from './lib/ambient.tsx';
import { libraryUrl, stillThumbUrl, stillViewUrl, useDownload } from './lib/download.ts';
import { classifyRunwayError, errorMessage } from './lib/runwayErrors.ts';
import { useCapabilities } from './lib/useCapabilities.ts';
import { isUploadFailure, uploadRender } from './lib/uploadRender.ts';
import { useInFlight } from './lib/useInFlight.ts';
import { useProjectUploads } from './lib/useProjectUploads.ts';
import { LightReferenceField } from './LightReferenceField.tsx';
import { PeopleCheck } from './PeopleCheck.tsx';
import { trpc } from './trpc.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { ChoiceGroup } from './ui/ChoiceGroup.tsx';
import { CompareSlider } from './ui/CompareSlider.tsx';
import { CostLine } from './ui/CostLine.tsx';
import { FullscreenDialog } from './ui/FullscreenDialog.tsx';
import { ImageDropZone } from './ui/ImageDropZone.tsx';
import { BlockedTip, ModelUnavailable } from './ui/ModelUnavailable.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { RenderingStatus } from './ui/RenderingStatus.tsx';
import { RunwayErrorNotice } from './ui/RunwayErrorNotice.tsx';
import { Select } from './ui/Select.tsx';
import { SkeletonBlock } from './ui/Skeleton.tsx';
import { Text, TextLink } from './ui/Text.tsx';
import { TextArea } from './ui/TextArea.tsx';
import { TextInput } from './ui/TextInput.tsx';
import { ToggleButton } from './ui/ToggleButton.tsx';
import type { VideoPreset } from './VideoPage.tsx';
import own from './LifestylePage.module.css';
import styles from './Studio.module.css';

/** How many renders one plan takes (the server's MAX_LIFESTYLE_IMAGES). */
const MAX_IMAGES = 24;
const HOUSEHOLD_MAX = 400;
const KEEP_MAX = 300;
const CROP_MAX = 200;
const PEOPLE_MAX = 400;
const NOTE_MAX = 400;
const LIGHT_MAX = 300;

/** What a film's first pass is shot on unless another is picked: the model the filmic pilot read right on. */
const DEFAULT_MODEL: ImageModelId = 'gpt-image-2-5-sunburst';

/** What finishes each frame unless another is picked (the server's DEFAULT_PASS2). */
const DEFAULT_PASS2_MODEL: ImageModelId = 'nano-banana-2-1';

/** Pass 2 sends the first pass and the render, so only a model that takes two images can finish a frame. */
const PASS2_MODELS = IMAGE_MODELS.filter((m) => imageModelTakesCastSheet(m.id));

/** The typed fields of a frame; their saves wait for a pause in typing. */
const TYPED: readonly string[] = ['keep', 'crop', 'people', 'note', 'light'];

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four'];

/** The planner's pick first, under group names short enough to sit beside the value in a card's half-width list. */
function plannedFirst<T extends { id: string; name: string; hint: string }>(list: readonly T[], pick: string) {
  return withPick(list, pick, '', 'Other').map((o) => (o.group === 'Other' ? o : { ...o, group: 'Planned' }));
}

type SaveState = 'saving' | 'saved' | { error: unknown };

type CastMode = LifestyleCast['mode'];

const CAST_MODES = [
  { id: 'generated', name: 'Generated', hint: 'One cast sheet per chapter, lit in its own light' },
  { id: 'uploaded', name: 'Upload a cast sheet', hint: 'Your own photos of the people' },
  { id: 'none', name: 'No cast', hint: 'Each frame casts its residents from its own brief' },
] as const;

type AiText = inferRouterOutputs<AppRouterType>['settings']['aiText'];

const PROVIDER_NAMES = { runway: 'Runway', anthropic: 'Anthropic', omegaplus: 'OmegaPlus' } as const;

/** Who writes the plan, as the page says it: "OmegaPlus · Claude Opus 5.5" and the model alone, or Claude through Runway. */
type Planner = { provider: AiTextProvider; label: string; model: string };

function plannerOf(ai: AiText | undefined, viaRunway: boolean): Planner {
  if (!ai || ai.provider === 'runway') {
    return { provider: 'runway', label: viaRunway ? 'Claude through your Runway account' : 'your AI text provider', model: 'Claude' };
  }
  const list: readonly { id: string; name: string }[] = ai.provider === 'anthropic' ? ai.anthropicModels : ai.omegaModels;
  const model = list.find((m) => m.id === ai.model)?.name ?? ai.model ?? 'its default model';
  return { provider: ai.provider, label: `${PROVIDER_NAMES[ai.provider]} · ${model}`, model };
}

export type LifestylePageProps = {
  /** Whether this tab is on screen; a hidden tab polls slowly and skips the library. */
  active: boolean;
  /** Open the Video tab with this still picked and the shot set up for it. */
  onAnimate: (stillId: string, preset: VideoPreset) => void;
  /** The address (`#lifestyle?job=abc&frame=3`), when App hands it down; without it the page reads it itself. */
  handoff?: Handoff | undefined;
};

/** A model's 4K, the size a lifestyle frame is shot at, else its own default. */
function fourK(model: ImageModelId): string {
  return imageResolutions(model).find((r) => r.name === '4K')?.id ?? defaultImageResolution(model);
}

/** A frame as it is cast and shot: the plan with the person's changes over it, read as the server reads it. */
type BoardFrame = LifestyleFrame & { note: string; include: boolean };

const NO_PEOPLE_LEAD = /^no people\b/i;

/** Whether a brief names a household role ("mother" never matches "grandmother"). */
function namesRole(brief: string, role: CastRoleId): boolean {
  return new RegExp(`\\b${role}s?\\b`, 'i').test(brief);
}

/**
 * The roles in a people frame: what the person's own brief names, when it
 * names any (the roles they removed are gone); else the planned roles, plus
 * any the brief names.
 */
function castRoles(frame: LifestyleFrame, fits: boolean, own: boolean, people: string): CastRoleId[] {
  const named = CAST_ROLE_IDS.filter((r) => namesRole(people, r));
  if (own && named.length > 0) return named;
  return CAST_ROLE_IDS.filter((r) => (fits && frame.cast.includes(r)) || named.includes(r));
}

function boardFrame(frame: LifestyleFrame, choice: LifestyleChoice | undefined): BoardFrame {
  const c = choice ?? {};
  const grammar = c.grammar ?? frame.grammar;
  const withPeople = grammarById(grammar).people;
  // The planner's brief was written for its own shot: a brief with people
  // never fits a shot without them, nor the other way round.
  const fits = withPeople === grammarById(frame.grammar).people;
  const people = c.people ?? (fits ? frame.people : '');
  return {
    ...frame,
    chapter: c.chapter ?? frame.chapter,
    grammar,
    keep: c.keep ?? frame.keep,
    crop: c.crop ?? frame.crop,
    sun: c.sun === null ? undefined : (c.sun ?? frame.sun),
    light: (c.light ?? frame.light ?? '').trim() || undefined,
    lighting: c.lighting === null ? undefined : (c.lighting ?? frame.lighting),
    depth: c.depth === null ? undefined : (c.depth ?? frame.depth),
    focus: c.focus === null ? undefined : (c.focus ?? frame.focus),
    people,
    cast: withPeople ? castRoles(frame, fits, c.people !== undefined, people) : [],
    note: c.note ?? '',
    include: c.include ?? true,
  };
}

/** Film order, which numbers the frames: chapter, then position, then image. */
function byFilmOrder(a: BoardFrame, b: BoardFrame): number {
  return CHAPTER_IDS.indexOf(a.chapter) - CHAPTER_IDS.indexOf(b.chapter) || a.position - b.position || a.image - b.image;
}

type CastNeed = { chapter: ChapterId; roles: CastRoleId[] };

/** The sheets "Create the cast" makes: one per chapter whose frames in the film have household roles. */
function castNeeds(frames: readonly BoardFrame[]): CastNeed[] {
  const included = frames.filter((f) => f.include);
  return CHAPTERS.flatMap((c) => {
    const roles = CAST_ROLE_IDS.filter((r) => included.some((f) => f.chapter === c.id && f.cast.includes(r)));
    return roles.length ? [{ chapter: c.id, roles }] : [];
  });
}

function capitalised(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "mother, father, daughter". */
function roleNames(roles: readonly CastRoleId[]): string {
  return roles.map((r) => (CAST_ROLES.find((x) => x.id === r)?.name ?? r).toLowerCase()).join(', ');
}

/** Why a frame can't be shot as it stands, or undefined when it can. */
function notReady(f: BoardFrame): string | undefined {
  const g = grammarById(f.grammar);
  const people = f.people.trim();
  if (g.people && (!people || NO_PEOPLE_LEAD.test(people))) {
    return `Say who is there and where before shooting it as a ${g.name.toLowerCase()}, or shoot it as Empty.`;
  }
  if (g.reframe && !f.crop.trim()) return 'Say what the camera moves in on before shooting it.';
  if (
    f.keep.length > KEEP_MAX ||
    f.crop.length > CROP_MAX ||
    f.people.length > PEOPLE_MAX ||
    f.note.length > NOTE_MAX ||
    (f.light?.length ?? 0) > LIGHT_MAX
  ) {
    return 'Shorten the fields over their limit before shooting it.';
  }
  return undefined;
}

type TakeState = 'none' | 'pass1-pending' | 'pass1-failed' | 'pass2-waiting' | 'pass2-pending' | 'pass2-failed' | 'done';

/** A frame's take across its passes, and the still the board shows for it. */
type TakeView = {
  pass1?: Still | undefined;
  pass2?: Still | undefined;
  state: TakeState;
  /** The frame as it stands: the final, or pass 1 while pass 2 can't be had (so the frame is usable meanwhile). */
  result?: Still | undefined;
  /** Why pass 2 didn't finish. */
  note?: string | undefined;
  /** The take's first pass is an x-ray plate that pass 2 develops; false on older takes and single-pass plans. */
  plate: boolean;
};

const NO_TAKE: TakeView = { state: 'none', plate: false };

/** A take still on its way: never shot again, and the board keeps polling for it. */
function inFlight(state: TakeState | undefined): boolean {
  return state === 'pass1-pending' || state === 'pass2-waiting' || state === 'pass2-pending';
}

/**
 * Where a take is: its first pass from the library, then (on a two-pass
 * plan) its second from the job's record of it and the library. A first
 * pass the library doesn't list yet is pending: the server puts a lost take
 * back as it loads the board.
 */
function takeView(shot: LifestyleShot | undefined, twoPass: boolean, stillById: ReadonlyMap<string, Still>): TakeView {
  if (!shot) return NO_TAKE;
  const plate = shot.plate === true;
  const pass1 = stillById.get(shot.stillId);
  if (!pass1 || pass1.status === 'pending') return { pass1, state: 'pass1-pending', plate };
  if (pass1.status === 'failed') return { pass1, state: 'pass1-failed', plate };
  if (!twoPass) return { pass1, state: 'done', result: pass1, plate };
  const p = shot.pass2;
  if (!p || p.state === 'starting') return { pass1, state: 'pass2-waiting', plate };
  if (p.state === 'started') {
    const pass2 = stillById.get(p.stillId);
    if (!pass2 || pass2.status === 'pending') return { pass1, pass2, state: 'pass2-pending', plate };
    if (pass2.status === 'succeeded') return { pass1, pass2, state: 'done', result: pass2, plate };
    const failure = pass2.error ?? 'The finishing pass failed.';
    return { pass1, pass2, state: 'pass2-failed', result: pass1, note: failure, plate };
  }
  const note = p.state === 'failed' ? p.error : p.state === 'skipped' ? p.reason : 'Pass 2 was deleted from the library.';
  return { pass1, state: 'pass2-failed', result: pass1, note, plate };
}

/** The take each frame uses, as the server reads it: the one picked for it, else its newest. */
function usedShots(job: LifestyleJob | null): Map<number, LifestyleShot> {
  const used = new Map<number, LifestyleShot>();
  for (const shot of job?.shots ?? []) {
    const picked = job?.choices?.[shot.image]?.take;
    if (picked ? shot.stillId === picked : !used.has(shot.image)) used.set(shot.image, shot);
  }
  return used;
}

/** "lifestyle-3-by-the-pool.png", or "…-pass1.png" for a two-pass take's first pass. */
function downloadName(order: number, title: string, pass1: boolean): string {
  return `lifestyle-${order}-${slugify(title)}${pass1 ? '-pass1' : ''}.png`;
}

/** What a frame without people still does on video. */
const NATURAL_MOTION =
  'Only natural motion, where the frame has it: leaves stir in a light breeze, water ripples softly and a few petals drift down';

/**
 * How "Animate" sets a finished frame up on the Video tab, after a good
 * locked-off lifestyle clip: Kling 3.0 at native 4K for five seconds, the
 * camera locked off, and the brief the take was shot from as one small,
 * unhurried movement (a frame without people gets only leaves, water and
 * petals). All of it stays editable there.
 */
function animatePreset(still: Still, grammar: GrammarId): VideoPreset {
  const brief = still.people.trim().replace(/[\s.,;:!?]+$/, '');
  const people = grammarById(still.lifestyle?.grammar ?? grammar).people && brief !== '' && !NO_PEOPLE_LEAD.test(brief);
  return {
    model: 'kling-3-4k',
    seconds: 5,
    motion: 'still-life',
    moveStyle: 'steady',
    speed: 'slow',
    direction: people ? `${capitalised(brief)}; just one small, unhurried movement, at real-time speed` : NATURAL_MOTION,
    note: 'Set up from your Lifestyle frame: Kling, five seconds, the camera locked off. Change anything; nothing is made until you press Make the video.',
  };
}

function uploadErrorFrom(e: unknown, what: string): unknown {
  // The route's body, so a sign-in or consent refusal shows its prompt.
  if (isUploadFailure(e)) {
    const kind = classifyRunwayError(e.body);
    return kind.signIn || kind.consent ? e.body : { message: e.message };
  }
  return e instanceof Error ? e : { message: `The ${what} could not be uploaded. Try again.` };
}

/** A reference photo as held: whose it is, the preview, the upload in flight (its preview's src) and the last failure. */
type Reference = { owner: string | undefined; image: CastSheet | null; uploading: string | null; error: unknown };

/**
 * One optional reference photo (the lighting reference, a cast sheet): a local
 * preview, uploaded at once. `owner` is what the photo is for (a board's id):
 * another owner is shown none of it, not the preview, the upload nor the
 * failure, and an upload still in flight resolves for the one that dropped
 * it, so a board opened meanwhile neither shows it nor takes it.
 */
function useReferenceUpload(what: string, owner?: string) {
  const [held, setHeld] = useState<Reference>({ owner, image: null, uploading: null, error: null });
  /** The upload each owner last started, so one replaced meanwhile is never applied. */
  const latest = useRef(new Map<string | undefined, string>());
  const mine = held.owner === owner;

  /** Upload a photo in place of the current one; its hosted URL, unless it failed or was replaced meanwhile. */
  async function add(file: Blob, name: string): Promise<string | undefined> {
    const src = URL.createObjectURL(file);
    latest.current.set(owner, src);
    setHeld((prev) => {
      if (prev.image?.src.startsWith('blob:')) URL.revokeObjectURL(prev.image.src);
      return { owner, image: { src, name }, uploading: src, error: null };
    });
    try {
      const hostedUrl = await uploadRender(file);
      setHeld((cur) => (cur.image?.src === src ? { ...cur, image: { ...cur.image, hostedUrl } } : cur));
      return latest.current.get(owner) === src ? hostedUrl : undefined;
    } catch (e) {
      // The failure shows where the photo was dropped, while it is still the one there.
      setHeld((cur) => {
        if (cur.image?.src !== src) return cur;
        URL.revokeObjectURL(src);
        return { ...cur, image: null, error: uploadErrorFrom(e, what) };
      });
      return undefined;
    } finally {
      setHeld((cur) => (cur.uploading === src ? { ...cur, uploading: null } : cur));
    }
  }

  /** Drop this owner's photo; another's, in flight or in, is left alone. */
  function clear() {
    latest.current.delete(owner);
    setHeld((prev) => {
      if (prev.owner !== owner) return prev;
      if (prev.image?.src.startsWith('blob:')) URL.revokeObjectURL(prev.image.src);
      return { ...prev, image: null, error: null };
    });
  }

  function setError(error: unknown) {
    setHeld((prev) => (prev.owner === owner ? { ...prev, error } : { owner, image: null, uploading: null, error }));
  }

  return {
    image: mine ? held.image : null,
    uploading: mine && held.uploading !== null,
    error: mine ? held.error : null,
    setError,
    add,
    clear,
  };
}

/**
 * The address: App's when it hands one down, else read here on load and on
 * every change. App writes a page switch with replaceState, which fires no
 * hashchange and lands after this page's effects, so that read waits for it.
 */
function useHandoff(given: Handoff | undefined, active: boolean): Handoff {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    if (given) return;
    const read = () => setHash(window.location.hash);
    queueMicrotask(read);
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [given, active]);
  return useMemo(() => given ?? parseHash(hash), [given, hash]);
}

/** A plan made here takes over from the job the address names, so a reload lands on the new plan. */
function dropAddressedJob() {
  const { page, params } = parseHash(window.location.hash);
  if (page === 'lifestyle' && params['job']) window.location.replace(formatHash('lifestyle'));
}

/** The frames of `board` in a guard keyed `board:image`, as the page's busy state. */
function framesOn(board: string, guard: ReadonlySet<string>): Record<number, boolean> {
  const out: Record<number, boolean> = {};
  for (const key of guard) {
    if (key.startsWith(`${board}:`)) out[Number(key.slice(board.length + 1))] = true;
  }
  return out;
}

/**
 * The Lifestyle tab: every render of a project planned as a frame of a
 * residential lifestyle film (src/lifestyle-api.ts). Claude tags each one
 * with its chapter, shot, what stays exactly as it is and who of the
 * household is there; the person edits that plan of action, the household
 * is cast once (per chapter, in that chapter's light) or uploaded, and each
 * frame is then re-photographed from its render onto the board. Every take
 * lands in the library tagged @lifestyle.
 */
export function LifestylePage({ active, onAnimate, handoff }: LifestylePageProps) {
  const utils = trpc.useUtils();
  const address = useHandoff(handoff, active);
  const addressedJob = (address.page === 'lifestyle' && address.params['job']) || undefined;
  const addressedFrame = address.page === 'lifestyle' ? address.params['frame'] : undefined;
  // A take or cast sheet rendering, or one the board knows of that the
  // library hasn't caught up with yet, keeps the library fresh.
  const boardWaiting = useRef(false);
  const library = trpc.library.useQuery(undefined, {
    refetchInterval: (q) =>
      active && (boardWaiting.current || q.state.data?.stills.some((s) => s.status === 'pending')) ? 8_000 : false,
  });

  const { uploads, overflow, addFiles, remove, retry, canRetry, pending, failed } = useProjectUploads(MAX_IMAGES);
  const [heritage, setHeritage] = useState<EthnicityId>(DEFAULT_HERITAGE);
  const [household, setHousehold] = useState('');
  const [directorStyle, setDirectorStyle] = useDirectionStyle('lifestyle');
  const light = useReferenceUpload('lighting reference');
  const { allowedImage, caps, modelBlocked, onBay, providerNote } = useCapabilities();
  const [imageModel, setImageModel] = useState<ImageModelId>(DEFAULT_MODEL);
  const [resolution, setResolution] = useState(() => fourK(DEFAULT_MODEL));
  const [twoPass, setTwoPass] = useState(true);
  const [pass2Model, setPass2Model] = useState<ImageModelId>(DEFAULT_PASS2_MODEL);
  const [pass2Resolution, setPass2Resolution] = useState(() => fourK(DEFAULT_PASS2_MODEL));
  const pass1Off = modelBlocked('image', imageModel);
  const pass2Off = twoPass ? modelBlocked('image', pass2Model) : null;
  const jobBlocked = pass1Off ?? pass2Off;
  const [jobId, setJobId] = useState<string | null>(addressedJob ?? null);
  const [viewing, setViewing] = useState<number | null>(null);
  /** What the inspector and the canvas are on: the film's setup, or one frame (its image index). */
  const [selected, setSelected] = useState<'job' | number>('job');
  /** The contact sheet is on the canvas while a frame is selected. */
  const [gridShown, setGridShown] = useState(false);
  /** A chapter's cast sheet on the canvas, by its still id, picked in the strip. */
  const [sheetShown, setSheetShown] = useState<string | null>(null);
  /** The renders the last plan made here was sent with: others added since turn the footer back to Plan. */
  const [plannedKey, setPlannedKey] = useState<string | null>(null);
  /** The renders waiting when an address opened a board: the board stays up, and they keep a Plan of their own. */
  const [behindBoard, setBehindBoard] = useState<string | null>(null);

  const plan = trpc.lifestyle.plan.useMutation();
  // A double-click's second press arrives before plan.isPending shows, and a
  // second plan would leave an orphan job stuck in "planning".
  const planGuard = useInFlight();
  // Who writes the plan: the Settings choice, which step 2 changes too.
  const aiText = trpc.settings.aiText.useQuery(undefined, { enabled: active });
  const planner = plannerOf(aiText.data, caps.textViaRunway);
  // A two-pass take on its way: only a poll of the job sends its second pass.
  const passesWaiting = useRef(false);
  // With no plan made here yet, this is the newest one, so a reload picks up where it was.
  const job = trpc.lifestyle.job.useQuery(jobId ? { id: jobId } : {}, {
    refetchInterval: (q) =>
      q.state.data?.status === 'planning'
        ? active
          ? 4000
          : 15_000
        : passesWaiting.current
          ? active
            ? 6000
            : 20_000
          : false,
    // Pass 2 starts on a poll, so polling goes on with the browser tab in the background.
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    retry: 2,
  });
  const current = job.data ?? null;

  // Until the new plan's first poll lands there is no job to show, and the
  // button must not start (and bill) a second plan meanwhile. A job the address
  // opened is being read, not planned.
  const planning =
    plan.isPending || (jobId !== null && jobId !== addressedJob && job.isPending) || current?.status === 'planning';
  const householdTooLong = household.length > HOUSEHOLD_MAX;
  const ready = uploads.length > 0 && pending === 0 && failed === 0 && !householdTooLong && !light.uploading;
  const uploadsKey = uploads.map((u) => u.key).join('|');

  async function runPlan() {
    if (!ready || planning || jobBlocked || !planGuard.start()) return;
    const sentKey = uploadsKey;
    try {
      const { id } = await plan.mutateAsync({
        images: uploads.map((u) => ({ url: u.hostedUrl!, width: u.width, height: u.height, name: u.name })),
        imageModel,
        resolution,
        pass2: twoPass ? { imageModel: pass2Model, resolution: pass2Resolution } : null,
        heritage,
        household,
        directorStyle,
        lightRefUrl: light.image?.hostedUrl,
      });
      setJobId(id);
      setPlannedKey(sentKey);
      dropAddressedJob();
      void utils.lifestyle.job.invalidate();
    } catch {
      // Shown by RunwayErrorNotice from plan.error.
    } finally {
      planGuard.end();
    }
  }

  // ---- The lighting reference may be one of the person's own stills: it is
  // sent like an uploaded photo.
  const stillById = useMemo(() => new Map((library.data?.stills ?? []).map((s) => [s.id, s])), [library.data]);
  const lightStills = useMemo(
    () =>
      (library.data?.stills ?? [])
        .filter((s) => s.status === 'succeeded' && s.lifestyle?.kind !== 'cast')
        .slice(0, 24)
        .map((s) => {
          // Two lines: the frame or look, then the model, size and time; the tooltip holds both.
          const caption = s.lifestyle?.title ?? lookLabel(s.look, litFromReference(s));
          const res = imageResolutionName(s.imageModel, s.resolution);
          const when = new Date(s.createdAt).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          });
          const detail = `${imageModelName(s.imageModel)}${res ? `, ${res}` : ''}, ${when}`;
          return {
            id: s.id,
            src: stillThumbUrl(s.id),
            alt: `${caption}, ${new Date(s.createdAt).toLocaleString()}`,
            caption,
            detail,
            title: `${caption}, ${detail}`,
          };
        }),
    [library.data]
  );
  async function matchStill(id: string | null) {
    const item = lightStills.find((s) => s.id === id);
    if (!id || !item) return;
    try {
      const res = await fetch(stillViewUrl(id));
      if (!res.ok) throw new Error(`The still could not be loaded (${res.status}).`);
      await light.add(await res.blob(), `${slugify(item.caption)}.jpg`);
    } catch {
      light.setError({ message: 'That still could not be loaded. Try again, or drop a photo instead.' });
    }
  }

  // ---- The board: the person's changes per frame, saved as they make them.
  const [drafts, setDrafts] = useState<Record<number, LifestyleChoice>>({});
  const [saves, setSaves] = useState<Record<number, SaveState>>({});
  const [shooting, setShooting] = useState<Record<number, boolean>>({});
  const [shootErrors, setShootErrors] = useState<Record<number, unknown>>({});
  const [retrying, setRetrying] = useState<Record<number, boolean>>({});
  const [retryErrors, setRetryErrors] = useState<Record<number, unknown>>({});
  /** Takes shown as their first pass rather than the final, by the final's id; the card and the big screen share it. */
  const [pass1Shown, setPass1Shown] = useState<Record<string, boolean>>({});
  const [castMode, setCastMode] = useState<CastMode>('generated');
  const [castBusy, setCastBusy] = useState<CastMode | 'approve' | null>(null);
  const [castError, setCastError] = useState<unknown>(undefined);
  const boardId = current?.status === 'planned' ? current.id : undefined;
  // The person's own cast sheet; held here so it survives the inspector
  // switching to a frame and back, and the board's own: another board is
  // shown its own cast, never this one.
  const castUpload = useReferenceUpload('cast sheet', boardId);
  const loadedBoard = useRef<string | undefined>(undefined);
  /** Frames whose shoot or pass-2 retry request is in flight, by board and image, which the state is too slow to guard. */
  const shootingNow = useRef(new Set<string>());
  const retryingNow = useRef(new Set<string>());
  useEffect(() => {
    if (!boardId || loadedBoard.current === boardId || !current) return;
    loadedBoard.current = boardId;
    const initial: Record<number, LifestyleChoice> = {};
    for (const [k, v] of Object.entries(current.choices ?? {})) initial[Number(k)] = v;
    setDrafts(initial);
    setSaves({});
    // A board read again keeps what it has in flight: a frame stays busy, and its press isn't dropped unseen.
    setShooting(framesOn(boardId, shootingNow.current));
    setShootErrors({});
    setRetrying(framesOn(boardId, retryingNow.current));
    setRetryErrors({});
    setCastBusy(null);
    setCastError(undefined);
    // A film with residents starts on the created cast; one without, on none.
    const residents = castNeeds((current.plan ?? []).map((f) => boardFrame(f, initial[f.image]))).length > 0;
    setCastMode(current.cast?.mode ?? (residents && imageModelTakesCastSheet(current.imageModel) ? 'generated' : 'none'));
    // A new board opens on the film's setup.
    setSelected('job');
    setGridShown(false);
    setSheetShown(null);
  }, [boardId, current]);

  // One frame's saves go one after another, so a quick run of changes is
  // stored in the order it was made.
  const saveChains = useRef(new Map<number, Promise<unknown>>());
  const save = useCallback(
    (id: string, image: number, patch: LifestyleChoice) => {
      // A save that lands after another board loaded is not that board's.
      const stillLoaded = () => loadedBoard.current === id;
      if (stillLoaded()) setSaves((s) => ({ ...s, [image]: 'saving' }));
      const chains = saveChains.current;
      const next = (chains.get(image) ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => utils.client.lifestyle.choose.mutate({ id, image, ...patch }))
        .then(() => {
          if (chains.get(image) === next && stillLoaded()) setSaves((s) => ({ ...s, [image]: 'saved' }));
        })
        .catch((error: unknown) => {
          if (stillLoaded()) setSaves((s) => ({ ...s, [image]: { error } }));
        });
      chains.set(image, next);
    },
    [utils]
  );
  const typingTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  /** Typing not saved yet, per frame, so a quick edit of two fields saves both. */
  const unsent = useRef(new Map<number, LifestyleChoice>());
  const takeUnsent = useCallback((image: number): LifestyleChoice | undefined => {
    clearTimeout(typingTimers.current.get(image));
    typingTimers.current.delete(image);
    const patch = unsent.current.get(image);
    unsent.current.delete(image);
    return patch;
  }, []);
  const onChoose = useCallback(
    (image: number, patch: LifestyleChoice) => {
      if (!boardId) return;
      setDrafts((d) => ({ ...d, [image]: { ...d[image], ...patch } }));
      if (Object.keys(patch).every((k) => TYPED.includes(k))) {
        unsent.current.set(image, { ...unsent.current.get(image), ...patch });
        clearTimeout(typingTimers.current.get(image));
        setSaves((s) => ({ ...s, [image]: 'saving' }));
        typingTimers.current.set(
          image,
          setTimeout(() => {
            const typed = takeUnsent(image);
            if (typed) save(boardId, image, typed);
          }, 800)
        );
      } else {
        // A pick is saved at once, with any typing still waiting.
        save(boardId, image, { ...takeUnsent(image), ...patch });
      }
    },
    [boardId, save, takeUnsent]
  );
  /** Save every change still waiting and let all saves land, so the server reads the plan as it is on screen. */
  const flushSaves = useCallback(async () => {
    if (!boardId) return;
    for (const image of [...unsent.current.keys()]) {
      const typed = takeUnsent(image);
      if (typed) save(boardId, image, typed);
    }
    await Promise.all([...saveChains.current.values()]);
  }, [boardId, save, takeUnsent]);

  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const viewsRef = useRef(new Map<number, TakeView>());
  const refetchJob = job.refetch;
  const shoot = useCallback(
    async (image: number, fixes?: string) => {
      // The drafts and frame state are the loaded board's: a Shoot all still
      // running for a board since replaced stops here, with nothing billed.
      if (!boardId || loadedBoard.current !== boardId) return;
      const stillLoaded = () => loadedBoard.current === boardId;
      // A frame already being shot, or whose take is still on either pass, is not billed a second time.
      const flying = `${boardId}:${image}`;
      if (shootingNow.current.has(flying) || retryingNow.current.has(flying) || inFlight(viewsRef.current.get(image)?.state)) {
        return;
      }
      shootingNow.current.add(flying);
      // Typing still waiting to save rides along with the shoot instead.
      const typed = takeUnsent(image);
      setShooting((s) => ({ ...s, [image]: true }));
      setShootErrors((e) => ({ ...e, [image]: undefined }));
      setRetryErrors((e) => ({ ...e, [image]: undefined }));
      try {
        // The current changes ride along, so one made a moment ago is never lost.
        await utils.client.lifestyle.shoot.mutate({
          id: boardId,
          image,
          ...draftsRef.current[image],
          take: undefined,
          ...(fixes ? { fixes: fixes.slice(0, 2000) } : {}),
        });
        if (typed && stillLoaded()) setSaves((s) => ({ ...s, [image]: 'saved' }));
        await Promise.all([refetchJob(), utils.library.invalidate()]);
      } catch (error) {
        if (stillLoaded()) setShootErrors((e) => ({ ...e, [image]: error }));
        // The shoot didn't go, so the typing it carried is saved on its own.
        if (typed) save(boardId, image, typed);
      } finally {
        shootingNow.current.delete(flying);
        if (stillLoaded()) setShooting((s) => ({ ...s, [image]: false }));
      }
    },
    [boardId, utils, refetchJob, save, takeUnsent]
  );

  /**
   * Send a take's second pass again (one that failed, was skipped or was
   * deleted). The server claims it as a poll does, so a second press, or a
   * poll that got there first, sends nothing more.
   */
  const retryPass2 = useCallback(
    async (image: number, stillId: string) => {
      if (!boardId) return;
      const flying = `${boardId}:${image}`;
      if (retryingNow.current.has(flying) || shootingNow.current.has(flying)) return;
      const stillLoaded = () => loadedBoard.current === boardId;
      retryingNow.current.add(flying);
      setRetrying((r) => ({ ...r, [image]: true }));
      setRetryErrors((e) => ({ ...e, [image]: undefined }));
      try {
        await utils.client.lifestyle.retryPass2.mutate({ id: boardId, stillId });
      } catch (error) {
        // A failure that lands after another board loaded is not that board's.
        if (stillLoaded()) setRetryErrors((e) => ({ ...e, [image]: error }));
      } finally {
        // Sent or refused, the take has moved on: show where it is now.
        await Promise.all([refetchJob(), utils.library.invalidate()]).catch(() => undefined);
        retryingNow.current.delete(flying);
        if (stillLoaded()) setRetrying((r) => ({ ...r, [image]: false }));
      }
    },
    [boardId, utils, refetchJob]
  );
  const showPass1 = useCallback(
    (resultId: string, pass1: boolean) => setPass1Shown((s) => ({ ...s, [resultId]: pass1 })),
    []
  );

  const twoPassBoard = current?.status === 'planned' && current.pass2 !== undefined;
  /** Each frame's take, across both passes: the one the frame uses, as the server reads it. */
  const views = useMemo(() => {
    const out = new Map<number, TakeView>();
    for (const [image, shot] of usedShots(current)) out.set(image, takeView(shot, twoPassBoard, stillById));
    return out;
  }, [current, twoPassBoard, stillById]);
  viewsRef.current = views;
  // A poll of the job moves a second pass on (sent, failed, skipped) once its
  // first pass is done, which the library's own slower poll may not know yet:
  // catch the library up, so the card shows pass 1 under pass 2 at once.
  const passKey =
    current?.status === 'planned'
      ? `${current.id}|${(current.shots ?? [])
          .map((s) => `${s.stillId}:${s.pass2?.state ?? ''}:${s.pass2?.state === 'started' ? s.pass2.stillId : ''}`)
          .join(',')}`
      : undefined;
  const seenPassKey = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (passKey === undefined) return;
    const before = seenPassKey.current;
    seenPassKey.current = passKey;
    if (before !== undefined && before !== passKey) void utils.library.invalidate();
  }, [passKey, utils]);
  const board = useMemo(
    () =>
      current?.status === 'planned'
        ? (current.plan ?? []).map((f) => boardFrame(f, drafts[f.image])).sort(byFilmOrder)
        : [],
    [current, drafts]
  );
  const planned = useMemo(() => new Map((current?.plan ?? []).map((f) => [f.image, f])), [current?.plan]);
  const needs = useMemo(() => castNeeds(board), [board]);
  const cast = current?.status === 'planned' ? current.cast : undefined;
  const sheets = cast?.mode === 'generated' ? (cast.sheets ?? []) : [];
  // A take on either pass, or a sheet, whose still the library doesn't list
  // yet (the server puts a lost one back, pending, as it loads the board)
  // waits for the next refresh too.
  const anyInFlight = [...views.values()].some((v) => inFlight(v.state));
  boardWaiting.current =
    anyInFlight ||
    Object.values(shooting).some(Boolean) ||
    sheets.some((s) => {
      const state = stillById.get(s.stillId)?.status;
      return state !== 'succeeded' && state !== 'failed';
    });
  passesWaiting.current = twoPassBoard && anyInFlight;
  // A plan keeps the models it was made with, so a provider that hides one stops the shoot.
  const boardBlocked = current
    ? (modelBlocked('image', current.imageModel) ??
      (current.pass2 ? modelBlocked('image', current.pass2.imageModel) : null))
    : null;
  const boardNote = current ? providerNote(current.imageModel, ...(current.pass2 ? [current.pass2.imageModel] : [])) : undefined;
  const canShoot = cast?.approved === true && boardBlocked === null;
  const whyNotShoot = boardBlocked ?? 'Approve the cast, or choose No cast, to start shooting.';
  const included = board.filter((f) => f.include);
  const unshot = included.filter((f) => {
    const state = views.get(f.image)?.state ?? 'none';
    // A take on its way is never shot again, and one whose second pass
    // didn't finish is retried on its own, not shot again.
    return !notReady(f) && !shooting[f.image] && (state === 'none' || state === 'pass1-failed');
  });
  const unshotRef = useRef(unshot);
  unshotRef.current = unshot;
  const [shootingAll, setShootingAll] = useState(false);
  /** A frame of the film being sent or still on its passes. */
  const takesOnTheirWay = included.some((f) => Boolean(shooting[f.image]) || inFlight(views.get(f.image)?.state));
  // Every frame of the film has its take (one whose develop didn't finish keeps its first pass).
  const firstTake = included[0] ? views.get(included[0].image)?.result : undefined;
  const filmShot =
    included.length > 0 &&
    !shootingAll &&
    !takesOnTheirWay &&
    included.every((f) => views.get(f.image)?.result !== undefined);
  async function shootAll() {
    setShootingAll(true);
    try {
      for (const f of unshot) {
        // The list was made when the button was pressed; a frame shot or changed since is skipped.
        if (unshotRef.current.some((u) => u.image === f.image)) await shoot(f.image);
      }
    } finally {
      setShootingAll(false);
    }
  }

  // ---- The cast: made, uploaded or none, then approved before the shoot.
  // Both calls are this board's: one that ends after another board loaded (a
  // sheet whose upload outlasted the hop) still lands on its own job, and shows
  // the board now on screen nothing of it.
  const chooseCast = useCallback(
    async (mode: CastMode, uploadedUrl?: string) => {
      if (!boardId) return;
      const stillLoaded = () => loadedBoard.current === boardId;
      if (stillLoaded()) {
        setCastBusy(mode);
        setCastError(undefined);
      }
      try {
        // The cast is made from the plan as it reads on screen, typing included.
        if (stillLoaded()) await flushSaves();
        await utils.client.lifestyle.cast.mutate({ id: boardId, mode, ...(uploadedUrl ? { uploadedUrl } : {}) });
      } catch (error) {
        if (stillLoaded()) setCastError(error);
      } finally {
        // Sheets sent before a failure are on the plan too.
        await Promise.all([refetchJob(), utils.library.invalidate()]).catch(() => undefined);
        if (stillLoaded()) setCastBusy(null);
      }
    },
    [boardId, flushSaves, utils, refetchJob]
  );
  const approveCast = useCallback(async () => {
    if (!boardId) return;
    const stillLoaded = () => loadedBoard.current === boardId;
    setCastBusy('approve');
    setCastError(undefined);
    try {
      await utils.client.lifestyle.approveCast.mutate({ id: boardId });
      await refetchJob();
    } catch (error) {
      if (stillLoaded()) setCastError(error);
    } finally {
      if (stillLoaded()) setCastBusy(null);
    }
  }, [boardId, utils, refetchJob]);

  const openFrame = useCallback((image: number) => setViewing(image), []);
  // The room's light (DESIGN.md 2.5): the take on the big screen, as it is shown
  // there (final or pass 1); else the project's first frame as the board shows
  // it (its take, else its render); else the first render dropped in.
  const viewed = viewing !== null ? views.get(viewing) : undefined;
  const viewedTake =
    viewed?.result?.status === 'succeeded'
      ? viewed.state === 'done' && viewed.pass2 !== undefined && pass1Shown[viewed.result.id] === true
        ? viewed.pass1
        : viewed.result
      : undefined;
  const lead = board[0];
  const leadTake = lead ? views.get(lead.image)?.result : undefined;
  const leadPreview = lead
    ? leadTake?.status === 'succeeded'
      ? stillThumbUrl(leadTake.id)
      : current?.images[lead.image]?.url
    : undefined;
  useAmbient(viewedTake ? stillThumbUrl(viewedTake.id) : (leadPreview ?? uploads[0]?.src ?? null));
  const chaptersUsed = CHAPTERS.filter((c) => board.some((f) => f.chapter === c.id)).length;
  const directed = directedLine(current?.status === 'planned' ? current.directorStyle : undefined);
  const modelName = imageModelName(imageModel);
  const pass2Name = imageModelName(pass2Model);
  // How the plan on the board is shot: "GPT Image 2.5 Sunburst at 4K, finished with Nano Banana 2.1 at 4K".
  const shotWith = (model: ImageModelId, res: string) => {
    const size = imageResolutionName(model, res);
    return `${imageModelName(model)}${size ? ` at ${size}` : ''}`;
  };
  const boardShotWith = current
    ? current.pass2
      ? `X-ray plate on ${shotWith(current.imageModel, current.resolution)}, developed with ${shotWith(current.pass2.imageModel, current.pass2.resolution)}`
      : `Shot with ${shotWith(current.imageModel, current.resolution)}`
    : '';
  // What one frame of the board costs: "two stills: the x-ray plate on …, then the develop on …".
  const frameStills = current
    ? current.pass2
      ? `two stills: the x-ray plate on ${imageModelName(current.imageModel)}, then the develop on ${imageModelName(current.pass2.imageModel)}`
      : `one ${imageModelName(current.imageModel)} still`
    : '';

  // ---- The workspace: selection drives the inspector and the canvas.
  const isPlanned = current?.status === 'planned';
  // Renders added since the board was planned are a new film to plan; those an
  // address opened a board over wait behind it.
  const unplanned = uploads.length > 0 && uploadsKey !== plannedKey;
  const freshUploads = unplanned && uploadsKey !== behindBoard;
  const planMode = planning || !isPlanned || freshUploads;
  const planLabel = planning
    ? 'Planning the film…'
    : uploads.length === 0
      ? 'Add project renders first'
      : pending > 0
        ? 'Uploading the renders…'
        : failed > 0
          ? 'Retry or remove the failed upload'
          : householdTooLong
            ? 'Shorten the household note first'
            : light.uploading
              ? 'Uploading the lighting reference…'
              : `Plan ${uploads.length} frame${uploads.length === 1 ? '' : 's'}`;
  const selectedFrame = typeof selected === 'number' ? board.find((f) => f.image === selected) : undefined;
  const selectedIndex = selectedFrame ? board.indexOf(selectedFrame) : -1;
  const gridOn =
    isPlanned && board.length > 0 && sheetShown === null && (selectedFrame ? gridShown : !freshUploads || gridShown);
  const selView = selectedFrame ? (views.get(selectedFrame.image) ?? NO_TAKE) : NO_TAKE;
  const selImg = selectedFrame ? current?.images[selectedFrame.image] : undefined;
  const selSourceOk = useImageLoads(selImg?.url);
  const selShooting = selectedFrame ? Boolean(shooting[selectedFrame.image]) : false;
  const selRendering = selShooting || inFlight(selView.state);
  const selFinished = selView.state === 'done' && selView.pass2 !== undefined;
  const selPass1 = selFinished && selView.result ? pass1Shown[selView.result.id] === true : false;
  const selDone =
    selView.state === 'done' || selView.state === 'pass2-failed'
      ? selFinished && selPass1
        ? selView.pass1
        : selView.result
      : undefined;
  const selShowingPass1 = twoPassBoard && selDone !== undefined && selDone === selView.pass1;
  const frameSaver = useDownload();
  const prevFrame = selectedIndex > 0 ? board[selectedIndex - 1] : undefined;
  const nextFrame = selectedIndex < board.length - 1 ? board[selectedIndex + 1] : undefined;

  const selectFrame = useCallback((image: number) => {
    setSelected(image);
    setGridShown(false);
    setSheetShown(null);
  }, []);
  function selectJob() {
    setSelected('job');
    setGridShown(false);
    setSheetShown(null);
  }
  function showGrid() {
    setGridShown(true);
    setSheetShown(null);
  }
  function showFrame() {
    if (!selectedFrame && board[0]) setSelected(board[0].image);
    setGridShown(false);
    setSheetShown(null);
  }
  // Previous and next keep the view: the grid moves its highlight, the frame view its picture.
  const step = (dir: -1 | 1) => {
    const to = dir < 0 ? prevFrame : nextFrame;
    if (!to) return;
    setSelected(to.image);
    setGridShown(gridOn);
    setSheetShown(null);
  };
  const stepRef = useRef(step);
  stepRef.current = step;
  const toolsRef = useRef<HTMLDivElement>(null);
  // The arrow keys step through the frames while the canvas has focus (not on the compare divider).
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const target = e.target instanceof Element ? e.target : null;
      const canvasArea = toolsRef.current?.closest('[data-stage]');
      if (!target || !canvasArea?.contains(target)) return;
      if (target.closest('input, textarea, select, [contenteditable], [role="slider"], [role="dialog"]')) return;
      e.preventDefault();
      stepRef.current(e.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  // A plan made here lands: the inspector scrolls to it and the cast.
  const planRef = useRef<HTMLDivElement>(null);
  const scrolledTo = useRef(addressedJob);
  useEffect(() => {
    const el = planRef.current;
    if (!active || !boardId || boardId !== jobId || scrolledTo.current === boardId || !el) return;
    scrolledTo.current = boardId;
    let scroller = el.parentElement;
    while (scroller && getComputedStyle(scroller).overflowY !== 'auto') scroller = scroller.parentElement;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller?.scrollTo({ top: Math.max(0, el.offsetTop - 64), behavior: reduced ? 'auto' : 'smooth' });
  }, [active, boardId, jobId]);

  // An address opens its job once per arrival: a new job loads as on a reload,
  // past the board's guard even when it is the newest board already showing,
  // and a plan made here afterwards is not pulled back. Renders waiting to be
  // planned stay behind the board. The page stays mounted, so a job it already
  // holds is read again: it may have moved on out of view. One it held earlier
  // is read afresh too: the cached read lacks what was saved since, and the
  // drafts load from it.
  const openedJob = useRef(addressedJob);
  useEffect(() => {
    if (openedJob.current === addressedJob) return;
    openedJob.current = addressedJob;
    if (!addressedJob) return;
    setBehindBoard(uploadsKey);
    if (addressedJob === jobId) {
      void refetchJob();
      return;
    }
    loadedBoard.current = undefined;
    scrolledTo.current = addressedJob;
    void utils.lifestyle.job.reset({ id: addressedJob });
    setJobId(addressedJob);
  }, [addressedJob, jobId, refetchJob, uploadsKey, utils]);

  // A job that isn't there (gone, another account's, or an id longer than the
  // server takes) leaves the page on the newest board, and the page says so for
  // as long as the address names it.
  const [goneJob, setGoneJob] = useState<string | null>(null);
  const jobGone = jobId !== null && (job.data === null || jobId.length > 200);
  useEffect(() => {
    if (!jobGone) return;
    setGoneJob(jobId);
    void utils.lifestyle.job.reset();
    setJobId(null);
  }, [jobGone, jobId, utils]);

  // The frame an address names, by its image index, so a link stays on its
  // frame when the film is reordered. It waits for its board: loading one
  // opens on the setup, and this runs after that.
  const openedFrame = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (addressedFrame === undefined) {
      openedFrame.current = undefined;
      return;
    }
    const arrival = `${addressedJob}:${addressedFrame}`;
    if (openedFrame.current === arrival || !boardId || loadedBoard.current !== boardId) return;
    if (addressedJob && addressedJob !== boardId) return;
    openedFrame.current = arrival;
    // Digits only: Number() would read '' as 0 and take '1e0' or '0x1' for 1.
    if (/^\d+$/.test(addressedFrame)) selectFrame(Number(addressedFrame));
  }, [addressedFrame, addressedJob, boardId, current, selectFrame]);

  // ---- The canvas.
  let canvasState: CanvasState;
  let canvas: ReactNode = null;
  let aspectRatio: string | undefined = '16 / 9';
  let caption: ReactNode | undefined;
  let canvasNote: string | undefined;
  let canvasActions: ReactNode | undefined;
  const shownSheet = sheetShown !== null ? sheets.find((s) => s.stillId === sheetShown) : undefined;
  const lead0 = uploads[0] ?? current?.images[0];
  const leadSrc = uploads[0]?.src ?? current?.images[0]?.url;

  if (shownSheet) {
    const still = stillById.get(shownSheet.stillId);
    canvasState = 'live';
    aspectRatio = still ? `${still.width} / ${still.height}` : '16 / 9';
    canvas = (
      <TakeImage key={shownSheet.stillId} full stillId={shownSheet.stillId} alt={`Cast sheet: ${roleNames(shownSheet.roles)}`} />
    );
    caption = `Cast: ${chapterById(shownSheet.chapter).name} · ${roleNames(shownSheet.roles)}`;
  } else if (gridOn) {
    canvasState = 'free';
    canvas = (
      <ol className={own.grid} aria-label="Every frame of the film">
        {board.map((f, i) => {
          const view = views.get(f.image) ?? NO_TAKE;
          const img = current?.images[f.image];
          return (
            <GridCard
              key={`${current?.id}-${f.image}`}
              image={f.image}
              order={i + 1}
              title={f.title}
              chapterName={chapterById(f.chapter).name}
              thumb={thumbOf(view, img)}
              badge={takeBadge(view.state, Boolean(shooting[f.image]), twoPassBoard)}
              leftOut={!f.include}
              selected={selectedFrame?.image === f.image}
              onSelect={selectFrame}
            />
          );
        })}
      </ol>
    );
  } else if (selectedFrame && current) {
    const f = selectedFrame;
    const order = selectedIndex + 1;
    const title = `${order}. ${f.title}`;
    const shotAs = grammarById(selDone?.lifestyle?.grammar ?? f.grammar);
    const sourceAspect = selImg ? `${selImg.width} / ${selImg.height}` : '16 / 9';
    caption = `Frame ${order} of ${board.length} · ${chapterById(selDone?.lifestyle?.chapter ?? f.chapter).name} · ${shotAs.name}, ${shotAs.lens}`;
    if (selRendering) {
      // Pass 1 is in: it shows, stepped back, while pass 2 finishes it.
      const passOne =
        (selView.state === 'pass2-waiting' || selView.state === 'pass2-pending') && !selShooting ? selView.pass1 : undefined;
      canvasState = 'live';
      aspectRatio = sourceAspect;
      canvas = (
        <>
          {passOne && (
            <TakeImage
              key={passOne.id}
              stillId={passOne.id}
              alt={selView.plate ? `X-ray plate of ${f.title}` : `Pass 1 of ${f.title}`}
              className={own.passOverlay}
            />
          )}
          <RenderingStatus
            label={renderingLabel(selView.state, selShooting, twoPassBoard, selView.plate)}
            runKey={passOne ? `${passOne.id}-pass2` : (selView.pass1?.id ?? `${current.id}-${f.image}`)}
          />
        </>
      );
    } else if (selDone) {
      const aspect = `${selDone.width} / ${selDone.height}`;
      const what = selShowingPass1 ? 'Pass 1 of the lifestyle frame' : 'Lifestyle frame';
      canvasState = 'live';
      aspectRatio = aspect;
      canvas = (
        <>
          {selImg && selSourceOk === true ? (
            <CompareSlider
              key={selDone.id}
              className={own.canvasCompare}
              before={selImg.url}
              after={stillViewUrl(selDone.id)}
              afterFallback={stillThumbUrl(selDone.id)}
              beforeAlt={`Your render: ${selImg.name || f.title}`}
              afterAlt={`${what}: ${f.title}`}
              aspectRatio={aspect}
            />
          ) : (
            <TakeImage key={selDone.id} full stillId={selDone.id} alt={`${what}: ${f.title}`} />
          )}
          {selView.state === 'pass2-failed' && (
            <span className={own.passChip}>{selView.plate ? 'Plate only' : 'Pass 1 only'}</span>
          )}
        </>
      );
      canvasActions = (
        <>
          <Button
            size="sm"
            variant="ghost"
            icon={<Download size={14} />}
            loading={frameSaver.pending}
            aria-label={frameSaver.pending ? undefined : `Download ${title}${selShowingPass1 ? ', pass 1' : ''}`}
            onPress={() =>
              frameSaver.start(libraryUrl('still', selDone.id), downloadName(order, f.title, selShowingPass1))
            }
          >
            {frameSaver.label('Download')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Film size={14} />}
            aria-label={`Animate ${title}`}
            onPress={() => onAnimate(selDone.id, animatePreset(selDone, f.grammar))}
          >
            Animate
          </Button>
          <Button size="sm" variant="ghost" icon={<Expand size={14} />} onPress={() => openFrame(f.image)}>
            Open full size
          </Button>
        </>
      );
    } else if (selImg && selSourceOk !== false) {
      canvasState = 'preview';
      aspectRatio = sourceAspect;
      canvas = <img src={selImg.url} alt={`Your render: ${selImg.name || f.title}`} decoding="async" />;
      canvasNote = 'This frame will appear here once shot';
    } else {
      canvasState = 'live';
      aspectRatio = sourceAspect;
      canvas = (
        <div className={styles.frameAlert}>
          <Text tone="secondary" size="sm" as="p">
            This uploaded render is no longer kept. Plan the film again to shoot it.
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
            ? `Sending the renders to ${planner.model}…`
            : `Planning ${current?.images.length ?? uploads.length} frames: chapter, shot, light, what to keep, who is there…`
        }
        runKey={current?.id}
      />
    );
  } else if (current?.status === 'failed') {
    canvasState = 'live';
    canvas = (
      <div className={styles.frameAlert}>
        <Alert tone="error" title="The film wasn't planned">
          {current.error ?? 'Plan the film again.'}
        </Alert>
        <div className={own.retry}>
          <Button size="sm" icon={<RotateCcw size={14} />} onPress={() => void runPlan()} disabled={!ready}>
            {ready ? 'Plan again' : 'Add the renders again to plan'}
          </Button>
        </div>
      </div>
    );
  } else if (job.isLoading) {
    canvasState = 'live';
    canvas = <RenderingStatus label="Loading your plan…" />;
  } else if (leadSrc && lead0) {
    canvasState = 'preview';
    aspectRatio = `${lead0.width} / ${lead0.height}`;
    canvas = <img src={leadSrc} alt="" decoding="async" />;
    canvasNote = 'Your plan of action will appear here';
    if (uploads.length > 0) caption = `${uploads.length} render${uploads.length === 1 ? '' : 's'} to plan`;
  } else {
    canvasState = 'empty';
  }

  const toolbar =
    isPlanned && board.length > 0 ? (
      <>
        <div ref={toolsRef} role="group" aria-label="View" className={own.viewToggle}>
          <AriaToggleButton className={own.tool} isSelected={gridOn} onChange={(on) => on && showGrid()}>
            <LayoutGrid size={16} aria-hidden />
            <span className={own.toolLabel}>Grid</span>
          </AriaToggleButton>
          <AriaToggleButton
            className={own.tool}
            isSelected={!gridOn && shownSheet === undefined && selectedFrame !== undefined}
            onChange={(on) => on && showFrame()}
          >
            <RectangleHorizontal size={16} aria-hidden />
            <span className={own.toolLabel}>Frame</span>
          </AriaToggleButton>
        </div>
        <span className={own.toolSep} aria-hidden />
        <AriaButton
          className={own.toolIcon}
          aria-label="Previous frame"
          isDisabled={!prevFrame}
          onPress={() => step(-1)}
        >
          <ChevronLeft size={18} aria-hidden />
        </AriaButton>
        <AriaButton className={own.toolIcon} aria-label="Next frame" isDisabled={!nextFrame} onPress={() => step(1)}>
          <ChevronRight size={18} aria-hidden />
        </AriaButton>
        <AriaButton
          className={own.tool}
          isDisabled={!selectedFrame || selView.result?.status !== 'succeeded'}
          onPress={() => selectedFrame && openFrame(selectedFrame.image)}
        >
          <Expand size={16} aria-hidden />
          <span className={own.toolLabel}>Full screen</span>
        </AriaButton>
        {selectedFrame && !gridOn && shownSheet === undefined && selFinished && selView.result && (
          <>
            <span className={own.toolSep} aria-hidden />
            <PassToggle
              pass1={selPass1}
              onChange={(next) => selView.result && showPass1(selView.result.id, next)}
              plate={selView.plate}
              className={own.passToggleTools}
            />
          </>
        )}
        {current && (
          <>
            <span className={own.toolSep} aria-hidden />
            <CopyLink job={current.id} />
          </>
        )}
      </>
    ) : undefined;

  const strip =
    isPlanned && board.length > 0 ? (
      <>
        <button
          type="button"
          className={own.filmCard}
          aria-pressed={selectedFrame === undefined}
          title="The film: renders, models, residents and the cast"
          onClick={selectJob}
        >
          <Clapperboard size={18} aria-hidden />
          <span className={own.filmName}>The film</span>
          <span className={own.filmMeta}>
            {board.length} frame{board.length === 1 ? '' : 's'}
          </span>
        </button>
        {CHAPTERS.map((chapter, ci) => {
          const frames = board.filter((f) => f.chapter === chapter.id);
          if (frames.length === 0) return null;
          // The chapter's cast sheet, once it is in, beside its name.
          const sheet = sheets.find((s) => s.chapter === chapter.id);
          const sheetIn = sheet !== undefined && stillById.get(sheet.stillId)?.status === 'succeeded';
          return (
            <section key={chapter.id} className={own.chapter} aria-labelledby={`chapter-${chapter.id}`}>
              <div className={own.chapterHead}>
                <span className={own.chapterMeta}>
                  <span className={own.chapterNo} aria-hidden>
                    {String(ci + 1).padStart(2, '0')}
                  </span>
                  <span className={own.chapterCount}>
                    {frames.length} frame{frames.length === 1 ? '' : 's'}
                  </span>
                </span>
                <h3 id={`chapter-${chapter.id}`} className={own.chapterName} title={chapter.hint}>
                  {chapter.name}
                </h3>
                {sheet && sheetIn && (
                  <button
                    type="button"
                    className={own.chapterCast}
                    aria-pressed={sheetShown === sheet.stillId}
                    aria-label={`Cast sheet for ${chapter.name}: ${roleNames(sheet.roles)}`}
                    title={`Cast: ${roleNames(sheet.roles)}`}
                    onClick={() => setSheetShown((cur) => (cur === sheet.stillId ? null : sheet.stillId))}
                  >
                    <img src={stillThumbUrl(sheet.stillId)} alt="" loading="lazy" decoding="async" />
                    <span>Cast</span>
                  </button>
                )}
              </div>
              <ol className={own.frames}>
                {frames.map((f) => {
                  const view = views.get(f.image) ?? NO_TAKE;
                  const img = current?.images[f.image];
                  return (
                    <StripCard
                      key={`${current?.id}-${f.image}`}
                      image={f.image}
                      order={board.indexOf(f) + 1}
                      title={f.title}
                      aspect={img ? `${img.width} / ${img.height}` : '16 / 10'}
                      thumb={thumbOf(view, img)}
                      badge={takeBadge(view.state, Boolean(shooting[f.image]), twoPassBoard)}
                      leftOut={!f.include}
                      selected={selectedFrame?.image === f.image}
                      onSelect={selectFrame}
                    />
                  );
                })}
              </ol>
            </section>
          );
        })}
      </>
    ) : undefined;

  // ---- The inspector: the film's setup, or the selected frame's fields.
  const header = (
    <PageHeader
      title="Bring the home to life"
      description={
        selectedFrame
          ? undefined
          : 'Upload every render of the project. The app plans each one as a frame of a residential lifestyle film: what to keep, who is there and how far away, and how it is lit. It creates the residents once, then re-photographs each render as a real photograph.'
      }
    />
  );

  const jobInspector = (
    <>
      {header}
      {job.error && (
        <div className={own.pollError}>
          <RunwayErrorNotice error={job.error} modelName="Claude" onRetry={() => void job.refetch()} />
        </div>
      )}
      <Section step={1} title="Project renders" description={`Every render of one project, up to ${MAX_IMAGES}.`}>
        <div className={styles.stack}>
          <ImageDropZone
            onFiles={(files) => void addFiles(files)}
            disabled={planning || uploads.length >= MAX_IMAGES}
            actionLabel={uploads.length ? 'Add renders' : 'Choose renders'}
            label="Drop or choose project renders"
          >
            <div className={own.dropEmpty}>
              <ImageIcon size={20} aria-hidden />
              <Text tone="secondary" size="sm">
                {uploads.length >= MAX_IMAGES
                  ? `That is the full ${MAX_IMAGES}. Remove one to add another.`
                  : 'Drop the project’s renders here, all at once. PNG, JPEG or WebP.'}
              </Text>
            </div>
          </ImageDropZone>
          {isPlanned && current && uploads.length === 0 && (
            <Text tone="secondary" size="sm" as="p">
              The plan below is from an earlier session and keeps its own {current.images.length} render
              {current.images.length === 1 ? '' : 's'}: shoot it as it is, or add renders here to plan a new film.
            </Text>
          )}
          {overflow > 0 && (
            <Alert tone="warning" title={`${overflow} render${overflow === 1 ? ' was' : 's were'} left out`}>
              A lifestyle plan takes up to {MAX_IMAGES} renders. Remove one to add another.
            </Alert>
          )}
          {uploads.length > 0 && (
            <ul className={own.thumbs} aria-label="Project renders">
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
                    onPress={() => remove(u.key)}
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
                  onRetry={canRetry(u.key) ? () => retry(u.key) : () => remove(u.key)}
                />
              </div>
            ))}
        </div>
      </Section>

      <Section
        step={2}
        title="AI and models"
        description="Who writes the plan of action, how it is directed, and which image models shoot it."
      >
        <div className={own.aiRows}>
          <PlannerRow ai={aiText.data} error={aiText.error} planner={planner} disabled={planning} />

          <div className={own.aiRow}>
            <DirectionStyleSelect value={directorStyle} onChange={setDirectorStyle} disabled={planning} />
          </div>

          <div className={own.aiRow}>
            <p className={own.aiRowHead}>
              Image models <span>re-photograph each render</span>
            </p>
            <ToggleButtonGroup
              aria-label="Image models"
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={[twoPass ? 'two' : 'one']}
              onSelectionChange={(keys) => {
                const [key] = keys;
                if (key !== undefined) setTwoPass(key === 'two');
              }}
              isDisabled={planning}
              className={own.passCount}
            >
              <AriaToggleButton id="one" className={own.passCountItem}>
                One image model
              </AriaToggleButton>
              <AriaToggleButton id="two" className={own.passCountItem}>
                Two passes: x-ray plate, then develop
              </AriaToggleButton>
            </ToggleButtonGroup>
            <Text tone="muted" size="sm" as="p" className={own.aiRowNote}>
              {twoPass
                ? `Pass 1 shoots each render as a flat x-ray plate: deep focus, neutral, every decision legible. Pass 2 develops the plate into the finished film frame at full detail and matches the architecture back to your render. The cast is always made on ${imageModelName(CAST_SHEET_MODEL.imageModel)}.`
                : 'Each frame is one still from this model, as it comes back.'}
            </Text>
            <div className={styles.selectRow}>
              <Select
                label={twoPass ? 'Pass 1: the x-ray plate' : 'Image model'}
                options={allowedImage(IMAGE_MODELS)}
                value={imageModel}
                onChange={(id) => {
                  const m = id as ImageModelId;
                  setImageModel(m);
                  setResolution(fourK(m));
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
              {pass1Off && <ModelUnavailable message={pass1Off} />}
            </div>
            {twoPass && (
              <div className={styles.selectRow}>
                <Select
                  label="Pass 2: the develop"
                  options={allowedImage(PASS2_MODELS)}
                  value={pass2Model}
                  onChange={(id) => {
                    const m = id as ImageModelId;
                    setPass2Model(m);
                    setPass2Resolution(fourK(m));
                  }}
                  disabled={planning}
                />
                {imageResolutions(pass2Model).length > 1 && (
                  <Select
                    label="Resolution"
                    options={imageResolutions(pass2Model)}
                    value={pass2Resolution}
                    onChange={setPass2Resolution}
                    disabled={planning}
                    showHint={false}
                  />
                )}
                {pass2Off && <ModelUnavailable message={pass2Off} />}
              </div>
            )}
          </div>
        </div>
      </Section>

      <Section step={3} title="Residents" description="Who lives there: the same household recurs in every frame with people.">
        <div className={styles.stack}>
          <Select
            label="Heritage"
            options={ETHNICITIES}
            value={heritage}
            onChange={(id) => setHeritage(id as EthnicityId)}
            disabled={planning}
          />
          <TextArea
            label="The household (optional)"
            value={household}
            onChange={setHousehold}
            rows={3}
            maxLength={HOUSEHOLD_MAX}
            disabled={planning}
            placeholder="e.g. a young couple, their daughter of six and her grandparents; a golden retriever"
            onSubmit={() => void runPlan()}
          />
          <LightReferenceField
            image={light.image}
            uploading={light.uploading}
            error={light.error}
            modelName={modelName}
            disabled={planning}
            onFile={(f) => void light.add(f, f.name)}
            onRemove={light.clear}
            stills={lightStills}
            stillsLoading={library.isLoading}
            stillsError={library.error}
            onRetryStills={() => void library.refetch()}
            matched={null}
            onMatch={(id) => void matchStill(id)}
          />
          <Text tone="muted" size="sm" as="p" className={own.refNote}>
            A photograph whose light, colour and plant realism every frame should match. Only its light is used.
          </Text>
          {/* With a board up, planning the renders waiting behind it is the secondary action here. */}
          {!planMode && unplanned && (
            <>
              <BlockedTip message={jobBlocked}>
                <Button
                  icon={<Projector size={16} />}
                  disabled={!ready || jobBlocked !== null}
                  onPress={() => void runPlan()}
                >
                  {planLabel}
                </Button>
              </BlockedTip>
              <Text tone="muted" size="sm" as="p">
                Plans a new film from these renders; this one stays in your library.
              </Text>
              <RunwayErrorNotice error={plan.error} modelName="Claude" onRetry={() => void runPlan()} />
            </>
          )}
        </div>
      </Section>

      {isPlanned && current && (
        <Section title="Plan of action">
          <div ref={planRef} className={own.planIntro}>
            <Text tone="secondary" as="p">
              {board.length} frame{board.length === 1 ? '' : 's'} in {COUNT_WORDS[chaptersUsed]} chapter
              {chaptersUsed === 1 ? '' : 's'}.{directed ? ` ${directed}.` : ''} Edit anything, then create the cast and
              shoot.
            </Text>
            <Text tone="muted" size="sm" as="p">
              {boardShotWith}
              {current.lightRefUrl ? ', matched to your lighting reference' : ''}. Each list puts the planned choice
              first. Plans come from {planner.label}. Pick a frame in the strip to change it or shoot it on its own.
            </Text>
            {current.warning && (
              <Alert tone="warning" title="Part of the film wasn't planned">
                {current.warning}
              </Alert>
            )}
            <Text tone="muted" size="sm" as="p">
              Every frame is saved to your library, tagged @lifestyle
              {current.pass2 ? ', its x-ray plate also @pass-1. Pass 2 develops the plate on its own once it is in, while this page is open' : ''}
              . Shoot within a day of planning: uploaded renders are only kept that long.
            </Text>
          </div>
        </Section>
      )}
      {isPlanned && current && (
        <CastPanel
          imageModel={current.imageModel}
          cast={cast}
          needs={needs}
          stillById={stillById}
          mode={castMode}
          onMode={setCastMode}
          busy={castBusy}
          error={castError}
          onCast={chooseCast}
          onApprove={approveCast}
          upload={castUpload}
        />
      )}
    </>
  );

  const frameInspector =
    selectedFrame && current ? (
      <>
        {header}
        <FrameFields
          key={`${current.id}-${selectedFrame.image}`}
          order={selectedIndex + 1}
          frame={planned.get(selectedFrame.image)!}
          choice={drafts[selectedFrame.image]}
          modelName={imageModelName(current.imageModel)}
          pass2ModelName={current.pass2 ? imageModelName(current.pass2.imageModel) : undefined}
          save={saves[selectedFrame.image]}
          view={selView}
          done={selDone}
          shooting={selShooting}
          shootError={shootErrors[selectedFrame.image]}
          retrying={Boolean(retrying[selectedFrame.image])}
          retryError={retryErrors[selectedFrame.image]}
          canShoot={canShoot}
          shootingAll={shootingAll}
          downloadError={frameSaver.error}
          onChoose={onChoose}
          onShoot={shoot}
          onRetryPass2={retryPass2}
        />
      </>
    ) : undefined;

  // ---- The footer: the one primary action and what it costs.
  let footer: ReactNode;
  if (selectedFrame && current) {
    const f = selectedFrame;
    const blocked = notReady(f);
    footer = (
      <>
        <BlockedTip message={boardBlocked}>
          <Button
            variant="primary"
            size="lg"
            className={own.primary}
            icon={<Clapperboard size={18} />}
            loading={selRendering}
            disabled={!f.include || !canShoot || blocked !== undefined || shootingAll || Boolean(retrying[f.image])}
            onPress={() => void shoot(f.image)}
          >
            {!f.include
              ? 'Left out of the film'
              : selRendering
                ? 'Shooting…'
                : selView.state !== 'none'
                  ? 'Shoot again'
                  : 'Shoot this frame'}
          </Button>
        </BlockedTip>
        <CostLine
          summary={
            !f.include
              ? 'Put it back in the film to shoot it.'
              : (blocked ??
                (canShoot
                  ? `This frame is ${frameStills}${onBay ? ', billed to your own Runway credits' : ''}.`
                  : whyNotShoot))
          }
          providerNote={f.include && !blocked && canShoot ? boardNote : undefined}
        />
      </>
    );
  } else if (planMode) {
    footer = (
      <>
        <BlockedTip message={jobBlocked}>
          <Button
            variant="primary"
            size="lg"
            className={own.primary}
            icon={<Projector size={18} />}
            loading={planning}
            disabled={!ready || jobBlocked !== null}
            onPress={() => void runPlan()}
          >
            {planLabel}
          </Button>
        </BlockedTip>
        <CostLine
          summary={
            <>
              {planner.provider !== 'runway'
                ? `${planner.model} plans the film on your own ${PROVIDER_NAMES[planner.provider]} key.`
                : caps.textViaRunway
                  ? 'Claude plans the film, a few credits for every six renders.'
                  : 'Choose Anthropic or OmegaPlus and add a key.'}{' '}
              Nothing is shot until you say so.
            </>
          }
          providerNote={providerNote(imageModel, ...(twoPass ? [pass2Model] : []))}
          details={
            <>
              {imageModelTakesCastSheet(imageModel)
                ? `The cast is one ${imageModelName(CAST_SHEET_MODEL.imageModel)} still per chapter; each frame is `
                : `${modelName} takes only the render, so there is no cast; each frame is `}
              {twoPass
                ? pass2Model === imageModel
                  ? `two stills on ${modelName}, the x-ray plate and then the develop.`
                  : `two stills, an x-ray plate on ${modelName} and then the develop on ${pass2Name}.`
                : `one ${modelName} still.`}
              {onBay && ' Billed to your own Runway credits at each model’s own rate.'}
            </>
          }
        />
        <RunwayErrorNotice error={plan.error} modelName="Claude" onRetry={() => void runPlan()} />
      </>
    );
  } else if (filmShot && firstTake && included[0]) {
    // Every frame is shot: the next step is the film's first frame, animated.
    const first = included[0];
    const undeveloped = included.filter((f) => views.get(f.image)?.state === 'pass2-failed').length;
    footer = (
      <>
        <Button
          variant="primary"
          size="lg"
          className={own.primary}
          icon={<Film size={18} />}
          onPress={() => onAnimate(firstTake.id, animatePreset(firstTake, first.grammar))}
        >
          Animate the first frame
        </Button>
        <CostLine
          summary={
            undeveloped > 0
              ? `Every frame is shot; ${undeveloped} develop${undeveloped === 1 ? " didn't finish, so retry it on its frame" : "s didn't finish, so retry them on their frames"}.`
              : 'Every frame is shot. Animating opens the Video tab set up for a clip; nothing is billed until you make it.'
          }
        />
      </>
    );
  } else {
    // Nothing left to send: frames still on their passes, or one that must change before it can be shot.
    const waiting = !shootingAll && unshot.length === 0 && takesOnTheirWay;
    const stuck =
      !shootingAll && unshot.length === 0 && !takesOnTheirWay
        ? included.find((f) => views.get(f.image)?.result === undefined)
        : undefined;
    const stuckReason = stuck ? notReady(stuck) : undefined;
    footer = (
      <>
        <BlockedTip message={boardBlocked}>
          <Button
            variant="primary"
            size="lg"
            className={own.primary}
            icon={<Clapperboard size={18} />}
            loading={shootingAll || waiting}
            disabled={!stuck && (!canShoot || unshot.length === 0)}
            onPress={() => (stuck ? selectFrame(stuck.image) : void shootAll())}
          >
            {shootingAll || waiting
              ? 'Shooting the frames…'
              : stuck
                ? `Open frame ${board.indexOf(stuck) + 1} to finish it`
                : unshot.length === 0
                  ? 'Nothing left to shoot'
                  : unshot.length === included.length
                    ? unshot.length === 1
                      ? 'Shoot the frame'
                      : `Shoot all ${unshot.length} frames`
                    : `Shoot the other ${unshot.length} frame${unshot.length === 1 ? '' : 's'}`}
          </Button>
        </BlockedTip>
        <CostLine
          summary={
            !canShoot
              ? whyNotShoot
              : stuck && stuckReason
                ? `Frame ${board.indexOf(stuck) + 1}: ${stuckReason}`
                : `Each frame is ${frameStills}${onBay ? ', billed to your own Runway credits' : ''}.`
          }
          providerNote={canShoot && !(stuck && stuckReason) ? boardNote : undefined}
        />
      </>
    );
  }

  return (
    <>
      <Workspace
        page="lifestyle"
        canvasState={canvasState}
        canvas={canvas}
        aspectRatio={aspectRatio}
        caption={caption}
        canvasNote={canvasNote}
        canvasToolbar={toolbar}
        canvasActions={canvasActions}
        onDropFiles={planning || uploads.length >= MAX_IMAGES ? undefined : (files) => void addFiles(files)}
        empty={{
          title: 'Drop the project’s renders to begin',
          hint: 'Up to 24 renders of one project. Each comes back tagged with its chapter, shot, light, what to keep and who is there.',
          action: 'Choose project renders',
          label: 'Drop or choose project renders',
        }}
        inspector={frameInspector ?? jobInspector}
        footer={
          <>
            {goneJob !== null && goneJob === addressedJob && (
              <Alert tone="warning" title="That link's film is gone">
                {isPlanned ? 'This is your newest film.' : 'Add renders to plan a new one.'}
              </Alert>
            )}
            {footer}
          </>
        }
        strip={strip}
        stripLabel="Frames"
        raiseSheet={selected}
      />

      {current?.status === 'planned' && (
        <LifestyleViewer
          board={board}
          images={current.images}
          views={views}
          twoPass={twoPassBoard}
          pass1Shown={pass1Shown}
          onShowPass1={showPass1}
          image={viewing}
          onImage={(image) => {
            setViewing(image);
            // The frame stepped to on the big screen is the one selected when it closes.
            if (image !== null) selectFrame(image);
          }}
          onAnimate={onAnimate}
        />
      )}
    </>
  );
}

/** The board's address, for a chat or a note. The note sits before the button, so a phone's scrolled toolbar still shows it. */
function CopyLink({ job }: { job: string }) {
  const [note, setNote] = useState('');
  const clearNote = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(clearNote.current), []);
  async function copy() {
    clearTimeout(clearNote.current);
    try {
      await navigator.clipboard.writeText(formatHash('lifestyle', { job }));
      setNote('Copied');
    } catch {
      // No clipboard on this page, or the browser refused.
      setNote('Could not copy');
    }
    clearNote.current = setTimeout(() => setNote(''), 2500);
  }
  return (
    <>
      <span className={own.saveState} role="status">
        {note}
      </span>
      <AriaButton className={own.tool} onPress={() => void copy()}>
        <Link2 size={16} aria-hidden />
        <span className={own.toolLabel}>Copy link</span>
      </AriaButton>
    </>
  );
}

type PlannerRowProps = {
  ai: AiText | undefined;
  error: unknown;
  planner: Planner;
  disabled: boolean;
};

/**
 * Step 2's first row, who writes the plan of action: Claude through Runway,
 * or the visitor's own Anthropic or OmegaPlus key with a model of their
 * choosing. It is the Settings choice itself, so a change here is a change
 * there; the keys are saved in Settings. A provider without a key can be
 * picked, and the server says to save one first.
 */
function PlannerRow({ ai, error, planner, disabled }: PlannerRowProps) {
  const { caps } = useCapabilities();
  const utils = trpc.useUtils();
  const choose = trpc.settings.setAiText.useMutation({ onSettled: () => utils.settings.aiText.invalidate() });
  const head = (
    <p className={own.aiRowHead}>
      Planner <span>writes the plan of action</span>
    </p>
  );
  if (!ai) {
    return (
      <div className={own.aiRow}>
        {head}
        {error ? (
          <Alert tone="error" title={errorMessage(error) ?? 'The planner choice did not load.'} />
        ) : (
          <SkeletonBlock height={66} />
        )}
      </div>
    );
  }

  const { provider, model, keys } = ai;
  const providers = [
    ...(caps.textViaRunway ? [{ id: 'runway', name: 'Runway' }] : []),
    { id: 'anthropic', name: `Anthropic${keys.anthropic ? '' : ' (add a key in Settings)'}` },
    { id: 'omegaplus', name: `OmegaPlus${keys.omegaplus ? '' : ' (add a key in Settings)'}` },
  ];
  const models =
    provider === 'anthropic'
      ? ai.anthropicModels.map((m) => ({ id: m.id, name: m.name }))
      : ai.omegaModels.map((m) => ({ id: m.id, name: m.name, hint: m.owner }));
  const busy = disabled || choose.isPending;

  return (
    <div className={own.aiRow}>
      {head}
      <div className={own.plannerPick} data-alone={provider === 'runway' || undefined}>
        <Select
          label="Provider"
          options={providers}
          value={choose.isPending && choose.variables ? choose.variables.provider : provider}
          disabled={busy}
          onChange={(id) => {
            const next = id as AiTextProvider;
            // Another provider starts on its default model (the server picks it).
            if (next !== provider) choose.mutate({ provider: next });
          }}
          showHint={false}
        />
        {provider !== 'runway' && (
          <Select
            label="Model"
            options={models}
            value={model ?? ''}
            disabled={busy}
            onChange={(id) => {
              if (id !== model) choose.mutate({ provider, model: id });
            }}
            showHint={false}
          />
        )}
      </div>
      <Text tone="muted" size="sm" as="p" className={own.aiRowNote}>
        {provider !== 'runway'
          ? `${planner.model} on your own ${PROVIDER_NAMES[provider]} key.`
          : caps.textViaRunway
            ? 'Claude through your Runway account.'
            : 'Choose Anthropic or OmegaPlus and add a key.'}{' '}
        <TextLink href="#settings">Keys live in Settings</TextLink>
      </Text>
      {choose.error && <Alert tone="error" title={errorMessage(choose.error) ?? 'That choice was not saved.'} />}
    </div>
  );
}

type CastPanelProps = {
  imageModel: ImageModelId;
  cast: LifestyleCast | undefined;
  needs: readonly CastNeed[];
  stillById: ReadonlyMap<string, Still>;
  mode: CastMode;
  onMode: (mode: CastMode) => void;
  busy: CastMode | 'approve' | null;
  error: unknown;
  onCast: (mode: CastMode, uploadedUrl?: string) => Promise<void>;
  onApprove: () => Promise<void>;
  /** The person's own cast sheet, uploading or in. */
  upload: ReturnType<typeof useReferenceUpload>;
};

/**
 * The household's cast, between the plan and the shoot: created once per
 * chapter that has residents (lit in that chapter's light, on one of its
 * renders), the person's own sheet, or none. Frames are shot only once it
 * is approved.
 */
function CastPanel({
  imageModel,
  cast,
  needs,
  stillById,
  mode,
  onMode,
  busy,
  error,
  onCast,
  onApprove,
  upload,
}: CastPanelProps) {
  const { offeredImageNames } = useCapabilities();
  const castModels = offeredImageNames(castSheetModelNames());
  const [big, setBig] = useState<string | null>(null);
  const supported = imageModelTakesCastSheet(imageModel);
  const modelName = imageModelName(imageModel);
  const n = needs.length;
  const sheets = cast?.mode === 'generated' ? (cast.sheets ?? []) : [];
  const made = sheets.map((sheet) => ({ sheet, still: stillById.get(sheet.stillId) }));
  const allDone = made.length > 0 && made.every((m) => m.still?.status === 'succeeded');
  const anyFailed = made.some((m) => m.still?.status === 'failed');
  // Chapters the plan now needs a sheet for, or more people on one, than the cast that was made.
  const stale =
    cast?.mode === 'generated'
      ? needs.filter((need) => {
          const sheet = sheets.find((s) => s.chapter === need.chapter);
          return !sheet || need.roles.some((r) => !sheet.roles.includes(r));
        })
      : [];
  const ownSheet =
    upload.image ??
    (cast?.mode === 'uploaded' && cast.uploadedUrl
      ? { src: cast.uploadedUrl, name: 'Your cast sheet', hostedUrl: cast.uploadedUrl }
      : null);
  const status = !cast
    ? 'Not set yet'
    : cast.mode === 'generated'
      ? cast.approved
        ? 'Approved'
        : 'Waiting for your approval'
      : cast.mode === 'uploaded'
        ? 'Using your cast sheet'
        : 'Shooting without a cast';
  const bigSheet = made.find((m) => m.sheet.stillId === big);

  async function onSheet(file: File) {
    const url = await upload.add(file, file.name);
    if (url) await onCast('uploaded', url);
  }

  function removeSheet() {
    upload.clear();
    // A removed sheet is never sent: frames are shot without one until another is in.
    if (cast?.mode === 'uploaded') void onCast('none');
  }

  return (
    <Section title="The residents">
      <div className={own.castPanel}>
        <span className={own.castStatus} data-approved={cast?.approved || undefined}>
          {cast?.approved ? <Check size={12} aria-hidden /> : <Users size={12} aria-hidden />}
          {status}
        </span>
        <Text tone="secondary" size="sm" as="p" className={own.castLead}>
          {n > 0
            ? `The same household appears across the film. ${n === 1 ? 'One chapter has' : `${capitalised(COUNT_WORDS[n] ?? String(n))} chapters have`} residents in it; each gets one cast sheet lit in its own light, so faces, hair and clothing stay the same from frame to frame.${cast?.approved ? '' : ' Approve the cast to start shooting.'}`
            : `No frame in the film has household residents in it, so there is no cast to create.${cast?.approved ? '' : ' Choose No cast to start shooting.'}`}
        </Text>
        {!supported && (
          <Alert tone="warning" title="No cast sheet with this model">
            {modelName} takes only the render, so the frames are shot without a cast
            {castModels.length > 0 ? `; plan again with ${castModels.join(' or ')} to use one` : ''}.
          </Alert>
        )}
        <div className={own.castMode}>
          <ChoiceGroup
            label="Cast"
            choices={supported ? CAST_MODES : CAST_MODES.filter((m) => m.id === 'none')}
            value={supported ? mode : 'none'}
            onChange={(id) => onMode(id as CastMode)}
            disabled={busy !== null}
          />
        </div>

        {supported && mode === 'generated' && (
          <>
            {made.length > 0 && (
              <ul className={own.sheets} aria-label="Cast sheets">
                {made.map(({ sheet, still }) => {
                  const chapter = chapterById(sheet.chapter);
                  const caption = `Cast: ${chapter.name} · ${roleNames(sheet.roles)}`;
                  return (
                    <li key={sheet.stillId} className={own.sheet}>
                      <div
                        className={own.sheetFrame}
                        style={{ aspectRatio: still ? `${still.width} / ${still.height}` : '16 / 9' }}
                      >
                        {still?.status === 'succeeded' ? (
                          <TakeImage
                            stillId={sheet.stillId}
                            alt={caption}
                            className={styles.image}
                            onOpen={() => setBig(sheet.stillId)}
                            openLabel={`Open on the big screen: ${caption}`}
                            openClassName={own.frameButton}
                          />
                        ) : still?.status === 'failed' ? (
                          <div className={styles.frameAlert}>
                            <Alert tone="error" title="This sheet didn't render">
                              {still.error ?? 'Create the cast again.'}
                            </Alert>
                          </div>
                        ) : (
                          <RenderingStatus label="Casting the residents…" runKey={sheet.stillId} />
                        )}
                      </div>
                      <Text tone="secondary" size="sm" as="p">
                        {caption}
                      </Text>
                    </li>
                  );
                })}
              </ul>
            )}
            {stale.length > 0 && (
              <Alert tone="warning" title="The plan has changed since the cast was made">
                {stale.map((s) => chapterById(s.chapter).name).join(', ')} now {stale.length === 1 ? 'needs' : 'need'}{' '}
                {stale.map((s) => roleNames(s.roles)).join('; ')}. Create the cast again to include them.
              </Alert>
            )}
            <div className={own.cardActions}>
              <Button
                variant={made.length === 0 || anyFailed || stale.length > 0 ? 'primary' : 'ghost'}
                icon={made.length > 0 ? <RotateCcw size={14} /> : <Users size={14} />}
                loading={busy === 'generated'}
                disabled={n === 0 || (busy !== null && busy !== 'generated')}
                onPress={() => void onCast('generated')}
              >
                {busy === 'generated'
                  ? 'Creating the cast…'
                  : `${made.length > 0 ? 'Create the cast again' : 'Create the cast'} (${n} sheet${n === 1 ? '' : 's'})`}
              </Button>
              {made.length > 0 && !cast?.approved && (
                <Button
                  variant="primary"
                  icon={<Check size={14} />}
                  loading={busy === 'approve'}
                  disabled={!allDone || (busy !== null && busy !== 'approve')}
                  onPress={() => void onApprove()}
                >
                  Approve cast
                </Button>
              )}
            </div>
            <Text tone="muted" size="sm" as="p">
              {made.length > 0 && !allDone && !anyFailed
                ? 'The sheets land in about a minute. Approve them once you like the faces.'
                : `Each sheet is one ${imageModelName(CAST_SHEET_MODEL.imageModel)} still at ${imageResolutionName(CAST_SHEET_MODEL.imageModel, CAST_SHEET_MODEL.resolution) ?? '4K'}; every press makes a new set.`}
            </Text>
          </>
        )}

        {supported && mode === 'uploaded' && (
          <>
            <CastSheetField
              sheet={ownSheet}
              uploading={upload.uploading || busy === 'uploaded'}
              error={upload.error}
              supported={supported}
              modelName={modelName}
              alternatives={castModels}
              disabled={busy !== null}
              onFile={(f) => void onSheet(f)}
              onRemove={removeSheet}
            />
            {cast?.mode === 'uploaded' && (
              <Text tone="muted" size="sm" as="p">
                Every frame with residents is shot with your cast sheet.
              </Text>
            )}
          </>
        )}

        {(!supported || mode === 'none') && (
          <div className={own.castNone}>
            <Text tone="muted" size="sm" as="p">
              Each frame casts its residents from its own brief, so faces may change from frame to frame.
            </Text>
            {cast?.mode !== 'none' && (
              <Button
                icon={<Clapperboard size={14} />}
                loading={busy === 'none'}
                disabled={busy !== null && busy !== 'none'}
                onPress={() => void onCast('none')}
              >
                Shoot without a cast
              </Button>
            )}
          </div>
        )}

        {/* A cast error comes from making the sheets, which are always on CAST_SHEET_MODEL. */}
        <RunwayErrorNotice error={error} modelName={imageModelName(CAST_SHEET_MODEL.imageModel)} />

        <FullscreenDialog isOpen={bigSheet !== undefined} title={bigSheet ? `Cast: ${chapterById(bigSheet.sheet.chapter).name}` : ''} onClose={() => setBig(null)}>
          {bigSheet && (
            <div
              className={own.viewerPicture}
              style={{
                aspectRatio: bigSheet.still ? `${bigSheet.still.width} / ${bigSheet.still.height}` : '16 / 9',
                ['--ar' as string]: bigSheet.still ? `${bigSheet.still.width} / ${bigSheet.still.height}` : '16 / 9',
              }}
            >
              <TakeImage
                full
                stillId={bigSheet.sheet.stillId}
                alt={`Cast sheet: ${roleNames(bigSheet.sheet.roles)}`}
                className={own.viewerImage}
              />
            </div>
          )}
        </FullscreenDialog>
      </div>
    </Section>
  );
}

type FrameFieldsProps = {
  order: number;
  /** The planner's frame; the fields read the person's changes over it. */
  frame: LifestyleFrame;
  choice: LifestyleChoice | undefined;
  modelName: string;
  /** The model that finishes each take; unset on a one-pass plan. */
  pass2ModelName: string | undefined;
  save: SaveState | undefined;
  view: TakeView;
  /** The take on show (the final, or its first pass), once there is one. */
  done: Still | undefined;
  shooting: boolean;
  shootError: unknown;
  retrying: boolean;
  retryError: unknown;
  /** The cast is approved, so frames may be shot. */
  canShoot: boolean;
  /** The whole board is being shot in turn, so no frame is shot on its own. */
  shootingAll: boolean;
  /** The canvas's download of this frame failed. */
  downloadError: string | null;
  onChoose: (image: number, patch: LifestyleChoice) => void;
  onShoot: (image: number, fixes?: string) => Promise<void>;
  onRetryPass2: (image: number, stillId: string) => Promise<void>;
};

/** What the canvas says while a frame's take is on its way. */
function renderingLabel(state: TakeState, shooting: boolean, twoPass: boolean, plate: boolean): string {
  if (shooting) return 'Starting the take…';
  if (state === 'pass2-waiting') return plate ? 'Pass 2 of 2: starting the develop…' : 'Pass 2 of 2: starting…';
  if (state === 'pass2-pending') {
    return plate ? 'Pass 2 of 2: developing the plate at full detail…' : 'Pass 2 of 2: finishing at full detail…';
  }
  if (twoPass) return plate ? 'Pass 1 of 2: shooting the x-ray plate…' : 'Pass 1 of 2: re-photographing the render…';
  return 'Re-photographing the render…';
}

/** A refusal the alert above already says in full; a sign-in, credits or consent prompt still shows. */
function saysOnlyThis(error: unknown, note: string | undefined): boolean {
  const k = classifyRunwayError(error);
  return !k.signIn && !k.credits && !k.consent && !k.planBlocked && k.message === note;
}

type PassToggleProps = {
  pass1: boolean;
  onChange: (pass1: boolean) => void;
  /** The first pass is an x-ray plate, so the button says Plate. */
  plate?: boolean | undefined;
  className?: string | undefined;
};

/** Final | Pass 1 (Plate on a plate take): which of a finished two-pass take's stills is on show. */
function PassToggle({ pass1, onChange, plate, className }: PassToggleProps) {
  return (
    <div className={[own.passToggle, className].filter(Boolean).join(' ')} role="group" aria-label="Which pass to show">
      <ToggleButton selected={!pass1} onChange={(on) => on && onChange(false)}>
        Final
      </ToggleButton>
      <ToggleButton selected={pass1} onChange={(on) => on && onChange(true)}>
        {plate ? 'Plate' : 'Pass 1'}
      </ToggleButton>
    </div>
  );
}

/** A frame's state as the filmstrip and the contact sheet badge it. */
type TakeBadge = {
  take: 'none' | 'pass1' | 'pass2' | 'ready' | 'failed' | 'pass2-failed';
  label: string | undefined;
};

function takeBadge(state: TakeState, shooting: boolean, twoPass: boolean): TakeBadge {
  if (shooting || state === 'pass1-pending') return { take: 'pass1', label: twoPass ? 'Pass 1 of 2' : 'Shooting' };
  if (state === 'pass2-waiting' || state === 'pass2-pending') return { take: 'pass2', label: 'Pass 2 of 2' };
  if (state === 'done') return { take: 'ready', label: 'Ready' };
  if (state === 'pass1-failed') return { take: 'failed', label: 'Failed' };
  if (state === 'pass2-failed') return { take: 'pass2-failed', label: 'Pass 2 failed' };
  return { take: 'none', label: undefined };
}

/** The small picture of a frame: its take, else pass 1 while pass 2 runs, else its render. */
function thumbOf(view: TakeView, img: LifestyleImage | undefined): string | undefined {
  if (view.result?.status === 'succeeded') return stillThumbUrl(view.result.id);
  if (view.pass1?.status === 'succeeded') return stillThumbUrl(view.pass1.id);
  return img?.url;
}

/** A thumbnail that steps aside for a plain tile once its render has expired. */
function Thumb({ src }: { src: string | undefined }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (!src || broken === src) {
    return (
      <span className={own.thumbGone} aria-hidden>
        <ImageIcon size={16} />
      </span>
    );
  }
  return (
    <img className={own.thumbPic} src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(src)} />
  );
}

type FrameThumbProps = {
  image: number;
  order: number;
  title: string;
  thumb: string | undefined;
  badge: TakeBadge;
  leftOut: boolean;
  selected: boolean;
  onSelect: (image: number) => void;
};

function frameName(order: number, title: string, badge: TakeBadge, leftOut: boolean): string {
  return `Frame ${order}: ${title}${leftOut ? ', left out' : ''}${badge.label ? `, ${badge.label.toLowerCase()}` : ''}`;
}

/** One frame in the filmstrip: its picture, number and state; pressing it selects it. */
const StripCard = memo(function StripCard({
  image,
  order,
  title,
  aspect,
  thumb,
  badge,
  leftOut,
  selected,
  onSelect,
}: FrameThumbProps & { aspect: string }) {
  const name = frameName(order, title, badge, leftOut);
  return (
    <li className={own.stripItem} aria-current={selected || undefined}>
      <button
        type="button"
        className={own.stripCard}
        style={{ ['--ar' as string]: aspect }}
        aria-pressed={selected}
        aria-label={name}
        title={name}
        data-take={badge.take}
        data-left-out={leftOut || undefined}
        onClick={() => onSelect(image)}
      >
        <Thumb src={thumb} />
        <span className={own.cardNumber} aria-hidden>
          {order}
        </span>
        {badge.label && (
          <span className={own.badge} data-take={badge.take}>
            {badge.label}
          </span>
        )}
      </button>
    </li>
  );
});

/** One frame on the contact sheet: picture, number, title, chapter and state. */
const GridCard = memo(function GridCard({
  image,
  order,
  title,
  chapterName,
  thumb,
  badge,
  leftOut,
  selected,
  onSelect,
}: FrameThumbProps & { chapterName: string }) {
  return (
    <li className={own.gridItem}>
      <button
        type="button"
        className={own.gridCard}
        aria-pressed={selected}
        aria-label={frameName(order, title, badge, leftOut)}
        data-take={badge.take}
        data-left-out={leftOut || undefined}
        onClick={() => onSelect(image)}
      >
        <span className={own.gridPic}>
          <Thumb src={thumb} />
          {badge.label && (
            <span className={own.badge} data-take={badge.take}>
              {badge.label}
            </span>
          )}
        </span>
        <span className={own.gridText}>
          <span className={own.gridTitle}>
            <span className={own.cardNo}>{order}</span>
            {title}
          </span>
          <span className={own.gridChip}>{leftOut ? `${chapterName} · left out` : chapterName}</span>
        </span>
      </button>
    </li>
  );
});

/** The selected frame in the inspector: its fields, its take's state and errors. Memoised, so the
 * board's other changes don't re-render it while the person types. */
const FrameFields = memo(function FrameFields({
  order,
  frame,
  choice,
  modelName,
  pass2ModelName,
  save,
  view,
  done,
  shooting,
  shootError,
  retrying,
  retryError,
  canShoot,
  shootingAll,
  downloadError,
  onChoose,
  onShoot,
  onRetryPass2,
}: FrameFieldsProps) {
  const f = useMemo(() => boardFrame(frame, choice), [frame, choice]);
  const preset = lightingPresetById(f.lighting);
  const grammarOptions = useMemo(() => plannedFirst(GRAMMARS, frame.grammar), [frame.grammar]);
  const chapterOptions = useMemo(() => plannedFirst(CHAPTERS, frame.chapter), [frame.chapter]);
  const lightingOptions = useMemo(
    () => [
      {
        id: '',
        name: 'As the chapter has it',
        hint: "The chapter's light, shaped by the Sun and Light fields",
        group: frame.lighting ? 'Other' : 'Planned',
      },
      ...plannedFirst(
        LIGHTING_PRESETS.filter((p) => p.setting === f.setting),
        frame.lighting ?? ''
      ),
    ],
    [frame.lighting, f.setting]
  );
  const sunOptions = useMemo(() => {
    // A preset allows only the sun positions its relation names.
    if (preset) {
      const ids = presetSunIds(preset);
      return plannedFirst(
        SUN_POSITIONS.filter((s) => ids.includes(s.id)),
        frame.sun && ids.includes(frame.sun) ? frame.sun : ''
      );
    }
    return [
      {
        id: '',
        name: 'As the chapter has it',
        hint: "No lighting design: the chapter's fixed sun",
        group: frame.sun ? 'Other' : 'Planned',
      },
      ...plannedFirst(SUN_POSITIONS, frame.sun ?? ''),
    ];
  }, [frame.sun, preset]);
  const grammar = grammarById(f.grammar);
  const depthOptions = useMemo(
    () => [
      {
        id: '',
        name: 'As the shot has it',
        hint: `${grammar.lens}, the shot's own depth of field`,
        group: frame.depth ? 'Other' : 'Planned',
      },
      ...plannedFirst(DEPTH_PRESETS, frame.depth ?? ''),
    ],
    [frame.depth, grammar.lens]
  );
  const focusOptions = useMemo(
    () => [
      {
        id: '',
        name: grammar.people ? 'The people' : 'The subject',
        hint: "The shot's own focus",
        group: frame.focus ? 'Other' : 'Planned',
      },
      ...plannedFirst(FOCUS_TARGETS, frame.focus ?? ''),
    ],
    [frame.focus, grammar.people]
  );
  const title = `${order}. ${f.title}`;
  const { state, pass1 } = view;
  const rendering = shooting || inFlight(state);
  const blocked = notReady(f);
  const moment = momentById(f.moment);
  const place = [f.space, f.setting === 'interior' ? 'interior' : 'exterior'].filter(Boolean).join(' · ');
  // The check reviews the take as it was shot, so a frame since changed to Empty can still be checked.
  const checkPeople = done !== undefined && grammarById(done.lifestyle?.grammar ?? f.grammar).people;

  function pickGrammar(id: string) {
    const next = grammarById(id);
    const patch: LifestyleChoice = { grammar: id as GrammarId };
    // A brief is for a shot with people or one without: crossing over
    // starts afresh, or goes back to the planner's own brief.
    if (next.people !== grammar.people) {
      patch.people = next.people === grammarById(frame.grammar).people ? frame.people : '';
    }
    onChoose(frame.image, patch);
  }

  return (
    <Section title={`Frame ${order}: ${f.title}`} description={place} label="this frame">
      <div className={own.fields} data-left-out={!f.include || undefined}>
        <ul className={own.tags} aria-label={`Tags for ${title}`}>
          <li className={own.tag}>
            {grammar.name}, {grammar.lens}
          </li>
          {f.cast.length > 0 ? (
            <li className={own.tag}>{roleNames(f.cast)}</li>
          ) : (
            !grammar.people && <li className={own.tag}>No people</li>
          )}
          {moment && <li className={own.tag}>{moment.name}</li>}
          {preset && <li className={own.tag}>{preset.name}</li>}
          {f.sun && <li className={own.tag}>Sun: {SUN_POSITIONS.find((s) => s.id === f.sun)?.name.toLowerCase()}</li>}
          {f.depth && (
            <li className={own.tag}>
              {DEPTH_PRESETS.find((d) => d.id === f.depth)?.name}
              {f.focus ? `, on ${FOCUS_TARGETS.find((t) => t.id === f.focus)?.name.toLowerCase()}` : ''}
            </li>
          )}
          {!f.include && (
            <li className={own.tag} data-tone="muted">
              Left out
            </li>
          )}
        </ul>

        {state === 'pass1-failed' && !shooting && (
          <Alert tone="error" title="This frame didn't render">
            {pass1?.error ?? 'Shoot it again.'}
          </Alert>
        )}
        {state === 'pass2-failed' && !shooting && pass1 && (
          <Alert tone="warning" title="Pass 2 didn't finish">
            {view.note && (/[.!?]$/.test(view.note) ? `${view.note} ` : `${view.note}. `)}
            Pass 1 is shown meanwhile; retry pass 2 to finish it{pass2ModelName ? ` on ${pass2ModelName}` : ''}.
            <div className={own.passRetry}>
              <Button
                size="sm"
                icon={<RotateCcw size={14} />}
                loading={retrying}
                disabled={retrying || shootingAll}
                onPress={() => void onRetryPass2(frame.image, pass1.id)}
              >
                Retry pass 2
              </Button>
            </div>
          </Alert>
        )}

        {f.include && (
          <div className={own.options}>
            <div className={own.optionRow}>
              <Select label="Shot" options={grammarOptions} value={f.grammar} onChange={pickGrammar} disabled={rendering} />
              <Select
                label="Chapter"
                options={chapterOptions}
                value={f.chapter}
                onChange={(id) => onChoose(frame.image, { chapter: id as ChapterId })}
                disabled={rendering}
              />
            </div>
            {/* A reframed shot says what it moves in on, right under the shot. */}
            {grammar.reframe && (
              <TextInput
                label="Move in on"
                value={f.crop}
                onChange={(v) => onChoose(frame.image, { crop: v })}
                maxLength={CROP_MAX}
                disabled={rendering}
                placeholder="e.g. the nearest lounger at bottom left"
              />
            )}
            <div className={own.optionRow}>
              <TextArea
                label="Keep exactly"
                value={f.keep}
                onChange={(v) => onChoose(frame.image, { keep: v })}
                rows={2}
                maxLength={KEEP_MAX}
                disabled={rendering}
                placeholder="e.g. the free-form pool, the timber pavilions, the palms and the pink paving"
                className={own.pairField}
              />
              <TextArea
                label={grammar.people ? 'Who is there and where' : 'What the frame shows'}
                value={f.people}
                onChange={(v) => onChoose(frame.image, { people: v })}
                rows={3}
                maxLength={PEOPLE_MAX}
                disabled={rendering}
                className={own.pairField}
                placeholder={
                  grammar.people
                    ? 'e.g. the mother reads on the far lounger while the daughter dips her feet in the pool'
                    : 'e.g. No people. Petals fallen on the stone path by the bench.'
                }
              />
            </div>
            <TextInput
              label="Direction (optional)"
              value={f.note}
              onChange={(v) => onChoose(frame.image, { note: v })}
              maxLength={NOTE_MAX}
              disabled={rendering}
              placeholder="e.g. a softer sky, the umbrellas closed"
              onPressEnter={() => {
                if (canShoot && !blocked && !rendering && !shootingAll) void onShoot(frame.image);
              }}
            />
            <div className={own.optionRow}>
              <Select
                label="Lighting"
                options={lightingOptions}
                value={f.lighting ?? ''}
                onChange={(id) => onChoose(frame.image, { lighting: id === '' ? null : (id as LightingPresetId) })}
                disabled={rendering}
              />
              {(!preset || presetSunIds(preset).length > 1) && (
                <Select
                  label="Sun"
                  options={sunOptions}
                  value={preset ? presetSun(preset, f.sun) : (f.sun ?? '')}
                  onChange={(id) => onChoose(frame.image, { sun: id === '' ? null : (id as SunPositionId) })}
                  disabled={rendering}
                />
              )}
            </div>
            <TextArea
              label="Light"
              value={f.light ?? ''}
              onChange={(v) => onChoose(frame.image, { light: v })}
              rows={2}
              maxLength={LIGHT_MAX}
              disabled={rendering}
              placeholder="e.g. the tower on the left keeps the near walkway in shade; sun breaks through the trees in pools down the middle; she walks into the first pool, rim-lit against the shaded façade"
            />
            <div className={own.optionRow}>
              <Select
                label="Depth"
                options={depthOptions}
                value={f.depth ?? ''}
                onChange={(id) => onChoose(frame.image, { depth: id === '' ? null : (id as DepthId) })}
                disabled={rendering}
              />
              <Select
                label="Focus"
                options={focusOptions}
                value={f.focus ?? ''}
                onChange={(id) => onChoose(frame.image, { focus: id === '' ? null : (id as FocusId) })}
                disabled={rendering}
              />
            </div>
            {f.why && (
              <Text tone="muted" size="sm" as="p">
                Why: {f.why}
              </Text>
            )}
          </div>
        )}

        <div className={own.cardActions}>
          <ToggleButton
            selected={f.include}
            onChange={(next) => onChoose(frame.image, { include: next })}
            disabled={rendering}
          >
            {f.include ? 'In the film' : 'Left out'}
          </ToggleButton>
          <span className={own.saveState} role="status">
            {save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved' : ''}
          </span>
        </div>
        {save && typeof save === 'object' && <RunwayErrorNotice error={save.error} modelName="your plan" />}
        <RunwayErrorNotice error={shootError} modelName={modelName} onRetry={() => void onShoot(frame.image)} />
        {/* A retry's error only while its pass 2 still hasn't finished: one that lost a race to a poll has moved on. */}
        {state === 'pass2-failed' && pass1 && retryError !== undefined && !saysOnlyThis(retryError, view.note) && (
          <RunwayErrorNotice
            error={retryError}
            modelName={pass2ModelName ?? modelName}
            onRetry={() => void onRetryPass2(frame.image, pass1.id)}
          />
        )}
        {downloadError && (
          <Alert tone="error" title="Download failed">
            {downloadError}
          </Alert>
        )}
        {checkPeople && (
          <PeopleCheck
            key={done.id}
            stillId={done.id}
            autoRun={false}
            onFix={(fixes) => void onShoot(frame.image, fixes)}
            fixing={rendering}
          />
        )}
      </div>
    </Section>
  );
});

/** Whether an image URL loads, without showing it: the uploads expire after a day or so. */
function useImageLoads(url: string | undefined): boolean | null {
  const [state, setState] = useState<{ url: string | undefined; ok: boolean | null }>({ url, ok: null });
  useEffect(() => {
    if (!url) return;
    let live = true;
    const probe = new Image();
    probe.onload = () => live && setState({ url, ok: true });
    probe.onerror = () => live && setState({ url, ok: false });
    probe.src = url;
    return () => {
      live = false;
    };
  }, [url]);
  if (!url) return false;
  return state.url === url ? state.ok : null;
}

type LifestyleViewerProps = {
  /** Every frame, in film order. */
  board: readonly BoardFrame[];
  images: readonly LifestyleImage[];
  views: ReadonlyMap<number, TakeView>;
  twoPass: boolean;
  /** Takes shown as their first pass, by the final's id (shared with the cards). */
  pass1Shown: Readonly<Record<string, boolean>>;
  onShowPass1: (resultId: string, pass1: boolean) => void;
  /** The frame on screen (its image index), or null when closed. */
  image: number | null;
  onImage: (image: number | null) => void;
  onAnimate: (stillId: string, preset: VideoPreset) => void;
};

/**
 * The big screen for one shot frame: the take against its render with a
 * wipe, as the final or its first pass. The arrow keys step through the
 * frames already shot.
 */
function LifestyleViewer({
  board,
  images,
  views,
  twoPass,
  pass1Shown,
  onShowPass1,
  image,
  onImage,
  onAnimate,
}: LifestyleViewerProps) {
  const saver = useDownload();
  const shot = board.filter((f) => views.get(f.image)?.result?.status === 'succeeded');
  const index = shot.findIndex((f) => f.image === image);
  const frame = index >= 0 ? shot[index] : undefined;
  const img = frame ? images[frame.image] : undefined;
  const sourceOk = useImageLoads(img?.url);
  const view = frame ? views.get(frame.image) : undefined;
  const result = view?.result;
  const finished = view?.state === 'done' && view.pass2 !== undefined;
  const pass1 = finished && result ? pass1Shown[result.id] === true : false;
  const done = pass1 ? view?.pass1 : result;
  if (!frame || !view || !done || !result) {
    return (
      <FullscreenDialog isOpen={false} title="" onClose={() => onImage(null)}>
        {null}
      </FullscreenDialog>
    );
  }

  const order = board.indexOf(frame) + 1;
  const title = `${order}. ${frame.title}`;
  const aspect = `${done.width} / ${done.height}`;
  const prev = index > 0 ? shot[index - 1] : undefined;
  const next = index < shot.length - 1 ? shot[index + 1] : undefined;
  const shotAs = grammarById(done.lifestyle?.grammar ?? frame.grammar);
  const showingPass1 = twoPass && done === view.pass1;
  const what = showingPass1 ? 'Pass 1 of the lifestyle frame' : 'Lifestyle frame';

  return (
    <FullscreenDialog
      isOpen
      title={title}
      onClose={() => onImage(null)}
      onPrev={prev ? () => onImage(prev.image) : undefined}
      onNext={next ? () => onImage(next.image) : undefined}
      aside={
        <div className={own.viewerAside}>
          <div className={own.cardText}>
            <Text tone="muted" size="sm" as="p">
              Frame {order} of {board.length} · {chapterById(done.lifestyle?.chapter ?? frame.chapter).name} ·{' '}
              {shotAs.name}, {shotAs.lens}
            </Text>
            {done.people && (
              <Text tone="secondary" size="sm" as="p">
                {done.people}
              </Text>
            )}
          </div>
          {finished && (
            <PassToggle pass1={pass1} onChange={(next) => onShowPass1(result.id, next)} plate={view.plate} />
          )}
          {view.state === 'pass2-failed' && (
            <Text tone="muted" size="sm" as="p">
              Pass 1 only: pass 2 didn&rsquo;t finish. Retry it from the frame&rsquo;s card.
            </Text>
          )}
          <div className={own.cardActions}>
            <Button
              size="sm"
              icon={<Download size={14} />}
              loading={saver.pending}
              onPress={() => saver.start(libraryUrl('still', done.id), downloadName(order, frame.title, showingPass1))}
            >
              {saver.label('Download')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Film size={14} />}
              onPress={() => {
                // Closed first, or the big screen would stay over the Video tab.
                onImage(null);
                onAnimate(done.id, animatePreset(done, frame.grammar));
              }}
            >
              Animate
            </Button>
          </div>
          {saver.error && (
            <Alert tone="error" title="Download failed">
              {saver.error}
            </Alert>
          )}
          <Text tone="muted" size="sm" as="p">
            {sourceOk === false
              ? 'Your uploaded render is no longer kept, so only the frame can be shown.'
              : 'Drag the divider to compare the frame with your render.'}
          </Text>
        </div>
      }
    >
      <div className={own.viewerPicture} style={{ aspectRatio: aspect, ['--ar' as string]: aspect }}>
        {img && sourceOk === true ? (
          <CompareSlider
            key={done.id}
            className={own.viewerCompare}
            before={img.url}
            after={stillViewUrl(done.id)}
            afterFallback={stillThumbUrl(done.id)}
            beforeAlt={`Your render: ${img.name || frame.title}`}
            afterAlt={`${what}: ${frame.title}`}
            aspectRatio={aspect}
          />
        ) : (
          <TakeImage key={done.id} full stillId={done.id} alt={`${what}: ${frame.title}`} className={own.viewerImage} />
        )}
      </div>
    </FullscreenDialog>
  );
}
