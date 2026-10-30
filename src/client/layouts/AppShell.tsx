import type React from 'react';
import { useRef } from 'react';

import { AmbientLayer } from '../lib/ambient.tsx';
import { useActivity } from '../lib/useActivity.ts';
import type { PageId } from '../nav.ts';
import { ErrorBoundary } from '../ui/ErrorBoundary.tsx';
import styles from './AppShell.module.css';
import { Dock, isShootPage, ShootModes, TabBar, TopBar } from './Nav.tsx';

export type AppShellUser = {
  name: string;
  email: string;
  avatarUrl?: string | null;
};

export type AppShellProps = {
  /** The page showing; the nav marks it current. */
  current: PageId;
  user?: AppShellUser | undefined;
  children?: React.ReactNode;
};

/**
 * The screening room's frame (DESIGN.md 3.1): a skip link, the ambient
 * backdrop, the glass top bar, the floating glass dock (from 900 px) or, on
 * phones, the floating tab bar (and, on a Shoot page, the row of Shoot
 * modes under the top bar), and `<main>`. Sets `--app-header`,
 * `--app-subnav`, `--app-dock` and `--app-bottom` for the pages' own geometry.
 */
export function AppShell({ current, user, children }: AppShellProps) {
  const main = useRef<HTMLElement>(null);
  const activity = useActivity().total;

  return (
    <div data-bay-block="app-shell" className={styles.shell} data-shoot={isShootPage(current) ? '' : undefined}>
      <a
        href="#main"
        className={styles.skip}
        onClick={(e) => {
          // A `#main` hash would be read as a page id; move focus instead.
          e.preventDefault();
          main.current?.focus();
        }}
      >
        Skip to content
      </a>
      <AmbientLayer />
      <TopBar current={current} user={user} activity={activity} />
      <ShootModes current={current} />
      <Dock current={current} />
      <TabBar current={current} activity={activity} />
      <main id="main" tabIndex={-1} ref={main} className={styles.main}>
        <ErrorBoundary label="page">{children}</ErrorBoundary>
      </main>
    </div>
  );
}
