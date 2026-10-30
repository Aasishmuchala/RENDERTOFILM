import { creditsRequiredFrom } from '@runway/bay-react/credits';
import {
  consentRequiredFrom,
  signInRequiredFrom,
} from '@runway/bay-react/runway-sign-in';

const RUNWAY_UNAVAILABLE_PREFIX = 'runway_unavailable: ';

/**
 * An input check that reached the browser as its issues in JSON (`[ { "code":
 * "too_small", …, "message": "…" } ]`, what tRPC says when nothing formats it):
 * the first issue's message, or `text` itself when it isn't that.
 */
function readableIssues(text: string): string {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('[')) return text;
  try {
    const issues: unknown = JSON.parse(trimmed);
    if (Array.isArray(issues)) {
      for (const issue of issues) {
        const m = (issue as { message?: unknown } | null)?.message;
        if (typeof m === 'string' && m.trim()) return m.trim();
      }
    }
  } catch {
    // Not JSON after all: a message that happens to start with a bracket.
  }
  return text;
}

/** The readable message of a tRPC error or raw-route body. */
export function errorMessage(e: unknown): string | undefined {
  if (!e) return undefined;
  if (typeof e === 'object' && e !== null) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string' && m) return readableIssues(m);
    const err = (e as { error?: unknown }).error;
    if (typeof err === 'string' && err) return readableIssues(err);
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
