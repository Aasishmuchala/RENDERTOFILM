import { randomUUID } from 'node:crypto';
import {
  type BayViewerKind,
  getBayViewer,
  getRunwayClient,
  getRunwaySignInUrl,
  RunwayBrokerError,
  RunwayCreditError,
  runwayAuthGated,
  runwayCreditsRequired,
  SIGN_IN_REQUIRED,
} from '@runway/bay/runway';
import { initTRPC, TRPCError } from '@trpc/server';
import {
  type TRPC_ERROR_CODE_KEY,
  TRPC_ERROR_CODES_BY_KEY,
} from '@trpc/server/rpc';

import type { CreateTrpcKoaContextOptions } from './vendor/trpc-koa-adapter.ts';

/** Gateway-header identity, set by the auth middleware in src/index.ts. */
export interface GatewayUser {
  email: string;
  name?: string | undefined;
  username?: string | undefined;
}

/** Stashes the Koa-resolved gateway user onto the raw request so createContext
 * (which only sees the raw Node req/res, not the Koa ctx) can read it back. */
export const UserSymbol = Symbol('bay.gatewayUser');

declare module 'node:http' {
  interface IncomingMessage {
    [UserSymbol]?: GatewayUser | undefined;
  }
}

declare module 'koa' {
  interface DefaultState {
    user?: GatewayUser | undefined;
  }
}

export function createContext({ req, res }: CreateTrpcKoaContextOptions) {
  return {
    // SDK helpers that talk to the platform on the user's behalf (e.g.
    // getMcpClient from @runway/bay/mcp) need the inbound request for its
    // gateway cookies, so keep req/res on the context.
    req,
    res,
    user: req[UserSymbol],
    // runwayAuth() (src/index.ts) attaches the authenticated RunwayClient to
    // the raw request; this reads the same instance for tRPC. Unset for a
    // visitor with no Runway session — see `signedInProcedure`.
    runway: getRunwayClient(req),
    // Who is looking, per the edge: a `member` of this workspace, a `guest`
    // (another Runway account — only on an app shared with anyone), or
    // `anonymous` (no session — same). Branch on it for member-only data.
    viewer: (getBayViewer(req) ?? 'member') as BayViewerKind,
    // The sign-in URL for this request; `errorFormatter` hands it to the
    // client with every UNAUTHORIZED error so `<SignInPrompt>` can open it.
    signInUrl: getRunwaySignInUrl(req),
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

/**
 * The tRPC code for each 4xx a user-facing error may carry (`expose: true`
 * and a `status`, by Koa's and `http-errors`' convention — what a
 * `StorageBrokerError` from `@runway/bay/storage` is in a preview whose
 * workspace can't serve storage).
 */
const EXPOSED_CODE_BY_STATUS: Readonly<Record<number, TRPC_ERROR_CODE_KEY>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  412: 'PRECONDITION_FAILED',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE_CONTENT',
  429: 'TOO_MANY_REQUESTS',
};

/**
 * The first user-facing error on a `cause` chain (at most 8 links, loop-safe):
 * a procedure often wraps the error it caught — `new TRPCError({ code:
 * 'INTERNAL_SERVER_ERROR', cause })` — before tRPC sees it. An error that
 * explicitly sets `expose: false` ends the search: the app classified it as
 * internal.
 */
function exposedCause(
  cause: unknown
): { code: TRPC_ERROR_CODE_KEY; status: number; message: string } | undefined {
  const seen = new Set<unknown>();
  let current = cause;
  for (let depth = 0; depth < 8; depth++) {
    if (!(current instanceof Error) || seen.has(current)) return undefined;
    seen.add(current);
    const { expose, status } = current as Error & {
      expose?: unknown;
      status?: unknown;
    };
    if (expose === false) return undefined;
    const code =
      expose === true && typeof status === 'number'
        ? EXPOSED_CODE_BY_STATUS[status]
        : undefined;
    if (code && typeof status === 'number') {
      return { code, status, message: current.message };
    }
    current = current.cause;
  }
  return undefined;
}

/** An error's stack (or name and message), or any other value as a string. */
function describeError(value: unknown): string {
  return value instanceof Error
    ? (value.stack ?? `${value.name}: ${value.message}`)
    : String(value);
}

/**
 * tRPC's error shape, with an INTERNAL_SERVER_ERROR whose `cause` chain
 * carries a user-facing 4xx answered with that status instead, any other 5xx
 * answered with a fixed sentence and a reference (also `data.correlationId`,
 * logged with the error's stack and cause) instead of its own message (a
 * database error or an upstream body a visitor must not read),
 * and `data.stack` removed, both unless this is a developer's local `bay dev`.
 * tRPC includes the stack whenever `NODE_ENV` isn't `production`, and a
 * Studio preview (`bay dev` under `BAY_ENV=development`, in a Studio session
 * other people open) isn't — so this fails closed rather than trusting it.
 *
 * The same rule as `formatBayTrpcError` from `@runway/bay/runway`, written
 * out here so the scaffold compiles against any SDK release an app pins.
 */
function bayErrorShape<
  TShape extends {
    message: string;
    code: number;
    data: {
      code: string;
      httpStatus: number;
      stack?: string | undefined;
      correlationId?: string | undefined;
    };
  },
>({ shape, error }: { shape: TShape; error: TRPCError }): TShape {
  const exposed =
    error.code === 'INTERNAL_SERVER_ERROR'
      ? exposedCause(error.cause)
      : undefined;
  let next = shape;
  if (exposed) {
    next = {
      ...next,
      message: exposed.message,
      code: TRPC_ERROR_CODES_BY_KEY[exposed.code],
      data: { ...next.data, code: exposed.code, httpStatus: exposed.status },
    };
  }
  const localDev =
    process.env.BAY_ENV === 'development' &&
    !process.env.STUDIO_SESSION_ID &&
    process.env.NODE_ENV !== 'production';
  if (next.data.httpStatus >= 500 && !localDev) {
    const ref = randomUUID();
    console.error(`[trpc] internal error ${ref}: ${next.message}`, {
      code: next.data.code,
      stack: error.stack ?? next.data.stack,
      ...(error.cause === undefined
        ? {}
        : { cause: describeError(error.cause) }),
    });
    next = {
      ...next,
      message: `Something went wrong on our side. If it keeps happening, share reference ${ref}.`,
      data: { ...next.data, correlationId: ref },
    };
  }
  if (next.data.stack !== undefined && !localDev) {
    const { stack: _stack, ...data } = next.data;
    next = { ...next, data };
  }
  return next;
}

/** What the visitor reads when this app has no grant to call Runway for them. */
const CONSENT_MESSAGE =
  'This app needs your permission to generate with your Runway account. Allow it, then try again.';

/**
 * The consent page a broker consent refusal (`RunwayBrokerError` with `code:
 * 'grant_denied'`) names, found anywhere on a `cause` chain (at most 8 links,
 * loop-safe) — a procedure that wraps what it caught keeps it as `cause`.
 * A published app on a brokered workspace meets it on the first Runway call
 * of every visitor who hasn't allowed the app yet; a Studio preview never
 * does. The same rule as `runwayConsentRequired` from `@runway/bay/runway`,
 * written out here so the scaffold compiles against any SDK release an app
 * pins.
 */
function consentUrlFrom(cause: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current = cause;
  for (let depth = 0; depth < 8; depth++) {
    if (!(current instanceof Error) || seen.has(current)) return undefined;
    seen.add(current);
    if (current instanceof RunwayBrokerError && current.code === 'grant_denied')
      return current.consentUrl;
    current = current.cause;
  }
  return undefined;
}

const t = initTRPC.context<Context>().create({
  // An UNAUTHORIZED error — from `signedInProcedure` below, or from a stale
  // session `src/api.ts` reclassifies — carries the sign-in URL as
  // `data.reauth`. The client's `signInRequiredFrom()` reads that shape and
  // `<SignInPrompt>` opens it in a popup, then retries the call. A FORBIDDEN
  // (plan) denial deliberately gets none: signing in again can't clear it.
  // A billing refusal (out of credits, a cap, a free plan — `src/api.ts`
  // passes the `RunwayCreditError` as `cause`) carries `data.credits`
  // instead, which `<OutOfCreditsPrompt>` reads.
  //
  // A visitor who hasn't allowed this app to use their Runway account (a
  // published app on a brokered workspace) answers FORBIDDEN with the consent
  // page as `data.consent` and a plain sentence as the message, whatever code
  // the procedure gave it — never the SDK's own message, which tells a
  // developer what to do. `<ConsentPrompt>` (src/client/ui/) reads it.
  //
  // `bayErrorShape` runs first: a storage call's user-facing refusal (a
  // Studio preview whose workspace can't serve storage) answers 409 CONFLICT
  // with its message instead of a 500 — also when a procedure wrapped it in
  // its own INTERNAL_SERVER_ERROR — and the stack trace never reaches the
  // browser outside a local `bay dev`. Keep it first when adding fields of
  // your own; never return `opts.shape` directly.
  errorFormatter(opts) {
    const { error, ctx } = opts;
    const shape = bayErrorShape(opts);
    const consent = consentUrlFrom(error.cause);
    if (consent) {
      return {
        ...shape,
        message: CONSENT_MESSAGE,
        code: TRPC_ERROR_CODES_BY_KEY.FORBIDDEN,
        data: {
          ...shape.data,
          code: 'FORBIDDEN' as const,
          httpStatus: 403,
          consent,
        },
      };
    }
    if (error.cause instanceof RunwayCreditError) {
      return {
        ...shape,
        data: { ...shape.data, credits: runwayCreditsRequired(error.cause) },
      };
    }
    if (error.code !== 'UNAUTHORIZED' || !ctx?.signInUrl) return shape;
    return { ...shape, data: { ...shape.data, reauth: ctx.signInUrl } };
  },
});

export const router = t.router;

/** A procedure any visitor can call — browsing, listing, public reads. */
export const publicProcedure = t.procedure;

/**
 * A procedure that spends the visitor's Runway credits (or reads their
 * account): generations, uploads, task history. Without a Runway session it
 * answers UNAUTHORIZED with the sign-in URL attached (see `errorFormatter`),
 * which the client turns into a sign-in prompt; with one, `ctx.runway` is
 * narrowed to a present `RunwayClient` for the resolver. Never downgrade a
 * credit-spending procedure to `publicProcedure` to make a preview or an
 * anonymous visitor "work" — there is no account to bill.
 */
export const signedInProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.runway) {
    // Same refusal as `requireRunwayUser()`: on a path `runwayAuth()` never
    // gated (mounted first, or in its `exclude` list) nobody can have a
    // session, so a sign-in prompt would loop a signed-in member forever.
    // Say it's a wiring problem instead.
    if (!runwayAuthGated(ctx.req)) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message:
          'runway_auth_not_configured: mount runwayAuth() before tRPC and keep /trpc out of its exclude list',
      });
    }
    // A gated request with no sign-in URL is one whose session the broker
    // refused for good (`runwaySessionRefused()`): signing in again would mint
    // the same one, so say so rather than prompt for a sign-in. Read through
    // the URL so the starter keeps building on releases that predate it.
    if (!ctx.signInUrl) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message:
          "runway_unavailable: This app can't use your Runway account on this workspace yet.",
      });
    }
    throw new TRPCError({ code: 'UNAUTHORIZED', message: SIGN_IN_REQUIRED });
  }
  return next({ ctx: { ...ctx, runway: ctx.runway } });
});
