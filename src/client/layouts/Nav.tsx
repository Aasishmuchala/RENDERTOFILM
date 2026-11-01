import { Aperture, Check, Library as LibraryIcon, Menu as MenuIcon, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import {
  Button,
  Dialog,
  DialogTrigger,
  Heading,
  Link,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  ModalOverlay,
  Popover,
  Text,
} from 'react-aria-components';

import type { RunView } from '../../chat/domain.ts';
import { RunTray } from '../chat/RunTray.tsx';
import { formatHash, type Handoff } from '../handoff.ts';
import { useActivity } from '../lib/useActivity.ts';
import { MENU_PAGES, type PageId, pageById } from '../nav.ts';
import { UserMenu } from '../ui/UserMenu.tsx';
import type { AppShellUser } from './AppShell.tsx';
import styles from './Nav.module.css';
import { usePhoneLayout } from './Workspace.tsx';

/**
 * The shell's navigation (DESIGN.md 3.1, 3.2): a glass top bar at every
 * width, with one menu button that lists the pages, as a popover or, on
 * phones, a sheet. Every item is a real `<a href="#id">`, so the back button
 * steps between pages.
 */

function Mark() {
  return (
    <span className={styles.mark} aria-hidden>
      <Aperture size={16} />
    </span>
  );
}

/** The pill is a button now, not a link: the reset a native button needs to keep its look. */
const PILL_RESET: CSSProperties = { border: 0, cursor: 'pointer' };

/** What the pill opens: every Run at a glance, above the way to the library. */
export function ActivityPanel({
  runs,
  onOpen,
  onClose,
}: {
  runs: RunView[];
  onOpen: (handoff: Handoff) => void;
  onClose?: (() => void) | undefined;
}) {
  return (
    <div className={styles.menu}>
      <RunTray runs={runs} onOpen={onOpen} />
      <Link href="#library" className={styles.menuItem} onPress={onClose}>
        <LibraryIcon size={20} aria-hidden className={styles.menuIcon} />
        <span className={styles.menuText}>
          <span className={styles.menuLabel}>Library</span>
        </span>
      </Link>
    </div>
  );
}

/**
 * "{n} rendering": shown while a still or clip is pending or a Run is going;
 * it opens the Runs and a link to the library.
 */
export function ActivityPill({ count, runs }: { count: number; runs: RunView[] }) {
  return (
    <DialogTrigger>
      <Button className={styles.pill} style={PILL_RESET}>
        <span className={styles.pillSweep} aria-hidden>
          <span className={styles.pillBand} />
        </span>
        <span className={styles.pillCount}>{count}</span>
        <span className={styles.pillText}> rendering</span>
      </Button>
      <Popover placement="bottom end" offset={6} className={styles.popover}>
        <Dialog aria-label="Activity" className={styles.sheetDialog}>
          {({ close }) => (
            <ActivityPanel
              runs={runs}
              onOpen={(handoff) => {
                window.location.hash = formatHash(handoff.page, handoff.params);
                close();
              }}
              onClose={close}
            />
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

/** The pages, each with what it is for; the current one wears a check and a 2 px border. */
function PageList({ current }: { current: PageId }) {
  return (
    <Menu className={styles.menu}>
      {MENU_PAGES.map((page) => {
        const Icon = page.icon;
        const here = page.id === current;
        return (
          <MenuItem
            key={page.id}
            id={page.id}
            href={`#${page.id}`}
            textValue={page.label}
            data-current={here || undefined}
            className={styles.menuItem}
          >
            <Icon size={20} aria-hidden className={styles.menuIcon} />
            <span className={styles.menuText}>
              <Text slot="label" className={styles.menuLabel}>
                {page.label}
                {here && <span className={styles.srOnly}>, current page</span>}
              </Text>
              <Text slot="description" className={styles.menuPurpose}>
                {page.purpose}
              </Text>
            </span>
            {here && <Check size={18} aria-hidden className={styles.menuCheck} />}
          </MenuItem>
        );
      })}
    </Menu>
  );
}

/** The top bar's one way to the other pages: the same list in a popover, or on phones a bottom sheet. */
function MenuButton({ current }: { current: PageId }) {
  const phone = usePhoneLayout();

  return (
    <MenuTrigger>
      <Button aria-label="Pages" aria-haspopup="menu" className={styles.menuButton}>
        <MenuIcon size={18} aria-hidden />
      </Button>
      {phone ? (
        <ModalOverlay isDismissable className={styles.sheetOverlay}>
          <Modal className={styles.sheet}>
            <Dialog className={styles.sheetDialog}>
              <div className={styles.sheetHead}>
                <Heading slot="title" className={styles.sheetTitle}>
                  Pages
                </Heading>
                <Button slot="close" aria-label="Close" className={styles.sheetClose}>
                  <X size={18} aria-hidden />
                </Button>
              </div>
              <PageList current={current} />
            </Dialog>
          </Modal>
        </ModalOverlay>
      ) : (
        <Popover placement="bottom end" offset={6} className={styles.popover}>
          <PageList current={current} />
        </Popover>
      )}
    </MenuTrigger>
  );
}

/**
 * The fixed glass bar across the top, at every width: the mark and the app's
 * name (a link home to the chat), the page showing, then the activity pill
 * with the chat page's own slot beside it, the page menu and the account.
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
  const { runs } = useActivity();
  return (
    <header className={styles.topBar}>
      <div className={styles.topStart}>
        <a href="#chat" aria-label="Render to Film, go to Chat" className={styles.brand}>
          <Mark />
          <span className={styles.brandName}>Render to Film</span>
        </a>
      </div>
      <span className={styles.topTitle}>{pageById(current)?.label}</span>
      <div className={styles.topEnd}>
        <div aria-live="polite" className={styles.live}>
          {activity > 0 && <ActivityPill count={activity} runs={runs} />}
        </div>
        <span id="tray-slot" />
        <MenuButton current={current} />
        {user && (
          <div className={styles.topUser}>
            <UserMenu name={user.name} email={user.email} avatarUrl={user.avatarUrl} />
          </div>
        )}
      </div>
    </header>
  );
}
