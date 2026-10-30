import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, Disclosure, DisclosurePanel } from 'react-aria-components';

import styles from './CostLine.module.css';

export type CostLineProps = {
  /** One sentence under the primary action: what it uses and who pays. */
  summary: ReactNode;
  /** The model-by-model breakdown, behind "What this costs". */
  details?: ReactNode | undefined;
};

/**
 * The cost or status line under a Workspace footer's primary action
 * (DESIGN.md 3.3). The summary always shows; a longer breakdown waits behind
 * a disclosure, collapsed each time the page loads.
 */
export function CostLine({ summary, details }: CostLineProps) {
  return (
    <div className={styles.cost}>
      <p className={styles.summary}>{summary}</p>
      {details !== undefined && details !== null && details !== false && (
        <Disclosure className={styles.disclosure}>
          <Button slot="trigger" className={styles.trigger}>
            <ChevronRight size={14} aria-hidden className={styles.chevron} />
            What this costs
          </Button>
          <DisclosurePanel className={styles.panel}>{details}</DisclosurePanel>
        </Disclosure>
      )}
    </div>
  );
}
