import { Download, ExternalLink, ImageUpscale, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  STILL_UPSCALERS,
  UPSCALE_FACTORS,
  upscalerName,
  type StillUpscalerId,
  type UpscaleFactor,
} from '../models.ts';
import { libraryUrl, stillThumbUrl, useDownload } from './lib/download.ts';
import { classifyRunwayError } from './lib/runwayErrors.ts';
import { useInFlight } from './lib/useInFlight.ts';
import { trpc } from './trpc.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { RenderingStatus } from './ui/RenderingStatus.tsx';
import { RunwayErrorNotice } from './ui/RunwayErrorNotice.tsx';
import { Select } from './ui/Select.tsx';
import { Text } from './ui/Text.tsx';
import styles from './Studio.module.css';

export type UpscaleStillProps = {
  stillId: string;
  /** CSS aspect-ratio of the still, so the result frame doesn't jump. */
  aspectRatio: string;
  /** Filename stem for the download. */
  name: string;
  /** The upscale for this still; kept by the parent so it survives a new take. */
  job: UpscaleJob | null;
  onJob: (job: UpscaleJob | null) => void;
  /** This is the upscale of a take a newer one replaced: say so, and allow dismissing it. */
  earlier?: boolean | undefined;
};

export type UpscaleJob = {
  id: string;
  upscaler: StillUpscalerId;
  factor: UpscaleFactor;
  /** The still's frame and download name, for when its own panel is gone. */
  aspectRatio: string;
  name: string;
};

/** Upscale a finished still; the copy lands in the library as its own take. */
export function UpscaleStill({ stillId, aspectRatio, name, job, onJob, earlier = false }: UpscaleStillProps) {
  const saver = useDownload();
  const utils = trpc.useUtils();
  const [upscaler, setUpscaler] = useState<StillUpscalerId>('precision');
  const [factor, setFactor] = useState<UpscaleFactor>(2);

  const upscale = trpc.upscaleStill.useMutation();
  // A double-click's second press arrives before upscale.isPending shows.
  const guard = useInFlight();
  const status = trpc.shotStatus.useQuery(
    { id: job?.id ?? '' },
    {
      enabled: job !== null,
      refetchInterval: (q) => (q.state.data?.done ? false : 2500),
      refetchOnWindowFocus: false,
      retry: 2,
    }
  );
  const doneId = status.data?.done ? job?.id : undefined;
  useEffect(() => {
    if (doneId) void utils.library.invalidate();
  }, [doneId, utils]);

  // In flight until a final status arrives: a failed poll doesn't free the
  // button, or a second press would bill a second upscale.
  const rendering = job !== null && !status.data?.done;
  const lostTrack = rendering && status.error !== null;
  const busy = upscale.isPending || rendering;
  const url = status.data?.done ? status.data.url : undefined;
  const taskError =
    status.data?.done && !status.data.url
      ? status.data.error ?? 'The upscale did not return an image. Try again.'
      : undefined;
  const statusSpecial = status.error ? classifyRunwayError(status.error) : null;
  const shownError =
    upscale.error ??
    (statusSpecial && (statusSpecial.signIn || statusSpecial.credits || statusSpecial.consent)
      ? status.error
      : null);
  const { planBlocked, unavailable } = classifyRunwayError(shownError);

  async function run() {
    if (!guard.start()) return;
    try {
      const { id } = await upscale.mutateAsync({ stillId, upscaler, factor });
      onJob({ id, upscaler, factor, aspectRatio, name });
    } catch {
      // Shown by RunwayErrorNotice from upscale.error.
    } finally {
      guard.end();
    }
  }

  return (
    <div className={styles.upscale}>
      <h3 className={styles.upscaleTitle}>{earlier ? 'Upscale of an earlier take' : 'Upscale'}</h3>
      <Text tone="muted" size="sm" as="p">
        {earlier
          ? 'This upscale belongs to the take before your newest one. It is saved in the Library either way.'
          : 'Makes a larger copy for print or close crops. It is saved next to the original, so you can animate either one.'}
      </Text>
      <div className={styles.upscaleRow}>
        <Select
          label="Upscaler"
          options={STILL_UPSCALERS}
          value={upscaler}
          onChange={(id) => {
            setUpscaler(id as StillUpscalerId);
            upscale.reset();
          }}
          disabled={busy}
          showHint={false}
        />
        <Select
          label="Scale"
          options={UPSCALE_FACTORS}
          value={String(factor)}
          onChange={(id) => setFactor(id === '4' ? 4 : 2)}
          disabled={busy}
        />
        <Button
          icon={<ImageUpscale size={16} />}
          loading={busy}
          disabled={busy || planBlocked || unavailable}
          onPress={() => void run()}
        >
          {upscale.isPending ? 'Starting…' : rendering ? 'Upscaling…' : 'Upscale'}
        </Button>
      </div>
      <Text tone="muted" size="sm" as="p" className={styles.meta}>
        {STILL_UPSCALERS.find((u) => u.id === upscaler)?.hint}. Billed to your own Runway credits.
      </Text>

      <RunwayErrorNotice
        error={shownError}
        modelName={upscalerName(status.error && job ? job.upscaler : upscaler)}
        onRetry={() => void (shownError === status.error ? status.refetch() : run())}
      />

      {lostTrack && (
        <Alert tone="error" title="We lost touch with the upscale">
          {classifyRunwayError(status.error).message ?? 'The check failed.'} It may still be rendering and will appear
          in the Library, so check again before starting another.
          <div className={styles.resultActions}>
            <Button size="sm" loading={status.isFetching} onPress={() => void status.refetch()}>
              Check again
            </Button>
            <Button size="sm" variant="ghost" onPress={() => onJob(null)}>
              Stop waiting
            </Button>
          </div>
        </Alert>
      )}

      {(rendering || url || taskError) && !lostTrack && (
        <div className={styles.upscaleResult}>
          <div className={styles.resultFrame} style={{ aspectRatio, ['--ar' as string]: aspectRatio }}>
            {url ? (
              <img
                className={styles.image}
                src={job ? stillThumbUrl(job.id) : url}
                alt="Upscaled film still (preview; open full size for every pixel)"
              />
            ) : rendering ? (
              <RenderingStatus
                label="Upscaling the still…"
                progress={status.data?.progress}
                runKey={job?.id}
              />
            ) : (
              <div className={styles.frameAlert}>
                <Alert tone="error" title="The upscale didn't finish">
                  {taskError}
                </Alert>
              </div>
            )}
          </div>
          {url && job && (
            <div className={styles.markRow}>
              <Button
                variant="ghost"
                icon={<Download size={16} />}
                loading={saver.pending}
                onPress={() => saver.start(libraryUrl('still', job.id), `${name}-${job.factor}x.png`)}
              >
                {saver.label('Download upscaled')}
              </Button>
              <Button
                variant="ghost"
                icon={<ExternalLink size={16} />}
                onPress={() => window.open(libraryUrl('still', job.id), '_blank', 'noopener')}
              >
                Open full size
              </Button>
              {earlier && (
                <Button variant="ghost" size="sm" icon={<X size={14} />} onPress={() => onJob(null)}>
                  Dismiss
                </Button>
              )}
            </div>
          )}
          {url && job && (
            <Text tone="muted" size="sm" as="p" className={styles.meta}>
              {upscalerName(job.upscaler)}, {job.factor}×
            </Text>
          )}
          {saver.error && (
            <Alert tone="error" title="Download failed">
              {saver.error}
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}
