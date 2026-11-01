import type { RunView } from '../../chat/domain.ts';
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
 * Everything in flight, for the shell's activity pill: the stills and clips
 * still rendering plus the chat Runs still going (`pending`, and `total`, the
 * name the shell reads), and the Runs themselves for the tray. Two observers
 * of queries the pages share: `library` polls every 8 s only while something
 * is pending, `chat.runs` every 8 s even in a background tab, because a Run
 * goes on without the page.
 */
export function useActivity(): {
  stills: number;
  clips: number;
  total: number;
  pending: number;
  runs: RunView[];
} {
  const library = trpc.library.useQuery(undefined, {
    refetchInterval: (q) => (pending(q.state.data) > 0 ? 8_000 : false),
    refetchOnWindowFocus: false,
  });
  const active = trpc.chat.runs.useQuery(
    { active: true },
    { refetchInterval: 8_000, refetchIntervalInBackground: true, refetchOnWindowFocus: false }
  );
  const stills = pendingStills(library.data);
  const clips = pendingClips(library.data);
  const runs = active.data ?? [];
  const all = stills + clips + runs.length;
  return { stills, clips, total: all, pending: all, runs };
}
