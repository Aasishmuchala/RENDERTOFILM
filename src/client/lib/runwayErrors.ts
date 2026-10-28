import { creditsRequiredFrom } from '@runway/bay-react/credits';
import {
  consentRequiredFrom,
  signInRequiredFrom,
} from '@runway/bay-react/runway-sign-in';

const RUNWAY_UNAVAILABLE_PREFIX = 'runway_unavailable: ';

/** The readable message of a tRPC error or raw-route body. */
export function errorMessage(e: unknown): string | undefined {
  if (!e) return undefined;
  if (typeof e === 'object' && e !== null) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
    const err = (e as { error?: unknown }).error;
    if (typeof err === 'string' && err) return err;
  }
  return 'Something blocked this request. Try again in a moment.';
}

/** Sorts a Runway call's failure into the one notice it should show. */
export function classifyRunwayError(e: unknown) {
  const signIn = signInRequiredFrom(e);
  const credits = creditsRequiredFrom(e);
  const consent = consentRequiredFrom(e);
  const raw = errorMessage(e);
  const unavailable = raw?.startsWith(RUNWAY_UNAVAILABLE_PREFIX) === true;
  const message = unavailable ? raw!.slice(RUNWAY_UNAVAILABLE_PREFIX.length) : raw;
  const planBlocked =
    !credits &&
    !consent &&
    !unavailable &&
    (e as { data?: { code?: string; refused?: boolean } } | null)?.data?.code === 'FORBIDDEN' &&
    // A refusal before the app (trpcFetch.ts) says nothing about the model.
    (e as { data?: { refused?: boolean } } | null)?.data?.refused !== true;
  return { signIn, credits, consent, message, unavailable, planBlocked };
}
