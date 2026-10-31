import type { ReactElement } from 'react';

import { Alert } from './Alert.tsx';
import styles from './ModelUnavailable.module.css';

/** Under a select whose saved value the chosen provider hides. The value stays, so switching back restores the page. */
export function ModelUnavailable({ message }: { message: string }) {
  return <Alert tone="warning" title={message} className={styles.notice} />;
}

/** Gives a disabled primary button the same sentence as its tooltip; with no message it adds nothing to the page. */
export function BlockedTip({ message, children }: { message: string | null; children: ReactElement }) {
  if (!message) return children;
  return (
    <span className={styles.tip} title={message}>
      {children}
    </span>
  );
}
