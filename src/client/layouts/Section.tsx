import type React from 'react';

import { ErrorBoundary } from '../ui/ErrorBoundary.tsx';
import { SkeletonText } from '../ui/Skeleton.tsx';
import styles from './Section.module.css';

export type SectionProps = {
  title?: React.ReactNode;
  description?: React.ReactNode;
  loading?: boolean;
  label?: string;
  /** Its place in a workflow; shown as a numbered marker before the title. */
  step?: number | undefined;
  children?: React.ReactNode;
};

export function Section({
  title,
  description,
  loading,
  label,
  step,
  children,
}: SectionProps) {
  return (
    <section data-bay-block="section" className={styles.section}>
      {title && (
        <h2 className={styles.title}>
          {step !== undefined && (
            <span className={styles.step} aria-hidden>
              {step}
            </span>
          )}
          {step !== undefined && <span className={styles.srOnly}>Step {step}: </span>}
          {title}
        </h2>
      )}
      {description && (
        <p className={step !== undefined ? `${styles.description} ${styles.stepped}` : styles.description}>
          {description}
        </p>
      )}
      <ErrorBoundary
        label={
          label ?? (typeof title === 'string' ? title.toLowerCase() : undefined)
        }
      >
        {loading ? <SkeletonText /> : children}
      </ErrorBoundary>
    </section>
  );
}
