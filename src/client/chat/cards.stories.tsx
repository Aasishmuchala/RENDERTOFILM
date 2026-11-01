import { type ReactNode, useState } from 'react';

import type { QuoteView, RunView, Step, StepId, StepState } from '../../chat/domain.ts';
import { formatHash, type Handoff } from '../handoff.ts';
import { QuoteCard } from './QuoteCard.tsx';
import { ResultCard } from './ResultCard.tsx';
import { RunCard } from './RunCard.tsx';
import { RunTray } from './RunTray.tsx';

/**
 * Every state of the chat cards from fixtures, for looking at them without a
 * film in progress: `#chat?gallery=1`. Dev only. The fixture ids are not in any
 * library, so pictures show as empty frames here unless something serves them.
 */

const STEP_IDS: StepId[] = ['plan', 'cast', 'stills', 'direct', 'clips', 'cut', 'master', 'qc'];
const MINUTE = 60_000;

function fixtures(now: number) {
  const quote = (over: Partial<QuoteView>): QuoteView => ({
    id: 'quote-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    specHash: 'hash',
    spec: { kind: 'stills', stillIds: ['still-1', 'still-2', 'still-3'] },
    unit: 'credits',
    amount: 42,
    items: [
      { label: 'Stills', count: 3, unitAmount: 4, amount: 12 },
      { label: 'Clips', count: 6, unitAmount: 5, amount: 30 },
    ],
    createdAt: now - 2 * MINUTE,
    expiresAt: now + 28 * MINUTE,
    state: 'open',
    ...over,
  });
  const steps = (...states: StepState[]): Step[] =>
    STEP_IDS.map((id, i) => ({ id, state: states[i] ?? 'pending', ids: [], startedAt: now - 134_000 }));
  const run = (over: Partial<RunView>): RunView => ({
    id: 'run-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    kind: 'lifestyle_film',
    spec: { kind: 'lifestyle_film', lifestyleJobId: 'job-1', seconds: 60 },
    specHash: 'hash',
    quoteId: 'quote-1',
    state: 'running',
    steps: steps('done', 'skipped', 'running'),
    createdAt: now - 10 * MINUTE,
    updatedAt: now,
    outputs: { stillIds: [], clipIds: [] },
    percent: 25,
    label: 'Shooting stills 7 of 12',
    ...over,
  });
  const finished = steps('done', 'skipped', 'done', 'done', 'done', 'done', 'done', 'done');
  return {
    quotes: {
      open: quote({}),
      lifestyle: quote({ spec: { kind: 'lifestyle_film', seconds: 60 } }),
      bay: quote({
        amount: null,
        items: [
          { label: 'Stills', count: 3, unitAmount: null, amount: null },
          { label: 'Clips', count: 6, unitAmount: null, amount: null },
        ],
      }),
      approved: quote({ state: 'approved', source: 'click', decidedAt: now - MINUTE }),
      declined: quote({ state: 'declined', reason: 'user', decidedAt: now - MINUTE }),
      replaced: quote({ state: 'declined', reason: 'superseded', decidedAt: now - MINUTE }),
      expired: quote({ state: 'expired', expiresAt: now - MINUTE }),
    },
    runs: {
      queued: run({ state: 'queued', steps: steps(), percent: 0, label: 'Waiting to start' }),
      running: run({}),
      waiting: run({ state: 'awaiting_user', label: 'Waiting for you' }),
      done: run({
        id: 'run-2',
        state: 'done',
        steps: finished,
        percent: 100,
        label: 'Done',
        outputs: { stillIds: [], clipIds: [], exportId: 'export-1' },
      }),
      failed: run({
        id: 'run-3',
        state: 'failed',
        steps: steps('done', 'skipped', 'failed'),
        error: 'The provider could not read one of the renders.',
        label: 'The provider could not read one of the renders.',
      }),
      unknown: run({
        id: 'run-4',
        state: 'submit_unknown',
        steps: steps('done', 'skipped', 'done', 'done', 'submit_unknown'),
        percent: 50,
        label: 'Check the Library before running again',
      }),
      stopped: run({ id: 'run-5', state: 'stopped', steps: steps('done', 'skipped', 'running'), label: 'Stopped' }),
    },
  };
}

const RESULTS = [
  { id: 'item-1', name: 'Terrace at dusk' },
  { id: 'item-2', name: 'Pool, wide, with the long name a real still can have' },
  { id: 'item-3', name: 'Lobby' },
  { id: 'item-4', name: 'Bedroom' },
  { id: 'item-5', name: 'Garden path' },
];

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 16 }}>
      <h2 style={{ margin: 0, font: 'var(--text-title-3)', letterSpacing: 'var(--track-title-3)' }}>{title}</h2>
      {children}
    </section>
  );
}

export function CardsGallery() {
  const [{ quotes, runs }] = useState(() => fixtures(Date.now()));
  const [last, setLast] = useState('Nothing yet');
  const onOpen = ({ page, params }: Handoff) => setLast(formatHash(page, params));
  const said = (what: string) => () => setLast(what);
  const quoteProps = { onApprove: said('approve'), onDecline: said('decline') };
  const runProps = { onOpen, onStop: said('stop') };
  return (
    <div style={{ display: 'grid', gap: 32, maxWidth: 760, margin: '0 auto', padding: '24px 16px' }}>
      <p role="status" style={{ margin: 0, font: 'var(--text-footnote)', color: 'var(--bay-text-2)' }}>
        Last action: {last}
      </p>
      <Group title="Quotes">
        <QuoteCard quote={quotes.open} allowanceLeft={120} {...quoteProps} />
        <QuoteCard quote={quotes.lifestyle} assetKeys={['chat-assets/local/render-1.jpg']} {...quoteProps} />
        <QuoteCard quote={quotes.open} busy {...quoteProps} />
        <QuoteCard quote={quotes.bay} bay {...quoteProps} />
        <QuoteCard quote={quotes.approved} {...quoteProps} />
        <QuoteCard quote={quotes.declined} {...quoteProps} />
        <QuoteCard quote={quotes.replaced} {...quoteProps} />
        <QuoteCard quote={quotes.expired} {...quoteProps} />
      </Group>
      <Group title="Runs">
        <RunCard run={runs.queued} {...runProps} />
        <RunCard run={runs.running} {...runProps} />
        <RunCard run={runs.running} bay {...runProps} />
        <RunCard run={runs.waiting} {...runProps} />
        <RunCard run={runs.done} {...runProps} />
        <RunCard run={runs.failed} {...runProps} />
        <RunCard run={runs.unknown} {...runProps} />
        <RunCard run={runs.stopped} {...runProps} />
      </Group>
      <Group title="Results">
        <ResultCard kind="still" items={RESULTS} onOpen={onOpen} />
        <ResultCard
          kind="clip"
          items={RESULTS.slice(0, 3)}
          onOpen={onOpen}
          onKeep={(id) => setLast(`keep ${id}`)}
          onDiscard={(id) => setLast(`discard ${id}`)}
        />
        <ResultCard kind="edit" items={[{ id: 'export-1', name: 'Lifestyle film', mediaId: 'final-1' }]} onOpen={onOpen} />
        <ResultCard kind="edit" items={[{ id: 'export-2', name: 'Lifestyle film, no file yet' }]} onOpen={onOpen} />
      </Group>
      <Group title="Tray">
        <div className="glass-thick" style={{ justifySelf: 'start', padding: 6, borderRadius: 'var(--r-card)' }}>
          <RunTray runs={[runs.running, runs.done, runs.failed, runs.unknown]} onOpen={onOpen} />
        </div>
      </Group>
    </div>
  );
}
