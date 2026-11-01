import {
  Clapperboard,
  Image as ImageIcon,
  Library as LibraryIcon,
  type LucideIcon,
  MessageCircle,
  Projector,
  Scissors,
  Settings as SettingsIcon,
  Users,
} from 'lucide-react';

import { parseHash } from './handoff.ts';

/**
 * The studio's pages (DESIGN.md 3.2): the chat is home, and the rest sit
 * behind the top bar's one menu button. The ids are the address hashes
 * (`#stills`), so deep links never change; Close-ups and Location are modes of
 * Still, and handoff.ts sends their old addresses there.
 */
export type PageId = 'chat' | 'director' | 'lifestyle' | 'stills' | 'video' | 'edit' | 'library' | 'settings';

export type Page = {
  id: PageId;
  label: string;
  /** One line on what the page is for: the page menu shows it under the label. */
  purpose: string;
  icon: LucideIcon;
};

export const PAGES: readonly Page[] = [
  { id: 'chat', label: 'Chat', purpose: 'Drop renders and say what you need', icon: MessageCircle },
  { id: 'director', label: 'Director', purpose: 'A storyboard shot from your project images', icon: Projector },
  { id: 'lifestyle', label: 'Lifestyle', purpose: 'A whole project, with the people who live there', icon: Users },
  { id: 'stills', label: 'Still', purpose: 'One render into a film still, close-ups and locations', icon: ImageIcon },
  { id: 'video', label: 'Video', purpose: 'Bring a still to life, or recreate a clip in 4K', icon: Clapperboard },
  { id: 'edit', label: 'Editing', purpose: 'Cut, grade and export the film', icon: Scissors },
  { id: 'library', label: 'Library', purpose: 'Everything you have made', icon: LibraryIcon },
  { id: 'settings', label: 'Settings', purpose: 'Accounts, models and connections', icon: SettingsIcon },
];

export const PAGE_IDS: readonly PageId[] = PAGES.map((p) => p.id);

/** The menu button's list: every page but the chat, which the brand links home to. */
export const MENU_PAGES: readonly Page[] = PAGES.filter((p) => p.id !== 'chat');

/** Where a bare address (no hash, or an unknown one) lands. */
export const DEFAULT_PAGE: PageId = 'chat';

export function pageById(id: string): Page | undefined {
  return PAGES.find((p) => p.id === id);
}

/** The page named in an address hash (`#video`, `video?still=abc`); `#closeups` and the like are Still. */
export function tabFromHash(hash: string): PageId {
  return parseHash(hash).page;
}
