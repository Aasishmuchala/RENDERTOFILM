import styles from './Skeleton.module.css';

export function SkeletonText({ rows = 3 }: { rows?: number }) {
  return (
    <div className={styles.text} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={styles.bar}
          style={i === rows - 1 ? { width: '60%' } : undefined}
        />
      ))}
    </div>
  );
}

export function SkeletonBlock({ height = 120 }: { height?: number | string }) {
  return (
    <div
      className={styles.block}
      style={{ height }}
      aria-busy="true"
      aria-live="polite"
    />
  );
}
