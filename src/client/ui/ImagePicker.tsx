import { Film } from 'lucide-react';
import { memo, useState } from 'react';
import { Label, Radio, RadioGroup } from 'react-aria-components';

import styles from './ImagePicker.module.css';

export type ImagePickerItem = {
  id: string;
  src: string;
  alt: string;
  caption: string;
};

export type ImagePickerProps = {
  label: string;
  items: readonly ImagePickerItem[];
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean | undefined;
};

/** A grid of image thumbnails to pick one from — a radio group, arrow keys move. */
export const ImagePicker = memo(function ImagePicker({ label, items, value, onChange, disabled = false }: ImagePickerProps) {
  // A thumbnail that can't load (its still was deleted) shows a plain frame.
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
        {items.map((item) => (
          <Radio key={item.id} value={item.id} className={styles.card} aria-label={item.alt}>
            {broken.has(item.src) ? (
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
          </Radio>
        ))}
      </div>
    </RadioGroup>
  );
});
