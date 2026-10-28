import type { CutColour } from './colour.ts';
import { gradeName } from './grades.ts';

/**
 * The Edit tab's data shapes and the pure helpers the server and the page
 * share. Storage lives in src/edits.ts.
 */

export type TaskState = 'pending' | 'succeeded' | 'failed';

/**
 * One cut on the Edit tab's timeline. `clipId` is the library clip it came
 * from; `versionId` the graded or AI-edited copy now in use (a `Derived`
 * id), unset for the original. `pendingId` is a copy still rendering.
 */
export type TimelineItem = {
  key: string;
  clipId: string;
  versionId?: string | undefined;
  pendingId?: string | undefined;
  /** Seconds into the source the cut starts, and how long it runs. */
  sourceStart: number;
  duration: number;
  /** Why the cut's last grade or edit failed, until the next one starts. */
  lastError?: string | undefined;
  /** The built-in grade drawn over the cut (src/colour.ts); no re-render. */
  colour?: CutColour | undefined;
};

/** A graded or AI-edited copy of a clip (Aleph 2.0). `id` is its task id. */
export type Derived = {
  id: string;
  /** What it was made from: a library clip id or another `Derived` id. */
  parentId: string;
  kind: 'grade' | 'edit';
  gradeId?: string | undefined;
  instruction?: string | undefined;
  seconds: number;
  status: TaskState;
  error?: string | undefined;
  createdAt: string;
};

/**
 * An export of the timeline. A hard-cut film is one `timeline_export` task;
 * a film with fades first trims each cut (`parts`), then stitches them.
 */
export type ExportJob = {
  id: string;
  createdAt: string;
  status: TaskState;
  error?: string | undefined;
  transition: 'hard' | 'fade';
  seconds: number;
  cuts: number;
  /** Fades only: each cut as a trim task, or as a whole clip's asset id. */
  parts?:
    | { trimId?: string | undefined; assetId?: string | undefined; seconds?: number | undefined }[]
    | undefined;
  fadeSeconds?: number | undefined;
  /** Set once one poll has claimed the stitch, so it is submitted once. */
  stitchAt?: string | undefined;
  /** Which poll claimed it (a random id; two polls can share a millisecond). */
  stitchBy?: string | undefined;
  /** The task whose artifact is the film; set once it has been submitted. */
  finalId?: string | undefined;
  /** Each cut's length and built-in grade when exported, to grade the film's download. */
  grades?: { key?: string | undefined; seconds: number; colour?: CutColour | undefined }[] | undefined;
  /** Polls in a row that could not reach Runway; the job fails after a few. */
  pollErrors?: number | undefined;
};

export type ChatMessage = {
  role: 'user' | 'agent';
  text: string;
  at: string;
  /** What the editor did on this turn, one plain line each. */
  actions?: string[] | undefined;
  error?: boolean | undefined;
};

export type EditDoc = {
  timeline: TimelineItem[];
  transition: 'hard' | 'fade';
  fadeSeconds: number;
  derived: Derived[];
  exports: ExportJob[];
  messages: ChatMessage[];
  /** Standing preferences the AI editor keeps across sessions. */
  memory: string[];
  /** The editor's turn in flight; `handles` maps "c1"… to the clip ids it was shown. */
  agent?:
    | {
        taskId: string;
        status: 'running' | 'applying';
        at: string;
        /** Which poll is applying the plan (a random id; two polls can share a millisecond). */
        by?: string | undefined;
        handles: Record<string, string>;
        /** The timeline's cut keys when the message was sent, so "cut 2" still means that cut. */
        cutKeys: string[];
      }
    | undefined;
};

/** The id whose media a cut plays: its current copy, else the library clip. */
export function playId(item: TimelineItem): string {
  return item.versionId ?? item.clipId;
}

/** The copies a cut's current version was built from, oldest first. */
export function versionChain(derived: readonly Derived[], item: TimelineItem): Derived[] {
  const chain: Derived[] = [];
  let id = item.versionId;
  while (id && chain.length < 20) {
    const d = derived.find((x) => x.id === id);
    if (!d) break;
    chain.unshift(d);
    id = d.parentId;
  }
  return chain;
}

/** One short phrase per copy: "Warm luxury grade", "edit: light rain". */
export function versionNotes(derived: readonly Derived[], item: TimelineItem): string[] {
  return versionChain(derived, item).map(derivedLabel);
}

export function derivedLabel(d: Derived): string {
  return d.kind === 'grade'
    ? `${gradeName(d.gradeId)} grade`
    : `edit: ${d.instruction ?? ''}`;
}

/** The library clip a cut or copy ultimately comes from. */
export function rootClipId(derived: readonly Derived[], id: string): string {
  let cur = id;
  for (let i = 0; i < 20; i++) {
    const d = derived.find((x) => x.id === cur);
    if (!d) return cur;
    cur = d.parentId;
  }
  return cur;
}
