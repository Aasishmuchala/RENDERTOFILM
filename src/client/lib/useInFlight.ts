import { useMemo, useRef } from 'react';

/**
 * A guard for a handler that starts paid work. `mutation.isPending` only
 * flips a tick after the call, so the second press of a double-click still
 * finds an idle button and sends the request again; a ref flips at once.
 *
 *   if (!guard.start()) return;
 *   try { await start.mutateAsync(…); } finally { guard.end(); }
 *
 * or `const run = guard.wrap(async () => …)`, where a call made while the
 * first is still running returns undefined and sends nothing.
 */
export type InFlight = {
  /** Claim the guard; false when a call is already in flight. */
  start: () => boolean;
  /** Release it, sent or failed. */
  end: () => void;
  /** Whether a call is in flight, for a handler that must not even reset state meanwhile. */
  busy: () => boolean;
  wrap: <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => (...args: A) => Promise<R | undefined>;
};

export function useInFlight(): InFlight {
  const flying = useRef(false);
  return useMemo(() => {
    const start = () => {
      if (flying.current) return false;
      flying.current = true;
      return true;
    };
    const end = () => {
      flying.current = false;
    };
    return {
      start,
      end,
      busy: () => flying.current,
      wrap:
        <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
        async (...args: A) => {
          if (!start()) return undefined;
          try {
            return await fn(...args);
          } finally {
            end();
          }
        },
    };
  }, []);
}
