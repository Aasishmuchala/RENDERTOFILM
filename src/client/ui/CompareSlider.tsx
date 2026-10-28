import { useState } from 'react';

import styles from './CompareSlider.module.css';

export type CompareSliderProps = {
  before: string;
  after: string;
  beforeAlt: string;
  afterAlt: string;
  /** CSS aspect-ratio of both images, e.g. `'2560 / 1440'`. */
  aspectRatio: string;
  /** Shown instead of `after` if it can't load (a smaller copy). */
  afterFallback?: string | undefined;
  className?: string | undefined;
};

/**
 * Before/after wipe: the result over the source, revealed up to a draggable
 * divider. The divider is a native range input, so arrow keys move it.
 */
export function CompareSlider({
  before,
  after,
  beforeAlt,
  afterAlt,
  aspectRatio,
  afterFallback,
  className,
}: CompareSliderProps) {
  const [pos, setPos] = useState(50);
  const [failed, setFailed] = useState<string | null>(null);
  const afterSrc = failed === after && afterFallback ? afterFallback : after;
  return (
    <div
      className={className ? `${styles.frame} ${className}` : styles.frame}
      style={{ aspectRatio, ['--ar' as string]: aspectRatio, ['--pos' as string]: `${pos}%` }}
    >
      <img className={styles.image} src={before} alt={beforeAlt} />
      <img
        className={`${styles.image} ${styles.after}`}
        src={afterSrc}
        alt={afterAlt}
        onError={() => setFailed(after)}
      />
      <div className={styles.divider} aria-hidden />
      <span className={`${styles.tag} ${styles.tagLeft}`} aria-hidden>
        Render
      </span>
      <span className={`${styles.tag} ${styles.tagRight}`} aria-hidden>
        Film still
      </span>
      <input
        className={styles.range}
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label="Compare render and film still"
      />
    </div>
  );
}
