import { TRPC_ERROR_CODES_BY_KEY, type TRPC_ERROR_CODE_KEY } from '@trpc/server/rpc';

/**
 * The tRPC link's fetch. The server always answers `/trpc` in tRPC's shape,
 * but whatever sits in front of it doesn't: the sign-in gate (an expired
 * session, a refused grant, a billing refusal), the public edge (a rate-limit
 * 403, an oversized body) or a timed-out proxy (an HTML error page). tRPC
 * can't read those and shows "Unable to transform response from server". This
 * rewrites any such answer into one tRPC error per call in the batch, keeping
 * `reauth` / `consent` / `credits` where the pages already look for them, so
 * the sign-in, consent and credits prompts still appear and everything else
 * reads as one plain sentence.
 */
export async function trpcFetch(input: RequestInfo | URL | string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (err) {
    if (init?.signal?.aborted) throw err;
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  if (json !== undefined && isTrpcBody(json)) {
    return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
  }
  const error = toTrpcError(res.status, json);
  const calls = callCount(input);
  const body = calls === null ? { error } : Array.from({ length: calls }, () => ({ error }));
  return new Response(JSON.stringify(body), {
    status: res.status >= 200 && res.status <= 599 ? res.status : 500,
    headers: { 'content-type': 'application/json' },
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isTrpcItem(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if ('result' in v) return isRecord(v['result']);
  return isRecord(v['error']) && typeof v['error']['code'] === 'number';
}

function isTrpcBody(v: unknown): boolean {
  return Array.isArray(v) ? v.length > 0 && v.every(isTrpcItem) : isTrpcItem(v);
}

/** Calls in the batch (`/trpc/a,b?batch=1`), or null for an unbatched call. */
function callCount(input: RequestInfo | URL | string): number | null {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, window.location.href);
  if (url.searchParams.get('batch') !== '1') return null;
  const paths = url.pathname.split('/').pop() ?? '';
  return Math.max(1, paths.split(',').length);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

function shape(code: TRPC_ERROR_CODE_KEY, httpStatus: number, message: string, extra: Record<string, unknown> = {}) {
  return { message, code: TRPC_ERROR_CODES_BY_KEY[code], data: { code, httpStatus, ...extra } };
}

function toTrpcError(status: number, json: unknown) {
  const body = isRecord(json) ? json : {};
  const kind = str(body['error']);
  const reauth = str(body['reauth']);
  if ((kind === 'sign_in_required' || kind === 'session_expired') && reauth) {
    return shape('UNAUTHORIZED', 401, 'Your Runway sign-in has expired. Sign in again to carry on.', { reauth });
  }
  const consent = str(body['consent']);
  if (consent) {
    return shape(
      'FORBIDDEN',
      403,
      str(body['message']) ?? 'This app needs your permission to use your Runway account. Allow it, then try again.',
      { consent }
    );
  }
  if (kind === 'runway_unavailable') {
    return shape(
      'FORBIDDEN',
      403,
      `runway_unavailable: ${str(body['message']) ?? "This app can't use your Runway account right now."}`
    );
  }
  if (status === 402 && isRecord(json)) {
    return shape('FORBIDDEN', 403, 'Runway refused to bill this generation.', { credits: json });
  }
  if (kind === 'grant_denied') {
    return shape('FORBIDDEN', 403, "This app isn't allowed to use your Runway account. Ask the app's owner.", {
      refused: true,
    });
  }
  if (status === 401) {
    return shape('UNAUTHORIZED', 401, 'Your sign-in has expired. Reload the page to sign in again.');
  }
  if (status === 403) {
    return shape(
      'FORBIDDEN',
      403,
      str(body['message']) ??
        'This request was refused before it reached the app. Reload the page, sign in if asked, then try again in a minute.',
      { refused: true }
    );
  }
  if (status === 413) {
    return shape('PAYLOAD_TOO_LARGE', 413, 'That is too large to send in one go. Use a smaller file and try again.');
  }
  if (status === 429) {
    return shape('TOO_MANY_REQUESTS', 429, 'Too many requests at once. Wait a minute, then try again.');
  }
  if (status === 408 || status === 502 || status === 503 || status === 504) {
    return shape(
      'GATEWAY_TIMEOUT',
      504,
      'The server took too long to answer. Check the Library in a moment: the work may still have gone through, then try again.'
    );
  }
  const detail = str(body['message']) ?? (kind && kind.includes(' ') ? kind : undefined);
  return shape(
    'INTERNAL_SERVER_ERROR',
    status >= 400 ? status : 500,
    detail ?? `The server sent a reply the app couldn't read (status ${status}). Try again in a moment.`
  );
}
