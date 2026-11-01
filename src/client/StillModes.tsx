import type { ReactNode } from 'react';
import { SelectionIndicator, Tab, TabList, TabPanel, Tabs } from 'react-aria-components';

import { CloseupsPage } from './CloseupsPage.tsx';
import type { GoTo, Handoff } from './handoff.ts';
import { PageActiveContext } from './lib/ambient.tsx';
import { LocationPage } from './LocationPage.tsx';
import { StillsPage } from './StillsPage.tsx';
import styles from './StillModes.module.css';

const MODES = [
  { id: 'still', label: 'Still' },
  { id: 'closeups', label: 'Close-ups' },
  { id: 'location', label: 'Location' },
] as const;

type StillMode = (typeof MODES)[number]['id'];

export type StillModesProps = {
  /** True while the Still page is on screen. */
  active: boolean;
  handoff: Handoff;
  goTo: GoTo;
  onAnimate: (stillId: string) => void;
};

/**
 * One mode, always mounted like the pages themselves, so a running take
 * survives a mode switch. A mode out of view counts as a hidden page, for
 * `useAmbient` and the Workspace's keys alike.
 */
function ModePanel({ id, showing, children }: { id: StillMode; showing: boolean; children: ReactNode }) {
  return (
    <TabPanel id={id} shouldForceMount hidden={!showing} className={styles.panel}>
      <PageActiveContext.Provider value={showing}>{children}</PageActiveContext.Provider>
    </TabPanel>
  );
}

/**
 * The Still page: a row of three modes under the top bar (`--app-subnav`)
 * over the Still, Close-ups and Location pages. The mode rides in the address
 * (`#stills?mode=closeups`), and anything but a mode there is Still.
 */
export function StillModes({ active, handoff, goTo, onAnimate }: StillModesProps) {
  const mode = MODES.find((m) => m.id === handoff.params['mode'])?.id ?? 'still';
  const showing = (id: StillMode) => active && mode === id;

  return (
    <Tabs selectedKey={mode} onSelectionChange={(key) => goTo('stills', { mode: String(key) })}>
      <div className={styles.bar}>
        <TabList aria-label="Still modes" className={styles.list}>
          {MODES.map((m) => (
            <Tab key={m.id} id={m.id} className={styles.tab}>
              <SelectionIndicator className={styles.indicator} aria-hidden />
              {m.label}
            </Tab>
          ))}
        </TabList>
      </div>
      <ModePanel id="still" showing={showing('still')}>
        <StillsPage onAnimate={onAnimate} />
      </ModePanel>
      <ModePanel id="closeups" showing={showing('closeups')}>
        <CloseupsPage
          active={showing('closeups')}
          handoff={handoff}
          onGoToStills={() => goTo('stills', { mode: 'still' })}
          onAnimate={onAnimate}
        />
      </ModePanel>
      <ModePanel id="location" showing={showing('location')}>
        <LocationPage active={showing('location')} handoff={handoff} onAnimate={onAnimate} />
      </ModePanel>
    </Tabs>
  );
}
