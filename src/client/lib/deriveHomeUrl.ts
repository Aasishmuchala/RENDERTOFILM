/** The fleet zone every deployment cell's launcher lives one label under
 * (`<cell>.any.runwayml.com`). Duplicated as a plain literal on purpose: this
 * client bundle can't import the server-only `FLEET_APEX`
 * (`fleet-cells/snapshot.ts` in the private fleet service). Keep in sync. */
const FLEET_ZONE = 'any.runwayml.com';

/**
 * The "home" (app launcher) URL for a deployed app on a deployment cell,
 * derived from its own hostname:
 *
 * - `<app>.<cell>.any.runwayml.com` → `https://<cell>.any.runwayml.com`
 *
 * Scoped to cell apps by design — that's where this menu lives and
 * where "back to the workspace's app list" is the intent. Returns null for
 * everything else: internal primary apps (`*.bay.runwayml.com`), external-edge
 * apps (`*.ext.runwayml.com`), custom domains, localhost/IPs, a bare cell apex
 * (already home), or no `window`. Any app outside that scope that still wants
 * the link passes an explicit `homeUrl` (e.g. the injected
 * `BAY_ORCHESTRATOR_URL`).
 */
export function deriveHomeUrl(
  host: string | undefined = typeof window === 'undefined'
    ? undefined
    : window.location.hostname
): string | null {
  if (!host) return null;
  const h = host.toLowerCase();
  if (!h.endsWith(`.${FLEET_ZONE}`)) return null;

  // Keep the cell label + the fleet zone, dropping the app (and any deeper)
  // labels above it. A bare `<cell>.any.runwayml.com` is the launcher itself —
  // nothing to go back to — so it returns null.
  const labels = h.split('.');
  const cellApexLen = FLEET_ZONE.split('.').length + 1; // <cell> + zone
  if (labels.length <= cellApexLen) return null;
  return `https://${labels.slice(labels.length - cellApexLen).join('.')}`;
}
