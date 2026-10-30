import { Film } from 'lucide-react';
import { memo, useState } from 'react';
import { Label, Radio, RadioGroup } from 'react-aria-components';

import styles from './ImagePicker.module.css';

export type ImagePickerItem = {
  id: string;
  /** The thumbnail; empty for an item with no picture to show. */
  src: string;
  alt: string;
  /** Line 1 under the thumbnail: the look or the name. */
  caption: string;
  /** Optional line 2: model, resolution and time, so similar stills can be told apart. */
  detail?: string | undefined;
  /** Optional tooltip for the whole card (both lines in full, since each is clipped to one row). */
  title?: string | undefined;
};

export type ImagePickerProps = {
  label: string;
  items: readonly ImagePickerItem[];
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean | undefined;
};

/** A grid of image thumbnails to pick one from: a radio group, arrow keys move. */
export const ImagePicker = memo(function ImagePicker({ label, items, value, onChange, disabled = false }: ImagePickerProps) {
  // An item with no picture (`src` empty) or one that can't load shows a plain frame.
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  return (
    <RadioGroup
      className={styles.group}
      value={value}
      onChange={onChange}
      isDisabled={disabled}
    >
      <Label className={styles.srOnly}>{label}</Label>
      <div className={styles.grid}>
        {items.map((item) => {
          const body = (
            <>
              {!item.src || broken.has(item.src) ? (
                <span className={`${styles.thumb} ${styles.missing}`} aria-hidden>
                  <Film size={16} />
                </span>
              ) : (
                <img
                  className={styles.thumb}
                  src={item.src}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onError={() => setBroken((prev) => new Set(prev).add(item.src))}
                />
              )}
              <span className={styles.caption}>{item.caption}</span>
              {item.detail && <span className={styles.detail}>{item.detail}</span>}
            </>
          );
          return (
            <Radio key={item.id} value={item.id} className={styles.card} aria-label={item.alt}>
              {/* Radio takes no `title`, so the tooltip rides on a wrapper that adds no box. */}
              {item.title ? (
                <span className={styles.titled} title={item.title}>
                  {body}
                </span>
              ) : (
                body
              )}
            </Radio>
          );
        })}
      </div>
    </RadioGroup>
  );
});
