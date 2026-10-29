import { Check, Clapperboard, Download, Expand, Film, Image as ImageIcon, Projector, RotateCcw, Users, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ToggleButton as AriaToggleButton, ToggleButtonGroup } from 'react-aria-components';

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
  GRAMMARS,
  grammarById,
  momentById,
  type CastRoleId,
  type ChapterId,
  type GrammarId,
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
import { slugify, withPick } from './director/shared.ts';
import { TakeImage } from './director/TakeImage.tsx';
import { Section } from './layouts/Section.tsx';
import { libraryUrl, stillThumbUrl, stillViewUrl, useDownload } from './lib/download.ts';
import { classifyRunwayError, errorMessage } from './lib/runwayErrors.ts';
import { isUploadFailure, uploadRender } from './lib/uploadRender.ts';
import { useProjectUploads } from './lib/useProjectUploads.ts';
import { LightReferenceField } from './LightReferenceField.tsx';
import { PeopleCheck } from './PeopleCheck.tsx';
import { trpc } from './trpc.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { ChoiceGroup } from './ui/ChoiceGroup.tsx';
import { CompareSlider } from './ui/CompareSlider.tsx';
import { EmptyState } from './ui/EmptyState.tsx';
import { FullscreenDialog } from './ui/FullscreenDialog.tsx';
import { ImageDropZone } from './ui/ImageDropZone.tsx';
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

/** What a film's first pass is shot on unless another is picked: the model the filmic pilot read right on. */
const DEFAULT_MODEL: ImageModelId = 'gpt-image-2-5-sunburst';

/** What finishes each frame unless another is picked (the server's DEFAULT_PASS2). */
const DEFAULT_PASS2_MODEL: ImageModelId = 'nano-banana-2-1';

/** Pass 2 sends the first pass and the render, so only a model that takes two images can finish a frame. */
const PASS2_MODELS = IMAGE_MODELS.filter((m) => imageModelTakesCastSheet(m.id));

/** The typed fields of a frame; their saves wait for a pause in typing. */
const TYPED: readonly string[] = ['keep', 'crop', 'people', 'note'];

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

function plannerOf(ai: AiText | undefined): Planner {
  if (!ai || ai.provider === 'runway') {
    return { provider: 'runway', label: 'Claude through your Runway account', model: 'Claude' };
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
  if (f.keep.length > KEEP_MAX || f.crop.length > CROP_MAX || f.people.length > PEOPLE_MAX || f.note.length > NOTE_MAX) {
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

/** One optional reference photo (the lighting reference, a cast sheet): a local preview, uploaded at once. */
function useReferenceUpload(what: string) {
  const [image, setImage] = useState<CastSheet | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const latest = useRef<string | null>(null);

  /** Upload a photo in place of the current one; its hosted URL, unless it failed or was replaced meanwhile. */
  async function add(file: Blob, name: string): Promise<string | undefined> {
    setError(null);
    const src = URL.createObjectURL(file);
    latest.current = src;
    setImage((prev) => {
      if (prev?.src.startsWith('blob:')) URL.revokeObjectURL(prev.src);
      return { src, name };
    });
    setUploading(true);
    try {
      const hostedUrl = await uploadRender(file);
      setImage((cur) => (cur?.src === src ? { ...cur, hostedUrl } : cur));
      return latest.current === src ? hostedUrl : undefined;
    } catch (e) {
      setImage((cur) => {
        if (cur?.src !== src) return cur;
        URL.revokeObjectURL(src);
        return null;
      });
      setError(uploadErrorFrom(e, what));
      return undefined;
    } finally {
      setUploading(false);
    }
  }

  function clear() {
    latest.current = null;
    setError(null);
    setImage((prev) => {
      if (prev?.src.startsWith('blob:')) URL.revokeObjectURL(prev.src);
      return null;
    });
  }

  return { image, uploading, error, setError, add, clear };
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
export function LifestylePage({ active, onAnimate }: LifestylePageProps) {
  const utils = trpc.useUtils();
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
  const light = useReferenceUpload('lighting reference');
  const [imageModel, setImageModel] = useState<ImageModelId>(DEFAULT_MODEL);
  const [resolution, setResolution] = useState(() => fourK(DEFAULT_MODEL));
  const [twoPass, setTwoPass] = useState(true);
  const [pass2Model, setPass2Model] = useState<ImageModelId>(DEFAULT_PASS2_MODEL);
  const [pass2Resolution, setPass2Resolution] = useState(() => fourK(DEFAULT_PASS2_MODEL));
  const [jobId, setJobId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);

  const plan = trpc.lifestyle.plan.useMutation();
  // Who writes the plan: the Settings choice, which step 2 changes too.
  const aiText = trpc.settings.aiText.useQuery(undefined, { enabled: active });
  const planner = plannerOf(aiText.data);
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
    refetchOnWindowFocus: false,
    retry: 2,
  });
  const current = job.data ?? null;

  // Until the new plan's first poll lands there is no job to show, and the
  // button must not start (and bill) a second plan meanwhile.
  const planning = plan.isPending || (jobId !== null && job.isPending) || current?.status === 'planning';
  const householdTooLong = household.length > HOUSEHOLD_MAX;
  const ready = uploads.length > 0 && pending === 0 && failed === 0 && !householdTooLong && !light.uploading;

  async function runPlan() {
    if (!ready || planning) return;
    try {
      const { id } = await plan.mutateAsync({
        images: uploads.map((u) => ({ url: u.hostedUrl!, width: u.width, height: u.height, name: u.name })),
        imageModel,
        resolution,
        pass2: twoPass ? { imageModel: pass2Model, resolution: pass2Resolution } : null,
        heritage,
        household,
        lightRefUrl: light.image?.hostedUrl,
      });
      setJobId(id);
      void utils.lifestyle.job.invalidate();
    } catch {
      // Shown by RunwayErrorNotice from plan.error.
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
          const caption = s.lifestyle?.title ?? lookLabel(s.look, litFromReference(s));
          return {
            id: s.id,
            src: stillThumbUrl(s.id),
            alt: `${caption}, ${new Date(s.createdAt).toLocaleString()}`,
            caption,
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
  const boardId = current?.status === 'planned' ? current.id : undefined;
  const loadedBoard = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!boardId || loadedBoard.current === boardId || !current) return;
    loadedBoard.current = boardId;
    const initial: Record<number, LifestyleChoice> = {};
    for (const [k, v] of Object.entries(current.choices ?? {})) initial[Number(k)] = v;
    setDrafts(initial);
    setSaves({});
    setShooting({});
    setShootErrors({});
    setRetrying({});
    setRetryErrors({});
    // A film with residents starts on the created cast; one without, on none.
    const residents = castNeeds((current.plan ?? []).map((f) => boardFrame(f, initial[f.image]))).length > 0;
    setCastMode(current.cast?.mode ?? (residents && imageModelTakesCastSheet(current.imageModel) ? 'generated' : 'none'));
  }, [boardId, current]);

  // One frame's saves go one after another, so a quick run of changes is
  // stored in the order it was made.
  const saveChains = useRef(new Map<number, Promise<unknown>>());
  const save = useCallback(
    (id: string, image: number, patch: LifestyleChoice) => {
      setSaves((s) => ({ ...s, [image]: 'saving' }));
      const chains = saveChains.current;
      const next = (chains.get(image) ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => utils.client.lifestyle.choose.mutate({ id, image, ...patch }))
        .then(() => {
          if (chains.get(image) === next) setSaves((s) => ({ ...s, [image]: 'saved' }));
        })
        .catch((error: unknown) => setSaves((s) => ({ ...s, [image]: { error } })));
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
  /** Frames whose shoot or pass-2 retry request is in flight, which the state is too slow to guard. */
  const shootingNow = useRef(new Set<number>());
  const retryingNow = useRef(new Set<number>());
  const viewsRef = useRef(new Map<number, TakeView>());
  const refetchJob = job.refetch;
  const shoot = useCallback(
    async (image: number, fixes?: string) => {
      if (!boardId) return;
      // A frame already being shot, or whose take is still on either pass, is not billed a second time.
      if (shootingNow.current.has(image) || retryingNow.current.has(image) || inFlight(viewsRef.current.get(image)?.state)) {
        return;
      }
      shootingNow.current.add(image);
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
        if (typed) setSaves((s) => ({ ...s, [image]: 'saved' }));
        await Promise.all([refetchJob(), utils.library.invalidate()]);
      } catch (error) {
        setShootErrors((e) => ({ ...e, [image]: error }));
        // The shoot didn't go, so the typing it carried is saved on its own.
        if (typed) save(boardId, image, typed);
      } finally {
        shootingNow.current.delete(image);
        setShooting((s) => ({ ...s, [image]: false }));
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
      if (!boardId || retryingNow.current.has(image) || shootingNow.current.has(image)) return;
      retryingNow.current.add(image);
      setRetrying((r) => ({ ...r, [image]: true }));
      setRetryErrors((e) => ({ ...e, [image]: undefined }));
      try {
        await utils.client.lifestyle.retryPass2.mutate({ id: boardId, stillId });
      } catch (error) {
        setRetryErrors((e) => ({ ...e, [image]: error }));
      } finally {
        // Sent or refused, the take has moved on: show where it is now.
        await Promise.all([refetchJob(), utils.library.invalidate()]).catch(() => undefined);
        retryingNow.current.delete(image);
        setRetrying((r) => ({ ...r, [image]: false }));
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
  const canShoot = cast?.approved === true;
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
  const [castBusy, setCastBusy] = useState<CastMode | 'approve' | null>(null);
  const [castError, setCastError] = useState<unknown>(undefined);
  const chooseCast = useCallback(
    async (mode: CastMode, uploadedUrl?: string) => {
      if (!boardId) return;
      setCastBusy(mode);
      setCastError(undefined);
      try {
        // The cast is made from the plan as it reads on screen, typing included.
        await flushSaves();
        await utils.client.lifestyle.cast.mutate({ id: boardId, mode, ...(uploadedUrl ? { uploadedUrl } : {}) });
      } catch (error) {
        setCastError(error);
      } finally {
        // Sheets sent before a failure are on the plan too.
        await Promise.all([refetchJob(), utils.library.invalidate()]).catch(() => undefined);
        setCastBusy(null);
      }
    },
    [boardId, flushSaves, utils, refetchJob]
  );
  const approveCast = useCallback(async () => {
    if (!boardId) return;
    setCastBusy('approve');
    setCastError(undefined);
    try {
      await utils.client.lifestyle.approveCast.mutate({ id: boardId });
      await refetchJob();
    } catch (error) {
      setCastError(error);
    } finally {
      setCastBusy(null);
    }
  }, [boardId, utils, refetchJob]);

  const openFrame = useCallback((image: number) => setViewing(image), []);
  const chaptersUsed = CHAPTERS.filter((c) => board.some((f) => f.chapter === c.id)).length;
  const heritageName = ETHNICITIES.find((e) => e.id === current?.heritage)?.name ?? '';
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

  return (
    <>
      <div className={styles.layout}>
        <div className={styles.controls}>
          <PageHeader
            title="Bring the home to life"
            description="Upload every render of the project. The app plans each one as a frame of a residential lifestyle film — what to keep, who is there and how far away — creates the residents once, then re-photographs each render as a real photograph."
          />
          <Section step={1} title="Project renders" description={`Every render of one project, up to ${MAX_IMAGES}.`}>
            <div className={styles.stack}>
              <ImageDropZone
                onFiles={(files) => void addFiles(files)}
                disabled={planning || uploads.length >= MAX_IMAGES}
                actionLabel={uploads.length ? 'Add renders' : 'Choose renders'}
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

          <Section step={2} title="AI and models" description="Who writes the plan of action, and which image models shoot it.">
            <div className={own.aiRows}>
              <PlannerRow ai={aiText.data} error={aiText.error} planner={planner} disabled={planning} />

              <div className={own.aiRow}>
                <p className={own.aiRowHead}>
                  Image models <span>— re-photograph each render</span>
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
                    Two passes — x-ray plate, then develop
                  </AriaToggleButton>
                </ToggleButtonGroup>
                <Text tone="muted" size="sm" as="p" className={own.aiRowNote}>
                  {twoPass
                    ? `Pass 1 shoots each render as a flat x-ray plate: deep focus, neutral, every decision legible. Pass 2 develops the plate into the finished film frame at full detail and matches the architecture back to your render. The cast is always made on ${imageModelName(CAST_SHEET_MODEL.imageModel)}.`
                    : 'Each frame is one still from this model, as it comes back.'}
                </Text>
                <div className={styles.selectRow}>
                  <Select
                    label={twoPass ? 'Pass 1 — the x-ray plate' : 'Image model'}
                    options={IMAGE_MODELS}
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
                </div>
                {twoPass && (
                  <div className={styles.selectRow}>
                    <Select
                      label="Pass 2 — the develop"
                      options={PASS2_MODELS}
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
                          : `Plan ${uploads.length} frame${uploads.length === 1 ? '' : 's'}`}
            </Button>
            <Text tone="muted" size="sm" as="p" className={styles.meta}>
              {planner.provider === 'runway'
                ? 'Claude plans the film, a few credits for every six renders.'
                : `${planner.model} plans the film on your own ${PROVIDER_NAMES[planner.provider]} key.`}{' '}
              Nothing is shot until you say so.{' '}
              {imageModelTakesCastSheet(imageModel)
                ? `The cast is one ${imageModelName(CAST_SHEET_MODEL.imageModel)} still per chapter; each frame is `
                : `${modelName} takes only the render, so there is no cast; each frame is `}
              {twoPass
                ? pass2Model === imageModel
                  ? `two stills on ${modelName}, the x-ray plate and then the develop.`
                  : `two stills, an x-ray plate on ${modelName} and then the develop on ${pass2Name}.`
                : `one ${modelName} still.`}{' '}
              Billed to your own Runway credits at each model&rsquo;s own rate.
            </Text>
            <RunwayErrorNotice error={plan.error} modelName="Claude" onRetry={() => void runPlan()} />
          </div>
        </div>

        <div className={styles.result} data-stage>
          {current?.status === 'planned' ? (
            <Section title="Plan of action">
              <div className={own.boardHead}>
                <div className={own.boardIntro}>
                  <Text tone="secondary" as="p">
                    {board.length} frame{board.length === 1 ? '' : 's'} in {COUNT_WORDS[chaptersUsed]} chapter
                    {chaptersUsed === 1 ? '' : 's'}. Edit anything, then create the cast and shoot.
                  </Text>
                  <Text tone="muted" size="sm" as="p">
                    {heritageName && `${heritageName} household. `}
                    {boardShotWith}
                    {current.lightRefUrl ? ', matched to your lighting reference' : ''}. Each list puts the planned
                    choice first. Plans come from {planner.label}.
                  </Text>
                </div>
                <div className={own.cardActions}>
                  {(unshot.length > 0 || shootingAll) && (
                    <Button
                      variant="primary"
                      icon={<Clapperboard size={16} />}
                      loading={shootingAll}
                      disabled={!canShoot}
                      onPress={() => void shootAll()}
                    >
                      {shootingAll
                        ? 'Shooting the frames…'
                        : unshot.length === included.length
                          ? unshot.length === 1
                            ? 'Shoot the frame'
                            : `Shoot all ${unshot.length} frames`
                          : `Shoot the other ${unshot.length} frame${unshot.length === 1 ? '' : 's'}`}
                    </Button>
                  )}
                </div>
              </div>
              {current.warning && (
                <div className={own.pollError}>
                  <Alert tone="warning" title="Part of the film wasn't planned">
                    {current.warning}
                  </Alert>
                </div>
              )}

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
              />

              {CHAPTERS.map((chapter, ci) => {
                const frames = board.filter((f) => f.chapter === chapter.id);
                if (frames.length === 0) return null;
                return (
                  <section key={chapter.id} className={own.chapter} aria-labelledby={`chapter-${chapter.id}`}>
                    <header className={own.chapterHead}>
                      <span className={own.chapterNo} aria-hidden>
                        {String(ci + 1).padStart(2, '0')}
                      </span>
                      <h3 id={`chapter-${chapter.id}`} className={own.chapterName}>
                        {chapter.name}
                      </h3>
                      <span className={own.chapterHint}>{chapter.hint}</span>
                      <span className={own.chapterCount}>
                        {frames.length} frame{frames.length === 1 ? '' : 's'}
                      </span>
                    </header>
                    <ol className={own.frames}>
                      {frames.map((f) => {
                        const view = views.get(f.image) ?? NO_TAKE;
                        return (
                          <FrameCard
                            key={`${current.id}-${f.image}`}
                            order={board.indexOf(f) + 1}
                            frame={planned.get(f.image)!}
                            choice={drafts[f.image]}
                            img={current.images[f.image]}
                            jobId={current.id}
                            modelName={imageModelName(current.imageModel)}
                            pass2ModelName={current.pass2 ? imageModelName(current.pass2.imageModel) : undefined}
                            save={saves[f.image]}
                            view={view}
                            twoPass={twoPassBoard}
                            pass1Shown={view.result ? pass1Shown[view.result.id] === true : false}
                            onShowPass1={showPass1}
                            shooting={Boolean(shooting[f.image])}
                            shootError={shootErrors[f.image]}
                            retrying={Boolean(retrying[f.image])}
                            retryError={retryErrors[f.image]}
                            canShoot={canShoot}
                            shootingAll={shootingAll}
                            onChoose={onChoose}
                            onShoot={shoot}
                            onRetryPass2={retryPass2}
                            onOpen={openFrame}
                            onAnimate={onAnimate}
                          />
                        );
                      })}
                    </ol>
                  </section>
                );
              })}
              <Text tone="muted" size="sm" as="p" className={own.saved}>
                Every frame is saved to your library, tagged @lifestyle
                {current.pass2 ? ', its x-ray plate also @pass-1. Pass 2 develops the plate on its own once it is in, while this page is open' : ''}
                . Shoot within a day of planning: uploaded renders are only kept that long.
              </Text>
            </Section>
          ) : (
            <Section title="Plan of action">
              <div className={styles.resultFrame} style={{ aspectRatio: '16 / 9', ['--ar' as string]: '16 / 9' }}>
                {planning ? (
                  <RenderingStatus
                    label={
                      plan.isPending
                        ? `Sending the renders to ${planner.model}…`
                        : `Planning ${current?.images.length ?? uploads.length} frames: chapter, shot, what to keep, who is there…`
                    }
                    runKey={current?.id}
                  />
                ) : current?.status === 'failed' ? (
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
                ) : job.isLoading ? (
                  <RenderingStatus label="Loading your plan…" />
                ) : (
                  <EmptyState
                    title="Your plan of action will appear here"
                    hint="Upload the project's renders, say who lives there, then press Plan. Each render comes back tagged with its chapter, shot, what to keep and who is there, ready to cast and shoot."
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
        <LifestyleViewer
          board={board}
          images={current.images}
          views={views}
          twoPass={twoPassBoard}
          pass1Shown={pass1Shown}
          onShowPass1={showPass1}
          image={viewing}
          onImage={setViewing}
          onAnimate={onAnimate}
        />
      )}
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
  const utils = trpc.useUtils();
  const choose = trpc.settings.setAiText.useMutation({ onSettled: () => utils.settings.aiText.invalidate() });
  const head = (
    <p className={own.aiRowHead}>
      Planner <span>— writes the plan of action</span>
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
    { id: 'runway', name: 'Runway' },
    { id: 'anthropic', name: `Anthropic${keys.anthropic ? '' : ' — add a key in Settings'}` },
    { id: 'omegaplus', name: `OmegaPlus${keys.omegaplus ? '' : ' — add a key in Settings'}` },
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
        {provider === 'runway'
          ? 'Claude through your Runway account.'
          : `${planner.model} on your own ${PROVIDER_NAMES[provider]} key.`}{' '}
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
};

/**
 * The household's cast, between the plan and the shoot: created once per
 * chapter that has residents (lit in that chapter's light, on one of its
 * renders), the person's own sheet, or none. Frames are shot only once it
 * is approved.
 */
function CastPanel({ imageModel, cast, needs, stillById, mode, onMode, busy, error, onCast, onApprove }: CastPanelProps) {
  const upload = useReferenceUpload('cast sheet');
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
    <section className={own.castPanel} aria-labelledby="lifestyle-cast">
      <div className={own.castPanelHead}>
        <h3 id="lifestyle-cast" className={own.castPanelTitle}>
          <Users size={16} aria-hidden />
          The residents
        </h3>
        <span className={own.castStatus} data-approved={cast?.approved || undefined}>
          {cast?.approved && <Check size={12} aria-hidden />}
          {status}
        </span>
      </div>
      <Text tone="secondary" size="sm" as="p" className={own.castLead}>
        {n > 0
          ? `The same household appears across the film. ${n === 1 ? 'One chapter has' : `${capitalised(COUNT_WORDS[n] ?? String(n))} chapters have`} residents in it; each gets one cast sheet lit in its own light, so faces, hair and clothing stay the same from frame to frame.${cast?.approved ? '' : ' Approve the cast to start shooting.'}`
          : `No frame in the film has household residents in it, so there is no cast to create.${cast?.approved ? '' : ' Choose No cast to start shooting.'}`}
      </Text>
      {!supported && (
        <Alert tone="warning" title="No cast sheet with this model">
          {modelName} takes only the render, so the frames are shot without a cast
          {castSheetModelNames().length > 0 ? `; plan again with ${castSheetModelNames().join(' or ')} to use one` : ''}.
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
                const caption = `Cast: ${chapter.name} — ${roleNames(sheet.roles)}`;
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
            alternatives={castSheetModelNames()}
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
    </section>
  );
}

type FrameCardProps = {
  order: number;
  /** The planner's frame; the card reads the person's changes over it. */
  frame: LifestyleFrame;
  choice: LifestyleChoice | undefined;
  img: LifestyleImage | undefined;
  jobId: string;
  modelName: string;
  /** The model that finishes each take; unset on a one-pass plan. */
  pass2ModelName: string | undefined;
  save: SaveState | undefined;
  view: TakeView;
  twoPass: boolean;
  /** The take is shown as its first pass rather than the final. */
  pass1Shown: boolean;
  onShowPass1: (resultId: string, pass1: boolean) => void;
  shooting: boolean;
  shootError: unknown;
  retrying: boolean;
  retryError: unknown;
  /** The cast is approved, so frames may be shot. */
  canShoot: boolean;
  /** The whole board is being shot in turn, so no frame is shot on its own. */
  shootingAll: boolean;
  onChoose: (image: number, patch: LifestyleChoice) => void;
  onShoot: (image: number, fixes?: string) => Promise<void>;
  onRetryPass2: (image: number, stillId: string) => Promise<void>;
  onOpen: (image: number) => void;
  onAnimate: (stillId: string, preset: VideoPreset) => void;
};

/** What the card's picture says while a take is on its way. */
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

/** One frame of the plan, and its take once shot. Memoised, with its own
 * download state, so typing in one card doesn't re-render the others. */
const FrameCard = memo(function FrameCard({
  order,
  frame,
  choice,
  img,
  jobId,
  modelName,
  pass2ModelName,
  save,
  view,
  twoPass,
  pass1Shown,
  onShowPass1,
  shooting,
  shootError,
  retrying,
  retryError,
  canShoot,
  shootingAll,
  onChoose,
  onShoot,
  onRetryPass2,
  onOpen,
  onAnimate,
}: FrameCardProps) {
  const saver = useDownload();
  const [sourceBroken, setSourceBroken] = useState(false);
  const f = useMemo(() => boardFrame(frame, choice), [frame, choice]);
  const grammarOptions = useMemo(() => plannedFirst(GRAMMARS, frame.grammar), [frame.grammar]);
  const chapterOptions = useMemo(() => plannedFirst(CHAPTERS, frame.chapter), [frame.chapter]);
  const grammar = grammarById(f.grammar);
  const aspect = img ? `${img.width} / ${img.height}` : '16 / 9';
  const title = `${order}. ${f.title}`;
  const { state, pass1, result } = view;
  const rendering = shooting || inFlight(state);
  // The finished take, as the final or (by choice, or while pass 2 can't be had) its first pass.
  const finished = state === 'done' && view.pass2 !== undefined;
  const done = state === 'done' || state === 'pass2-failed' ? (finished && pass1Shown ? pass1 : result) : undefined;
  const showingPass1 = twoPass && done !== undefined && done === pass1;
  const blocked = notReady(f);
  const moment = momentById(f.moment);
  const place = [f.space, f.setting === 'interior' ? 'interior' : 'exterior'].filter(Boolean).join(' · ');
  // The check reviews the take as it was shot, so a frame since changed to Empty can still be checked.
  const checkPeople = done !== undefined && grammarById(done.lifestyle?.grammar ?? f.grammar).people;
  const passOne = (state === 'pass2-waiting' || state === 'pass2-pending') && !shooting ? pass1 : undefined;

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
    <li className={own.card} data-left-out={!f.include || undefined}>
      <div className={own.cardFrame} style={{ aspectRatio: aspect }}>
        {rendering ? (
          <>
            {/* Pass 1 is in: it shows, stepped back, while pass 2 finishes it. */}
            {passOne && (
              <TakeImage
                key={passOne.id}
                stillId={passOne.id}
                alt={view.plate ? `X-ray plate of ${f.title}` : `Pass 1 of ${f.title}`}
                className={`${styles.image} ${own.passOverlay}`}
              />
            )}
            <RenderingStatus
              label={renderingLabel(state, shooting, twoPass, view.plate)}
              runKey={passOne ? `${passOne.id}-pass2` : (pass1?.id ?? `${jobId}-${frame.image}`)}
            />
          </>
        ) : done ? (
          <>
            <TakeImage
              key={done.id}
              stillId={done.id}
              alt={`${showingPass1 ? 'Pass 1 of the lifestyle frame' : 'Lifestyle frame'}: ${f.title}`}
              className={styles.image}
              onOpen={() => onOpen(frame.image)}
              openLabel={`Compare with your render: ${title}`}
              openClassName={own.frameButton}
            />
            {state === 'pass2-failed' && (
              <span className={own.passChip}>{view.plate ? 'Plate only' : 'Pass 1 only'}</span>
            )}
            {finished && result && (
              <PassToggle
                pass1={pass1Shown}
                onChange={(next) => onShowPass1(result.id, next)}
                plate={view.plate}
                className={own.passToggleOnFrame}
              />
            )}
          </>
        ) : img && !sourceBroken ? (
          <>
            <img
              className={`${styles.image} ${own.source}`}
              src={img.url}
              alt={`Your render: ${img.name || f.title}`}
              loading="lazy"
              decoding="async"
              onError={() => setSourceBroken(true)}
            />
            <span className={own.sourceChip}>Your render</span>
          </>
        ) : (
          <div className={styles.frameAlert}>
            <Text tone="muted" size="sm" as="p">
              This uploaded render is no longer kept. Plan the film again to shoot it.
            </Text>
          </div>
        )}
      </div>

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

      <div className={own.cardText}>
        <h4 className={own.cardTitle}>
          <span className={own.cardNo}>{order}</span>
          {f.title}
          <span className={own.space}>{place}</span>
        </h4>
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
          {!f.include && (
            <li className={own.tag} data-tone="muted">
              Left out
            </li>
          )}
        </ul>
      </div>

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
          <TextArea
            label="Keep exactly"
            value={f.keep}
            onChange={(v) => onChoose(frame.image, { keep: v })}
            rows={2}
            maxLength={KEEP_MAX}
            disabled={rendering}
            placeholder="e.g. the free-form pool, the timber pavilions, the palms and the pink paving"
          />
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
          <TextArea
            label={grammar.people ? 'Who is there and where' : 'What the frame shows'}
            value={f.people}
            onChange={(v) => onChoose(frame.image, { people: v })}
            rows={3}
            maxLength={PEOPLE_MAX}
            disabled={rendering}
            placeholder={
              grammar.people
                ? 'e.g. the mother reads on the far lounger while the daughter dips her feet in the pool'
                : 'e.g. No people. Petals fallen on the stone path by the bench.'
            }
          />
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
        {f.include && (
          <Button
            size="sm"
            icon={<Clapperboard size={14} />}
            loading={rendering}
            disabled={!canShoot || blocked !== undefined || shootingAll || retrying}
            onPress={() => void onShoot(frame.image)}
          >
            {rendering ? 'Shooting…' : state !== 'none' ? 'Shoot again' : 'Shoot this frame'}
          </Button>
        )}
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
              aria-label={saver.pending ? undefined : `Download ${title}${showingPass1 ? ', pass 1' : ''}`}
              onPress={() => saver.start(libraryUrl('still', done.id), downloadName(order, f.title, showingPass1))}
            >
              {saver.label('Download')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Film size={14} />}
              aria-label={`Animate ${title}`}
              onPress={() => onAnimate(done.id, animatePreset(done, f.grammar))}
            >
              Animate
            </Button>
          </>
        )}
        <span className={own.saveState} role="status">
          {save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved' : ''}
        </span>
      </div>
      {f.include && blocked && (
        <Text tone="muted" size="sm" as="p">
          {blocked}
        </Text>
      )}
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
      {saver.error && (
        <Alert tone="error" title="Download failed">
          {saver.error}
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
    </li>
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
