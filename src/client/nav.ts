import {
  Camera,
  Clapperboard,
  Focus,
  Image as ImageIcon,
  Library as LibraryIcon,
  type LucideIcon,
  MapPinned,
  Projector,
  Scissors,
  Settings as SettingsIcon,
  Users,
} from 'lucide-react';

/**
 * The studio's pages and how the shell groups them (DESIGN.md 3.2): the film
 * pipeline (Shoot, Animate, Finish), then the library and settings. The ids
 * are the address hashes (`#stills`), so deep links never change.
 */
export type PageId =
  | 'director'
  | 'stills'
  | 'lifestyle'
  | 'video'
  | 'closeups'
  | 'location'
  | 'edit'
  | 'library'
  | 'settings';

export type NavGroupId = 'shoot' | 'animate' | 'finish' | 'library' | 'settings';

export type Page = {
  id: PageId;
  label: string;
  /** One line on what the page is for: the Shoot sheet and the nav `title`. */
  purpose: string;
  group: NavGroupId;
  icon: LucideIcon;
};

export const PAGES: readonly Page[] = [
  { id: 'stills', label: 'Stills', purpose: 'One render into a film still', group: 'shoot', icon: ImageIcon },
  {
    id: 'lifestyle',
    label: 'Lifestyle',
    purpose: 'A whole project, with the people who live there',
    group: 'shoot',
    icon: Users,
  },
  {
    id: 'director',
    label: 'Director',
    purpose: 'A storyboard shot from your project images',
    group: 'shoot',
    icon: Projector,
  },
  { id: 'closeups', label: 'Close-ups', purpose: 'Close-ups found inside your frames', group: 'shoot', icon: Focus },
  { id: 'location', label: 'Location', purpose: 'A map screenshot as a photograph', group: 'shoot', icon: MapPinned },
  {
    id: 'video',
    label: 'Video',
    purpose: 'Bring a still to life, or recreate a clip in 4K',
    group: 'animate',
    icon: Clapperboard,
  },
  { id: 'edit', label: 'Edit', purpose: 'Cut, grade and export the film', group: 'finish', icon: Scissors },
  { id: 'library', label: 'Library', purpose: 'Everything you have made', group: 'library', icon: LibraryIcon },
  {
    id: 'settings',
    label: 'Settings',
    purpose: 'Accounts, models and connections',
    group: 'settings',
    icon: SettingsIcon,
  },
];

export const PAGE_IDS: readonly PageId[] = PAGES.map((p) => p.id);

/** Nav groups in order; `label: null` groups have no header. */
export const GROUPS: readonly { id: NavGroupId; label: string | null }[] = [
  { id: 'shoot', label: 'Shoot' },
  { id: 'animate', label: 'Animate' },
  { id: 'finish', label: 'Finish' },
  { id: 'library', label: null },
  { id: 'settings', label: null },
];

/** Where a bare address (no hash, or an unknown one) lands. */
export const DEFAULT_PAGE: PageId = 'lifestyle';

export function pageById(id: string): Page | undefined {
  return PAGES.find((p) => p.id === id);
}

/** The page named in an address hash (`#video`, `video`); the old `#surroundings` is Location. */
export function tabFromHash(hash: string): PageId {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const id = raw === 'surroundings' ? 'location' : raw;
  return pageById(id)?.id ?? DEFAULT_PAGE;
}

/** The phone's five tabs; Shoot opens a sheet of its five pages. */
export const PHONE_TABS: readonly {
  id: 'shoot' | 'video' | 'edit' | 'library' | 'settings';
  label: string;
  icon: LucideIcon;
  pages: readonly PageId[];
}[] = [
  { id: 'shoot', label: 'Shoot', icon: Camera, pages: ['stills', 'lifestyle', 'director', 'closeups', 'location'] },
  { id: 'video', label: 'Video', icon: Clapperboard, pages: ['video'] },
  { id: 'edit', label: 'Edit', icon: Scissors, pages: ['edit'] },
  { id: 'library', label: 'Library', icon: LibraryIcon, pages: ['library'] },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, pages: ['settings'] },
];
