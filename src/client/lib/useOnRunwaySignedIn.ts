import { useCallback } from 'react';

import { trpc } from '../trpc.ts';

/**
 * What every `<SignInPrompt onSignedIn>` in this app does: after a popup
 * sign-in the visitor has changed, so every cached query (`profile` in the
 * navbar, `models`, …) is refetched — the whole page renders signed in, not
 * just the widget that asked — and then the failed call is retried:
 * `onSignedIn(() => generate.mutate(input))`.
 */
export function useOnRunwaySignedIn(): (retry?: () => void) => Promise<void> {
  const utils = trpc.useUtils();
  return useCallback(
    async (retry?: () => void) => {
      const refreshed = utils.invalidate();
      retry?.();
      await refreshed;
    },
    [utils]
  );
}
