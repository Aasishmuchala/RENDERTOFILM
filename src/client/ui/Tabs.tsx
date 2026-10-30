import type { ReactNode } from 'react';
import {
  SelectionIndicator,
  Tab as AriaTab,
  TabList as AriaTabList,
  TabPanel as AriaTabPanel,
  Tabs as AriaTabs,
  type Key,
} from 'react-aria-components';

import styles from './Tabs.module.css';

export type TabsProps = {
  selectedKey: string;
  onSelectionChange: (key: string) => void;
  children?: ReactNode | undefined;
};

/** A segmented control (the Video page's modes). Arrow keys move between
 * tabs; panels keep their state. */
export function Tabs({ selectedKey, onSelectionChange, children }: TabsProps) {
  return (
    <AriaTabs
      className={styles.tabs}
      selectedKey={selectedKey}
      onSelectionChange={(key: Key) => onSelectionChange(String(key))}
    >
      {children}
    </AriaTabs>
  );
}

export function TabList({
  'aria-label': ariaLabel,
  children,
}: {
  'aria-label': string;
  children?: ReactNode | undefined;
}) {
  return (
    <AriaTabList aria-label={ariaLabel} className={styles.list}>
      {children}
    </AriaTabList>
  );
}

export function Tab({
  id,
  icon,
  children,
}: {
  id: string;
  icon?: ReactNode | undefined;
  children?: ReactNode | undefined;
}) {
  return (
    <AriaTab id={id} className={styles.tab}>
      {/* The selected segment's fill; it slides here from the last one. */}
      <SelectionIndicator className={styles.indicator} data-indicator aria-hidden />
      {icon}
      {children}
    </AriaTab>
  );
}

/** Always mounted, so a tab keeps its work (a running take) while hidden. */
export function TabPanel({ id, children }: { id: string; children?: ReactNode | undefined }) {
  return (
    <AriaTabPanel id={id} shouldForceMount className={styles.panel}>
      {children}
    </AriaTabPanel>
  );
}
