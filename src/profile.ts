/**
 * Pure identity resolution for the `profile` procedure — kept free of SDK
 * and tRPC imports so the rules below can be exercised on their own.
 */

export interface AppProfile {
  name: string;
  email: string;
  avatarUrl: string | null;
}

/** What the `profile` procedure knows about the visitor before deciding. */
export interface ProfileInput {
  /** Gateway-forwarded identity (internal, Google-OIDC cells). */
  headerEmail: string | undefined;
  headerName: string | undefined;
  /** Whether the request carries a Runway session at all. */
  hasRunwayClient: boolean;
  /** `getProfile()`'s answer — `undefined` when there was no client, or it failed. */
  runwayProfile:
    | {
        email: string;
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        username?: string | null | undefined;
        picture?: string | null | undefined;
      }
    | undefined;
  /** The session JWT's own `email` claim, the fallback when `getProfile()` failed. */
  tokenEmail: string | undefined;
}

/** Placeholder email for a session nothing else can name. */
export const UNNAMED_ACCOUNT = 'runway-account';

/**
 * Resolve display identity, or `null` for a visitor with no identity at all
 * — an anonymous viewer of an app shared with anyone (no gateway email, no
 * Runway session). Name chain otherwise: gateway header name → Runway
 * profile firstName+lastName, else username → email local-part.
 *
 * Two guards:
 *
 * - `getProfile()` returns the token OWNER's profile — the account that ran
 *   "Connect Runway" — not necessarily this visitor's. Its name and picture
 *   are trusted only when its email matches the gateway header email, or
 *   when there is no header email to compare against (Bay Studio preview).
 *   Otherwise every visitor of a shared app would see the connector's
 *   identity.
 * - A signed-in visitor whose `getProfile()` failed (Runway API blip,
 *   revoked token) is still signed in and is never reported as anonymous:
 *   that would flip the UI into its signed-out state and offer a sign-in
 *   that can't help. The JWT's email names them instead; the picture is
 *   skipped.
 */
export function resolveProfileIdentity(input: ProfileInput): AppProfile | null {
  const { headerEmail, headerName, hasRunwayClient, runwayProfile } = input;
  if (!hasRunwayClient && !headerEmail) return null;

  const trustRunwayIdentity =
    runwayProfile !== undefined &&
    (!headerEmail || runwayProfile.email === headerEmail);

  const email =
    headerEmail ?? runwayProfile?.email ?? input.tokenEmail ?? UNNAMED_ACCOUNT;

  const runwayName = runwayProfile
    ? [runwayProfile.firstName, runwayProfile.lastName]
        .filter((part): part is string => !!part)
        .join(' ') || runwayProfile.username
    : undefined;

  const name =
    headerName ||
    (trustRunwayIdentity ? runwayName : undefined) ||
    email.split('@')[0] ||
    email;

  const avatarUrl = trustRunwayIdentity
    ? (runwayProfile?.picture ?? null)
    : null;

  return { name: name ?? email, email, avatarUrl };
}
