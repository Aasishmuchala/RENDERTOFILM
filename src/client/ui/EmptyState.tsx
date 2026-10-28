import type React from 'react';

import styles from './EmptyState.module.css';

export type EmptyStateProps = {
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
};

export function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    <div data-bay-block="empty-state" className={styles.emptyState}>
      <div className={styles.title}>{title}</div>
      {hint && <div className={styles.hint}>{hint}</div>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
