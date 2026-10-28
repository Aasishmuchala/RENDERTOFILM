import { Image } from 'lucide-react';

import styles from './ImagePlaceholder.module.css';

export type ImagePlaceholderProps = {
  /** What the image will show — the accessible name, and the visible caption. */
  label: string;
  /** CSS `aspect-ratio` of the final image, e.g. `'1 / 1'`. */
  aspectRatio?: string | undefined;
  maxWidth?: number | string | undefined;
};

/**
 * Stands in for an image that hasn't been generated yet, sized like the
 * final asset so the layout doesn't jump when a real `<img>` replaces it.
 */
export function ImagePlaceholder({
  label,
  aspectRatio = '16 / 9',
  maxWidth,
}: ImagePlaceholderProps) {
  const style =
    maxWidth === undefined ? { aspectRatio } : { aspectRatio, maxWidth };
  return (
    <div
      role="img"
      aria-label={label}
      data-bay-block="image-placeholder"
      className={styles.placeholder}
      style={style}
    >
      <Image size={20} aria-hidden />
      <span className={styles.label}>{label}</span>
    </div>
  );
}
