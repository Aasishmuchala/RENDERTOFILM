import type { ReactNode } from 'react';

import styles from './Avatar.module.css';

const PALETTE_KEYS = [
  'mint',
  'pink',
  'purple',
  'sky',
  'amber',
  'red',
  'lime',
  'cyan',
  'slate',
] as const;

type PaletteKey = (typeof PALETTE_KEYS)[number];

/**
 * Deterministically hash a name to one of the avatar palette slots, so the
 * same name always gets the same color. Backed by `--bay-app-<key>-bg`/`-fg`
 * CSS vars shipped in `@runway/bay-react/tokens.css`.
 */
export function paletteForName(name: string): PaletteKey {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PALETTE_KEYS[h % PALETTE_KEYS.length] as PaletteKey;
}

export type AvatarProps = {
  /** Person's display name — used for the fallback initials, color, and `alt`/`title` text. */
  name: string;
  /** Profile picture URL. Falls back to colored initials when absent. */
  src?: string | null | undefined;
  /** Diameter in px. */
  size?: number | undefined;
};

/**
 * A round person avatar — profile picture when `src` is set, otherwise
 * colored initials derived from `name`.
 */
export function Avatar({ name, src, size = 28 }: AvatarProps): ReactNode {
  const initials = name
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
  const palette = paletteForName(name);

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        title={name}
        width={size}
        height={size}
        className={styles.avatar}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      title={name}
      aria-label={name}
      className={styles.avatar}
      style={{
        width: size,
        height: size,
        background: `var(--bay-app-${palette}-bg)`,
        color: `var(--bay-app-${palette}-fg)`,
        fontSize: Math.round(size * 0.42),
      }}
    >
      {initials || '·'}
    </span>
  );
}
