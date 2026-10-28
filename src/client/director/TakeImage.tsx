import { ImageOff, RotateCcw } from 'lucide-react';
import { useState } from 'react';

import { libraryUrl, stillThumbUrl, stillViewUrl } from '../lib/download.ts';
import { Button } from '../ui/Button.tsx';
import styles from './TakeImage.module.css';

export type TakeImageProps = {
  stillId: string;
  alt: string;
  className?: string | undefined;
  /** The full-size still rather than the small copy. */
  full?: boolean | undefined;
  /** Makes the picture a button (the big screen). Not the broken state, so
   * its own retry button is never nested inside another button. */
  onOpen?: (() => void) | undefined;
  openLabel?: string | undefined;
  openClassName?: string | undefined;
};

/**
 * A finished take. A load that fails is tried again past any cached answer,
 * then as the large stored copy, then as the original file, and only then
 * says so, with a retry: a frame is never silently blank.
 */
export function TakeImage({ stillId, alt, className, full = false, onOpen, openLabel, openClassName }: TakeImageProps) {
  const [attempt, setAttempt] = useState(0);
  const [round, setRound] = useState(0);
  // Each attempt's source, small copy first unless the big one is wanted.
  const steps = full ? ['view', 'view', 'original'] : ['thumb', 'thumb', 'view', 'original'];
  if (attempt >= steps.length) {
    return (
      <div className={styles.broken} role="status">
        <ImageOff size={16} aria-hidden />
        <span>This take didn't load.</span>
        <Button
          size="sm"
          icon={<RotateCcw size={14} />}
          onPress={() => {
            setRound((r) => r + 1);
            setAttempt(1);
          }}
        >
          Try again
        </Button>
      </div>
    );
  }
  const step = steps[attempt];
  const base =
    step === 'thumb' ? stillThumbUrl(stillId) : step === 'view' ? stillViewUrl(stillId) : libraryUrl('still', stillId);
  const bust = attempt === 0 && round === 0 ? '' : `${step === 'original' ? '?' : '&'}r=${round}-${attempt}`;
  const image = (
    <img
      key={`${round}-${attempt}`}
      className={className}
      src={base + bust}
      alt={alt}
      decoding="async"
      onError={() => setAttempt((a) => a + 1)}
    />
  );
  if (!onOpen) return image;
  return (
    <button type="button" className={openClassName} onClick={onOpen} aria-label={openLabel}>
      {image}
    </button>
  );
}
