import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import styles from './Alert.module.css';

export type AlertProps = {
  tone?: 'error' | 'warning' | 'info' | 'success' | undefined;
  title: ReactNode;
  children?: ReactNode | undefined;
  className?: string | undefined;
};

const TONE_CLASS = {
  error: 'err',
  warning: 'warn',
  info: 'info',
  success: 'ok',
} as const;

const TONE_ICON = {
  error: CircleAlert,
  warning: TriangleAlert,
  info: Info,
  success: CircleCheck,
} as const;

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: AlertProps) {
  const Icon = TONE_ICON[tone];
  return (
    <div
      role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}
      className={[styles.alert, styles[TONE_CLASS[tone]], className]
        .filter(Boolean)
        .join(' ')}
    >
      <Icon size={16} aria-hidden className={styles.icon} />
      <div className={styles.body}>
        <div className={styles.title}>{title}</div>
        {children && <div className={styles.content}>{children}</div>}
      </div>
    </div>
  );
}
