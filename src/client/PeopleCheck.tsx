import { CircleCheck, RotateCcw, ScanEye, TriangleAlert, WandSparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { PEOPLE_CHECKS } from '../checks.ts';
import { trpc } from './trpc.ts';
import { errorMessage } from './lib/runwayErrors.ts';
import { useCapabilities } from './lib/useCapabilities.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { RunwayErrorNotice } from './ui/RunwayErrorNotice.tsx';
import { SkeletonText } from './ui/Skeleton.tsx';
import { Text } from './ui/Text.tsx';
import styles from './PeopleCheck.module.css';

export type PeopleCheckProps = {
  stillId: string;
  /** Start the check by itself when this still has never been checked. */
  autoRun: boolean;
  /** Re-take the still with the reviewer's corrections. */
  onFix: (fixes: string) => void;
  fixing?: boolean | undefined;
};

/**
 * The automatic review of a still with people in it: height against the
 * scene, grounding and physics, light, faces, blend, and that nothing else
 * changed, with a re-take that carries the reviewer's fixes.
 */
export function PeopleCheck({ stillId, autoRun, onFix, fixing = false }: PeopleCheckProps) {
  const { caps } = useCapabilities();
  const utils = trpc.useUtils();
  const checkShot = trpc.checkShot.useMutation({
    onSuccess: () => utils.checkStatus.invalidate({ stillId }),
  });
  const status = trpc.checkStatus.useQuery(
    { stillId },
    {
      refetchInterval: (q) => (q.state.data?.status === 'running' ? 3000 : false),
      retry: 2,
    }
  );
  const started = useRef<string | null>(null);

  useEffect(() => {
    if (!autoRun || started.current === stillId) return;
    if (status.isSuccess && status.data === null && !checkShot.isPending) {
      started.current = stillId;
      checkShot.mutate({ stillId });
    }
  }, [autoRun, stillId, status.isSuccess, status.data, checkShot]);

  const check = status.data;
  const running = checkShot.isPending || check?.status === 'running';
  const run = () => {
    if (running || fixing) return;
    checkShot.mutate({ stillId });
  };

  return (
    <section className={styles.panel} aria-labelledby={`check-${stillId}`}>
      <div className={styles.head}>
        <h3 id={`check-${stillId}`} className={styles.title}>
          <ScanEye size={16} aria-hidden />
          People check
        </h3>
        {check?.status === 'done' && (
          <span
            className={check.report.verdict === 'pass' ? styles.pass : styles.issues}
          >
            {check.report.verdict === 'pass' ? 'Looks real' : 'Needs fixes'} ·{' '}
            {check.report.score}/10
          </span>
        )}
      </div>

      {running ? (
        <div role="status" aria-live="polite">
          <Text tone="secondary" size="sm" as="p" className={styles.lead}>
            Measuring each person against the curbs, lamps and trees, and checking
            feet, shadows, faces and blend…
          </Text>
          <SkeletonText rows={4} />
        </div>
      ) : checkShot.error ? (
        <div className={styles.stack}>
          <RunwayErrorNotice error={checkShot.error} modelName="Claude Opus 5.5" onRetry={run} />
          <Button size="sm" icon={<RotateCcw size={14} />} onPress={run}>
            Try the check again
          </Button>
        </div>
      ) : status.error ? (
        <div className={styles.stack}>
          <Alert tone="error" title="The people check could not be loaded">
            {errorMessage(status.error)}
          </Alert>
          <Button
            size="sm"
            icon={<RotateCcw size={14} />}
            loading={status.isFetching}
            onPress={() => void status.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : check?.status === 'failed' ? (
        <div className={styles.stack}>
          <Text tone="secondary" size="sm" as="p">
            {check.error}
          </Text>
          <Button size="sm" icon={<RotateCcw size={14} />} onPress={run}>
            Run the check again
          </Button>
        </div>
      ) : check?.status === 'done' ? (
        <>
          <Text tone="secondary" size="sm" as="p" className={styles.lead}>
            {check.report.summary}
          </Text>
          <ul className={styles.list}>
            {PEOPLE_CHECKS.map((c) => {
              const item = check.report.checks.find((x) => x.id === c.id);
              if (!item) return null;
              return (
                <li key={c.id} className={styles.item}>
                  {item.ok ? (
                    <CircleCheck size={14} className={styles.okIcon} role="img" aria-label="Passed" />
                  ) : (
                    <TriangleAlert size={14} className={styles.badIcon} role="img" aria-label="Issue" />
                  )}
                  <span>
                    <span className={styles.itemName}>{c.name}.</span> {item.note}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className={styles.actions}>
            {check.report.verdict === 'issues' && check.report.fixes.trim() && (
              <Button
                icon={<WandSparkles size={16} />}
                loading={fixing}
                disabled={fixing || running}
                onPress={() => onFix(check.report.fixes)}
              >
                Fix and re-take
              </Button>
            )}
            <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} onPress={run} disabled={fixing || running}>
              Check again
            </Button>
          </div>
          {check.report.verdict === 'issues' && check.report.fixes.trim() && (
            <Text tone="muted" size="sm" as="p" className={styles.fixes}>
              The re-take will ask for: {check.report.fixes}
            </Text>
          )}
        </>
      ) : status.isLoading ? (
        <SkeletonText rows={2} />
      ) : (
        <div className={styles.stack}>
          <Text tone="secondary" size="sm" as="p">
            Checks height, footing, shadows, faces and blend for every person in this still.
          </Text>
          <Button size="sm" icon={<ScanEye size={14} />} onPress={run}>
            Check the people
          </Button>
        </div>
      )}
      <Text tone="muted" size="sm" as="p" className={styles.note}>
        {caps.desktop ? 'Reviewed by Claude on your AI text key.' : 'Reviewed by Claude Opus 5.5 on your Runway credits.'}
      </Text>
    </section>
  );
}
