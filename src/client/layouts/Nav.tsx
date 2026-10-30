import { Aperture, Settings as SettingsIcon, X } from 'lucide-react';
import { Fragment, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';

import { type PageId, PAGES, pageById, PHONE_TABS } from '../nav.ts';
import { UserMenu } from '../ui/UserMenu.tsx';
import type { AppShellUser } from './AppShell.tsx';
import styles from './Nav.module.css';

/**
 * The shell's navigation (DESIGN.md 3.1, 3.2): a glass top bar at every
 * width, the floating glass dock from 900 px, and on phones the floating tab
 * bar whose Shoot tab opens a sheet of the five Shoot pages. Every item is a
 * real `<a href="#id">`, so the back button steps between pages.
 */

const SHOOT_PAGES = PHONE_TABS[0]!.pages;
/** The Shoot group's pages in pipeline order: the phone's segmented row. */
const SHOOT_MODES = PAGES.filter((p) => p.group === 'shoot');
/** The dock's pages: every page but Settings, which lives in the top bar. */
const DOCK_PAGES = PAGES.filter((p) => p.id !== 'settings');
const SETTINGS = pageById('settings')!;

/**
 * Slide the list's one indicator (`[data-indicator]`) to its
 * `aria-current="page"` item. Placed without a transition the first time and
 * whenever the list was hidden (`display: none` measures 0), so it never
 * sweeps in from the corner; after that it moves with `translate`.
 */
function useIndicator(list: RefObject<HTMLElement | null>, indicator: RefObject<HTMLElement | null>, key: unknown) {
  useLayoutEffect(() => {
    const root = list.current;
    const ind = indicator.current;
    if (!root || !ind) return;
    const place = () => {
      const item = root.querySelector<HTMLElement>('[aria-current="page"]');
      if (!item || item.offsetWidth === 0) {
        ind.removeAttribute('data-ready');
        return;
      }
      let x = 0;
      let y = 0;
      for (let n: HTMLElement | null = item; n && n !== root; n = n.offsetParent as HTMLElement | null) {
        x += n.offsetLeft;
        y += n.offsetTop;
      }
      ind.style.width = `${item.offsetWidth}px`;
      ind.style.height = `${item.offsetHeight}px`;
      ind.style.translate = `${x}px ${y}px`;
      if (!ind.hasAttribute('data-ready')) {
        ind.getBoundingClientRect(); // commit the first position before the transition exists
        ind.setAttribute('data-ready', '');
      }
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(root);
    for (const child of Array.from(root.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [list, indicator, key]);
}

function Mark() {
  return (
    <span className={styles.mark} aria-hidden>
      <Aperture size={16} />
    </span>
  );
}

/** "{n} rendering": shown while a still or clip is pending; it links to the library. */
export function ActivityPill({ count }: { count: number }) {
  return (
    <a href="#library" className={styles.pill}>
      <span className={styles.pillSweep} aria-hidden>
        <span className={styles.pillBand} />
      </span>
      <span className={styles.pillCount}>{count}</span>
      <span className={styles.pillText}> rendering</span>
    </a>
  );
}

/**
 * The fixed glass bar across the top, at every width: the mark and the app's
 * name, the page showing, then the activity pill, Settings and the account.
 */
export function TopBar({
  current,
  user,
  activity,
}: {
  current: PageId;
  user?: AppShellUser | undefined;
  activity: number;
}) {
  return (
    <header className={styles.topBar}>
      <div className={styles.topStart}>
        <Mark />
        <span className={styles.brandName}>Render to Film</span>
      </div>
      <span className={styles.topTitle}>{pageById(current)?.label}</span>
      <div className={styles.topEnd}>
        <div aria-live="polite" className={styles.live}>
          {activity > 0 && <ActivityPill count={activity} />}
        </div>
        <a
          href="#settings"
          aria-label="Settings"
          aria-current={current === 'settings' ? 'page' : undefined}
          title={SETTINGS.purpose}
          className={styles.settings}
        >
          <SettingsIcon size={18} aria-hidden />
        </a>
        {user && (
          <div className={styles.topUser}>
            <UserMenu name={user.name} email={user.email} avatarUrl={user.avatarUrl} />
          </div>
        )}
      </div>
    </header>
  );
}

/**
 * The floating glass dock (from 900 px): every page but Settings in pipeline
 * order, a hairline between the groups (Shoot, Animate, Finish, Library), and
 * one indicator gliding to the page showing. Labels show from 1200 px; below
 * that the items are icons and keep the label for screen readers.
 */
export function Dock({ current }: { current: PageId }) {
  const navRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  useIndicator(navRef, indicatorRef, current);

  return (
    <nav aria-label="Studio" className={styles.dock} ref={navRef}>
      <span data-indicator aria-hidden className={styles.dockIndicator} ref={indicatorRef} />
      <ul className={styles.dockList}>
        {DOCK_PAGES.map((page, i) => {
          const Icon = page.icon;
          const next = DOCK_PAGES[i + 1];
          return (
            <Fragment key={page.id}>
              <li>
                <a
                  href={`#${page.id}`}
                  aria-current={page.id === current ? 'page' : undefined}
                  title={page.purpose}
                  className={styles.dockItem}
                >
                  <Icon size={18} aria-hidden className={styles.dockIcon} />
                  <span className={styles.dockLabel}>{page.label}</span>
                </a>
              </li>
              {/* A list holds only list items (axe fails a separator role on the <li> itself), so the rule sits in one. */}
              {next && next.group !== page.group && (
                <li className={styles.dockGap}>
                  <span role="separator" aria-orientation="vertical" className={styles.dockRule} />
                </li>
              )}
            </Fragment>
          );
        })}
      </ul>
    </nav>
  );
}

/** Whether the page is one of the five Shoot modes (the phone shows their row under the top bar). */
export function isShootPage(id: PageId): boolean {
  return SHOOT_MODES.some((p) => p.id === id);
}

/**
 * Phones, on a Shoot page: the five Shoot modes as a segmented row under the
 * top bar, so moving between them never needs the Shoot sheet. Each is a
 * real link; the current one is accent. The row scrolls sideways when it
 * runs out of room, keeping the current mode in view. Not rendered from
 * 900 px (the dock lists them) or on the other pages.
 */
export function ShootModes({ current }: { current: PageId }) {
  const listRef = useRef<HTMLUListElement>(null);
  const shoot = isShootPage(current);

  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !item || list.scrollWidth <= list.clientWidth) return;
    const left = item.offsetLeft - (list.clientWidth - item.offsetWidth) / 2;
    list.scrollLeft = Math.max(0, left);
  }, [current]);

  if (!shoot) return null;
  return (
    <nav aria-label="Shoot modes" className={styles.modes}>
      <ul className={styles.modeList} ref={listRef}>
        {SHOOT_MODES.map((page) => (
          <li key={page.id}>
            <a
              href={`#${page.id}`}
              aria-current={page.id === current ? 'page' : undefined}
              title={page.purpose}
              className={styles.mode}
            >
              {page.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function TabBar({ current, activity }: { current: PageId; activity: number }) {
  const navRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  useIndicator(navRef, indicatorRef, current);
  const shootPage = SHOOT_PAGES.includes(current) ? pageById(current) : undefined;

  return (
    <nav aria-label="Studio" className={styles.tabBar} ref={navRef}>
      <span data-indicator aria-hidden className={styles.tabIndicator} ref={indicatorRef} />
      <ul className={styles.tabs}>
        {PHONE_TABS.map((tab) => {
          const Icon = tab.icon;
          if (tab.id === 'shoot') {
            return (
              <li key={tab.id}>
                <button
                  type="button"
                  className={styles.tab}
                  aria-haspopup="dialog"
                  aria-expanded={sheetOpen}
                  aria-current={shootPage ? 'page' : undefined}
                  onClick={() => setSheetOpen(true)}
                >
                  <Icon size={22} aria-hidden className={styles.tabIcon} />
                  <span className={styles.tabLabel}>{shootPage?.label ?? tab.label}</span>
                </button>
              </li>
            );
          }
          const id = tab.pages[0]!;
          const busy = tab.id === 'library' && activity > 0;
          return (
            <li key={tab.id}>
              <a
                href={`#${id}`}
                aria-current={current === id ? 'page' : undefined}
                className={styles.tab}
              >
                <Icon size={22} aria-hidden className={styles.tabIcon} />
                <span className={styles.tabLabel}>{tab.label}</span>
                {busy && (
                  <>
                    <span className={styles.dot} aria-hidden />
                    <span className={styles.srOnly}>, {activity} rendering</span>
                  </>
                )}
              </a>
            </li>
          );
        })}
      </ul>
      <ShootSheet isOpen={sheetOpen} onOpenChange={setSheetOpen} current={current} />
    </nav>
  );
}

/** The phone's Shoot sheet: the five Shoot pages with their purpose. */
export function ShootSheet({
  isOpen,
  onOpenChange,
  current,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  current: PageId;
}) {
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable className={styles.sheetOverlay}>
      <Modal className={styles.sheet}>
        <Dialog className={styles.sheetDialog}>
          <div className={styles.sheetHead}>
            <Heading slot="title" className={styles.sheetTitle}>
              Shoot
            </Heading>
            <Button aria-label="Close" className={styles.sheetClose} onPress={() => onOpenChange(false)}>
              <X size={18} aria-hidden />
            </Button>
          </div>
          <ul className={styles.sheetList}>
            {SHOOT_PAGES.map((id) => {
              const page = pageById(id)!;
              const Icon = page.icon;
              return (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    aria-current={current === id ? 'page' : undefined}
                    className={styles.sheetItem}
                    onClick={() => onOpenChange(false)}
                  >
                    <Icon size={20} aria-hidden className={styles.sheetIcon} />
                    <span className={styles.sheetText}>
                      <span className={styles.sheetLabel}>{page.label}</span>
                      <span className={styles.sheetPurpose}>{page.purpose}</span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
