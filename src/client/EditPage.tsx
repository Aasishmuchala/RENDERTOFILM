import type { inferRouterOutputs } from '@trpc/server';
import {
  ArrowDown,
  ArrowUp,
  Blend,
  BookmarkPlus,
  Check,
  Clapperboard,
  Copy,
  Download,
  Film,
  Maximize,
  Music,
  Palette,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Send,
  Square,
  Trash2,
  Undo2,
  WandSparkles,
  X,
} from 'lucide-react';
import {
  cloneElement,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  memo,
  type ReactElement,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Checkbox } from 'react-aria-components';

import type { AppRouterType } from '../api.ts';
import { type CutColour, colourCss, colourSteps, cutEnds, isNeutral, NEUTRAL_COLOUR } from '../colour.ts';
import { GRADES } from '../grades.ts';
import { cubeLut, lutFileName } from '../lut.ts';
import {
  DELIVERABLE_IDS,
  DELIVERABLE_LABELS,
  type DeliverableId,
  frameLabel,
  type QcReport,
  TITLE_CARD,
  type TitleCard,
  verticalFrame,
} from '../master.ts';
import { SIDECAR_LABELS } from '../sidecars.ts';
import { derivedLabel, rootClipId, versionChain, type TimelineItem } from '../timeline.ts';
import { formatHash, type Handoff, parseHash } from './handoff.ts';
import { Section } from './layouts/Section.tsx';
import { frameGuidesClass, PHONE_QUERY, Workspace } from './layouts/Workspace.tsx';
import { useAmbient } from './lib/ambient.tsx';
import { clipPosterUrl, libraryUrl, useDownload } from './lib/download.ts';
import { followFilm, musicLevel, useGradedDownload } from './lib/gradedFilm.ts';
import { cardSizes, renderTitleCard } from './lib/titleCard.ts';
import { useCapabilities } from './lib/useCapabilities.ts';
import { useInFlight } from './lib/useInFlight.ts';
import { trpc } from './trpc.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { ConfirmDialog } from './ui/ConfirmDialog.tsx';
import { CostLine } from './ui/CostLine.tsx';
import { EmptyState } from './ui/EmptyState.tsx';
import { FilterChips } from './ui/FilterChips.tsx';
import { FrameWindow } from './ui/FrameWindow.tsx';
import { BlockedTip } from './ui/ModelUnavailable.tsx';
import { NumberInput } from './ui/NumberInput.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { RenderingStatus } from './ui/RenderingStatus.tsx';
import { RunwayErrorNotice } from './ui/RunwayErrorNotice.tsx';
import { Select } from './ui/Select.tsx';
import { SkeletonBlock, SkeletonText } from './ui/Skeleton.tsx';
import { Slider } from './ui/Slider.tsx';
import { Text, TextLink } from './ui/Text.tsx';
import { TextArea } from './ui/TextArea.tsx';
import { TextInput } from './ui/TextInput.tsx';
import styles from './EditPage.module.css';
import studio from './Studio.module.css';

type Project = inferRouterOutputs<AppRouterType>['edit']['project'];
type Cut = Pick<TimelineItem, 'key' | 'clipId' | 'versionId' | 'sourceStart' | 'duration' | 'colour' | 'frame'>;
type Draft = { items: Cut[]; transition: 'hard' | 'fade'; fadeSeconds: number };
type EditMusic = NonNullable<Project['music']>;
type ExportRow = Project['exports'][number];
type Deliverable = NonNullable<ExportRow['deliverables']>[number];
/** Sends one of the page's writes beside the cut; see `write` in EditPage. */
type PageWrite = <T extends { rev: number }>(send: () => Promise<T>) => Promise<T>;

/** Longest message `edit.agentSend` takes (it trims first). */
const EDITOR_MESSAGE_MAX = 2000;

const SUGGESTIONS = [
  'Cut a 20 second film: widest view first, details in the middle, end on the hero shot',
  'Grade every cut warm luxury',
  'Use slow 1 second fades between cuts',
  'Remember: keep every cut between 3 and 5 seconds',
];

const GRADE_OPTIONS = GRADES.map((g) => ({ id: g.id, name: g.name, hint: g.hint }));
const LOOK_OPTIONS = GRADE_OPTIONS.map((g) => (g.id === 'none' ? { ...g, name: 'No look', hint: 'Only the adjustments below' } : g));
const GRADE_MODES = [
  { id: 'builtin', name: 'Built-in, instant' },
  { id: 'aleph', name: 'Aleph 2.0 re-render' },
];
const ADJUSTMENTS = [
  { id: 'exposure', label: 'Exposure' },
  { id: 'contrast', label: 'Contrast' },
  { id: 'saturation', label: 'Saturation' },
  { id: 'warmth', label: 'Warmth' },
] as const;
const NO_NOTES: string[] = [];
/** Longest music file `POST /api/upload-audio` takes. */
const AUDIO_LIMIT = 50 * 1024 * 1024;
/** Where a new bed starts: full level, a short fade each way. */
const NEW_MUSIC = { inSeconds: 0, gain: 0, fadeIn: 1.5, fadeOut: 2 };
/** Each deliverable's file name; desktop/platform/master.js sets the containers. */
const DELIVERABLE_FILES: Record<DeliverableId, string> = {
  h264: 'render-to-film-h264.mp4',
  hevc10: 'render-to-film-hevc10.mp4',
  prores: 'render-to-film-prores.mov',
  vertical: 'render-to-film-9x16.mp4',
};
/** A clip's size until its file says; the server falls back to the same. */
const CLIP_SIZE = { width: 1920, height: 1080 };
/** How long a clip's size may take to read before the page goes on without it. */
const CLIP_SIZE_MS = 8000;
/** The title card preview's canvas: twice the 320 px it shows at, for a sharp small picture. */
const CARD_PREVIEW = { width: 640, height: 360 };
const signed = (v: number) => (Math.round(v * 100) === 0 ? '0' : `${v > 0 ? '+' : ''}${Math.round(v * 100)}`);

function round(n: number) {
  return Math.round(n * 100) / 100;
}

function fromServer(p: Project): Draft {
  return {
    items: p.timeline.map(({ key, clipId, versionId, sourceStart, duration, colour, frame }) => ({
      key,
      clipId,
      versionId,
      sourceStart,
      duration,
      colour,
      frame,
    })),
    transition: p.transition,
    fadeSeconds: p.fadeSeconds,
  };
}

/** What a save would overwrite: order, trims, looks, transitions. A cut's version is the server's own. */
function cutOf(d: Draft): string {
  return JSON.stringify({ ...d, items: d.items.map(({ versionId: _serverOwned, ...c }) => c) });
}

/** A tRPC error's code; anything else has none. */
function codeOf(err: unknown): string | undefined {
  return (err as { data?: { code?: string } } | null)?.data?.code;
}

/** Where a music bed is served from. */
function assetUrl(key: string): string {
  return `/api/asset/${key}`;
}

/** Decibels with a real minus sign, to a tenth: −14.0. */
function decibels(value: number): string {
  return `${value < 0 ? '\u2212' : ''}${Math.abs(value).toFixed(1)}`;
}

/** A finished file's quality check in one line: its readings, or what is wrong with it. */
function qcLine(qc: QcReport): string {
  if (!qc.pass) return `QC: ${qc.findings.join(' ')}`;
  return [
    qc.integratedLufs !== null && `${decibels(qc.integratedLufs)} LUFS`,
    qc.truePeakDbfs !== null && `${decibels(qc.truePeakDbfs)} dBTP`,
    qc.tags.colorspace === 'bt709' ? 'BT.709' : qc.tags.colorspace,
    qc.frames !== null && `${qc.frames.toLocaleString('en-US')} frames`,
  ]
    .filter(Boolean)
    .join(', ');
}

/** What a 9:16 file did with the cuts: "2 cuts cropped (1 centre, 1 left), 1 fitted on black." */
function framesLine(frames: NonNullable<ExportRow['frames']>): string {
  const counted = (n: number) => `${n} ${n === 1 ? 'cut' : 'cuts'}`;
  const crops = frames.filter((f) => f.mode === 'crop');
  const fits = frames.length - crops.length;
  // `frameLabel` holds where left and right begin, so the row says what the cut says.
  const inPlace = (x: number) => crops.filter((f) => frameLabel(f) === frameLabel({ mode: 'crop', x })).length;
  const places = [
    { word: 'centre', n: inPlace(0.5) },
    { word: 'left', n: inPlace(0) },
    { word: 'right', n: inPlace(1) },
  ]
    .filter((p) => p.n > 0)
    .map((p) => `${p.n} ${p.word}`);
  const groups = [
    crops.length > 0 && `${counted(crops.length)} cropped (${places.join(', ')})`,
    fits > 0 && `${crops.length > 0 ? fits : counted(fits)} fitted on black`,
  ];
  return `${groups.filter(Boolean).join(', ')}.`;
}

/** The title cards cut into a master: "Title 3 s, End card 2.5 s." */
function cardsLine(cards: NonNullable<ExportRow['cards']>): string {
  const sides = [cards.head !== undefined && `Title ${cards.head} s`, cards.tail !== undefined && `End card ${cards.tail} s`];
  return `${sides.filter(Boolean).join(', ')}.`;
}

/** A FilmCraft conform: the one kind of export whose row names its own file. */
const isConform = (job: ExportRow | undefined) => !!job?.deliverables?.some((d) => d.fileName);

/** The name a finished file saves under. */
const fileNameOf = (file: Deliverable) => file.fileName ?? DELIVERABLE_FILES[file.id];

/**
 * A video's own size, from its file. The page's list of clips does not carry one, so
 * this is what stands for the clip's artifact. Null when the file can't say in time.
 */
function videoSize(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const done = (size: { width: number; height: number } | null) => {
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      resolve(size);
    };
    const timer = setTimeout(() => done(null), CLIP_SIZE_MS);
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => done(video.videoWidth ? { width: video.videoWidth, height: video.videoHeight } : null);
    video.onerror = () => done(null);
    video.src = src;
  });
}

/** The size of the clip at `src`, once `on`; `CLIP_SIZE` until its file says. */
function useClipSize(src: string, on: boolean) {
  const [read, setRead] = useState<{ src: string; width: number; height: number } | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    void videoSize(src).then((size) => {
      if (live && size) setRead({ src, ...size });
    });
    return () => {
      live = false;
    };
  }, [src, on]);
  return read?.src === src ? read : CLIP_SIZE;
}

/** Saves a cut's grade as a `.cube`. It is worked out here, so it asks nothing of the server. */
function downloadLut(colour: CutColour, title: string) {
  const href = URL.createObjectURL(new Blob([cubeLut(colour, title)], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = href;
  a.download = lutFileName(title);
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/**
 * What the address asks of this page, a new object per arrival: the shell's
 * `handoff` when it passes one, else the hash. The shell writes the hash in an
 * effect of its own, after this page's effects, so the read waits for those to end.
 */
function useArrival(handoff: Handoff | undefined, active: boolean): Handoff | null {
  const [address, setAddress] = useState<Handoff | null>(null);
  useEffect(() => {
    if (handoff) return;
    const read = () => setAddress(parseHash(window.location.hash));
    window.addEventListener('hashchange', read);
    if (active) queueMicrotask(read);
    return () => window.removeEventListener('hashchange', read);
  }, [handoff, active]);
  const arrival = handoff ?? address;
  return arrival?.page === 'edit' ? arrival : null;
}

/**
 * Takes an acted-on `clip` out of the address, as App does with `preset`: a reload
 * or a Back to it would be a new arrival, and put back a clip since removed.
 */
function clearArrivedClip(clipId: string) {
  const { page, params: { clip, ...params } } = parseHash(window.location.hash);
  if (page !== 'edit' || clip !== clipId) return;
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}${formatHash(page, params)}`);
}

export type EditPageProps = {
  /** Go to the Video tab, when there are no clips yet. */
  onGoToVideo: () => void;
  /** Whether the Edit tab is the one on screen; a hidden tab loads no video and polls slowly. */
  active: boolean;
  /** The address it was opened with: `export` plays that export, `clip` adds that clip. */
  handoff?: Handoff | undefined;
};

const HISTORY_MAX = 20;
const CLIP_PAGE = 24;
/** Most cuts `edit.saveTimeline` takes. */
const MAX_CUTS = 24;
const NO_DERIVED: Project['derived'] = [];
/** The server sends a clip's `stillId` only while that still is in the library (src/edit-api.ts). */
const LIVE_STILLS = { has: (id: string) => id !== '' };
const FIELD_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [role="spinbutton"], [role="slider"], [role="listbox"], [role="combobox"], [aria-haspopup]';

export function EditPage({ onGoToVideo, active, handoff }: EditPageProps) {
  const { caps, onBay } = useCapabilities();
  const canMaster = caps.master;
  const utils = trpc.useUtils();
  const project = trpc.edit.project.useQuery(undefined, {
    refetchOnWindowFocus: false,
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      const busy =
        d.agent !== null ||
        d.derived.some((x) => x.status === 'pending') ||
        d.exports.some((x) => x.status === 'pending');
      // A hidden tab only checks now and then.
      return busy ? (active ? 4000 : 15000) : false;
    },
  });
  const data = project.data;
  // While the AI editor is changing the timeline, hand edits would be overwritten.
  const locked = !!data?.agent;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  // The timeline is edited locally and autosaved. `rev` counts local edits
  // that the server has not confirmed; at 0 the server copy wins, otherwise
  // only the fields the server owns (a cut's version) are taken from it.
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const rev = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = useRef(0);
  // The server's rev this draft came from, sent with every save so a stale draft
  // can't overwrite a newer cut, and that rev's cut. `reloads` counts the drafts
  // the server has refused; a save queued behind one of them is dropped with it.
  const base = useRef<{ rev: number; cut: string } | null>(null);
  const reloads = useRef(0);
  const conflicted = useRef(false);
  const [saveState, setSaveState] = useState<'idle' | 'unsaved' | 'saving' | 'saved' | 'error' | 'reloaded'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveStateRef = useRef(saveState);
  saveStateRef.current = saveState;
  const save = trpc.edit.saveTimeline.useMutation();
  const saveRef = useRef(save.mutateAsync);
  saveRef.current = save.mutateAsync;

  // Undo and redo: up to 20 timeline states each.
  const past = useRef<Draft[]>([]);
  const future = useRef<Draft[]>([]);
  const lastTag = useRef<{ tag: string; at: number } | null>(null);
  const [removed, setRemoved] = useState<{ cut: Cut; index: number } | null>(null);

  const adoptServer = useCallback((p: Project) => {
    // A poll that crossed a save says nothing new.
    if (base.current && p.rev < base.current.rev) return;
    const server = fromServer(p);
    const cut = cutOf(server);
    const cur = draftRef.current;
    if (rev.current === 0 || !cur) {
      // Someone else moved the cut, so an Undo from here would put an older draft over theirs.
      if (base.current && p.rev > base.current.rev && cut !== base.current.cut) {
        past.current = [];
        future.current = [];
        lastTag.current = null;
        setRemoved(null);
      }
      base.current = { rev: p.rev, cut };
      // An unchanged poll keeps the draft as it is, so nothing re-renders.
      if (cur && JSON.stringify(cur) === JSON.stringify(server)) return;
      draftRef.current = server;
      setDraft(server);
      return;
    }
    // Edits are waiting. A write that left the cut alone (music, memory, an export)
    // is no conflict for them, so they move on to that rev.
    if (base.current && (p.rev === base.current.rev || cut === base.current.cut)) base.current = { rev: p.rev, cut };
    const owned = new Map(p.timeline.map((t) => [t.key, t.versionId]));
    let changed = false;
    const items = cur.items.map((c) => {
      if (!owned.has(c.key) || owned.get(c.key) === c.versionId) return c;
      changed = true;
      return { ...c, versionId: owned.get(c.key) };
    });
    if (changed) {
      const next = { ...cur, items };
      draftRef.current = next;
      setDraft(next);
    }
  }, []);

  const prevAgent = useRef(false);
  useEffect(() => {
    if (!data) return;
    const working = !!data.agent;
    const ended = prevAgent.current && !working;
    prevAgent.current = working;
    if (ended && !timer.current && pendingSaves.current === 0) {
      // The editor changed the timeline: take it, even over an earlier failed save.
      rev.current = 0;
      past.current = [];
      future.current = [];
      setSaveError(null);
      setSaveState((st) => (st === 'error' ? 'idle' : st));
    }
    adoptServer(data);
  }, [data, adoptServer]);

  // Coming back to the tab brings in whatever finished while it was hidden.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) void utils.edit.project.invalidate();
    wasActive.current = active;
  }, [active, utils]);

  /** The server refused a save: someone else moved the cut. Their copy wins over everything local. */
  const reloadCut = useCallback(async () => {
    conflicted.current = true;
    reloads.current += 1;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    rev.current = 0;
    past.current = [];
    future.current = [];
    lastTag.current = null;
    setRemoved(null);
    setSaveError(null);
    await utils.edit.project.invalidate();
    const fresh = utils.edit.project.getData();
    if (fresh) adoptServer(fresh);
    // An edit made since then is on the reloaded cut, and has its own save coming.
    if (rev.current === 0) setSaveState('reloaded');
  }, [utils, adoptServer]);

  const doSave = useCallback(
    (d: Draft) => {
      const at = rev.current;
      const era = reloads.current;
      const run = async () => {
        if (era !== reloads.current) return;
        pendingSaves.current += 1;
        setSaveState('saving');
        setSaveError(null);
        try {
          const saved = await saveRef.current({
            items: d.items.map((c) => ({ ...c, versionId: c.versionId ?? undefined, colour: c.colour ?? undefined })),
            transition: d.transition,
            fadeSeconds: d.fadeSeconds,
            baseRev: base.current?.rev,
          });
          base.current = { rev: saved.rev, cut: cutOf(d) };
          if (rev.current === at) {
            rev.current = 0;
            setSaveState('saved');
            // Nothing newer is waiting: take the server's timeline, with whatever finished meanwhile.
            await utils.edit.project.invalidate();
            const fresh = utils.edit.project.getData();
            if (fresh && rev.current === 0) adoptServer(fresh);
          } else {
            setSaveState(timer.current ? 'unsaved' : 'saving');
          }
        } catch (err) {
          if (codeOf(err) === 'CONFLICT') {
            await reloadCut();
          } else {
            setSaveError(err instanceof Error && err.message ? err.message : 'The server did not answer.');
            setSaveState('error');
          }
        } finally {
          pendingSaves.current -= 1;
        }
      };
      const next = inflight.current.then(run, run);
      inflight.current = next;
      return next;
    },
    [utils, adoptServer, reloadCut]
  );

  /**
   * One of the page's own writes beside the cut (music, memory, a grade, an export).
   * It takes its turn with the saves, so neither lands on a rev the other has just
   * moved, and a save after it goes out on the rev it answered. A rev further on
   * than that means someone else wrote too, which the next save finds out. That
   * holds only for a write that moves the rev: one the server would answer with
   * the rev it already has (a preference the list holds) must not come through
   * here, or another writer's rev passes for this page's own.
   */
  const write = useCallback<PageWrite>((send) => {
    const turn = async () => {
      const answer = await send();
      if (base.current && answer.rev === base.current.rev + 1) base.current = { ...base.current, rev: answer.rev };
      return answer;
    };
    const next = inflight.current.then(turn, turn);
    const settled = () => undefined;
    inflight.current = next.then(settled, settled);
    return next;
  }, []);

  /**
   * Save whatever is waiting now; true when the server has the timeline as shown.
   * False too when this save was refused: what was asked for was meant for a cut
   * that has just been replaced.
   */
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    conflicted.current = false;
    await inflight.current;
    if (rev.current !== 0 && draftRef.current) await doSave(draftRef.current);
    return rev.current === 0 && !conflicted.current;
  }, [doSave]);

  const retrySave = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (draftRef.current) void doSave(draftRef.current);
  }, [doSave]);

  const commit = useCallback(
    (next: Draft, delay: number) => {
      draftRef.current = next;
      setDraft(next);
      rev.current += 1;
      setSaveState('unsaved');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void doSave(next);
      }, delay);
    },
    [doSave]
  );

  /** A local edit. Edits with the same `tag` in quick succession (a drag, typing) are one undo step. */
  const change = useCallback(
    (next: Draft, delay = 600, tag?: string) => {
      if (lockedRef.current) return;
      const prev = draftRef.current;
      if (prev) {
        const at = Date.now();
        const last = lastTag.current;
        if (!(tag && last && last.tag === tag && at - last.at < 1200)) {
          past.current = [...past.current.slice(-(HISTORY_MAX - 1)), prev];
        }
        lastTag.current = tag ? { tag, at } : null;
        future.current = [];
      }
      commit(next, delay);
    },
    [commit]
  );

  const titleCards = useTitleCards(data?.titles, write);
  const titlesPending = titleCards.pending;
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (timer.current || ['unsaved', 'saving', 'error'].includes(saveStateRef.current) || titlesPending()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [titlesPending]);

  const [selected, setSelected] = useState<string | null>(null);
  const [clipLimit, setClipLimit] = useState(CLIP_PAGE);

  const clips = useMemo(() => data?.clips ?? [], [data?.clips]);
  const items = draft?.items ?? [];
  const clipById = useMemo(() => new Map(clips.map((c) => [c.id, c])), [clips]);
  const serverByKey = useMemo(() => new Map((data?.timeline ?? []).map((t) => [t.key, t])), [data?.timeline]);
  const serverRef = useRef(serverByKey);
  serverRef.current = serverByKey;
  const secondsById = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of clips) m.set(c.id, c.seconds);
    for (const d of data?.derived ?? []) if (d.seconds) m.set(d.id, d.seconds);
    return m;
  }, [clips, data?.derived]);
  // Rows and lists show a small copy of the still; only the video poster is the full one.
  // A clip's own poster comes first; with neither, a plain frame.
  const thumbOf = useCallback(
    (clipId: string) => {
      const c = clipById.get(clipId);
      return c ? clipPosterUrl(c, LIVE_STILLS) : undefined;
    },
    [clipById]
  );
  const posterOf = useCallback(
    (clipId: string) => {
      const c = clipById.get(clipId);
      return c ? clipPosterUrl(c, LIVE_STILLS, 'view') : undefined;
    },
    [clipById]
  );
  const mediaOf = useCallback(
    (c: Cut) => (c.versionId ? libraryUrl('edit', c.versionId) : libraryUrl('clip', c.clipId)),
    []
  );
  const total = round(items.reduce((s, c) => s + c.duration, 0));
  // The room takes the cut on the preview (the picked one, else the first).
  const previewCut = items.find((c) => c.key === selected) ?? items[0];
  useAmbient(previewCut ? thumbOf(previewCut.clipId) : null);

  // Stable for the life of the page (they read the draft from its ref), so a
  // change to one cut re-renders that cut's row and nothing else in the list.
  const update = useCallback(
    (key: string, patch: Partial<Cut>, delay?: number) => {
      const d = draftRef.current;
      if (!d) return;
      change(
        { ...d, items: d.items.map((c) => (c.key === key ? { ...c, ...patch } : c)) },
        delay,
        `${key}:${Object.keys(patch).join(',')}`
      );
    },
    [change]
  );
  const colourAll = useCallback(
    (colour: CutColour | undefined) => {
      const d = draftRef.current;
      if (!d) return;
      change({ ...d, items: d.items.map((c) => ({ ...c, colour })) }, 400);
    },
    [change]
  );
  const move = useCallback(
    (key: string, by: -1 | 1) => {
      const d = draftRef.current;
      if (!d) return;
      const index = d.items.findIndex((c) => c.key === key);
      const to = index + by;
      if (index < 0 || to < 0 || to >= d.items.length) return;
      const next = [...d.items];
      const [cut] = next.splice(index, 1);
      next.splice(to, 0, cut!);
      change({ ...d, items: next }, 300);
    },
    [change]
  );
  const remove = useCallback(
    (key: string) => {
      const d = draftRef.current;
      if (!d) return;
      const index = d.items.findIndex((c) => c.key === key);
      if (index < 0) return;
      setRemoved({ cut: d.items[index]!, index });
      setSelected((s) => (s === key ? null : s));
      change({ ...d, items: d.items.filter((c) => c.key !== key) }, 300);
    },
    [change]
  );
  const toggle = useCallback((key: string) => setSelected((s) => (s === key ? null : key)), []);
  const undoRemove = () => {
    const d = draftRef.current;
    if (!d || !removed) return;
    setRemoved(null);
    // Something else has put it back: a second copy would save with the same key.
    if (d.items.some((c) => c.key === removed.cut.key)) return;
    const next = [...d.items];
    next.splice(Math.min(removed.index, next.length), 0, removed.cut);
    change({ ...d, items: next }, 300);
  };
  const add = useCallback(
    (clipId: string, seconds: number) => {
      const d = draftRef.current;
      if (!d) return;
      const cut: Cut = { key: crypto.randomUUID(), clipId, sourceStart: 0, duration: seconds };
      setSelected(cut.key);
      change({ ...d, items: [...d.items, cut] }, 300);
    },
    [change]
  );

  // Going back to an earlier state keeps each cut's version as the server has it now.
  const restore = useCallback(
    (target: Draft) => {
      const merged: Draft = {
        ...target,
        items: target.items.map((c) => {
          const sv = serverRef.current.get(c.key);
          return sv ? { ...c, versionId: sv.versionId } : c;
        }),
      };
      setRemoved(null);
      setSelected((sel) => (sel && merged.items.some((c) => c.key === sel) ? sel : null));
      lastTag.current = null;
      commit(merged, 300);
    },
    [commit]
  );
  const undo = useCallback(() => {
    const cur = draftRef.current;
    const prev = past.current.pop();
    if (!cur || !prev || lockedRef.current) {
      if (prev) past.current.push(prev);
      return;
    }
    future.current = [...future.current.slice(-(HISTORY_MAX - 1)), cur];
    restore(prev);
  }, [restore]);
  const redo = useCallback(() => {
    const cur = draftRef.current;
    const next = future.current.pop();
    if (!cur || !next || lockedRef.current) {
      if (next) future.current.push(next);
      return;
    }
    past.current = [...past.current.slice(-(HISTORY_MAX - 1)), cur];
    restore(next);
  }, [restore]);

  // The cut list in the inspector and the reel on the stage both take these keys.
  const onTimelineKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    // Keys from a dialog bubble through its portal; they are not timeline keys.
    if (!e.currentTarget.contains(el) || el.closest(FIELD_SELECTOR)) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && (key === 'z' || key === 'y')) {
      e.preventDefault();
      if (key === 'y' || e.shiftKey) redo();
      else undo();
      return;
    }
    // The cut the focus is in, else the selected one.
    const target = el.closest<HTMLElement>('[data-cutkey]')?.dataset.cutkey ?? selected;
    if (!target || mod) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (!lockedRef.current) remove(target);
      e.currentTarget.focus();
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      move(target, e.key === 'ArrowUp' ? -1 : 1);
    }
  };

  // A cut picked on the stage opens in the inspector. On a desktop the
  // inspector scrolls on its own, so bring the opened cut into view there.
  const cutsRef = useRef<HTMLOListElement>(null);
  const pickOnStage = (key: string) => {
    toggle(key);
    if (selected === key || window.matchMedia(PHONE_QUERY).matches) return;
    requestAnimationFrame(() =>
      cutsRef.current
        ?.querySelector<HTMLElement>(`[data-cutkey="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    );
  };

  // A handoff: the clip goes on the timeline unless it is there already, and the
  // export goes on the player, until a newer one starts. What it names may be newer
  // than the page's last answer, so it asks again and acts once on what comes back.
  const arrival = useArrival(handoff, active);
  const [askedExport, setAskedExport] = useState<{ id: string; latest: string | undefined } | null>(null);
  const [showExport, setShowExport] = useState(0);
  const arrivedAt = useRef(0);
  const arrivedClip = useRef<Handoff | null>(null);
  const arrivedExport = useRef<Handoff | null>(null);
  useEffect(() => {
    if (!arrival?.params['clip'] && !arrival?.params['export']) return;
    arrivedAt.current = Date.now();
    void utils.edit.project.invalidate();
  }, [arrival, utils]);
  useEffect(() => {
    const clipId = arrival?.params['clip'];
    const d = draftRef.current;
    if (!arrival || !clipId || !d || locked || arrivedClip.current === arrival) return;
    if (project.dataUpdatedAt < arrivedAt.current) return;
    arrivedClip.current = arrival;
    clearArrivedClip(clipId);
    if (d.items.some((c) => c.clipId === clipId) || d.items.length >= MAX_CUTS) return;
    add(clipId, secondsById.get(clipId) ?? 5);
  }, [arrival, draft, locked, project.dataUpdatedAt, secondsById, add]);
  useEffect(() => {
    const exportId = arrival?.params['export'];
    if (!arrival || !exportId || !data?.exports.some((e) => e.id === exportId) || arrivedExport.current === arrival) return;
    arrivedExport.current = arrival;
    setAskedExport({ id: exportId, latest: data.exports[0]?.id });
    setShowExport((n) => n + 1);
  }, [arrival, data]);

  const [exporting, setExporting] = useState(false);
  const [deliverables, setDeliverables] = useState<DeliverableId[]>(['h264']);
  const exportDone = {
    // Stays "pending" until the refetch shows the running export, so a second click can't slip in.
    onSuccess: () => utils.edit.project.invalidate(),
    onError: () => void utils.edit.project.invalidate(),
  };
  const exportFilm = trpc.edit.exportFilm.useMutation(exportDone);
  const exportMaster = trpc.edit.exportMaster.useMutation(exportDone);
  const conform = trpc.edit.conformFilmcraft.useMutation(exportDone);
  const sending = exporting || exportFilm.isPending || exportMaster.isPending || conform.isPending;
  // A master takes the bed the server has, so one still on its way would be left out.
  const [musicUploading, setMusicUploading] = useState(false);
  const [drawingCards, setDrawingCards] = useState(false);
  const [cardsError, setCardsError] = useState<Error | null>(null);
  /** Draws the title cards in `titles` and keeps them with the server, for `exportMaster`. */
  const drawCards = async (titles: Project['titles']) => {
    const { head, tail } = titles ?? {};
    if (!head && !tail) return undefined;
    setDrawingCards(true);
    try {
      const first = draftRef.current?.items[0];
      const sizes = cardSizes((first ? await videoSize(mediaOf(first)) : null)?.width);
      const vertical = deliverables.includes('vertical');
      return {
        ...(head ? { head: await drawCard(head, sizes, vertical) } : {}),
        ...(tail ? { tail: await drawCard(tail, sizes, vertical) } : {}),
      };
    } catch (err) {
      setCardsError(err instanceof Error ? err : new Error('The title cards were not drawn. Try again.'));
      throw err;
    } finally {
      setDrawingCards(false);
    }
  };
  const runExport = async () => {
    if (sending || musicUploading) return;
    setExporting(true);
    setCardsError(null);
    try {
      // A change still on its way to the server is on the cards too; the section says when it can't go.
      if (canMaster && !(await titleCards.save())) return;
      if (!(await flush())) return;
      if (canMaster) {
        await write(async () => {
          // The bed as the server has it once the writes ahead of this one (a Remove,
          // a new file) have landed, not as the page last heard: the server masters
          // whatever key it is handed, so a stale one would put a removed bed back.
          const fresh = await utils.edit.project.fetch().catch(() => undefined);
          const music = fresh ? fresh.music : data?.music;
          const cards = await drawCards(fresh ? fresh.titles : data?.titles);
          return exportMaster.mutateAsync({ deliverables, musicAssetKey: music?.assetKey ?? null, ...(cards ? { cards } : {}) });
        });
      } else {
        await write(() => exportFilm.mutateAsync());
      }
    } catch {
      // The notice under the button shows the error.
    } finally {
      setExporting(false);
    }
  };
  // A second press lands while the first still waits on the save, before `sending` shows.
  const conformGuard = useInFlight();
  const runConform = async () => {
    if (sending || musicUploading || !conformGuard.start()) return;
    setExporting(true);
    try {
      if (!(await flush())) return;
      await write(() => conform.mutateAsync({ output: 'mp4' }));
    } catch {
      // The notice under the button shows the error.
    } finally {
      setExporting(false);
      conformGuard.end();
    }
  };
  const anyPending = data?.timeline.some((t) => t.pendingId) ?? false;
  const latestExport = data?.exports[0];
  const shownExport =
    (askedExport?.latest === latestExport?.id ? data?.exports.find((e) => e.id === askedExport?.id) : undefined) ?? latestExport;
  // The finished export against the timeline as it is now, from what the
  // export recorded (no new query): how many of the timeline's cuts it has as
  // they are (same place, length and look). Null while it matches.
  const exportStale = useMemo(() => {
    if (!draft || shownExport?.status !== 'succeeded' || !items.length) return null;
    // A title card holds its place in `grades` for the film's timing; a row with a key is a cut.
    const grades = (shownExport.grades ?? []).filter((g) => g.key);
    const total = items.length;
    const again = canMaster ? 'Master it again.' : 'Export again.';
    if (!grades.length) {
      if (shownExport.cuts === total) return null;
      return `Exported before your last changes: ${Math.min(shownExport.cuts, total)} of ${total} cuts. ${again}`;
    }
    const matched = items.filter((c, i) => {
      const g = grades[i];
      return !!g && g.key === c.key && round(g.seconds) === round(c.duration) && sameColour(g.colour, c.colour);
    }).length;
    if (matched < total) return `Exported before your last changes: ${matched} of ${total} cuts. ${again}`;
    if (grades.length !== total) {
      return `Exported before your last changes: it has ${grades.length} cuts, the timeline ${total}. ${again}`;
    }
    const transitionChanged =
      total > 1 &&
      (shownExport.transition !== draft.transition ||
        (draft.transition === 'fade' && round(shownExport.fadeSeconds ?? 0.5) !== round(draft.fadeSeconds)));
    return transitionChanged ? `Exported before your last changes to the transitions. ${again}` : null;
  }, [draft, items, shownExport, canMaster]);
  // A conform is a row of its own, so the export on the player does not push the other
  // kind off the list. Masters first, whichever is shown, so no row moves under a press.
  const beside = data?.exports.find((e) => e.status === 'succeeded' && e.deliverables && isConform(e) !== isConform(shownExport));
  const finished = [shownExport, beside]
    .filter((job): job is ExportRow => !!job?.deliverables)
    .sort((a, b) => Number(isConform(a)) - Number(isConform(b)))
    .flatMap((job) => (job.deliverables ?? []).map((file) => ({ job, file })));
  // A finished row puts its file on the player, through the handoff's own path.
  const [pickedFile, setPickedFile] = useState<string | undefined>(undefined);
  const watch = (job: ExportRow, file: Deliverable) => {
    setAskedExport({ id: job.id, latest: latestExport?.id });
    setPickedFile(file.finalId);
    setShowExport((n) => n + 1);
  };
  const framing = canMaster && deliverables.includes('vertical');
  const exportBlocked = !items.length || anyPending || musicUploading || latestExport?.status === 'pending' || locked;

  const inspector = (
    <>
      <PageHeader
        title="Edit the film"
        description="Lay your clips on a timeline, trim and grade them, and talk to the AI editor to shape the cut."
      />
      <Section step={1} title="Your clips" description="Add finished clips from the Video tab to the timeline.">
        {project.isLoading ? (
          <SkeletonBlock height={140} />
        ) : project.error ? (
          <RunwayErrorNotice error={project.error} modelName="your edit" onRetry={() => void project.refetch()} />
        ) : clips.length === 0 ? (
          <EmptyState
            title="No clips yet"
            hint="Make a video from one of your stills first, then come back to cut it into a film."
            action={<Button onPress={onGoToVideo}>Go to Video</Button>}
          />
        ) : (
          <ul className={styles.clipGrid}>
            {clips.slice(0, clipLimit).map((c) => (
              <ClipCard
                key={c.id}
                title={c.label || 'Clip'}
                seconds={c.seconds}
                poster={thumbOf(c.id)}
                src={libraryUrl('clip', c.id)}
                addLabel={`Add to timeline: ${c.label}`}
                disabled={items.length >= MAX_CUTS || locked}
                onAdd={() => add(c.id, c.seconds)}
              />
            ))}
            {clips.length > clipLimit && (
              <li className={styles.showMore}>
                <Button size="sm" variant="ghost" onPress={() => setClipLimit((n) => n + CLIP_PAGE)}>
                  {`Show more (${clips.length - clipLimit} more)`}
                </Button>
              </li>
            )}
          </ul>
        )}
      </Section>

      <Section
        step={2}
        title="Timeline"
        description={
          items.length
            ? `${items.length} ${items.length === 1 ? 'cut' : 'cuts'}, ${total}s. Pick a cut to trim, grade or edit it.`
            : undefined
        }
      >
        {!draft ? (
          <SkeletonText rows={3} />
        ) : items.length === 0 ? (
          <EmptyState
            title="The timeline is empty"
            hint="Add a clip above, or ask the AI editor to cut a film for you."
          />
        ) : (
          <>
            {locked && (
              <Text size="sm" tone="muted" as="p" className={styles.lockNote}>
                The AI editor is changing the timeline.
              </Text>
            )}
            <div tabIndex={-1} className={styles.timelineBox} onKeyDown={onTimelineKey}>
              <ol ref={cutsRef} className={styles.cuts}>
                {items.map((c, i) => (
                  <CutRow
                    key={c.key}
                    index={i}
                    count={items.length}
                    cut={c}
                    server={serverByKey.get(c.key)}
                    notes={data?.notes[c.key] ?? NO_NOTES}
                    label={clipById.get(c.clipId)?.label ?? 'A clip no longer in your library'}
                    poster={thumbOf(c.clipId)}
                    frame={thumbOf(c.clipId) ? undefined : `${mediaOf(c)}#t=${c.sourceStart + 0.05}`}
                    media={mediaOf(c)}
                    length={secondsById.get(c.versionId ?? c.clipId) ?? 5}
                    currentGrade={currentGrade(data, c)}
                    derived={data?.derived ?? NO_DERIVED}
                    locked={locked}
                    open={selected === c.key}
                    showFrame={framing}
                    onToggle={toggle}
                    onChange={update}
                    onColourAll={colourAll}
                    onMove={move}
                    onRemove={remove}
                    flush={flush}
                    write={write}
                  />
                ))}
              </ol>
              <Text size="sm" tone="muted" as="p" className={styles.shortcutHint}>
                Shortcuts with the timeline focused: Delete removes the cut, Ctrl+Z undoes, Ctrl+Shift+Z redoes, Alt+Up and Alt+Down move it.
              </Text>
            </div>
          </>
        )}
        {removed && (
          <div className={styles.undo}>
            <Text size="sm" tone="secondary">
              Cut removed.
            </Text>
            <Button size="sm" variant="ghost" icon={<Undo2 size={14} />} disabled={locked} onPress={undoRemove}>
              Undo
            </Button>
          </div>
        )}
      </Section>

      <Section step={3} title="Transitions">
        {draft && (
          <div className={studio.stack}>
            <FilterChips
              label="Transition between cuts"
              options={[
                { id: 'hard', name: 'Hard cuts' },
                { id: 'fade', name: 'Fades' },
              ]}
              value={draft.transition}
              onChange={(v) => change({ ...draft, transition: v as Draft['transition'] }, 300)}
            />
            {draft.transition === 'fade' && (
              <div className={styles.fadeRow}>
                {/* The field shows the value snapped to `min + n × step`, so the step must land on
                    every length the app stores: the server keeps hundredths (the AI editor can set
                    0.33), so 0.01 does, and it takes 0.1 to 4.9. */}
                <NumberInput
                  label="Fade length"
                  unit="s"
                  value={draft.fadeSeconds}
                  min={0.1}
                  max={4.9}
                  step={0.01}
                  disabled={locked}
                  onChange={(v) => change({ ...draft, fadeSeconds: v }, 600, 'fade')}
                />
              </div>
            )}
          </div>
        )}
      </Section>

      <Section
        step={4}
        title="Music"
        description={
          canMaster
            ? 'A bed under the film. It plays under the timeline preview and goes into the master.'
            : 'A bed under the film. It plays under the timeline preview and goes into the graded download; the exported film stays silent.'
        }
      >
        {project.isLoading ? <SkeletonText rows={2} /> : <MusicRow music={data?.music} write={write} onUploading={setMusicUploading} />}
      </Section>

      {canMaster && (
        <Section
          step={5}
          title="Title cards"
          description="A title at the head and an end card at the tail, drawn in the film's own type on black."
        >
          <TitleCards cards={titleCards.cards} onChange={titleCards.change} error={titleCards.error} />
        </Section>
      )}

      {(canMaster || finished.length > 0) && (
        <Section
          step={canMaster ? 6 : 5}
          title="Master"
          description="One finished file per format, with the music mixed in and the sound mastered."
        >
          <div className={studio.stack}>
            {canMaster && (
              <div role="group" aria-label="Files to master" className={styles.checks}>
                {DELIVERABLE_IDS.map((id) => (
                  <Checkbox
                    key={id}
                    className={styles.check}
                    isSelected={deliverables.includes(id)}
                    onChange={(on) => setDeliverables(DELIVERABLE_IDS.filter((d) => (d === id ? on : deliverables.includes(d))))}
                  >
                    <span className={styles.checkBox} aria-hidden>
                      <Check size={14} />
                    </span>
                    {DELIVERABLE_LABELS[id]}
                  </Checkbox>
                ))}
              </div>
            )}
            {framing && (
              <Text size="sm" tone="muted" as="p">
                A 9:16 cut shows a window of each clip, never more than the clip holds. Set the window on each cut in the timeline; a clip already taller than 9:16 is fitted on black.
              </Text>
            )}
            {caps.desktop && (
              <FilmcraftAction
                active={active}
                disabled={exportBlocked}
                loading={conform.isPending}
                error={conform.error}
                onConform={() => void runConform()}
              />
            )}
            {finished.length > 0 && (
              <ul aria-label="Finished files" className={styles.deliverables}>
                {finished.map(({ job, file }) => (
                  <DeliverableRow key={`${job.id}:${file.id}`} job={job} file={file} onWatch={() => watch(job, file)} />
                ))}
              </ul>
            )}
          </div>
        </Section>
      )}

      <Section title="AI editor" description="Tell it what you want, the way you would brief an editor. It changes the timeline for you.">
        <EditorChat data={data} flush={flush} write={write} loading={project.isLoading} />
      </Section>
      <Section title="Memory" description="Standing preferences the editor follows in every session.">
        <Memory memory={data?.memory} write={write} loading={project.isLoading} />
      </Section>
    </>
  );

  const footer = (
    <>
      <Button
        variant="primary"
        size="lg"
        icon={<Film size={18} />}
        loading={sending}
        disabled={exportBlocked || (canMaster && !deliverables.length)}
        onPress={() => void runExport()}
      >
        {canMaster
          ? drawingCards
            ? 'Drawing the title cards…'
            : latestExport?.status === 'pending'
              ? isConform(latestExport) ? 'Conforming…' : 'Mastering…'
              : 'Master'
          : latestExport?.status === 'pending' ? 'Exporting…' : 'Export film'}
      </Button>
      <RunwayErrorNotice
        error={canMaster ? (cardsError ?? exportMaster.error) : exportFilm.error}
        modelName={canMaster ? 'the master' : 'the export'}
        onRetry={() => void runExport()}
      />
      <CostLine
        summary={
          <>
            <SaveNote state={saveState} error={saveError} onRetry={retrySave} />
            {anyPending
              ? ' A cut is still re-rendering; export once it is done.'
              : musicUploading
                ? ' The music is still uploading; export once it is in.'
                : ` ${total}s, ${draft?.transition === 'fade' ? `${draft.fadeSeconds}s fades` : 'hard cuts'}. ${onBay ? 'Exporting runs on your own Runway credits.' : canMaster ? 'Mastering runs on this computer.' : 'Exporting runs on this computer.'}${!canMaster && (deliverables.includes('vertical') || titleCards.any) ? ' Nothing here calls a model.' : ''}`}
          </>
        }
      />
    </>
  );

  // The film at a glance: one card per cut, as wide as its length, with the
  // transition between them. It takes the same keys as the cut list.
  const reel =
    items.length > 0 ? (
      <div tabIndex={-1} className={styles.reel} onKeyDown={onTimelineKey}>
        <ol className={styles.strip} aria-label="Timeline overview">
          {items.map((c, i) => {
            const sv = serverByKey.get(c.key);
            const pending = !!sv?.pendingId;
            const failed = !pending && !!sv?.lastError;
            const thumb = thumbOf(c.clipId);
            const steps = colourSteps(c.colour);
            return (
              <li
                key={c.key}
                className={styles.segmentItem}
                data-cutkey={c.key}
                style={{ ['--seconds' as string]: Math.max(0.5, c.duration) }}
              >
                {i > 0 && (
                  <span className={styles.join} data-fade={draft?.transition === 'fade' || undefined} aria-hidden>
                    {draft?.transition === 'fade' && (
                      <>
                        <Blend size={14} />
                        {`${draft.fadeSeconds}s`}
                      </>
                    )}
                  </span>
                )}
                <button
                  type="button"
                  className={styles.segment}
                  data-selected={selected === c.key || undefined}
                  data-pending={pending || undefined}
                  data-failed={failed || undefined}
                  onClick={() => pickOnStage(c.key)}
                  aria-pressed={selected === c.key}
                  aria-label={`Cut ${i + 1}, ${round(c.duration)} seconds${pending ? ', re-rendering' : failed ? ', the last change failed' : ''}`}
                >
                  {thumb ? (
                    <img
                      src={thumb}
                      alt=""
                      className={styles.segmentThumb}
                      loading="lazy"
                      decoding="async"
                      style={steps ? { filter: colourCss(steps).filter } : undefined}
                    />
                  ) : (
                    // No poster and no still: the cut's own frame at its in point.
                    <video
                      src={`${mediaOf(c)}#t=${c.sourceStart + 0.05}`}
                      className={styles.segmentThumb}
                      muted
                      playsInline
                      preload="metadata"
                      tabIndex={-1}
                      aria-hidden
                      style={steps ? { filter: colourCss(steps).filter } : undefined}
                    />
                  )}
                  <span className={styles.segmentNumber}>{failed ? `Failed: ${i + 1}` : i + 1}</span>
                  <span className={styles.segmentTime}>{round(c.duration)}s</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    ) : undefined;

  return (
    <Workspace
      page="edit"
      canvasState="free"
      canvas={
        <Player
          active={active}
          items={items}
          selected={selected}
          mediaOf={mediaOf}
          posterOf={posterOf}
          shownExport={shownExport}
          shownFile={pickedFile}
          showExport={showExport}
          music={data?.music}
          stale={exportStale}
          write={write}
        />
      }
      inspector={inspector}
      footer={footer}
      strip={reel}
      stripSize="timeline"
      stripLabel="Timeline"
    />
  );
}

/** A built-in look as the export recorded it and as the cut has it now. */
function sameColour(a: CutColour | undefined, b: CutColour | undefined): boolean {
  if (isNeutral(a) || isNeutral(b)) return isNeutral(a) && isNeutral(b);
  return (Object.keys(NEUTRAL_COLOUR) as (keyof CutColour)[]).every((k) => a![k] === b![k]);
}

/**
 * One clip on offer (DESIGN, clip cards): its poster with a play button; the
 * video loads only once that is pressed, then plays with its own controls.
 */
function ClipCard({
  title,
  seconds,
  poster,
  src,
  addLabel,
  disabled,
  onAdd,
}: {
  title: string;
  seconds: number;
  poster: string | undefined;
  src: string;
  addLabel: string;
  disabled: boolean;
  onAdd: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  return (
    <li className={styles.clipCard}>
      <div className={styles.clipMedia}>
        {playing ? (
          <video src={src} poster={poster} controls autoPlay playsInline muted preload="auto" className={styles.clipVideo} />
        ) : (
          <>
            {poster ? (
              <img src={poster} alt="" className={styles.clipThumb} loading="lazy" decoding="async" />
            ) : (
              <span className={styles.clipThumb} />
            )}
            <button type="button" className={styles.clipPlay} aria-label={`Play ${title}`} onClick={() => setPlaying(true)}>
              <Play size={18} aria-hidden />
            </button>
          </>
        )}
      </div>
      <div className={styles.clipFoot}>
        <span className={styles.clipMeta}>
          <Text size="sm" className={styles.clipLabel}>
            {title}
          </Text>
          <Text size="sm" tone="muted">
            {seconds}s
          </Text>
        </span>
        <Button size="sm" variant="ghost" icon={<Plus size={14} />} aria-label={addLabel} onPress={onAdd} disabled={disabled} />
      </div>
    </li>
  );
}

function currentGrade(data: Project | undefined, c: Cut): string {
  if (!data || !c.versionId) return 'none';
  const chain = versionChain(data.derived, { ...c, versionId: c.versionId });
  const last = chain[chain.length - 1];
  return last?.kind === 'grade' ? (last.gradeId ?? 'none') : 'none';
}

function SaveNote({ state, error, onRetry }: { state: string; error: string | null; onRetry: () => void }) {
  if (state === 'saving' || state === 'unsaved') return <>Saving…</>;
  if (state === 'saved') return <>Saved.</>;
  if (state === 'reloaded') return <span role="status">The cut changed elsewhere; reloaded.</span>;
  if (state === 'error')
    return (
      <>
        Not saved: {error ?? 'the server did not answer.'}{' '}
        <button type="button" className={styles.inlineLink} onClick={onRetry}>
          Try again
        </button>
      </>
    );
  return null;
}

type CutRowProps = {
  index: number;
  count: number;
  cut: Cut;
  server: Project['timeline'][number] | undefined;
  notes: string[];
  label: string;
  poster: string | undefined;
  /** With no poster: the cut's own media at its in point, shown as its frame. */
  frame?: string | undefined;
  /** The file the cut plays. */
  media: string;
  length: number;
  currentGrade: string;
  derived: Project['derived'];
  locked: boolean;
  open: boolean;
  /** A 9:16 file is on the way out, so an open cut sets its window. */
  showFrame: boolean;
  onToggle: (key: string) => void;
  onChange: (key: string, patch: Partial<Cut>, delay?: number) => void;
  onColourAll: (colour: CutColour | undefined) => void;
  onMove: (key: string, by: -1 | 1) => void;
  onRemove: (key: string) => void;
  flush: () => Promise<boolean>;
  write: PageWrite;
};

/** One cut on the timeline. Memoised: its callbacks are stable, so editing
 * one cut re-renders only that row. */
const CutRow = memo(function CutRow({
  index,
  count,
  cut,
  server,
  notes,
  label,
  poster,
  frame,
  media,
  length,
  currentGrade,
  derived,
  locked,
  open,
  showFrame,
  onToggle,
  onChange,
  onColourAll,
  onMove,
  onRemove,
  flush,
  write,
}: CutRowProps) {
  const { caps, providerNote } = useCapabilities();
  const alephOff = caps.aleph ? null : 'Grades and AI edits need the Runway API provider.';
  const alephRate = providerNote('workflow_aleph_2');
  const utils = trpc.useUtils();
  const [instruction, setInstruction] = useState('');
  const [mode, setMode] = useState(currentGrade !== 'none' ? 'aleph' : 'builtin');
  const pending = !!server?.pendingId;
  const [confirmGrade, setConfirmGrade] = useState<string | null>(null);
  // Returned, so a button stays busy until the refetch shows the result.
  const done = () => utils.edit.project.invalidate();
  const grade = trpc.edit.gradeClip.useMutation({
    onSuccess: () => {
      setConfirmGrade(null);
      return done();
    },
  });
  const edit = trpc.edit.aiEditClip.useMutation({
    onSuccess: () => {
      setInstruction('');
      return done();
    },
  });
  const setVersion = trpc.edit.setVersion.useMutation({ onSuccess: done });
  // The notice under the select shows an error.
  const pickVersion = (versionId: string | null) =>
    void write(() => setVersion.mutateAsync({ key: cut.key, versionId })).catch(() => undefined);
  // The original plus every finished copy of this cut, newest first, so any can be picked again.
  const versions = useMemo(() => {
    const copies = derived.filter((d) => d.status === 'succeeded' && rootClipId(derived, d.id) === cut.clipId);
    return [
      { id: 'original', name: 'Original clip', hint: 'Before any grade or edit' },
      ...copies.map((d) => ({
        id: d.id,
        name: derivedLabel(d),
        hint: `${d.seconds}s, ${new Date(d.createdAt).toLocaleString()}`,
      })),
    ];
  }, [derived, cut.clipId]);
  const canPick = versions.length > 1 || !!cut.versionId || pending;
  const out = round(cut.sourceStart + cut.duration);
  const colour = cut.colour ?? NEUTRAL_COLOUR;
  const graded = !isNeutral(cut.colour);
  const thumbSteps = colourSteps(cut.colour);
  const setColour = (patch: Partial<CutColour>) => onChange(cut.key, { colour: { ...colour, ...patch } }, 800);
  const clipSize = useClipSize(media, open && showFrame);
  // Both re-render the clip on Aleph (billed): a double-click's second press
  // lands while the first still waits on the save, before `isPending` shows.
  const alephGuard = useInFlight();
  const runEdit = async () => {
    if (alephOff || instruction.trim().length < 3 || !alephGuard.start()) return;
    try {
      if (!(await flush())) return;
      await write(() => edit.mutateAsync({ key: cut.key, instruction }));
    } catch {
      // The notice under the field shows the error.
    } finally {
      alephGuard.end();
    }
  };
  const lookName = GRADES.find((g) => g.id === colour.gradeId)?.name;
  const runGrade = async (id: string) => {
    if (alephOff || !alephGuard.start()) return;
    try {
      if (!(await flush())) {
        setConfirmGrade(null);
        return;
      }
      await write(() => grade.mutateAsync({ key: cut.key, gradeId: id as (typeof GRADES)[number]['id'] }));
    } catch {
      // The notice under the select shows the error.
    } finally {
      alephGuard.end();
    }
  };

  return (
    <li
      className={styles.cut}
      data-open={open || undefined}
      data-pending={pending || undefined}
      data-failed={(!pending && !!server?.lastError) || undefined}
      data-cutkey={cut.key}
    >
      <div className={styles.cutHead}>
        <button type="button" className={styles.cutMain} onClick={() => onToggle(cut.key)} aria-expanded={open}>
          <span className={styles.cutNumber}>{index + 1}</span>
          {poster ? (
            <img
              src={poster}
              alt=""
              className={styles.cutThumb}
              loading="lazy"
              decoding="async"
              style={thumbSteps ? { filter: colourCss(thumbSteps).filter } : undefined}
            />
          ) : frame ? (
            <video
              src={frame}
              className={styles.cutThumb}
              muted
              playsInline
              preload="metadata"
              tabIndex={-1}
              aria-hidden
              style={thumbSteps ? { filter: colourCss(thumbSteps).filter } : undefined}
            />
          ) : (
            <span className={styles.cutThumb} />
          )}
          <span className={styles.cutText}>
            <span className={styles.cutLabel}>{label}</span>
            <span className={styles.cutSub}>
              {cut.sourceStart}s to {out}s ({round(cut.duration)}s)
              {graded ? `, ${colour.gradeId !== 'none' && lookName ? lookName : 'adjusted'} look` : ''}
              {notes.length ? `, ${notes.join(', ')}` : ''}
            </span>
          </span>
        </button>
        <div className={styles.cutTools}>
          <Button size="sm" variant="ghost" icon={<ArrowUp size={14} />} aria-label={`Move cut ${index + 1} earlier`} disabled={index === 0 || locked} onPress={() => onMove(cut.key, -1)} />
          <Button size="sm" variant="ghost" icon={<ArrowDown size={14} />} aria-label={`Move cut ${index + 1} later`} disabled={index === count - 1 || locked} onPress={() => onMove(cut.key, 1)} />
          <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label={`Remove cut ${index + 1}`} disabled={locked} onPress={() => onRemove(cut.key)} />
        </div>
      </div>
      {pending && (
        <Text size="sm" tone="secondary" as="p" className={styles.cutStatus}>
          <span className={styles.pulse} aria-hidden />
          Re-rendering this cut. This takes a few minutes; the timeline keeps the old version until it is done.
          <Button
            size="sm"
            variant="ghost"
            loading={setVersion.isPending}
            onPress={() => pickVersion(null)}
          >
            Use the original
          </Button>
        </Text>
      )}
      {server?.lastError && !pending && (
        <Alert tone="error" title="The last change to this cut failed" className={styles.cutAlert}>
          {server.lastError}
        </Alert>
      )}
      {open && (
        <div className={styles.cutBody}>
          <div className={styles.trimRow}>
            {/* Hundredths, like the server keeps (`round`): a coarser step snaps a stored 0.25 to
                0.3 on screen, and Out's grid would hang off In's moving minimum. */}
            <NumberInput
              label="In"
              unit="s"
              value={cut.sourceStart}
              min={0}
              max={round(Math.max(0, length - 0.5))}
              step={0.01}
              disabled={locked}
              onChange={(v) => {
                const start = Math.min(v, length - 0.5);
                onChange(cut.key, { sourceStart: round(start), duration: round(Math.max(0.5, Math.min(out, length) - start)) });
              }}
            />
            <NumberInput
              label="Out"
              unit="s"
              value={out}
              min={round(cut.sourceStart + 0.5)}
              max={length}
              step={0.01}
              disabled={locked}
              onChange={(v) => onChange(cut.key, { duration: round(Math.max(0.5, Math.min(v, length) - cut.sourceStart)) })}
            />
            <Text size="sm" tone="muted" className={styles.trimNote}>
              of {length}s
            </Text>
          </div>

          <div className={styles.gradeBlock}>
            <FilterChips label="Colour grade" options={GRADE_MODES} value={mode} onChange={setMode} />
            {mode === 'builtin' ? (
              <>
                <div className={styles.gradePanel}>
                  <div className={`${styles.gradeWide} ${styles.lookRow}`}>
                    <Select
                      label="Look"
                      options={LOOK_OPTIONS}
                      value={colour.gradeId}
                      disabled={locked}
                      onChange={(id) => onChange(cut.key, { colour: { ...colour, gradeId: id as CutColour['gradeId'] } }, 400)}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Download size={14} />}
                      disabled={!graded}
                      onPress={() => downloadLut(colour, `${colour.gradeId !== 'none' && lookName ? lookName : 'Adjusted'} grade`)}
                    >
                      Download LUT
                    </Button>
                  </div>
                  <Slider
                    label="Strength"
                    value={colour.strength}
                    onChange={(v) => setColour({ strength: v })}
                    format={(v) => `${Math.round(v * 100)}%`}
                    disabled={colour.gradeId === 'none' || locked}
                  />
                  {ADJUSTMENTS.map((a) => (
                    <Slider
                      key={a.id}
                      label={a.label}
                      value={colour[a.id]}
                      min={-1}
                      max={1}
                      disabled={locked}
                      onChange={(v) => setColour({ [a.id]: v })}
                      format={signed}
                    />
                  ))}
                </div>
                <div className={styles.gradeActions}>
                  <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} disabled={!cut.colour || locked} onPress={() => onChange(cut.key, { colour: undefined }, 300)}>
                    Reset
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Copy size={14} />} disabled={count < 2 || locked} onPress={() => onColourAll(cut.colour)}>
                    Apply to every cut
                  </Button>
                </div>
                <Text size="sm" tone="muted" as="p">
                  Instant and free: the preview shows it as you drag, and it rides along with the export.
                </Text>
              </>
            ) : (
              <>
                <Select
                  label="Aleph 2.0 grade"
                  options={GRADE_OPTIONS}
                  value={currentGrade}
                  disabled={pending || grade.isPending || locked || alephOff !== null}
                  onChange={(id) => {
                    if (id === currentGrade) return;
                    // Taking a grade off leaves the cut on an earlier copy: ask first.
                    if (id === 'none' && currentGrade !== 'none') setConfirmGrade(id);
                    else void runGrade(id);
                  }}
                />
                <RunwayErrorNotice error={grade.error} modelName="Aleph 2.0" />
                <Text size="sm" tone="muted" as="p">
                  {alephOff ?? 'Re-renders the clip with the grade baked in. It takes a few minutes and spends credits.'}
                </Text>
              </>
            )}
          </div>

          <div className={styles.editRow}>
            <TextInput
              label="Change something in this cut"
              placeholder="Light rain, wet paving, overcast sky"
              value={instruction}
              onChange={setInstruction}
              maxLength={600}
              disabled={pending || locked || alephOff !== null}
              onPressEnter={() => void runEdit()}
            />
            <BlockedTip message={alephOff}>
              <Button
                icon={<WandSparkles size={16} />}
                loading={edit.isPending}
                disabled={pending || locked || instruction.trim().length < 3 || alephOff !== null}
                onPress={() => void runEdit()}
              >
                Edit
              </Button>
            </BlockedTip>
          </div>
          <RunwayErrorNotice error={edit.error} modelName="Aleph 2.0" onRetry={() => void runEdit()} />
          <div className={styles.cutFoot}>
            <Text size="sm" tone="muted">
              {alephOff ?? 'Edits and Aleph grades re-render the whole clip with Aleph 2.0, which costs more credits than a still.'}
              {!alephOff && alephRate ? ` ${alephRate}` : ''}
            </Text>
          </div>
          {canPick && (
            <div className={styles.versionRow}>
              <Select
                label="Version of this cut"
                options={versions}
                value={cut.versionId && versions.some((v) => v.id === cut.versionId) ? cut.versionId : 'original'}
                disabled={locked || setVersion.isPending}
                onChange={async (id) => {
                  if (id === (cut.versionId ?? 'original') && !pending) return;
                  if (!(await flush())) return;
                  pickVersion(id === 'original' ? null : id);
                }}
              />
              {setVersion.error && <Alert tone="error" title="The version was not changed">{setVersion.error.message}</Alert>}
              <Text size="sm" tone="muted" as="p">
                Every finished grade and edit is kept, so you can switch back to any of them.
              </Text>
            </div>
          )}
          {showFrame && (
            <div className={styles.versionRow}>
              <Text size="sm" tone="secondary" as="p">
                Its window in the 9:16 file
              </Text>
              <FrameWindow
                poster={poster ?? null}
                width={clipSize.width}
                height={clipSize.height}
                value={cut.frame ?? verticalFrame(clipSize.width, clipSize.height)}
                onChange={(next) => onChange(cut.key, { frame: next }, 400)}
                disabled={locked}
              />
            </div>
          )}
          <ConfirmDialog
            isOpen={confirmGrade !== null}
            title="Take this grade off?"
            confirmLabel="Remove grade"
            loading={grade.isPending}
            error={grade.error?.message}
            onConfirm={() => confirmGrade && void runGrade(confirmGrade)}
            onCancel={() => setConfirmGrade(null)}
          >
            The cut goes back to the copy before the grade. The graded copy is kept under "Version of this cut", so you can pick it again.
          </ConfirmDialog>
        </div>
      )}
    </li>
  );
});

/** A player with its built-in grade: the filter on the video, the white
 * balance and lifted blacks as layers over it (src/colour.ts `colourCss`). */
function Graded({
  colour,
  hidden,
  portrait,
  children,
}: {
  colour: CutColour | undefined;
  hidden?: boolean;
  /** A 9:16 file: the block takes the picture's shape, so the grade's layers stop at its edges. */
  portrait?: boolean;
  children: ReactElement<{ style?: CSSProperties }>;
}) {
  const steps = colourSteps(colour);
  const css = steps ? colourCss(steps) : null;
  return (
    <div className={styles.graded} data-picture data-hidden={hidden || undefined} data-portrait={portrait || undefined}>
      {cloneElement(children, { style: css && css.filter !== 'none' ? { filter: css.filter } : undefined })}
      {css?.balance && <div className={styles.balance} style={{ background: css.balance }} aria-hidden />}
      {css?.lift && <div className={styles.lift} style={{ background: css.lift.color, opacity: css.lift.opacity }} aria-hidden />}
    </div>
  );
}

type PlayerProps = {
  active: boolean;
  items: Cut[];
  selected: string | null;
  mediaOf: (c: Cut) => string;
  posterOf: (clipId: string) => string | undefined;
  /** The export on the player: the latest, or the one a handoff asked for. */
  shownExport: Project['exports'][number] | undefined;
  /** The file of that export a finished row put on the player; else the export's first good one. */
  shownFile: string | undefined;
  /** Moves each time a handoff asks for that export to be shown. */
  showExport: number;
  music: Project['music'];
  /** The export line when the shown export is older than the timeline's last change. */
  stale: string | null;
  write: PageWrite;
};

/**
 * Plays the picked cut within its trim, the whole timeline in order, or the
 * export. While the timeline plays, the next cut is already loading in a hidden
 * player seeked to its in point, so each cut starts the moment the one before
 * it ends, and the music plays under it on the film's clock.
 */
function Player({ active, items, selected, mediaOf, posterOf, shownExport, shownFile, showExport, music, stale, write }: PlayerProps) {
  const videos = useRef(new Map<string, HTMLVideoElement>());
  const exportRef = useRef<HTMLVideoElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  /** The player on screen, for the transport. */
  const [onScreen, setOnScreen] = useState<HTMLVideoElement | null>(null);
  const [mode, setMode] = useState<'cut' | 'timeline' | 'export'>('cut');
  const [at, setAt] = useState(0);
  const saver = useDownload();
  const graded = useGradedDownload();
  const [exportCut, setExportCut] = useState(0);
  const utils = trpc.useUtils();
  const resume = trpc.edit.resumeExport.useMutation({
    onSuccess: () => void utils.edit.project.invalidate(),
  });

  useEffect(() => {
    if (selected) setMode('cut');
  }, [selected]);
  const exportReady = shownExport?.status === 'succeeded' && shownExport.finalId;
  useEffect(() => {
    if (exportReady) setMode('export');
  }, [exportReady]);
  // Sent here for this export: it goes on the screen and the screen into view.
  useEffect(() => {
    if (!showExport) return;
    if (exportReady) setMode('export');
    playerRef.current?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showExport]);

  const cut =
    mode === 'timeline'
      ? (items[at] ?? items[0])
      : (items.find((c) => c.key === selected) ?? items[0]);
  // A master downloads as the file it plays: the one its row asked for, else its first
  // good one, in that file's own container.
  const filmFile =
    shownExport?.deliverables?.find((d) => d.status === 'succeeded' && d.finalId === shownFile) ??
    shownExport?.deliverables?.find((d) => d.finalId === shownExport.finalId);
  const filmId = filmFile?.finalId ?? shownExport?.finalId;
  const exportSrc = exportReady ? libraryUrl('edit', filmId!) : null;
  const exportGrades = shownExport?.grades ?? [];
  const exportGraded = exportGrades.some((g) => !isNeutral(g.colour));
  const portrait = filmFile?.id === 'vertical';
  // A format with no picture this player can show (ProRes, on most machines) can
  // be downloaded but not played, so not graded here either. H.264, the 9:16 file
  // included, always can be, so a failure there is the connection's.
  const [noPicture, setNoPicture] = useState<string | null>(null);
  const unplayable = !!exportSrc && noPicture === exportSrc && !!filmFile && filmFile.id !== 'h264' && filmFile.id !== 'vertical';
  const master = !!shownExport?.deliverables;
  const conformed = isConform(shownExport);
  // The button that starts this kind of export again.
  const startOver = conformed ? 'Conform in FilmCraft' : master ? 'Master' : 'Export film';
  const canResume = master
    ? shownExport.deliverables?.some((d) => d.status === 'pending' && d.finalId)
    : shownExport?.finalId || shownExport?.parts;
  // Which cut of the export is on screen, so its grade can be shown over it.
  const trackExport = (v: HTMLVideoElement) => {
    if (!exportGraded || !shownExport || !v.duration) return;
    const ends = cutEnds(
      exportGrades.map((g) => g.seconds),
      shownExport.transition,
      shownExport.fadeSeconds ?? 0.5,
      v.duration
    );
    let i = ends.findIndex((end) => v.currentTime < end);
    if (i < 0) i = ends.length - 1;
    if (i !== exportCut) setExportCut(i);
  };
  // The players on the stage: the shown cut, plus the next one while the timeline plays.
  const layers = !active || mode === 'export' || !cut ? [] : mode === 'timeline' ? items.slice(at, at + 2) : [cut];
  const slot = (c: Cut) => `${c.key}:${mediaOf(c)}`;
  // The export's poster: the first cut's picture (its clip's poster, else its
  // still); with neither, the first cut's own frame stands in until the film
  // has a frame of its own to show.
  const exportPoster = items[0] ? posterOf(items[0].clipId) : undefined;
  const [exportFrame, setExportFrame] = useState(false);
  useEffect(() => setExportFrame(false), [exportSrc]);
  const standIn = mode === 'export' && exportSrc && !exportPoster && !exportFrame ? items[0] : undefined;
  const shownSlot = mode !== 'export' && cut && active ? slot(cut) : null;

  // The transport follows whichever player is on screen.
  useEffect(() => {
    setOnScreen(mode === 'export' ? exportRef.current : shownSlot ? (videos.current.get(shownSlot) ?? null) : null);
  }, [mode, shownSlot, exportSrc, active]);

  // Keep the shown cut at its in point when it is retrimmed (a new file reloads by itself).
  useEffect(() => {
    if (mode !== 'cut' || !cut) return;
    const v = videos.current.get(slot(cut));
    if (v && v.readyState >= 1) v.currentTime = cut.sourceStart;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, cut?.key, cut?.sourceStart]);

  // Timeline: start the shown cut, and hand over to the next on its out point.
  useEffect(() => {
    if (mode !== 'timeline' || !cut) return;
    const v = videos.current.get(slot(cut));
    if (v && v.readyState >= 1) void v.play().catch(() => undefined);
    let raf = 0;
    const tick = () => {
      const el = videos.current.get(slot(cut));
      if (el && el.currentTime >= cut.sourceStart + cut.duration - 0.03) {
        if (at < items.length - 1) setAt(at + 1);
        else {
          el.pause();
          setMode('cut');
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, at, cut?.key, cut?.sourceStart, cut?.duration, items.length]);

  // The music under the playing timeline: it plays and pauses with the shown cut,
  // stays on the film's clock and level, and keeps quiet while a video seeks.
  useEffect(() => {
    const bed = musicRef.current;
    if (!bed) return;
    const v = cut && videos.current.get(slot(cut));
    if (mode !== 'timeline' || !cut || !v || !music) {
      bed.pause();
      return;
    }
    const before = items.slice(0, at).reduce((sum, c) => sum + c.duration, 0);
    const length = items.reduce((sum, c) => sum + c.duration, 0);
    const filmAt = () => before + Math.max(0, v.currentTime - cut.sourceStart);
    const onPlay = () => {
      followFilm(bed, music, filmAt());
      // A bed shorter than the film stays out; the master has silence there too.
      if (music.inSeconds + filmAt() >= bed.duration) return;
      void bed.play().catch(() => undefined);
    };
    const onPause = () => bed.pause();
    const onSeeking = () => {
      bed.muted = true;
    };
    const onSeeked = () => {
      followFilm(bed, music, filmAt());
      bed.muted = false;
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeking', onSeeking);
    v.addEventListener('seeked', onSeeked);
    if (!v.paused) onPlay();
    let raf = 0;
    const tick = () => {
      followFilm(bed, music, filmAt());
      bed.volume = Math.min(1, musicLevel(music, filmAt(), length));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('seeking', onSeeking);
      v.removeEventListener('seeked', onSeeked);
      bed.muted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, at, cut?.key, cut?.sourceStart, music, active]);

  // The player fills the canvas: the picture contain-fits at 16:9 in the
  // space left by its caption, its buttons and the export's status.
  if (!exportSrc && !cut) {
    return (
      <div className={styles.player}>
        <div className={styles.fit}>
          <div className={`${styles.screen} ${frameGuidesClass}`}>
            <EmptyState title="Nothing to play yet" hint="Add a clip to the timeline and it plays here." />
          </div>
        </div>
      </div>
    );
  }
  const noPlayback = mode === 'export' && unplayable;
  // Until the file exists `seconds` is the timeline's sum, and a faded conform runs longer than that.
  const filmLength = exportSrc ? `${shownExport?.seconds}s, ` : '';
  const status =
    noPlayback ||
    graded.pending ||
    !!saver.error ||
    !!graded.error ||
    shownExport?.status === 'pending' ||
    shownExport?.status === 'failed';
  return (
    <div className={styles.player} data-status={status || undefined} ref={playerRef}>
      {active && music && <audio ref={musicRef} src={assetUrl(music.assetKey)} preload="metadata" hidden />}
      <div className={styles.fit}>
        <div className={`${styles.screen} ${frameGuidesClass}`} ref={screenRef}>
          {!active ? null : mode === 'export' && exportSrc ? (
            <Graded colour={exportGrades[exportCut]?.colour} portrait={portrait}>
              <video
                key={exportSrc}
                ref={exportRef}
                src={exportSrc}
                poster={portrait ? undefined : exportPoster}
                playsInline
                // A master has sound of its own; a plain export is silent.
                muted={!shownExport?.deliverables}
                preload="metadata"
                onTimeUpdate={(e) => trackExport(e.currentTarget)}
                onSeeked={(e) => trackExport(e.currentTarget)}
                onLoadedData={() => setExportFrame(true)}
                // With a track it can't decode, a player either refuses the file or plays only its sound.
                onLoadedMetadata={(e) => {
                  if (!e.currentTarget.videoWidth) setNoPicture(exportSrc);
                }}
                onError={() => setNoPicture(exportSrc)}
                aria-label="Exported film"
              />
            </Graded>
          ) : (
            layers.map((c, i) => {
              const k = slot(c);
              const shown = i === 0;
              return (
                <Graded key={k} colour={c.colour} hidden={!shown}>
                <video
                  ref={(el) => {
                    if (el) videos.current.set(k, el);
                    else videos.current.delete(k);
                  }}
                  aria-hidden={shown ? undefined : true}
                  src={mediaOf(c)}
                  poster={posterOf(c.clipId)}
                  playsInline
                  muted
                  // Only the hidden next cut of a playing timeline loads ahead.
                  preload={shown ? 'metadata' : 'auto'}
                  onLoadedMetadata={(e) => {
                    e.currentTarget.currentTime = c.sourceStart;
                    if (shown && mode === 'timeline') void e.currentTarget.play().catch(() => undefined);
                  }}
                  onTimeUpdate={(e) => {
                    const v = e.currentTarget;
                    if (shown && mode === 'cut' && v.currentTime >= c.sourceStart + c.duration) v.pause();
                  }}
                  aria-label={shown ? 'Cut preview' : undefined}
                />
                </Graded>
              );
            })
          )}
          {active && standIn && (
            <Graded colour={exportGrades[0]?.colour}>
              <video
                src={`${mediaOf(standIn)}#t=${standIn.sourceStart + 0.05}`}
                muted
                playsInline
                preload="metadata"
                tabIndex={-1}
                aria-hidden
              />
            </Graded>
          )}
        </div>
      </div>
      {noPlayback ? null : mode === 'export' && exportSrc ? (
        <Transport
          video={onScreen}
          inPoint={0}
          length={undefined}
          fallback={shownExport?.seconds}
          name="the exported film"
          stage={screenRef}
        />
      ) : mode === 'timeline' && cut ? (
        <Transport
          video={onScreen}
          inPoint={cut.sourceStart}
          length={cut.duration}
          timeline={{
            before: items.slice(0, at).reduce((sum, c) => sum + c.duration, 0),
            total: items.reduce((sum, c) => sum + c.duration, 0),
            onStop: () => setMode('cut'),
          }}
          name="the timeline"
          stage={screenRef}
        />
      ) : cut ? (
        <Transport
          video={onScreen}
          inPoint={cut.sourceStart}
          length={cut.duration}
          name={`cut ${items.indexOf(cut) + 1}`}
          stage={screenRef}
        />
      ) : null}
      <p className={styles.caption} data-stale={(mode === 'export' && stale) || undefined}>
        {mode === 'export'
          ? (stale ?? `${conformed ? 'The FilmCraft conform' : 'The exported film'}, ${filmLength}${shownExport?.cuts} cuts.`)
          : mode === 'timeline'
            ? `Playing cut ${at + 1} of ${items.length}, with its look. The preview plays hard cuts; fades appear in the export.`
            : cut
              ? `Cut ${items.indexOf(cut) + 1}, ${cut.sourceStart}s to ${round(cut.sourceStart + cut.duration)}s.`
              : ''}
      </p>
      <div className={styles.playerActions}>
        {mode === 'timeline' ? (
          <Button variant="ghost" icon={<Square size={16} />} onPress={() => setMode('cut')}>
            Stop
          </Button>
        ) : (
          <Button
            variant="ghost"
            icon={<Play size={16} />}
            disabled={!items.length}
            onPress={() => {
              setAt(0);
              setMode('timeline');
            }}
          >
            Play the timeline
          </Button>
        )}
        {exportReady && mode !== 'export' && (
          <Button variant="ghost" icon={<Film size={16} />} onPress={() => setMode('export')}>
            Watch the export
          </Button>
        )}
        {exportReady && (
          <Button
            variant="ghost"
            icon={<Download size={16} />}
            loading={saver.pending}
            onPress={() =>
              saver.start(libraryUrl('edit', filmId!), filmFile ? fileNameOf(filmFile) : 'render-to-film.mp4')
            }
          >
            {saver.label(exportGraded ? 'Download ungraded' : 'Download film')}
          </Button>
        )}
        {exportReady && exportGraded && !unplayable && (
          <Button
            variant="ghost"
            icon={<Palette size={16} />}
            loading={graded.pending}
            onPress={() =>
              graded.start(
                libraryUrl('edit', filmId!),
                {
                  grades: exportGrades,
                  transition: shownExport.transition,
                  fadeSeconds: shownExport.fadeSeconds,
                  // A master has its own mixed sound; a plain export is silent, so the bed goes under it.
                  ownSound: !!shownExport.deliverables?.length,
                  music: music && !shownExport.deliverables?.length ? { ...music, src: assetUrl(music.assetKey) } : null,
                },
                'render-to-film-graded'
              )
            }
          >
            {graded.label('Download graded film')}
          </Button>
        )}
        {graded.pending && (
          <Button variant="ghost" icon={<X size={16} />} onPress={graded.cancel}>
            Cancel
          </Button>
        )}
      </div>
      {noPlayback && <Alert title="This format plays outside the app; download it." className={styles.exportStatus} />}
      {graded.pending && (
        <Text tone="secondary" size="sm" as="p" className={styles.exportStatus}>
          Grading plays the film through once in this tab, so it takes about as long as the film. Keep the tab open.
        </Text>
      )}
      {saver.error && (
        <Alert tone="error" title="Download failed" className={styles.exportStatus}>
          {saver.error}
        </Alert>
      )}
      {graded.error && (
        <Alert tone="error" title="The graded film was not made" className={styles.exportStatus}>
          {graded.error}
          <div className={styles.alertActions}>
            <Button size="sm" variant="ghost" onPress={graded.clearError}>
              Dismiss
            </Button>
          </div>
        </Alert>
      )}
      {shownExport?.status === 'pending' && (
        <div className={styles.exportBand}>
          <RenderingStatus
            label={conformed ? 'Conforming in FilmCraft…' : master ? 'Mastering the film…' : 'Exporting the film…'}
            runKey={shownExport.id}
          />
        </div>
      )}
      {shownExport?.status === 'failed' && (
        <Alert
          tone="error"
          title={conformed ? 'The conform stopped' : master ? 'The master stopped' : 'The export stopped'}
          className={styles.exportStatus}
        >
          {shownExport.error ?? 'Runway could not put the film together.'}{' '}
          {canResume
            ? `Check again to pick it up where it left off, or press ${startOver} to start over.`
            : `Press ${startOver} to start over.`}
          {canResume && (
            <div className={styles.alertActions}>
              <Button
                size="sm"
                icon={<RotateCw size={14} />}
                loading={resume.isPending}
                onPress={() => void write(() => resume.mutateAsync({ id: shownExport.id })).catch(() => undefined)}
              >
                Check again
              </Button>
            </div>
          )}
          {resume.error && <Text tone="muted" size="sm">{resume.error.message}</Text>}
        </Alert>
      )}
    </div>
  );
}

/** Seconds as a clock: 7.4 → "0:07". */
function clock(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

type TransportProps = {
  video: HTMLVideoElement | null;
  /** Where the piece on screen starts in its file. */
  inPoint: number;
  /** How long it runs; `undefined` for the file's own length (the export). */
  length: number | undefined;
  /** The length to show until the file says (the export's recorded seconds). */
  fallback?: number | undefined;
  /** While the timeline plays: where this cut starts in the film, the film's length, and Stop. Read-only. */
  timeline?: { before: number; total: number; onStop: () => void } | undefined;
  /** What plays, for the controls' names: "cut 2", "the exported film". */
  name: string;
  /** What goes full screen: the picture with its grade. */
  stage: RefObject<HTMLElement | null>;
};

/**
 * The player's own controls (in place of the browser's): play or pause, a
 * scrub bar with an accent playhead, the time and full screen, in a thin
 * glass pill under the picture. A cut plays within its trim; while the
 * timeline plays the bar shows the whole film and the button stops it.
 */
function Transport({ video, inPoint, length, fallback, timeline, name, stage }: TransportProps) {
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(length ?? fallback ?? 0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!video) {
      setPos(0);
      setPlaying(false);
      return;
    }
    let raf = 0;
    const read = () => {
      setPos(Math.max(0, video.currentTime - inPoint));
      setDur(length ?? (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : (fallback ?? 0)));
    };
    const tick = () => {
      read();
      raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setPlaying(true);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const onStop = () => {
      setPlaying(false);
      cancelAnimationFrame(raf);
      read();
    };
    const reads = ['timeupdate', 'seeked', 'loadedmetadata', 'durationchange'] as const;
    for (const e of reads) video.addEventListener(e, read);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onStop);
    video.addEventListener('ended', onStop);
    if (video.paused) onStop();
    else onPlay();
    return () => {
      cancelAnimationFrame(raf);
      for (const e of reads) video.removeEventListener(e, read);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onStop);
      video.removeEventListener('ended', onStop);
    };
  }, [video, inPoint, length, fallback]);

  const span = Math.max(0, Math.min(pos, dur || pos));
  const shown = timeline ? timeline.before + span : span;
  const total = timeline ? timeline.total : dur;
  const share = total > 0 ? Math.min(100, (shown / total) * 100) : 0;

  const toggle = () => {
    if (timeline) {
      timeline.onStop();
      return;
    }
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    // From the in point again once the cut has played to its out point.
    const end = inPoint + (length ?? video.duration);
    if (video.currentTime < inPoint || video.currentTime >= end - 0.05) video.currentTime = inPoint;
    void video.play().catch(() => undefined);
  };

  const label = timeline ? 'Stop the timeline' : playing ? `Pause ${name}` : `Play ${name}`;
  return (
    <div className={styles.transport} role="group" aria-label={`Player controls for ${name}`}>
      <button type="button" className={styles.transportButton} onClick={toggle} disabled={!video} aria-label={label} title={label}>
        {timeline ? <Square size={16} aria-hidden /> : playing ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
      </button>
      <input
        type="range"
        className={styles.scrub}
        min={0}
        max={total || 1}
        step={0.01}
        value={Math.min(shown, total || 1)}
        disabled={!video || !!timeline || total <= 0}
        onChange={(e) => {
          if (!video || timeline) return;
          const v = Number(e.currentTarget.value);
          video.currentTime = inPoint + v;
          setPos(v);
        }}
        aria-label={`Position in ${name}`}
        aria-valuetext={`${clock(shown)} of ${clock(total)}`}
        style={{ ['--p' as string]: `${share}%` }}
      />
      <span className={styles.time} aria-hidden>
        {clock(shown)} / {clock(total)}
      </span>
      <button
        type="button"
        className={styles.transportButton}
        onClick={() => {
          const el = stage.current;
          if (el?.requestFullscreen) void el.requestFullscreen().catch(() => undefined);
        }}
        disabled={!video}
        aria-label="Full screen"
        title="Full screen"
      >
        <Maximize size={16} aria-hidden />
      </button>
    </div>
  );
}

function EditorChat({
  data,
  flush,
  write,
  loading,
}: {
  data: Project | undefined;
  flush: () => Promise<boolean>;
  write: PageWrite;
  loading: boolean;
}) {
  const { onBay } = useCapabilities();
  const utils = trpc.useUtils();
  const [text, setText] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const send = trpc.edit.agentSend.useMutation({
    onSuccess: () => {
      setText('');
      void utils.edit.project.invalidate();
    },
  });
  const clear = trpc.edit.clearChat.useMutation({
    onSuccess: () => {
      setConfirmClear(false);
      void utils.edit.project.invalidate();
    },
  });
  // One clear per press, however fast the second click comes.
  const clearGuard = useInFlight();
  const working = !!data?.agent || send.isPending;
  const messages = data?.messages ?? [];
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, working]);

  const tooLong = text.length > EDITOR_MESSAGE_MAX;
  // Each message is a billed model call: a double-click's second press lands
  // while the first still waits on the save, before `working` shows.
  const sendGuard = useInFlight();
  const submit = async (message = text) => {
    if (!message.trim() || message.length > EDITOR_MESSAGE_MAX || working || !sendGuard.start()) return;
    try {
      if (!(await flush())) return;
      await write(() => send.mutateAsync({ text: message.trim() }));
    } catch {
      // The conversation shows the error.
    } finally {
      sendGuard.end();
    }
  };

  if (loading) return <SkeletonText rows={3} />;
  return (
    <div className={styles.chat}>
      {messages.length === 0 && !working ? (
        <div className={styles.suggestions}>
          <Text size="sm" tone="secondary" as="p">
            Try one of these, or write your own:
          </Text>
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className={styles.suggestion} onClick={() => setText(s)}>
              {s}
            </button>
          ))}
        </div>
      ) : (
        // Focusable, so the transcript scrolls from the keyboard too.
        <ol className={styles.messages} ref={listRef} aria-live="polite" aria-label="Conversation" tabIndex={0}>
          {messages.map((m, i) => (
            <li key={`${m.at}-${i}`} className={styles.message} data-role={m.role} data-error={m.error || undefined}>
              <span className={styles.who}>{m.role === 'user' ? 'You' : 'Editor'}</span>
              <p className={styles.messageText}>{m.text}</p>
              {m.actions?.length ? (
                <ul className={styles.actions}>
                  {m.actions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
          {working && (
            <li className={styles.message} data-role="agent">
              <span className={styles.who}>Editor</span>
              <p className={styles.messageText}>
                <span className={styles.pulse} aria-hidden />
                {data?.agent?.status === 'applying' ? 'Applying the changes…' : 'Thinking about the cut…'}
              </p>
            </li>
          )}
        </ol>
      )}
      {/* A failed send shows just above the box it came from. */}
      <div className={styles.chatNotice}>
        <RunwayErrorNotice error={send.error} modelName="Claude" onRetry={() => void submit()} />
      </div>
      <div className={styles.composer}>
        <TextArea
          aria-label="Message to the AI editor"
          placeholder="Make it 30 seconds, open on the aerial, grade it blue hour luxe"
          value={text}
          onChange={setText}
          rows={2}
          maxLength={EDITOR_MESSAGE_MAX}
          disabled={working}
          onSubmit={() => void submit()}
        />
        {tooLong && (
          <Alert tone="warning" title="Your message is too long">
            The editor reads up to {EDITOR_MESSAGE_MAX.toLocaleString('en-US')} characters at a time. Shorten it and send again.
          </Alert>
        )}
        <div className={styles.composerBar}>
          <Text size="sm" tone="muted">
            Enter sends, Shift+Enter adds a line.{onBay ? ' Each message uses a few credits.' : ''}
          </Text>
          <div className={styles.composerButtons}>
            {messages.length > 0 && (
              <Button size="sm" variant="ghost" disabled={working} onPress={() => setConfirmClear(true)}>
                Clear chat
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              icon={<Send size={14} />}
              loading={working}
              disabled={!text.trim() || tooLong}
              onPress={() => void submit()}
            >
              Send
            </Button>
          </div>
        </div>
      </div>
      <ConfirmDialog
        isOpen={confirmClear}
        title="Clear the conversation?"
        confirmLabel="Clear"
        loading={clear.isPending}
        error={clear.error?.message}
        onConfirm={() => void clearGuard.wrap(() => write(() => clear.mutateAsync()).catch(() => undefined))()}
        onCancel={() => setConfirmClear(false)}
      >
        The messages go; the timeline and the editor's memory stay.
      </ConfirmDialog>
    </div>
  );
}

/** Keep the file with the server; answers its storage key and the name to show. */
async function uploadMusic(file: File): Promise<{ key: string; name: string }> {
  if (file.size > AUDIO_LIMIT) throw new Error('That file is over 50 MB.');
  let res: Response;
  try {
    res = await fetch(`/api/upload-audio?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
    });
  } catch {
    throw new Error('The upload was cut off. Check your connection and try again.');
  }
  const body = await uploadAnswer(res, `The music could not be uploaded (${res.status}). Try again.`);
  return { key: body.key, name: body.name ?? file.name };
}

/** What an upload route answered; a refusal throws the server's own sentence, else `failed`. */
async function uploadAnswer(res: Response, failed: string): Promise<{ key: string; name?: string }> {
  const body = (await res.clone().json().catch(() => null)) as { key?: string; name?: string; message?: string; error?: string } | null;
  if (!res.ok || !body?.key) {
    const text = await res.text().catch(() => '');
    const said = res.headers.get('content-type')?.startsWith('text/plain') && text.length <= 200 ? text : '';
    throw new Error(body?.message ?? body?.error ?? (said || failed));
  }
  return { ...body, key: body.key };
}

/** Keep a drawn title card with the server; answers its storage key. */
async function uploadCard(png: Blob): Promise<string> {
  let res: Response;
  try {
    res = await fetch('/api/chat/asset', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png });
  } catch {
    throw new Error('The upload was cut off. Check your connection and try again.');
  }
  return (await uploadAnswer(res, `The title card could not be uploaded (${res.status}). Try again.`)).key;
}

/** One title card on every shape this master cuts it into, as `exportMaster` takes it. */
async function drawCard(card: TitleCard, sizes: ReturnType<typeof cardSizes>, vertical: boolean) {
  const key = await uploadCard(await renderTitleCard(card, sizes.landscape.width, sizes.landscape.height));
  if (!vertical) return { key };
  return { key, verticalKey: await uploadCard(await renderTitleCard(card, sizes.vertical.width, sizes.vertical.height)) };
}

type CardSide = 'head' | 'tail';
/** A card as its fields hold it. An empty one is no card, so a draft may have no text. */
type CardDraft = { text: string; subtitle: string; seconds: number };
type CardDrafts = Record<CardSide, CardDraft>;

const NO_CARD: CardDraft = { text: '', subtitle: '', seconds: TITLE_CARD.defaultSeconds };

function cardDraft(card: TitleCard | null | undefined): CardDraft {
  return card ? { text: card.text, subtitle: card.subtitle ?? '', seconds: card.seconds } : NO_CARD;
}

function cardOf(draft: CardDraft): TitleCard | null {
  const text = draft.text.trim();
  if (!text) return null;
  const subtitle = draft.subtitle.trim();
  return { text, ...(subtitle ? { subtitle } : {}), seconds: draft.seconds };
}

const titlesOf = (cards: CardDrafts) => ({ head: cardOf(cards.head), tail: cardOf(cards.tail) });

/**
 * The title cards as the fields hold them, saved 600 ms after the last change. `save`
 * sends what is waiting now, and is false when the server refused it, so a master
 * never draws cards the page has moved on from. A save that changes nothing is not
 * sent: `write` is only for a write that moves the rev.
 */
function useTitleCards(titles: Project['titles'], write: PageWrite) {
  const utils = trpc.useUtils();
  const setTitles = trpc.edit.setTitles.useMutation({ onSuccess: () => utils.edit.project.invalidate() });
  const sendRef = useRef(setTitles.mutateAsync);
  sendRef.current = setTitles.mutateAsync;
  const [cards, setCards] = useState<CardDrafts>({ head: NO_CARD, tail: NO_CARD });
  const cardsRef = useRef(cards);
  // The titles the server has, or will have once the save on its way lands.
  const onServer = useRef<string | null>(JSON.stringify(titlesOf(cards)));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(0);

  useEffect(() => {
    if (timer.current || saving.current) return;
    const server: CardDrafts = { head: cardDraft(titles?.head), tail: cardDraft(titles?.tail) };
    const said = JSON.stringify(titlesOf(server));
    onServer.current = said;
    // The same cards: the fields keep what they hold, such as a space on its way to a next word.
    if (said === JSON.stringify(titlesOf(cardsRef.current))) return;
    cardsRef.current = server;
    setCards(server);
  }, [titles]);

  const save = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const next = titlesOf(cardsRef.current);
    const said = JSON.stringify(next);
    if (said === onServer.current) return true;
    onServer.current = said;
    saving.current += 1;
    try {
      await write(() => sendRef.current(next));
      return true;
    } catch {
      // Sent again with the next change or the next press; the section shows why.
      onServer.current = null;
      return false;
    } finally {
      saving.current -= 1;
    }
  }, [write]);

  const change = useCallback(
    (side: CardSide, patch: Partial<CardDraft>) => {
      const next = { ...cardsRef.current, [side]: { ...cardsRef.current[side], ...patch } };
      cardsRef.current = next;
      setCards(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), 600);
    },
    [save]
  );

  // Asked as the window closes, so it reads the refs: a change waiting on the timer, on its way, or refused.
  const pending = useCallback(() => !!timer.current || saving.current > 0 || onServer.current === null, []);

  const { head, tail } = titlesOf(cards);
  return { cards, change, save, pending, any: !!(head || tail), error: setTitles.error };
}

/** The two title cards, and when they go into the film. */
function TitleCards({
  cards,
  onChange,
  error,
}: {
  cards: CardDrafts;
  onChange: (side: CardSide, patch: Partial<CardDraft>) => void;
  error: { message: string } | null;
}) {
  const headText = cards.head.text.trim();
  return (
    <div className={styles.titleCards}>
      <TitleCardRow name="Title" card={cards.head} onChange={(patch) => onChange('head', patch)} />
      <TitleCardRow
        name="End card"
        card={cards.tail}
        onChange={(patch) => onChange('tail', patch)}
        action={
          <Button size="sm" variant="ghost" disabled={!headText} onPress={() => onChange('tail', { text: headText })}>
            Use the title
          </Button>
        }
      />
      {error && <Alert tone="error" title="The title cards were not saved">{error.message}</Alert>}
      <Text size="sm" tone="muted" as="p">
        Titles are drawn when you press Master here, so a film mastered from chat or conformed in FilmCraft has none.
      </Text>
    </div>
  );
}

function TitleCardRow({
  name,
  card,
  onChange,
  action,
}: {
  name: string;
  card: CardDraft;
  onChange: (patch: Partial<CardDraft>) => void;
  action?: ReactElement;
}) {
  const shown = cardOf(card);
  return (
    <div role="group" aria-label={name} className={styles.titleCard}>
      <div className={styles.titleCardHead}>
        <span className={styles.titleCardName}>{name}</span>
        {action}
        <Button size="sm" variant="ghost" icon={<X size={14} />} disabled={!card.text && !card.subtitle} onPress={() => onChange(NO_CARD)}>
          Remove
        </Button>
      </div>
      <TextInput label={`${name} text`} value={card.text} onChange={(text) => onChange({ text })} maxLength={TITLE_CARD.maxTitle} />
      <Text size="sm" tone="muted" className={styles.titleCount}>
        {`${card.text.length}/${TITLE_CARD.maxTitle}`}
      </Text>
      <div className={styles.titleCardFields}>
        <TextInput label="Subtitle" value={card.subtitle} onChange={(subtitle) => onChange({ subtitle })} maxLength={TITLE_CARD.maxSubtitle} />
        <NumberInput
          label="Seconds"
          unit="s"
          value={card.seconds}
          min={TITLE_CARD.minSeconds}
          max={TITLE_CARD.maxSeconds}
          step={0.5}
          onChange={(seconds) => onChange({ seconds })}
        />
      </div>
      {shown && <CardPreview text={shown.text} subtitle={shown.subtitle} label={`Preview of the ${name.toLowerCase()}`} />}
    </div>
  );
}

/** A card as it will come out, drawn by the same code that draws the master's. */
function CardPreview({ text, subtitle, label }: { text: string; subtitle: string | undefined; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    void renderTitleCard({ text, subtitle, seconds: TITLE_CARD.defaultSeconds }, CARD_PREVIEW.width, CARD_PREVIEW.height)
      .then((png) => createImageBitmap(png))
      .then((picture) => {
        if (live) canvas.current?.getContext('2d')?.drawImage(picture, 0, 0);
        picture.close();
      })
      // The picture stays as it was; the card itself is drawn again for the master.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [text, subtitle]);
  return <canvas ref={canvas} width={CARD_PREVIEW.width} height={CARD_PREVIEW.height} className={styles.titlePreview} role="img" aria-label={label} />;
}

/** The bed under the film: pick a file, then its licence note, level and fades. */
function MusicRow({
  music,
  write,
  onUploading,
}: {
  music: Project['music'];
  write: PageWrite;
  onUploading: (uploading: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const done = () => utils.edit.project.invalidate();
  const setMusic = trpc.edit.setMusic.useMutation({ onSuccess: done });
  const clearMusic = trpc.edit.clearMusic.useMutation({ onSuccess: done });
  const picker = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // What the sliders and the field show until the server's copy catches up.
  const [moving, setMoving] = useState<Partial<EditMusic>>({});
  const [licence, setLicence] = useState(music?.licence ?? '');
  useEffect(() => setMoving({}), [music]);
  useEffect(() => setLicence(music?.licence ?? ''), [music?.licence]);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    onUploading(true);
    setUploadError(null);
    try {
      const { key, name } = await uploadMusic(file);
      await write(() => setMusic.mutateAsync({ assetKey: key, name, ...NEW_MUSIC }));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'The music could not be uploaded. Try again.');
    } finally {
      setUploading(false);
      onUploading(false);
      if (picker.current) picker.current.value = '';
    }
  };

  if (!music) {
    return (
      <div className={studio.stack}>
        <input
          ref={picker}
          type="file"
          accept="audio/*"
          hidden
          tabIndex={-1}
          aria-label="Music file"
          onChange={(e) => void onPick(e.currentTarget.files?.[0])}
        />
        <div>
          <Button icon={<Music size={16} />} loading={uploading} onPress={() => picker.current?.click()}>
            Add music
          </Button>
        </div>
        {uploadError && <Alert tone="error" title="The music was not added">{uploadError}</Alert>}
      </div>
    );
  }

  const shown = { ...music, ...moving };
  const save = (patch: Partial<EditMusic>) => {
    setMoving((m) => ({ ...m, ...patch }));
    void write(() => setMusic.mutateAsync({ ...shown, ...patch })).catch(() => undefined);
  };
  const saveLicence = () => {
    const text = licence.trim();
    if (text !== (music.licence ?? '')) save({ licence: text || undefined });
  };
  const seconds = (v: number) => `${v}s`;
  return (
    <div className={studio.stack}>
      <div className={styles.musicHead}>
        <Music size={16} aria-hidden />
        <span className={styles.musicName}>{music.name}</span>
        <Button
          size="sm"
          variant="ghost"
          icon={<X size={14} />}
          loading={clearMusic.isPending}
          onPress={() => void write(() => clearMusic.mutateAsync()).catch(() => undefined)}
        >
          Remove
        </Button>
      </div>
      <div onBlur={saveLicence}>
        <TextInput
          label="Where this music is licensed from"
          value={licence}
          onChange={setLicence}
          maxLength={500}
          onPressEnter={saveLicence}
        />
      </div>
      <div className={styles.gradePanel}>
        <div className={styles.gradeWide}>
          <Slider
            label="Music gain"
            value={shown.gain}
            min={-24}
            max={12}
            step={0.5}
            onChange={(gain) => setMoving((m) => ({ ...m, gain }))}
            onChangeEnd={(gain) => save({ gain })}
            format={(v) => `${v > 0 ? '+' : v < 0 ? '\u2212' : ''}${Math.abs(v)} dB`}
          />
        </div>
        <Slider
          label="Fade in"
          value={shown.fadeIn}
          min={0}
          max={10}
          step={0.1}
          onChange={(fadeIn) => setMoving((m) => ({ ...m, fadeIn }))}
          onChangeEnd={(fadeIn) => save({ fadeIn })}
          format={seconds}
        />
        <Slider
          label="Fade out"
          value={shown.fadeOut}
          min={0}
          max={10}
          step={0.1}
          onChange={(fadeOut) => setMoving((m) => ({ ...m, fadeOut }))}
          onChangeEnd={(fadeOut) => save({ fadeOut })}
          format={seconds}
        />
      </div>
      {setMusic.error && <Alert tone="error" title="The music was not saved">{setMusic.error.message}</Alert>}
      {clearMusic.error && <Alert tone="error" title="The music was not removed">{clearMusic.error.message}</Alert>}
    </div>
  );
}

/**
 * FilmCraft, a second way out of the page, once Power tools has it; until then a line
 * saying where it is set up. The app works without it, so nothing here asks or nags.
 */
function FilmcraftAction({
  active,
  disabled,
  loading,
  error,
  onConform,
}: {
  active: boolean;
  disabled: boolean;
  loading: boolean;
  error: unknown;
  onConform: () => void;
}) {
  // Every answer runs the tool with `--version`, so it never polls, and only asks on screen.
  const sidecars = trpc.settings.sidecars.useQuery(undefined, { enabled: active, refetchOnWindowFocus: false });
  if (!sidecars.data && !sidecars.error) return null;
  if (!sidecars.data?.find((s) => s.id === 'filmcraft')?.ok) {
    return (
      <Text size="sm" tone="muted" as="p">
        FilmCraft is not set up on this computer. <TextLink href={formatHash('settings')}>Power tools in Settings</TextLink> sets it up.
      </Text>
    );
  }
  return (
    <>
      <div>
        <Button icon={<Clapperboard size={16} />} loading={loading} disabled={disabled} onPress={onConform}>
          Conform in FilmCraft
        </Button>
      </div>
      <RunwayErrorNotice error={error} modelName="FilmCraft" onRetry={onConform} />
    </>
  );
}

/** One finished file of a master: how it went, what is in it, its download, and what QC read back. */
function DeliverableRow({ job, file, onWatch }: { job: ExportRow; file: Deliverable; onWatch: () => void }) {
  const saver = useDownload();
  const conformed = !!file.fileName;
  const label = conformed ? SIDECAR_LABELS.filmcraft : DELIVERABLE_LABELS[file.id];
  const failed = file.status === 'failed';
  const ready = file.status === 'succeeded' && !!file.finalId;
  // The player takes a finished master, and only then is a conform's length its own.
  const finished = ready && job.status === 'succeeded';
  const caption = [file.id === 'vertical' && job.frames?.length ? framesLine(job.frames) : '', job.cards ? cardsLine(job.cards) : '']
    .filter(Boolean)
    .join(' ');
  return (
    <li className={styles.deliverable} data-status={file.status}>
      <div className={styles.deliverableHead}>
        <span className={file.status === 'pending' ? styles.pulse : styles.deliverableGlyph} aria-hidden />
        <span className={styles.deliverableName}>{failed ? `Failed: ${label}` : label}</span>
        {finished && <Button size="sm" variant="ghost" icon={<Play size={14} />} aria-label={`Watch ${label}`} onPress={onWatch} />}
        {ready && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Download size={14} />}
            aria-label={`Download ${label}`}
            loading={saver.pending}
            onPress={() => saver.start(libraryUrl('edit', file.finalId!), fileNameOf(file))}
          >
            {saver.label('Download')}
          </Button>
        )}
      </div>
      {file.status === 'pending' && (
        <Text size="sm" tone="secondary" as="p">
          {conformed ? 'Conforming in FilmCraft…' : 'Mastering…'}
        </Text>
      )}
      {failed && file.error && (
        <Text size="sm" tone="secondary" as="p">
          {file.error}
        </Text>
      )}
      {conformed && finished && (
        <Text size="sm" tone="muted" as="p">
          {`${job.seconds}s, the file's own length. No paid call: FilmCraft runs on this computer.`}
        </Text>
      )}
      {caption && (
        <Text size="sm" tone="muted" as="p">
          {caption}
        </Text>
      )}
      {file.qc && (
        <Text size="sm" tone="muted" as="p" className={styles.qc}>
          {qcLine(file.qc)}
        </Text>
      )}
      {saver.error && <Alert tone="error" title="Download failed">{saver.error}</Alert>}
    </li>
  );
}

function Memory({ memory, write, loading }: { memory: string[] | undefined; write: PageWrite; loading: boolean }) {
  const utils = trpc.useUtils();
  const [text, setText] = useState('');
  const [forgetting, setForgetting] = useState<string | null>(null);
  const done = () => void utils.edit.project.invalidate();
  const add = trpc.edit.addMemory.useMutation({
    onSuccess: () => {
      setText('');
      done();
    },
  });
  const forget = trpc.edit.forgetMemory.useMutation({
    onSuccess: () => {
      setForgetting(null);
      done();
    },
  });
  const list = useMemo(() => memory ?? [], [memory]);
  // One save per press: a double-click's second press lands before `isPending` shows.
  const guard = useInFlight();
  const submit = () => {
    const next = text.trim();
    if (next.length < 2) return;
    // Already remembered: the server would change nothing and answer the rev it has,
    // maybe another writer's, so it never goes through `write`. The field just clears.
    if (list.some((m) => m.toLowerCase() === next.toLowerCase())) {
      setText('');
      return;
    }
    void guard.wrap(() => write(() => add.mutateAsync({ text: next })).catch(() => undefined))();
  };

  if (loading) return <SkeletonText rows={2} />;
  return (
    <div className={studio.stack}>
      {list.length === 0 ? (
        <Text size="sm" tone="muted" as="p">
          Nothing yet. Add a preference below, or tell the editor "remember that I like long, slow cuts".
        </Text>
      ) : (
        <ul className={styles.memory}>
          {list.map((m) => (
            <li key={m} className={styles.memoryItem}>
              <span>{m}</span>
              <Button size="sm" variant="ghost" icon={<X size={14} />} aria-label={`Forget: ${m}`} onPress={() => setForgetting(m)} />
            </li>
          ))}
        </ul>
      )}
      <div className={styles.memoryAdd}>
        <TextInput
          aria-label="New preference"
          placeholder="Always end on the widest shot"
          value={text}
          onChange={setText}
          maxLength={240}
          onPressEnter={submit}
        />
        <Button icon={<BookmarkPlus size={16} />} loading={add.isPending} disabled={text.trim().length < 2} onPress={submit}>
          Remember
        </Button>
      </div>
      {add.error && <Alert tone="error" title="That preference was not saved">{add.error.message}</Alert>}
      <ConfirmDialog
        isOpen={forgetting !== null}
        title="Forget this preference?"
        confirmLabel="Forget"
        loading={forget.isPending}
        error={forget.error?.message}
        onConfirm={() => {
          if (forgetting) void guard.wrap(() => write(() => forget.mutateAsync({ text: forgetting })).catch(() => undefined))();
        }}
        onCancel={() => setForgetting(null)}
      >
        {forgetting}
      </ConfirmDialog>
    </div>
  );
}
