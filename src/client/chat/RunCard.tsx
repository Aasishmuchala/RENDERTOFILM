import {
  Check,
  CircleDashed,
  CirclePause,
  CircleQuestionMark,
  Clock,
  LoaderCircle,
  Minus,
  OctagonX,
} from 'lucide-react';

import type { RunState, RunView, StepId, StepState } from '../../chat/domain.ts';
import type { Handoff } from '../handoff.ts';
import { Button } from '../ui/Button.tsx';
import { Elapsed } from '../ui/RenderingStatus.tsx';
import { KIND_TITLE } from './QuoteCard.tsx';
import styles from './RunCard.module.css';

export type RunCardProps = {
  run: RunView;
  onOpen: (handoff: Handoff) => void;
  onStop: () => void;
  /** Bay has no clock of its own: a Run moves only while a tab polls. */
  bay?: boolean | undefined;
};

const STEP_NAMES: Record<StepId, string> = {
  plan: 'Plan',
  cast: 'Cast sheets',
  stills: 'Stills',
  direct: 'Shot direction',
  clips: 'Clips',
  cut: 'Cut',
  master: 'Master',
  qc: 'Quality check',
};

/** Said beside the step, because a glyph is not a word; a done or waiting step needs it only for a screen reader. */
const STEP_WORDS: Record<StepState | 'stopped', string> = {
  pending: 'Waiting',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
  submit_unknown: 'Not sure it was sent',
  stopped: 'Stopped',
};

const GLYPHS = {
  queued: Clock,
  pending: CircleDashed,
  running: LoaderCircle,
  awaiting_user: CirclePause,
  done: Check,
  failed: OctagonX,
  stopped: Minus,
  skipped: Minus,
  submit_unknown: CircleQuestionMark,
};

/** The shape that says a Run's or a Step's state, so no state rests on colour. */
export function StateGlyph({ state, size = 16 }: { state: RunState | StepState; size?: number | undefined }) {
  const Glyph = GLYPHS[state];
  return <Glyph size={size} aria-hidden className={state === 'running' ? styles.spin : undefined} />;
}

/** The headline of a Run the line alone cannot name: its `label` is then the detail under it. */
const HEADLINES: Partial<Record<RunState, string>> = {
  failed: 'Failed',
  submit_unknown: 'Not sure the last step was sent',
};

/** One line for a place too small for a headline: the state word first, then the detail. */
export function runLine(run: RunView): string {
  const headline = HEADLINES[run.state];
  return headline && headline !== run.label ? `${headline}: ${run.label}` : run.label;
}

const ACTIVE: RunState[] = ['queued', 'running', 'awaiting_user'];

/** Where a finished Run leads, best first. */
export function runExits(run: RunView): { label: string; handoff: Handoff }[] {
  if (run.state !== 'done') return [];
  const { exportId } = run.outputs;
  const { lifestyleJobId } = run.spec;
  return [
    ...(exportId
      ? [{ label: 'Open in Editing', handoff: { page: 'edit' as const, params: { export: exportId } } }]
      : run.kind === 'cut'
        ? [{ label: 'Open in Editing', handoff: { page: 'edit' as const, params: {} } }]
        : []),
    ...(lifestyleJobId
      ? [{ label: 'Open in Lifestyle', handoff: { page: 'lifestyle' as const, params: { job: lifestyleJobId } } }]
      : []),
  ];
}

/**
 * One Run as it moves: the line of what is happening now, a thin bar, every
 * Step by glyph, and the way into what it made. Stopping only stops following:
 * a provider task already sent carries on, and the button says exactly that.
 */
export function RunCard({ run, onOpen, onStop, bay = false }: RunCardProps) {
  const active = ACTIVE.includes(run.state);
  const headline = HEADLINES[run.state] ?? run.label;
  const exits = runExits(run);
  return (
    <div className={styles.card} role="group" aria-label={`Run: ${KIND_TITLE[run.kind]}`}>
      <p className={styles.title}>{KIND_TITLE[run.kind]}</p>
      {/* Always mounted, so a change is announced; the clock is in the step, or it would be read out every second. */}
      <p className={styles.status} role="status">
        <StateGlyph state={run.state} />
        {headline}
      </p>
      {headline !== run.label && <p className={styles.line}>{run.label}</p>}
      {run.state === 'stopped' && <p className={styles.line}>Work already sent finishes on its own.</p>}
      <div
        className={styles.bar}
        role="progressbar"
        aria-label="Progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={run.percent}
      >
        <span className={styles.fill} style={{ transform: `scaleX(${run.percent / 100})` }} />
      </div>
      <ol className={styles.steps}>
        {run.steps.map((step) => {
          // Stopping changes only the Run: the step it was on stays `running`, and nothing is following it now.
          const state = step.state === 'running' && !active ? 'stopped' : step.state;
          return (
            <li key={step.id} className={styles.step}>
              <StateGlyph state={state} size={14} />
              <span className={styles.name}>{STEP_NAMES[step.id]}</span>
              {state === 'running' ? (
                <span className={styles.note}>
                  <span className={styles.srOnly}>{STEP_WORDS.running}</span>
                  <span aria-hidden>
                    <Elapsed since={step.startedAt} />
                  </span>
                </span>
              ) : (
                <span className={state === 'done' || state === 'pending' ? styles.srOnly : styles.note}>
                  {STEP_WORDS[state]}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {bay && active && <p className={styles.line}>Runs continue while this tab is open.</p>}
      {active && (
        <div className={styles.actions}>
          <Button variant="ghost" className={styles.stop} onPress={onStop}>
            Stop following
          </Button>
        </div>
      )}
      {exits.length > 0 && (
        <div className={styles.actions}>
          {exits.map((exit, i) => (
            <Button key={exit.label} variant={i === 0 ? 'primary' : 'default'} size="lg" onPress={() => onOpen(exit.handoff)}>
              {exit.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
