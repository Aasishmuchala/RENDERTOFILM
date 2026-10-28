import { memo, useEffect, useRef, useState } from 'react';

import styles from './RenderingStatus.module.css';

export type RenderingStatusProps = {
  label: string;
  progress?: number | undefined;
  /** Changing this restarts the elapsed-seconds counter. */
  runKey?: string | undefined;
  /** When the work started (ms), so the clock survives a remount; else now. */
  since?: number | undefined;
};

/** Fills a dark result frame while something renders: a warm sweep, a status
 * line and the elapsed time (plus progress when the model reports it). */
export const RenderingStatus = memo(function RenderingStatus({ label, progress, runKey, since }: RenderingStatusProps) {
  return (
    <div className={styles.rendering}>
      <div className={styles.sweep} aria-hidden>
        <div className={styles.band} />
      </div>
      <div className={styles.text}>
        {/* Only the label is announced; a ticking clock would be read out every second. */}
        <span role="status" aria-live="polite">
          {label}
        </span>
        <span className={styles.elapsed} aria-hidden>
          {progress !== undefined && progress > 0 ? `${Math.round(progress * 100)}% · ` : ''}
          <Elapsed runKey={runKey} since={since} />
        </span>
      </div>
    </div>
  );
});

/** Only this text re-renders each second, not the frame around it. */
export function Elapsed({ runKey, since }: { runKey?: string | undefined; since?: number | undefined }) {
  const start = useRef(since ?? Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    start.current = since ?? Date.now();
    setNow(Date.now());
  }, [runKey, since]);
  useEffect(() => {
    const t = setInterval(() => {
      // A hidden tab or a closed panel has nothing to show; skip the work.
      if (document.visibilityState === 'visible') setNow(Date.now());
    }, 1000);
    return () => clearInterval(t);
  }, []);
  const seconds = Math.max(0, Math.round((now - start.current) / 1000));
  return <>{seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`}</>;
}
