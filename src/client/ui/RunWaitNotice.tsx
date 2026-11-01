import { useActivity } from '../lib/useActivity.ts';
import { useCapabilities } from '../lib/useCapabilities.ts';
import { trpc } from '../trpc.ts';
import { Alert } from './Alert.tsx';
import styles from './RunWaitNotice.module.css';

/**
 * Says so when a paid run is held up for a key, whichever tab it came from: to
 * every page it looks like a take still rendering. Chat Runs going on in the
 * background are named too, in the same breath. Desktop only for the hold, and
 * asked for only while something is pending, so an idle studio makes no extra
 * requests.
 */
export function RunWaitNotice({ active }: { active: boolean }) {
  const { caps } = useCapabilities();
  const { runs } = useActivity();
  const waits = trpc.settings.waitingRuns.useQuery(undefined, {
    enabled: caps.desktop && active,
    refetchInterval: 8_000,
    refetchOnWindowFocus: false,
  });
  const count = waits.data?.count ?? 0;
  const going = runs.length;
  if (!active || (count === 0 && going === 0)) return null;
  return (
    <div className={styles.notice}>
      {count > 0 && (
        <Alert tone="warning" title={count === 1 ? 'A paid run is on hold' : `${count} paid runs are on hold`}>
          {waits.data?.message}
        </Alert>
      )}
      {going > 0 && (
        <Alert tone="info" title={going === 1 ? 'A run in the background' : `${going} runs in the background`}>
          {going === 1 ? runs[0]?.label : undefined}
        </Alert>
      )}
    </div>
  );
}
