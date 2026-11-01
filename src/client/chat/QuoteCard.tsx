import { Check, CircleX, TimerOff } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { QuoteView, RunKind, Unit } from '../../chat/domain.ts';
import { stillThumbUrl } from '../lib/download.ts';
import { Button } from '../ui/Button.tsx';
import styles from './QuoteCard.module.css';
import { Thumb } from './ResultCard.tsx';

export type QuoteCardProps = {
  quote: QuoteView;
  onApprove: () => void;
  onDecline: () => void;
  busy?: boolean | undefined;
  /** Bay shows no rates and has no Allowance: the cost reads as billed by Runway. */
  bay?: boolean | undefined;
  /** What the Allowance still covers today, in the Quote's unit; unset or null shows no line. */
  allowanceLeft?: number | null | undefined;
  /** Renders the Quote works from that its spec cannot name (a Lifestyle film's), from the Thread's Assets. */
  assetKeys?: string[] | undefined;
};

export const KIND_TITLE: Record<RunKind, string> = {
  director_film: 'Director film',
  lifestyle_film: 'Lifestyle film',
  stills: 'Stills',
  clips: 'Clips',
  cut: 'Cut',
  master: 'Master',
};

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

const OUTCOMES = {
  approved: { word: 'Approved', Glyph: Check },
  declined: { word: 'Declined', Glyph: CircleX },
  replaced: { word: 'Replaced by a newer quote', Glyph: CircleX },
  expired: { word: 'Expired', Glyph: TimerOff },
};

/** How a Quote ended, or null while it can still be decided. Time up counts: the gate would refuse it. */
function outcomeOf(quote: QuoteView, secondsLeft: number): keyof typeof OUTCOMES | null {
  if (quote.state === 'open') return secondsLeft > 0 ? null : 'expired';
  if (quote.state !== 'declined') return quote.state;
  return quote.reason === 'superseded' ? 'replaced' : quote.reason === 'expired' ? 'expired' : 'declined';
}

/** An amount in the provider's own unit. */
function money(amount: number, unit: Unit) {
  if (unit === 'usd') return `$${amount.toFixed(2)}`;
  return amount === 1 ? '1 credit' : `${amount} credits`;
}

function clock(seconds: number) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}

/** Seconds to `expiresAt`. It ticks each second, or under reduced motion wakes once, at the end. */
function useSecondsLeft(expiresAt: number, open: boolean, reduced: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    if (reduced) {
      const end = setTimeout(() => setNow(Date.now()), expiresAt - Date.now());
      return () => clearTimeout(end);
    }
    const tick = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (at >= expiresAt) clearInterval(tick);
    }, 1000);
    return () => clearInterval(tick);
  }, [expiresAt, open, reduced]);
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

/**
 * The priced proposal the Owner says yes to: the exact inputs, what each line
 * costs, and the one button that starts the Run. Amounts come from the server's
 * Quote, never from model text.
 */
export function QuoteCard({
  quote,
  onApprove,
  onDecline,
  busy = false,
  bay = false,
  allowanceLeft,
  assetKeys = [],
}: QuoteCardProps) {
  const [reduced] = useState(() => window.matchMedia(REDUCED_MOTION).matches);
  const secondsLeft = useSecondsLeft(quote.expiresAt, quote.state === 'open', reduced);
  const outcome = outcomeOf(quote, secondsLeft);
  const ended = outcome ? OUTCOMES[outcome] : null;
  const amount = bay ? null : quote.amount;
  // A provider that cannot price this says so in the note; only Runway bills what it does not quote.
  const unknownCost = bay || !quote.note ? 'Billed to your Runway credits' : quote.note;
  const thumbs = [
    ...(quote.spec.stillIds ?? []).map(stillThumbUrl),
    ...assetKeys.map((key) => `/api/asset/${encodeURIComponent(key)}`),
  ];
  return (
    <div className={styles.card} role="group" aria-label={`Quote: ${KIND_TITLE[quote.spec.kind]}`}>
      <p className={styles.title}>{KIND_TITLE[quote.spec.kind]}</p>
      {thumbs.length > 0 && (
        <div className={styles.inputs}>
          {thumbs.map((src, i) => (
            <Thumb key={`${i}-${src}`} src={src} alt={`Render ${i + 1}`} />
          ))}
        </div>
      )}
      {quote.items.length > 0 && (
        <ul className={styles.items}>
          {quote.items.map((item, i) => (
            <li key={i} className={styles.item}>
              <span>
                {item.label} × {item.count}
              </span>
              {!bay && item.amount !== null && <span className={styles.amount}>{money(item.amount, quote.unit)}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className={styles.total}>
        <span>Total</span>
        <span className={styles.totalAmount}>{amount === null ? unknownCost : money(amount, quote.unit)}</span>
      </p>
      {!bay && allowanceLeft !== undefined && allowanceLeft !== null && (
        <p className={styles.line}>{money(allowanceLeft, quote.unit)} left in today's allowance</p>
      )}
      {quote.note && (amount !== null || bay) && <p className={styles.line}>{quote.note}</p>}
      <p className={styles.line}>Uses only what is in these renders.</p>
      {ended ? (
        <p className={styles.state}>
          <ended.Glyph size={16} aria-hidden />
          {ended.word}
        </p>
      ) : (
        <div className={styles.actions}>
          <Button variant="primary" size="lg" loading={busy} onPress={onApprove}>
            {amount ? `Run for ${money(amount, quote.unit)}` : 'Run'}
          </Button>
          <Button variant="ghost" disabled={busy} onPress={onDecline}>
            Change
          </Button>
          <span className={styles.clock}>
            {reduced
              ? `Expires at ${new Date(quote.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : `Expires in ${clock(secondsLeft)}`}
          </span>
        </div>
      )}
    </div>
  );
}
