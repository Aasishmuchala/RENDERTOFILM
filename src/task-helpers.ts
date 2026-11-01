import {
  describeRunwayFailure,
  parseRunwayApiErrorReason,
  RunwayApiError,
  RunwayAuthError,
  RunwayBrokerError,
  RunwayCreditError,
  RunwayTaskError,
  type TaskSnapshot,
} from '@runway/bay/runway';
import { TRPCError } from '@trpc/server';

import type { GenerationProvider } from './capabilities.ts';
import { compositeError, compositeUrl, ensureComposite } from './composite.ts';
import { readLibrary, type TaskState } from './library.ts';
import type { Context } from './trpc.ts';

/** Shared by every tRPC router: task polling and Runway error mapping. */

type Runway = NonNullable<Context['runway']>;
export type RunwayCtx = { runway: Runway };

/**
 * The finished image of a task. Pass `owner` for a still: a marked edit's
 * image is its composite (src/composite.ts), never the raw result.
 */
export async function finishedUrl(ctx: RunwayCtx, taskId: string, owner?: string): Promise<string> {
  const snap = await ctx.runway.taskSnapshot(taskId);
  if (owner && snap.url) {
    const still = (await readLibrary(owner)).stills.find((s) => s.id === taskId);
    if (!still) {
      // Fail closed: without its record the still might be a marked edit.
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'That still is no longer in your library. Pick another one.',
      });
    }
    if (still.maskKey) {
      try {
        return await compositeUrl(await ensureComposite(owner, still, snap.url));
      } catch (err) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: compositeError(err), cause: err });
      }
    }
  }
  if (snap.url) return snap.url;
  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: snap.done
      ? 'That still did not finish, so there is nothing to use. Pick another one.'
      : 'That still is still rendering. Try again once it has finished.',
  });
}

/**
 * `ctx` with every task it creates sent to `provider`: a later step of work
 * that provider started finishes there whatever Settings says now, or is
 * refused. `ctx` itself when nothing was recorded, always so on Bay.
 */
export function onProvider<C extends RunwayCtx>(ctx: C, provider: GenerationProvider | undefined): C {
  if (!provider) return ctx;
  const runway: Runway = Object.create(ctx.runway);
  runway.createTask = (type, options, opts) =>
    ctx.runway.createTask(type, options, { ...opts, provider } as typeof opts);
  return { ...ctx, runway };
}

export function settled(snap: TaskSnapshot): { status: TaskState; error?: string } {
  if (!snap.done) return { status: 'pending' };
  if (snap.status === 'SUCCEEDED') return { status: 'succeeded' };
  return { status: 'failed', error: snapError(snap) ?? 'The generation failed.' };
}

export function snapError(snap: TaskSnapshot): string | undefined {
  return snap.error
    ? [snap.error, snap.hint].filter(Boolean).join(' ')
    : undefined;
}

/**
 * Map a Runway failure onto the tRPC codes the client branches on.
 *
 * - `RunwayCreditError` → FORBIDDEN with `cause`, so `errorFormatter` in
 *   src/trpc.ts attaches `data.credits` and the UI renders
 *   `<OutOfCreditsPrompt>`. Checked first: never an UNAUTHORIZED.
 * - `RunwayAuthError` with `permissionDenied` (a plan-gated model) →
 *   FORBIDDEN, terminal; a stale session → UNAUTHORIZED, which prompts a
 *   sign-in.
 * - `RunwayTaskError` → BAD_REQUEST with the plain-language description.
 * - Anything else is passed on as `cause` (a broker consent refusal included),
 *   never replaced.
 */
export function toTrpcError(err: unknown): TRPCError {
  if (err instanceof TRPCError) return err;
  if (err instanceof RunwayCreditError) {
    return new TRPCError({
      code: 'FORBIDDEN',
      message: err.reason ?? err.message,
      cause: err,
    });
  }
  if (err instanceof RunwayAuthError) {
    return err.permissionDenied
      ? new TRPCError({
          code: 'FORBIDDEN',
          message: describeRunwayFailure(err).message,
        })
      : new TRPCError({
          code: 'UNAUTHORIZED',
          message: err.reason ?? err.message,
        });
  }
  if (err instanceof RunwayTaskError) {
    // Runway's own sentence says which setting it refused; the generic copy
    // alone leaves the visitor guessing which option to change.
    const reason = upstreamReason(err);
    const base = describeRunwayFailure(err).message;
    return new TRPCError({
      code: 'BAD_REQUEST',
      message: reason ? `${base} Runway said: ${reason}` : base,
    });
  }
  const base = describeRunwayFailure(err).message;
  const reason =
    err instanceof RunwayApiError && !(err instanceof RunwayBrokerError && err.code === 'grant_denied')
      ? parseRunwayApiErrorReason(err.body)?.replace(/\s+/g, ' ').trim().slice(0, 300)
      : undefined;
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: reason && err instanceof RunwayApiError ? `${base} Runway said (${err.status}): ${reason}` : base,
    cause: err,
  });
}

/** Runway's reason for refusing a task, in one readable line. */
function upstreamReason(err: RunwayTaskError): string | undefined {
  const issues = err.issues
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ');
  const reason = parseRunwayApiErrorReason(err.body) ?? (issues || undefined);
  return reason?.replace(/\s+/g, ' ').trim().slice(0, 400) || undefined;
}

export function logRejection(where: string, model: string, err: unknown) {
  if (err instanceof RunwayTaskError) {
    console.warn(`[${where}] ${model} refused`, err.status, err.message, err.issues);
  } else if (err instanceof RunwayBrokerError) {
    console.warn(`[${where}] ${model} broker`, err.code, err.status, err.message, JSON.stringify(err.body));
  } else if (err instanceof RunwayApiError) {
    console.warn(`[${where}] ${model} api`, err.status, err.message, JSON.stringify(err.body));
  } else {
    console.warn(`[${where}] ${model}`, err);
  }
}

