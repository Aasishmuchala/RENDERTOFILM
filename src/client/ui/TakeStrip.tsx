import { CircleCheck, Clock, OctagonAlert, Plus, TriangleAlert } from 'lucide-react';
import { memo } from 'react';
import { Label, Radio, RadioGroup } from 'react-aria-components';

import { useCapabilities } from '../lib/useCapabilities.ts';
import { Elapsed } from './RenderingStatus.tsx';
import styles from './TakeStrip.module.css';

export type TakeState = 'queued' | 'rendering' | 'ready' | 'failed' | 'lost';

export type TakeStripItem = {
  id: string;
  /** The still the take starts on, as its thumbnail. */
  thumb: string;
  title: string;
  state: TakeState;
  progress?: number | undefined;
  /** When the take started (ms), for its running clock. */
  since: number;
  /** Replaces the start time under a finished take ("Upscaling…"). */
  note?: string | undefined;
};

export type TakeStripProps = {
  label: string;
  items: readonly TakeStripItem[];
  /** The take on the big screen, or null for the next shot. */
  value: string | null;
  onChange: (id: string | null) => void;
  /** The shot being set up in the rail, first in the strip. */
  next: { thumb?: string | undefined; title: string };
};

const NEXT = '__next';

const STATE_TEXT: Record<TakeState, string> = {
  queued: 'Waiting at Runway',
  rendering: 'Rendering',
  ready: 'Ready',
  failed: "Failed: didn't render",
  lost: 'Lost touch',
};

/** Every video in flight or just made, as a row of cards to put on the big
 * screen. A radio group: arrow keys move, the chosen card is the one shown. */
export const TakeStrip = memo(function TakeStrip({ label, items, value, onChange, next }: TakeStripProps) {
  const { caps } = useCapabilities();
  const stateText = (state: TakeState) => (state === 'queued' && caps.desktop ? `Waiting at ${caps.providerName}` : STATE_TEXT[state]);
  return (
    <RadioGroup
      className={styles.group}
      value={value ?? NEXT}
      onChange={(id) => onChange(id === NEXT ? null : id)}
      orientation="horizontal"
    >
      <Label className={styles.srOnly}>{label}</Label>
      <div className={styles.row}>
        <Radio value={NEXT} className={`${styles.card} ${styles.nextCard}`} aria-label={`Next shot: ${next.title}`}>
          <span className={styles.frame}>
            {next.thumb ? <img className={styles.thumb} src={next.thumb} alt="" loading="lazy" /> : null}
            <span className={styles.nextBadge} aria-hidden>
              <Plus size={14} />
            </span>
          </span>
          <span className={styles.title}>Next shot</span>
          <span className={styles.sub}>{next.title}</span>
        </Radio>
        {items.map((item) => {
          const working = item.state === 'rendering' || item.state === 'queued';
          return (
            <Radio
              key={item.id}
              value={item.id}
              className={styles.card}
              data-state={item.state}
              aria-label={`${item.title}, ${stateText(item.state).toLowerCase()}`}
            >
              <span className={styles.frame}>
                <img className={styles.thumb} src={item.thumb} alt="" loading="lazy" />
                {working && (
                  <span className={styles.bar} aria-hidden>
                    {item.progress !== undefined && item.progress > 0 ? (
                      <span className={styles.fill} style={{ width: `${Math.round(item.progress * 100)}%` }} />
                    ) : (
                      <span className={styles.sweep} />
                    )}
                  </span>
                )}
                <span className={styles.badge} aria-hidden>
                  {item.state === 'ready' ? (
                    <CircleCheck size={12} />
                  ) : item.state === 'failed' ? (
                    <OctagonAlert size={12} />
                  ) : item.state === 'lost' ? (
                    <TriangleAlert size={12} />
                  ) : (
                    <Clock size={12} />
                  )}
                  {stateText(item.state)}
                  {item.state === 'rendering' && item.progress !== undefined && item.progress > 0
                    ? ` ${Math.round(item.progress * 100)}%`
                    : ''}
                </span>
              </span>
              <span className={styles.title}>{item.title}</span>
              <span className={styles.sub} aria-hidden>
                {working ? <Elapsed runKey={item.id} since={item.since} /> : (item.note ?? timeOf(item.since))}
              </span>
            </Radio>
          );
        })}
      </div>
    </RadioGroup>
  );
});

function timeOf(ms: number): string {
  return `Started ${new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}
