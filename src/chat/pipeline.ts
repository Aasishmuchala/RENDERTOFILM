// The film pipeline, pure: the steps of each kind of Run, how many clips a film
// needs and how long each runs, which planned frames become them, the cut that
// joins the clips, how long the film is, what a Run really spent and the one
// line a Run card shows. The RunEngine drives the steps and the Pricer reads the
// same shape, so a Quote prices what gets made; nothing here touches a provider
// or a document.
import type { Quote, Run, RunKind, RunSpec, RunView, Step, StepId } from './domain.ts';

/** A film nobody gave a length is a minute of five-second clips. */
export const DEFAULT_SECONDS = 60;
export const DEFAULT_CLIP_SECONDS = 5;

const STEPS: Record<RunKind, StepId[]> = {
  lifestyle_film: ['plan', 'cast', 'stills', 'direct', 'clips', 'cut', 'master', 'qc'],
  stills: ['stills'],
  clips: ['direct', 'clips'],
  cut: ['cut'],
  master: ['master', 'qc'],
};

/** The steps of a Run of this kind, in order. */
export function stepsFor(kind: RunKind): StepId[] {
  return [...STEPS[kind]];
}

/** How many clips cover `seconds`: a film is never shorter than asked. */
export function clipCount(seconds: number, clipSeconds: number): number {
  return Math.ceil(seconds / clipSeconds);
}

/** One frame of a Lifestyle plan, as far as choosing needs to know it. */
export type PlanFrame = {
  index: number;
  chapter: string;
  grammar: 'wide' | 'mid' | 'close' | 'detail' | 'empty';
  people: boolean;
};

const GRAMMAR_ORDER: PlanFrame['grammar'][] = ['wide', 'mid', 'close', 'detail', 'empty'];

/**
 * The `n` frames that become clips. The chapters keep the order they first
 * appear in and are taken round-robin, one frame from each per round, so a short
 * film still visits every chapter. Inside a chapter a frame with people goes
 * first, then a grammar the chapter has not used yet, in the order wide, mid,
 * close, detail; an empty frame waits until the chapter has nothing else. Stops
 * at `n` or when the frames run out, and never names an index twice.
 */
export function pickFrames(frames: PlanFrame[], n: number): number[] {
  const chapters = new Map<string, PlanFrame[]>();
  for (const f of frames) {
    const list = chapters.get(f.chapter);
    if (list) list.push(f);
    else chapters.set(f.chapter, [f]);
  }
  const used = new Map<string, Set<PlanFrame['grammar']>>();
  const take = (chapter: string, left: PlanFrame[]): PlanFrame => {
    const seen = used.get(chapter) ?? new Set<PlanFrame['grammar']>();
    // Smallest wins: not empty, people, a new grammar, the grammar order, then the plan's own order.
    const rank = (f: PlanFrame) => [
      f.grammar === 'empty' ? 1 : 0,
      f.people ? 0 : 1,
      seen.has(f.grammar) ? 1 : 0,
      GRAMMAR_ORDER.indexOf(f.grammar),
      f.index,
    ];
    const before = (a: PlanFrame, b: PlanFrame) => {
      const [ra, rb] = [rank(a), rank(b)];
      const k = ra.findIndex((v, i) => v !== rb[i]);
      return k >= 0 && (ra[k] as number) < (rb[k] as number);
    };
    const best = left.reduce((a, b) => (before(b, a) ? b : a));
    seen.add(best.grammar);
    used.set(chapter, seen);
    return best;
  };

  const picked: number[] = [];
  while (picked.length < n && [...chapters.values()].some((left) => left.length > 0)) {
    for (const [chapter, left] of chapters) {
      if (picked.length >= n) break;
      if (left.length === 0) continue;
      const f = take(chapter, left);
      left.splice(left.indexOf(f), 1);
      picked.push(f.index);
    }
  }
  return picked;
}

/**
 * The timeline that lays the clips end to end. A cut lasts as long as its clip,
 * counted in seconds as the Editing document does. saveTimeline matches a cut
 * to the saved one by key and keeps that cut's grade, so a Run passes a
 * `keyPrefix` of its own, like `cut-${run.id}`: keys another film shares would
 * play that film's graded shot here. The same prefix gives the same keys, so
 * a Run that cuts again keeps its grades.
 */
export function cutFor(
  clipIds: string[],
  clipSeconds: number,
  transition: 'hard' | 'fade' = 'fade',
  fadeSeconds = 0.5,
  keyPrefix = 'cut'
): {
  items: { key: string; clipId: string; sourceStart: number; duration: number }[];
  transition: 'hard' | 'fade';
  fadeSeconds: number;
} {
  return {
    items: clipIds.map((clipId, i) => ({
      key: `${keyPrefix}-${i + 1}`,
      clipId,
      sourceStart: 0,
      duration: clipSeconds,
    })),
    transition,
    fadeSeconds,
  };
}

/** The film's length: the clips, less the overlap of each fade between neighbours. */
export function filmSeconds(n: number, clipSeconds: number, fade: number): number {
  return n <= 0 ? 0 : n * clipSeconds - (n - 1) * fade;
}

export type FilmShape = { clips: number; clipSeconds: number; filmSeconds: number };

/**
 * The film `frames` frames can make. Frames that cover the wanted clips make them
 * at the asked length. Fewer frames each run longer, since a plan's frame is never
 * shot twice: the shortest of the model's `durations` that reaches `seconds` once
 * the fades are taken off, or the longest there is.
 */
export function filmShape({
  seconds,
  clipSeconds,
  frames,
  fade,
  durations,
}: {
  seconds: number;
  clipSeconds: number;
  frames: number;
  fade: number;
  durations: readonly number[];
}): FilmShape {
  // A clip of no length counts no clips, and is the timeline's to refuse.
  const wanted = clipSeconds > 0 ? clipCount(seconds, clipSeconds) : frames;
  const clips = Math.min(wanted, frames);
  const lengths = [...durations].sort((a, b) => a - b);
  const length =
    clips === 0 || clips === wanted || lengths.length === 0
      ? clipSeconds
      : (lengths.find((d) => filmSeconds(clips, d, fade) >= seconds) ?? (lengths.at(-1) as number));
  return { clips, clipSeconds: length, filmSeconds: filmSeconds(clips, length, fade) };
}

/** The fade a spec's timeline keeps, within the tenth of a second to 4.9 the timeline takes. */
export function fadeOf(spec: RunSpec): number {
  return Math.min(4.9, Math.max(0.1, spec.fadeSeconds ?? 0.5));
}

/** How much neighbouring clips overlap: nothing on hard cuts, whatever fade the spec keeps. */
export function overlapOf(spec: RunSpec): number {
  return spec.transition === 'hard' ? 0 : fadeOf(spec);
}

/**
 * The length a spec's clips run before anything stretches them. `createVideo` sends
 * the model's nearest length, the shorter on a tie (snapVideoSeconds), so the clips
 * are counted and priced on that one and not on the one asked for. A length that is
 * no whole number of seconds never gets that far: it stays, for the routers to refuse.
 */
function askedLength(spec: RunSpec, durations: readonly number[]): number {
  const asked = spec.clipSeconds ?? DEFAULT_CLIP_SECONDS;
  if (durations.length === 0 || !Number.isInteger(asked) || asked < 1) return asked;
  const nearest = (best: number, d: number) => (Math.abs(d - asked) < Math.abs(best - asked) ? d : best);
  return [...durations].sort((a, b) => a - b).reduce(nearest);
}

/** The shape of what a spec makes from `frames` frames: only a film has a length to reach; a Run of clips keeps the asked one, as the model makes it. */
export function shapeOf(spec: RunSpec, frames: number, durations: readonly number[]): FilmShape {
  const clipSeconds = askedLength(spec, durations);
  const fade = overlapOf(spec);
  if (spec.kind !== 'lifestyle_film' && spec.kind !== 'stills') {
    return { clips: frames, clipSeconds, filmSeconds: filmSeconds(frames, clipSeconds, fade) };
  }
  return filmShape({ seconds: spec.seconds ?? DEFAULT_SECONDS, clipSeconds, frames, fade, durations });
}

/** What a Quote says when the renders cannot reach the film asked for, like "3 renders make a 28 second film." */
export function shortNote(spec: RunSpec, shape: FilmShape, durations: readonly number[] = []): string | undefined {
  const seconds = spec.seconds ?? DEFAULT_SECONDS;
  const wanted = clipCount(seconds, askedLength(spec, durations));
  if (shape.clips === 0 || shape.clips >= wanted || shape.filmSeconds >= seconds) return undefined;
  const renders = shape.clips === 1 ? '1 render makes' : `${shape.clips} renders make`;
  return `${renders} a ${Math.round(shape.filmSeconds)} second film.`;
}

/** The rate a film's cuts are counted at when no clip says otherwise (src/edit-api.ts). */
const FILM_FPS = 24;

/**
 * Why `clips` clips of `clipSeconds` cannot carry this fade, in the master's own
 * words and whole frames (fadeFrames in desktop/platform/master.js): an end cut
 * carries one fade and a cut between two carries both, so two clips need the fade
 * under a clip and three or more under half of one. One clip has no fade.
 */
export function fadeProblem(clips: number, clipSeconds: number, fade: number): string | undefined {
  if (clips < 2 || !(fade > 0)) return undefined;
  const frames = Math.max(1, Math.round(clipSeconds * FILM_FPS));
  const faded = Math.max(1, Math.round(fade * FILM_FPS));
  if (frames > (clips === 2 ? faded : 2 * faded)) return undefined;
  return 'The fade must be shorter than the first and last cuts, and under half of every cut between them.';
}

/** The lines of a Quote: the Pricer names them from here and `spentOn` reads them back. */
export const QUOTE_LINES = {
  stills: 'Stills',
  pass2: 'Second pass',
  cast: 'Cast sheets',
  clips: 'Clips',
  cut: 'Cut',
  master: 'Master',
} as const;

/** The line a step's ids count on. Director calls are text, which is free and has no line. */
const LINE_OF_STEP: Partial<Record<StepId, string>> = {
  cast: QUOTE_LINES.cast,
  stills: QUOTE_LINES.stills,
  clips: QUOTE_LINES.clips,
  master: QUOTE_LINES.master,
};

/** A step's paid calls that went out or may have: its ids, and an intent still waiting for its answer or whose answer was lost. */
function madeBy(step: Step): number {
  if (step.intent === undefined || (step.state !== 'running' && step.state !== 'submit_unknown')) return step.ids.length;
  const expected = step.meta?.['expected'];
  return Math.max(step.ids.length, typeof expected === 'number' ? expected : 1);
}

/**
 * What a Run that ended really spent, in the Quote's own prices: 0 when nothing paid
 * for went out, else each line priced for what was made, past the line or the hold
 * when more was: what was made is what is recorded.
 * One cast call pays for a sheet per chapter, so one with no answer counts the whole
 * of its line. Null only when there is no better number: a done Run whose Quote has
 * no lines to read, or a price nobody knows. A Run cut short whose lines cannot be
 * read counts the hold, since it may have spent all of it.
 */
export function spentOn(run: Run, quote: Pick<Quote, 'amount' | 'items'> | null): number | null {
  const made = new Map<string, number>();
  for (const step of run.steps) {
    const line = LINE_OF_STEP[step.id];
    if (line) made.set(line, step.id === 'cast' && madeBy(step) > step.ids.length ? Infinity : madeBy(step));
    const passes = step.meta?.['passes'];
    if (step.id === 'stills' && typeof passes === 'number') made.set(QUOTE_LINES.pass2, passes);
  }
  if (!run.steps.some((s) => madeBy(s) > 0)) return 0;
  if (!quote) return null;
  const lines = quote.items.flatMap((item) => {
    const had = made.get(item.label) ?? 0;
    const count = had === Infinity ? item.count : had;
    return count > 0 ? [{ count, unitAmount: item.unitAmount }] : [];
  });
  if (quote.items.length === 0 || lines.some((l) => l.unitAmount === null)) return run.state === 'done' ? null : quote.amount;
  const spent = lines.reduce((sum, l) => sum + l.count * (l.unitAmount as number), 0);
  return Math.round(spent * 1e6) / 1e6;
}

/**
 * Why a Run may not go on from `shape` and the `sheets` it would still buy: the plan
 * moved after the Quote, and a clip longer than priced, more of them, or more cast
 * sheets would bill past what was approved. Fewer frames can stretch every clip, so a
 * smaller plan can still cost more, and the same clips from other frames can need
 * more sheets. A Quote of 0 approved itself and pays for nothing. One with no lines
 * and a real amount has nothing to read.
 */
export function pastQuote(quote: Pick<Quote, 'amount' | 'items'> | null, shape: FilmShape, sheets = 0): string | undefined {
  if (!quote || (quote.items.length === 0 && quote.amount !== 0)) return undefined;
  const line = quote.items.find((i) => i.label === QUOTE_LINES.clips) ?? quote.items.find((i) => i.label === QUOTE_LINES.stills);
  const cast = quote.items.find((i) => i.label === QUOTE_LINES.cast);
  const past = line
    ? shape.clips > line.count || (line.seconds !== undefined && shape.clipSeconds > line.seconds)
    : shape.clips > 0;
  if (!past && sheets <= (cast?.count ?? 0)) return undefined;
  return 'The plan changed after this was priced, so the film would cost more than you approved. Ask for a new quote.';
}

/** The first step still to do, or null when none is. */
export function nextStep(run: Run): Step | null {
  return run.steps.find((s) => s.state === 'pending' || s.state === 'running') ?? null;
}

const LABELS: Record<StepId, string> = {
  plan: 'Planning the film',
  cast: 'Making the cast sheets',
  stills: 'Shooting stills',
  direct: 'Directing shots',
  clips: 'Making clips',
  cut: 'Cutting the film',
  master: 'Mastering',
  qc: 'Checking the master',
};

/** The steps whose label counts how many of the film's frames are through. */
const COUNTED: StepId[] = ['stills', 'direct', 'clips'];

/** One line for a card, like "Shooting stills 7 of 12". */
export function summarize(run: Run): string {
  switch (run.state) {
    case 'queued':
      return 'Waiting to start';
    case 'awaiting_user':
      return 'Waiting for you';
    case 'done':
      return 'Done';
    case 'stopped':
      return 'Stopped';
    case 'failed':
      return run.error ?? 'Failed';
    case 'submit_unknown':
      return 'Check the Library before running again';
    case 'running':
      break;
  }
  const step = nextStep(run);
  if (!step) return 'Finishing';
  if (!COUNTED.includes(step.id)) return LABELS[step.id];
  const chosen = run.steps.find((s) => s.id === 'stills')?.meta?.['frames'];
  const total =
    run.spec.stillIds?.length ||
    (Array.isArray(chosen) ? chosen.length : 0) ||
    clipCount(run.spec.seconds ?? DEFAULT_SECONDS, run.spec.clipSeconds ?? DEFAULT_CLIP_SECONDS);
  return `${LABELS[step.id]} ${step.ids.length} of ${total}`;
}

/** The Run as the client sees it: the share of steps done (a skipped one counts) and the line. */
export function runView(run: Run): RunView {
  const total = run.steps.length;
  const through = run.steps.filter((s) => s.state === 'done' || s.state === 'skipped').length;
  return { ...run, percent: total === 0 ? 0 : Math.round((100 * through) / total), label: summarize(run) };
}
