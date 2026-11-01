/**
 * Sidecars: the optional command-line editors the desktop app can drive. Pinned
 * versions, the resolver and the download are in desktop/platform/sidecars.js
 * (desktop only); these are the types and names the pages share with it.
 */

export type SidecarId = 'filmcraft' | 'lightcraft';

/** What `status(id)` answers. `ok` means the version found is the pinned one. */
export type SidecarStatus = {
  id: SidecarId;
  installed: boolean;
  path?: string;
  version?: string;
  pinned: string;
  ok: boolean;
  message: string;
};

export const SIDECAR_LABELS: Record<SidecarId, string> = {
  filmcraft: 'FilmCraft conform',
  lightcraft: 'LightCraft relight',
};
