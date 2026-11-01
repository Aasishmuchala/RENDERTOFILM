import { ChevronRight, LoaderCircle, Music } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

import type { Asset, MessageView, QuoteView, RunView, Unit } from '../../chat/domain.ts';
import type { Handoff } from '../handoff.ts';
import { type Entry, resultsOf, type ToolStep } from '../lib/useChat.ts';
import { Alert } from '../ui/Alert.tsx';
import { QuoteCard } from './QuoteCard.tsx';
import { ResultCard, type ResultKind, Thumb } from './ResultCard.tsx';
import { RunCard } from './RunCard.tsx';
import styles from './Transcript.module.css';

export type TranscriptProps = {
  entries: Entry[];
  /** What the live Turn has said so far; '' before its first words, null with no Turn live. */
  draft: string | null;
  /** Bay: a Quote shows no rates, and a Run goes on only with the tab open. */
  bay: boolean;
  /** The Quote being decided. */
  deciding: string | null;
  /** A refusal, or a price that moved, for one Quote's card. */
  decideNote: { quoteId: string; message: string } | null;
  /** What today's Allowance still covers, in its unit: only a Quote in that unit shows the line. */
  allowance: { unit: Unit; left: number } | null;
  /** Quote id to the renders its plan was made from. */
  quoteInputs: Record<string, string[]>;
  /** Export id to its file. */
  films: Record<string, string>;
  onDecide: (quoteId: string, decision: 'approve' | 'decline') => void;
  onStopRun: (runId: string) => void;
  onOpen: (handoff: Handoff) => void;
};

/** The history a thread opens with is on screen already; only what comes after it is read out. */
const SETTLE_MS = 500;

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

type Block = { kind: 'p'; lines: string[] } | { kind: 'ul' | 'ol'; items: string[] };

/** The markdown a reply may use: paragraphs and lists. A blank line ends a paragraph and not a list. */
function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  let open: Block | undefined;
  for (const line of text.split('\n')) {
    if (!line.trim()) {
      if (open?.kind === 'p') open = undefined;
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    const item = bullet ?? numbered;
    const kind = bullet ? 'ul' : numbered ? 'ol' : 'p';
    if (open?.kind !== kind) {
      open = kind === 'p' ? { kind, lines: [] } : { kind, items: [] };
      blocks.push(open);
    }
    if (open.kind === 'p') open.lines.push(line.trimEnd());
    else open.items.push(item?.[1] ?? '');
  }
  return blocks;
}

/** Inline code and plain words. React escapes all of it, so a reply can bring no HTML, and a URL stays text. */
function Inline({ text }: { text: string }) {
  return text
    .split(/`([^`\n]+)`/)
    .map((part, i) => (i % 2 === 1 ? <code key={i} className={styles.code}>{part}</code> : part));
}

function Prose({ text }: { text: string }) {
  return (
    <div className={styles.prose}>
      {blocksOf(text).map((block, i) => {
        if (block.kind === 'p') {
          return (
            <p key={i}>
              <Inline text={block.lines.join('\n')} />
            </p>
          );
        }
        const List = block.kind;
        return (
          <List key={i}>
            {block.items.map((item, j) => (
              <li key={j}>
                <Inline text={item} />
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

function UserMessage({ message, assets }: { message: MessageView; assets: Asset[] }) {
  const images = assets.filter((a) => a.kind === 'image');
  const audio = assets.filter((a) => a.kind === 'audio');
  return (
    <div className={styles.user}>
      {images.length > 0 && (
        <div className={styles.thumbs}>
          {images.map((asset) => (
            <Thumb key={asset.key} className={styles.thumb} src={`/api/asset/${encodeURIComponent(asset.key)}`} alt={asset.name} />
          ))}
        </div>
      )}
      {audio.map((asset) => (
        <p key={asset.key} className={styles.audio}>
          <Music size={14} aria-hidden />
          {asset.name}
        </p>
      ))}
      <p className={styles.userText}>{message.text}</p>
    </div>
  );
}

/** A quiet line of what the assistant did; open, each step with its time. */
function Steps({ steps }: { steps: ToolStep[] }) {
  return (
    <details className={styles.steps}>
      <summary className={styles.stepsLine}>
        <ChevronRight size={14} aria-hidden className={styles.chevron} />
        <span>{steps.map((s) => s.line).join(' · ')}</span>
      </summary>
      <ul className={styles.stepList}>
        {steps.map((step) => (
          <li key={`${step.name}-${step.at}`}>
            {step.line} <time>{new Date(step.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * A card in the log. It ticks and moves, which a log would read out, so it opts
 * out of the log and one plain sentence takes its place; a Run's own status line
 * is its own live region.
 */
function Card({ said, children }: { said: string; children: ReactNode }) {
  return (
    <div className={styles.card}>
      <span className={styles.srOnly}>{said}</span>
      <div aria-live="off" className={styles.cardBody}>
        {children}
      </div>
    </div>
  );
}

const ITEM_NAMES: Record<ResultKind, (i: number) => string> = {
  still: (i) => `Still ${i + 1}`,
  clip: (i) => `Clip ${i + 1}`,
  edit: () => 'Film',
};

function Results({ run, films, onOpen }: { run: RunView; films: Record<string, string>; onOpen: TranscriptProps['onOpen'] }) {
  return (
    <Card said="The results are ready.">
      {resultsOf(run).map(({ kind, ids }) => (
        <ResultCard
          key={kind}
          kind={kind}
          items={ids.map((id, i) => ({ id, name: ITEM_NAMES[kind](i), mediaId: kind === 'edit' ? films[id] : undefined }))}
          onOpen={onOpen}
        />
      ))}
    </Card>
  );
}

function Quote({ quote, ...props }: { quote: QuoteView } & TranscriptProps) {
  const { bay, deciding, decideNote, allowance, quoteInputs, onDecide } = props;
  return (
    <Card said="A quote is ready.">
      <QuoteCard
        quote={quote}
        bay={bay}
        busy={deciding === quote.id}
        allowanceLeft={allowance?.unit === quote.unit ? allowance.left : null}
        assetKeys={quoteInputs[quote.id]}
        onApprove={() => onDecide(quote.id, 'approve')}
        onDecline={() => onDecide(quote.id, 'decline')}
      />
      {decideNote?.quoteId === quote.id && <Alert tone="warning" title={decideNote.message} className={styles.refused} />}
    </Card>
  );
}

function EntryView({ entry, ...props }: { entry: Entry } & TranscriptProps) {
  switch (entry.kind) {
    case 'message':
      return entry.message.role === 'user' ? (
        <UserMessage message={entry.message} assets={entry.assets} />
      ) : (
        <Prose text={entry.message.text} />
      );
    case 'steps':
      return <Steps steps={entry.steps} />;
    case 'quote':
      return <Quote quote={entry.quote} {...props} />;
    case 'run':
      return (
        <Card said="A run has started.">
          <RunCard run={entry.run} bay={props.bay} onOpen={props.onOpen} onStop={() => props.onStopRun(entry.run.id)} />
        </Card>
      );
    case 'result':
      return <Results run={entry.run} films={props.films} onOpen={props.onOpen} />;
    case 'ended':
      return entry.failed ? <Alert tone="error" title={entry.text} /> : <p className={styles.ended}>{entry.text}</p>;
  }
}

/**
 * The conversation on the solid canvas. Finished entries go in a log, each read
 * out once as it arrives. The streaming draft stays outside it under aria-busy, so
 * a screen reader hears the finished message and never the words as they come.
 */
export function Transcript(props: TranscriptProps) {
  const { entries, draft } = props;
  const [settling, setSettling] = useState(entries.length > 0);
  useEffect(() => {
    if (!settling) return;
    const settled = setTimeout(() => setSettling(false), SETTLE_MS);
    return () => clearTimeout(settled);
  }, [settling]);

  return (
    <>
      <div role="log" aria-live={settling ? 'off' : 'polite'} aria-label="Conversation" tabIndex={0} className={styles.log}>
        {entries.map((entry) => (
          <EntryView key={entry.key} entry={entry} {...props} />
        ))}
      </div>
      {draft !== null && (
        <div aria-busy="true" className={styles.draft}>
          {draft ? (
            <Prose text={draft} />
          ) : (
            <p className={styles.working}>
              <LoaderCircle size={14} aria-hidden className={styles.spin} />
              Working on it
            </p>
          )}
        </div>
      )}
    </>
  );
}
