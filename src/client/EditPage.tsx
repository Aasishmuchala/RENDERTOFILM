import type { inferRouterOutputs } from '@trpc/server';
import {
  ArrowDown,
  ArrowUp,
  Blend,
  BookmarkPlus,
  Copy,
  Download,
  Film,
  Maximize,
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

import type { AppRouterType } from '../api.ts';
import { type CutColour, colourCss, colourSteps, cutEnds, isNeutral, NEUTRAL_COLOUR } from '../colour.ts';
import { GRADES } from '../grades.ts';
import { derivedLabel, rootClipId, versionChain, type TimelineItem } from '../timeline.ts';
import { Section } from './layouts/Section.tsx';
import { frameGuidesClass, PHONE_QUERY, Workspace } from './layouts/Workspace.tsx';
import { useAmbient } from './lib/ambient.tsx';
import { clipPosterUrl, libraryUrl, useDownload } from './lib/download.ts';
import { useGradedDownload } from './lib/gradedFilm.ts';
import { useCapabilities } from './lib/useCapabilities.ts';
import { useInFlight } from './lib/useInFlight.ts';
import { trpc } from './trpc.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { ConfirmDialog } from './ui/ConfirmDialog.tsx';
import { CostLine } from './ui/CostLine.tsx';
import { EmptyState } from './ui/EmptyState.tsx';
import { FilterChips } from './ui/FilterChips.tsx';
import { BlockedTip } from './ui/ModelUnavailable.tsx';
import { NumberInput } from './ui/NumberInput.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { RenderingStatus } from './ui/RenderingStatus.tsx';
import { RunwayErrorNotice } from './ui/RunwayErrorNotice.tsx';
import { Select } from './ui/Select.tsx';
import { SkeletonBlock, SkeletonText } from './ui/Skeleton.tsx';
import { Slider } from './ui/Slider.tsx';
import { Text } from './ui/Text.tsx';
import { TextArea } from './ui/TextArea.tsx';
import { TextInput } from './ui/TextInput.tsx';
import styles from './EditPage.module.css';
import studio from './Studio.module.css';

type Project = inferRouterOutputs<AppRouterType>['edit']['project'];
type Cut = Pick<TimelineItem, 'key' | 'clipId' | 'versionId' | 'sourceStart' | 'duration' | 'colour'>;
type Draft = { items: Cut[]; transition: 'hard' | 'fade'; fadeSeconds: number };

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
const signed = (v: number) => (Math.round(v * 100) === 0 ? '0' : `${v > 0 ? '+' : ''}${Math.round(v * 100)}`);

function round(n: number) {
  return Math.round(n * 100) / 100;
}

function fromServer(p: Project): Draft {
  return {
    items: p.timeline.map(({ key, clipId, versionId, sourceStart, duration, colour }) => ({
      key,
      clipId,
      versionId,
      sourceStart,
      duration,
      colour,
    })),
    transition: p.transition,
    fadeSeconds: p.fadeSeconds,
  };
}

export type EditPageProps = {
  /** Go to the Video tab, when there are no clips yet. */
  onGoToVideo: () => void;
  /** Whether the Edit tab is the one on screen; a hidden tab loads no video and polls slowly. */
  active: boolean;
};

const HISTORY_MAX = 20;
const CLIP_PAGE = 24;
const NO_DERIVED: Project['derived'] = [];
/** The server sends a clip's `stillId` only while that still is in the library (src/edit-api.ts). */
const LIVE_STILLS = { has: (id: string) => id !== '' };
const FIELD_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [role="spinbutton"], [role="slider"], [role="listbox"], [role="combobox"], [aria-haspopup]';

export function EditPage({ onGoToVideo, active }: EditPageProps) {
  const { onBay } = useCapabilities();
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
  const [saveState, setSaveState] = useState<'idle' | 'unsaved' | 'saving' | 'saved' | 'error'>('idle');
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

  const adoptServer = useCallback((p: Project) => {
    const server = fromServer(p);
    const cur = draftRef.current;
    if (rev.current === 0 || !cur) {
      // An unchanged poll keeps the draft as it is, so nothing re-renders.
      if (cur && JSON.stringify(cur) === JSON.stringify(server)) return;
      draftRef.current = server;
      setDraft(server);
      return;
    }
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

  const doSave = useCallback(
    (d: Draft) => {
      const at = rev.current;
      const run = async () => {
        pendingSaves.current += 1;
        setSaveState('saving');
        setSaveError(null);
        try {
          await saveRef.current({
            items: d.items.map((c) => ({ ...c, versionId: c.versionId ?? undefined, colour: c.colour ?? undefined })),
            transition: d.transition,
            fadeSeconds: d.fadeSeconds,
          });
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
          setSaveError(err instanceof Error && err.message ? err.message : 'The server did not answer.');
          setSaveState('error');
        } finally {
          pendingSaves.current -= 1;
        }
      };
      const next = inflight.current.then(run, run);
      inflight.current = next;
      return next;
    },
    [utils, adoptServer]
  );

  /** Save whatever is waiting now; true when the server has the timeline as shown. */
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    await inflight.current;
    if (rev.current !== 0 && draftRef.current) await doSave(draftRef.current);
    return rev.current === 0;
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

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (timer.current || ['unsaved', 'saving', 'error'].includes(saveStateRef.current)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const [selected, setSelected] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ cut: Cut; index: number } | null>(null);
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
    const next = [...d.items];
    next.splice(Math.min(removed.index, next.length), 0, removed.cut);
    setRemoved(null);
    change({ ...d, items: next }, 300);
  };
  const add = (clipId: string, seconds: number) => {
    const d = draftRef.current;
    if (!d) return;
    const cut: Cut = { key: crypto.randomUUID(), clipId, sourceStart: 0, duration: seconds };
    setSelected(cut.key);
    change({ ...d, items: [...d.items, cut] }, 300);
  };

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

  const [exporting, setExporting] = useState(false);
  const exportFilm = trpc.edit.exportFilm.useMutation({
    // Stays "pending" until the refetch shows the running export, so a second click can't slip in.
    onSuccess: () => utils.edit.project.invalidate(),
    onError: () => void utils.edit.project.invalidate(),
  });
  const runExport = async () => {
    if (exporting || exportFilm.isPending) return;
    setExporting(true);
    try {
      if (!(await flush())) return;
      await exportFilm.mutateAsync();
    } catch {
      // The notice under the button shows the error.
    } finally {
      setExporting(false);
    }
  };
  const anyPending = data?.timeline.some((t) => t.pendingId) ?? false;
  const latestExport = data?.exports[0];
  // The finished export against the timeline as it is now, from what the
  // export recorded (no new query): how many of the timeline's cuts it has as
  // they are (same place, length and look). Null while it matches.
  const exportStale = useMemo(() => {
    if (!draft || latestExport?.status !== 'succeeded' || !items.length) return null;
    const grades = latestExport.grades ?? [];
    const total = items.length;
    const again = 'Export again.';
    if (!grades.length) {
      if (latestExport.cuts === total) return null;
      return `Exported before your last changes: ${Math.min(latestExport.cuts, total)} of ${total} cuts. ${again}`;
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
      (latestExport.transition !== draft.transition ||
        (draft.transition === 'fade' && round(latestExport.fadeSeconds ?? 0.5) !== round(draft.fadeSeconds)));
    return transitionChanged ? `Exported before your last changes to the transitions. ${again}` : null;
  }, [draft, items, latestExport]);

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
                disabled={items.length >= 24 || locked}
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
                    length={secondsById.get(c.versionId ?? c.clipId) ?? 5}
                    currentGrade={currentGrade(data, c)}
                    derived={data?.derived ?? NO_DERIVED}
                    locked={locked}
                    open={selected === c.key}
                    onToggle={toggle}
                    onChange={update}
                    onColourAll={colourAll}
                    onMove={move}
                    onRemove={remove}
                    flush={flush}
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

      <Section title="AI editor" description="Tell it what you want, the way you would brief an editor. It changes the timeline for you.">
        <EditorChat data={data} flush={flush} loading={project.isLoading} />
      </Section>
      <Section title="Memory" description="Standing preferences the editor follows in every session.">
        <Memory memory={data?.memory} loading={project.isLoading} />
      </Section>
    </>
  );

  const footer = (
    <>
      <Button
        variant="primary"
        size="lg"
        icon={<Film size={18} />}
        loading={exporting || exportFilm.isPending}
        disabled={!items.length || anyPending || latestExport?.status === 'pending' || locked}
        onPress={() => void runExport()}
      >
        {latestExport?.status === 'pending' ? 'Exporting…' : 'Export film'}
      </Button>
      <RunwayErrorNotice error={exportFilm.error} modelName="the export" onRetry={() => void runExport()} />
      <CostLine
        summary={
          <>
            <SaveNote state={saveState} error={saveError} onRetry={retrySave} />
            {anyPending
              ? ' A cut is still re-rendering; export once it is done.'
              : ` ${total}s, ${draft?.transition === 'fade' ? `${draft.fadeSeconds}s fades` : 'hard cuts'}. ${onBay ? 'Exporting runs on your own Runway credits.' : 'Exporting runs on this computer.'}`}
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
                  <span className={styles.segmentNumber}>{i + 1}</span>
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
          latestExport={latestExport}
          stale={exportStale}
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
  length: number;
  currentGrade: string;
  derived: Project['derived'];
  locked: boolean;
  open: boolean;
  onToggle: (key: string) => void;
  onChange: (key: string, patch: Partial<Cut>, delay?: number) => void;
  onColourAll: (colour: CutColour | undefined) => void;
  onMove: (key: string, by: -1 | 1) => void;
  onRemove: (key: string) => void;
  flush: () => Promise<boolean>;
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
  length,
  currentGrade,
  derived,
  locked,
  open,
  onToggle,
  onChange,
  onColourAll,
  onMove,
  onRemove,
  flush,
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
  // Both re-render the clip on Aleph (billed): a double-click's second press
  // lands while the first still waits on the save, before `isPending` shows.
  const alephGuard = useInFlight();
  const runEdit = async () => {
    if (alephOff || instruction.trim().length < 3 || !alephGuard.start()) return;
    try {
      if (!(await flush())) return;
      await edit.mutateAsync({ key: cut.key, instruction });
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
      await grade.mutateAsync({ key: cut.key, gradeId: id as (typeof GRADES)[number]['id'] });
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
            onPress={() => setVersion.mutate({ key: cut.key, versionId: null })}
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
                  <div className={styles.gradeWide}>
                    <Select
                      label="Look"
                      options={LOOK_OPTIONS}
                      value={colour.gradeId}
                      disabled={locked}
                      onChange={(id) => onChange(cut.key, { colour: { ...colour, gradeId: id as CutColour['gradeId'] } }, 400)}
                    />
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
                  setVersion.mutate({ key: cut.key, versionId: id === 'original' ? null : id });
                }}
              />
              {setVersion.error && <Alert tone="error" title="The version was not changed">{setVersion.error.message}</Alert>}
              <Text size="sm" tone="muted" as="p">
                Every finished grade and edit is kept, so you can switch back to any of them.
              </Text>
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
function Graded({ colour, hidden, children }: { colour: CutColour | undefined; hidden?: boolean; children: ReactElement<{ style?: CSSProperties }> }) {
  const steps = colourSteps(colour);
  const css = steps ? colourCss(steps) : null;
  return (
    <div className={styles.graded} data-hidden={hidden || undefined}>
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
  latestExport: Project['exports'][number] | undefined;
  /** The export line when the latest export is older than the timeline's last change. */
  stale: string | null;
};

/**
 * Plays the picked cut within its trim, the whole timeline in order, or the
 * latest export. While the timeline plays, the next cut is already loading in
 * a hidden player seeked to its in point, so each cut starts the moment the
 * one before it ends.
 */
function Player({ active, items, selected, mediaOf, posterOf, latestExport, stale }: PlayerProps) {
  const videos = useRef(new Map<string, HTMLVideoElement>());
  const exportRef = useRef<HTMLVideoElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
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
  const exportReady = latestExport?.status === 'succeeded' && latestExport.finalId;
  useEffect(() => {
    if (exportReady) setMode('export');
  }, [exportReady]);

  const cut =
    mode === 'timeline'
      ? (items[at] ?? items[0])
      : (items.find((c) => c.key === selected) ?? items[0]);
  const exportSrc = exportReady ? libraryUrl('edit', latestExport.finalId!) : null;
  const exportGrades = latestExport?.grades ?? [];
  const exportGraded = exportGrades.some((g) => !isNeutral(g.colour));
  // Which cut of the export is on screen, so its grade can be shown over it.
  const trackExport = (v: HTMLVideoElement) => {
    if (!exportGraded || !latestExport || !v.duration) return;
    const ends = cutEnds(
      exportGrades.map((g) => g.seconds),
      latestExport.transition,
      latestExport.fadeSeconds ?? 0.5,
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
  const status =
    graded.pending || !!saver.error || !!graded.error || latestExport?.status === 'pending' || latestExport?.status === 'failed';
  return (
    <div className={styles.player} data-status={status || undefined}>
      <div className={styles.fit}>
        <div className={`${styles.screen} ${frameGuidesClass}`} ref={screenRef}>
          {!active ? null : mode === 'export' && exportSrc ? (
            <Graded colour={exportGrades[exportCut]?.colour}>
              <video
                key={exportSrc}
                ref={exportRef}
                src={exportSrc}
                poster={exportPoster}
                playsInline
                muted
                preload="metadata"
                onTimeUpdate={(e) => trackExport(e.currentTarget)}
                onSeeked={(e) => trackExport(e.currentTarget)}
                onLoadedData={() => setExportFrame(true)}
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
      {mode === 'export' && exportSrc ? (
        <Transport
          video={onScreen}
          inPoint={0}
          length={undefined}
          fallback={latestExport?.seconds}
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
          ? (stale ?? `The exported film, ${latestExport?.seconds}s, ${latestExport?.cuts} cuts.`)
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
            onPress={() => saver.start(libraryUrl('edit', latestExport.finalId!), 'render-to-film.mp4')}
          >
            {saver.label(exportGraded ? 'Download ungraded' : 'Download film')}
          </Button>
        )}
        {exportReady && exportGraded && (
          <Button
            variant="ghost"
            icon={<Palette size={16} />}
            loading={graded.pending}
            onPress={() =>
              graded.start(
                libraryUrl('edit', latestExport.finalId!),
                { grades: exportGrades, transition: latestExport.transition, fadeSeconds: latestExport.fadeSeconds },
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
      {latestExport?.status === 'pending' && (
        <div className={styles.exportBand}>
          <RenderingStatus label="Exporting the film…" runKey={latestExport.id} />
        </div>
      )}
      {latestExport?.status === 'failed' && (
        <Alert tone="error" title="The export stopped" className={styles.exportStatus}>
          {latestExport.error ?? 'Runway could not put the film together.'}{' '}
          {latestExport.finalId || latestExport.parts
            ? 'Check again to pick it up where it left off, or press Export film to start over.'
            : 'Press Export film to start over.'}
          {(latestExport.finalId || latestExport.parts) && (
            <div className={styles.alertActions}>
              <Button
                size="sm"
                icon={<RotateCw size={14} />}
                loading={resume.isPending}
                onPress={() => resume.mutate({ id: latestExport.id })}
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

function EditorChat({ data, flush, loading }: { data: Project | undefined; flush: () => Promise<boolean>; loading: boolean }) {
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
      await send.mutateAsync({ text: message.trim() });
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
        onConfirm={() => void clearGuard.wrap(() => clear.mutateAsync().catch(() => undefined))()}
        onCancel={() => setConfirmClear(false)}
      >
        The messages go; the timeline and the editor's memory stay.
      </ConfirmDialog>
    </div>
  );
}

function Memory({ memory, loading }: { memory: string[] | undefined; loading: boolean }) {
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
    if (text.trim().length < 2) return;
    void guard.wrap(() => add.mutateAsync({ text: text.trim() }).catch(() => undefined))();
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
          if (forgetting) void guard.wrap(() => forget.mutateAsync({ text: forgetting }).catch(() => undefined))();
        }}
        onCancel={() => setForgetting(null)}
      >
        {forgetting}
      </ConfirmDialog>
    </div>
  );
}
