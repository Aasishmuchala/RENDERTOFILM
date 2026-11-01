import { Button } from 'react-aria-components';

import type { RunView } from '../../chat/domain.ts';
import type { Handoff } from '../handoff.ts';
import { KIND_TITLE } from './QuoteCard.tsx';
import { runExits, runLine, StateGlyph } from './RunCard.tsx';
import styles from './RunTray.module.css';

export type RunTrayProps = {
  runs: RunView[];
  onOpen: (handoff: Handoff) => void;
};

/** Where a row leads: what the Run made, else the chat that is following it. */
export function trayTarget(run: RunView): Handoff {
  return runExits(run)[0]?.handoff ?? { page: 'chat', params: {} };
}

/** Every Run at a glance, for the top bar's popover. With none it renders nothing. */
export function RunTray({ runs, onOpen }: RunTrayProps) {
  if (runs.length === 0) return null;
  return (
    <ul className={styles.tray} aria-label="Runs">
      {runs.map((run) => {
        const line = runLine(run);
        return (
          <li key={run.id}>
            <Button className={styles.row} onPress={() => onOpen(trayTarget(run))}>
              <StateGlyph state={run.state} size={14} />
              <span className={styles.words}>
                <span className={styles.title}>{KIND_TITLE[run.kind]}</span>
                <span className={styles.label} title={line}>
                  {line}
                </span>
              </span>
              <span className={styles.percent}>{run.percent}%</span>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
