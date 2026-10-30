import { trpc } from '../trpc.ts';

type LibraryData = { stills: readonly { status: string }[]; clips: readonly { status: string }[] };

function pendingStills(data: LibraryData | undefined): number {
  return data ? data.stills.filter((s) => s.status === 'pending').length : 0;
}

function pendingClips(data: LibraryData | undefined): number {
  return data ? data.clips.filter((c) => c.status === 'pending').length : 0;
}

function pending(data: LibraryData | undefined): number {
  return pendingStills(data) + pendingClips(data);
}

/**
 * How many stills and clips are still rendering, for the shell's activity
 * pill. One more observer of the `library` query: it polls every 8 s only
 * while something is pending, so an idle studio makes no extra requests.
 */
export function useActivity(): { stills: number; clips: number; total: number } {
  const library = trpc.library.useQuery(undefined, {
    refetchInterval: (q) => (pending(q.state.data) > 0 ? 8_000 : false),
    refetchOnWindowFocus: false,
  });
  const stills = pendingStills(library.data);
  const clips = pendingClips(library.data);
  return { stills, clips, total: stills + clips };
}
