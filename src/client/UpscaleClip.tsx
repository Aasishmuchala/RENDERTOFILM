import { Download, ExternalLink, Scaling } from 'lucide-react';
import { useEffect, useState } from 'react';

import { upscalerName, type ClipUpscalerId } from '../models.ts';
import { libraryUrl, useDownload } from './lib/download.ts';
import { classifyRunwayError } from './lib/runwayErrors.ts';
import { useCapabilities } from './lib/useCapabilities.ts';
import { useInFlight } from './lib/useInFlight.ts';
import { trpc } from './trpc.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { BlockedTip, ModelUnavailable } from './ui/ModelUnavailable.tsx';
import { RenderingStatus } from './ui/RenderingStatus.tsx';
import { RunwayErrorNotice } from './ui/RunwayErrorNotice.tsx';
import { Select } from './ui/Select.tsx';
import { Text } from './ui/Text.tsx';
import styles from './Studio.module.css';

export type UpscaleJob = { id: string; upscaler: ClipUpscalerId };

export type UpscaleClipProps = {
  clipId: string;
  aspectRatio: string;
  name: string;
  /** True while the Video tab is on screen; polling slows down when it isn't. */
  active: boolean;
  /** Why FLUX Video Upscale can't take this clip, or undefined when it can. */
  fluxBlock: string | undefined;
  /**
   * The upscale started for this clip, if any. The page keeps it, so it
   * outlives this view: focusing another take and coming back finds it again.
   */
  job: UpscaleJob | null;
  onJob: (job: UpscaleJob | null) => void;
};

const FINAL_CODES = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND']);

/** Upscale a finished clip; the copy lands in "Your clips" as its own clip. */
export function UpscaleClip({ clipId, aspectRatio, name, active, fluxBlock, job, onJob }: UpscaleClipProps) {
  const saver = useDownload();
  const utils = trpc.useUtils();
  const { allowedClipUpscalers, modelBlocked, noneOffered, onBay, providerNote } = useCapabilities();
  // Nothing picked yet follows the provider's first; a pick stays, offered or not.
  const [picked, setUpscaler] = useState<ClipUpscalerId | null>(null);
  const upscaler: ClipUpscalerId = picked ?? allowedClipUpscalers[0]?.id ?? 'runway';

  const upscale = trpc.upscaleClip.useMutation();
  // A double-click's second press arrives before upscale.isPending shows.
  const guard = useInFlight();
  const status = trpc.videoStatus.useQuery(
    { id: job?.id ?? '' },
    {
      enabled: job !== null,
      refetchInterval: (q) =>
        q.state.data?.done ||
        FINAL_CODES.has((q.state.error as { data?: { code?: string } } | null)?.data?.code ?? '')
          ? false
          : active
            ? 4000
            : 15_000,
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
  const fluxOffered = allowedClipUpscalers.some((u) => u.id === 'flux');
  const fluxBlocked = fluxBlock !== undefined && fluxOffered;
  const chosen: ClipUpscalerId = fluxBlocked && upscaler === 'flux' ? 'runway' : upscaler;
  const canUpscale = allowedClipUpscalers.length > 0;
  const blocked = canUpscale ? modelBlocked('clipUpscaler', chosen) : noneOffered;
  const done = status.data?.done && status.data.url && job ? job : null;
  const taskError =
    status.data?.done && !status.data.url
      ? status.data.error ?? 'The upscale did not return a video. Try again.'
      : undefined;
  const statusSpecial = status.error ? classifyRunwayError(status.error) : null;
  const shownError =
    upscale.error ??
    (statusSpecial && (statusSpecial.signIn || statusSpecial.credits || statusSpecial.consent)
      ? status.error
      : null);
  const { planBlocked, unavailable } = classifyRunwayError(shownError);

  async function run() {
    if (blocked || !guard.start()) return;
    try {
      const { id } = await upscale.mutateAsync({ clipId, upscaler: chosen });
      // Reaches the page even if this view was left while the upscale started.
      onJob({ id, upscaler: chosen });
    } catch {
      // Shown by RunwayErrorNotice from upscale.error.
    } finally {
      guard.end();
    }
  }

  return (
    <div className={styles.upscale}>
      <h3 className={styles.upscaleTitle}>Upscale clip</h3>
      <Text tone="muted" size="sm" as="p">
        Makes a sharper, larger copy of this clip. It is saved under Your clips.
      </Text>
      {!canUpscale && <ModelUnavailable message={noneOffered} />}
      {canUpscale && (
        <div className={`${styles.upscaleRow} ${styles.upscaleRowClip}`}>
          <Select
            label="Upscaler"
            options={allowedClipUpscalers.map((u) =>
              u.id === 'flux' && fluxBlocked
                ? { id: u.id, name: u.name, hint: 'Not available for this clip' }
                : { id: u.id, name: u.name, hint: u.hint }
            )}
            value={chosen}
            onChange={(id) => {
              setUpscaler(id as ClipUpscalerId);
              upscale.reset();
            }}
            disabled={busy}
            showHint={false}
          />
          <BlockedTip message={blocked}>
            <Button
              icon={<Scaling size={16} />}
              loading={busy}
              disabled={busy || planBlocked || unavailable || blocked !== null}
              onPress={() => void run()}
            >
              {upscale.isPending ? 'Starting…' : rendering ? 'Upscaling…' : 'Upscale clip'}
            </Button>
          </BlockedTip>
          {blocked && <ModelUnavailable message={blocked} />}
        </div>
      )}
      {!blocked && (
        <Text tone="muted" size="sm" as="p" className={styles.meta}>
          {allowedClipUpscalers.find((u) => u.id === chosen)?.hint}.{' '}
          {onBay ? 'Billed to your own Runway credits.' : providerNote(chosen)}
        </Text>
      )}
      {fluxBlocked && (
        <Text tone="muted" size="sm" as="p" className={styles.meta}>
          FLUX Video Upscale is off for this clip. {fluxBlock}
        </Text>
      )}

      <RunwayErrorNotice
        error={shownError}
        modelName={upscalerName(status.error && job ? job.upscaler : chosen)}
        onRetry={() => void (shownError === status.error ? status.refetch() : run())}
      />

      {lostTrack && (
        <Alert tone="error" title="We lost touch with the upscale">
          {classifyRunwayError(status.error).message ?? 'The check failed.'} It may still be rendering and will appear
          under Your clips, so check again before starting another.
          <div className={styles.resultActions}>
            <Button size="sm" loading={status.isFetching} onPress={() => void status.refetch()}>
              Check again
            </Button>
            {FINAL_CODES.has((status.error as { data?: { code?: string } } | null)?.data?.code ?? '') && (
              <Button size="sm" variant="ghost" onPress={() => onJob(null)}>
                Stop waiting
              </Button>
            )}
          </div>
        </Alert>
      )}

      {(rendering || done || taskError) && !lostTrack && (
        <div className={styles.upscaleResult}>
          <div className={styles.resultFrame} style={{ aspectRatio, ['--ar' as string]: aspectRatio }}>
            {done ? (
              <video
                key={done.id}
                src={libraryUrl('clip', done.id)}
                controls
                muted
                loop
                playsInline
                preload="metadata"
                aria-label="Upscaled video"
              />
            ) : rendering ? (
              <RenderingStatus
                label="Upscaling the clip. This can take a few minutes…"
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
          {done && (
            <>
              <div className={styles.resultActions}>
                <Button
                  variant="ghost"
                  icon={<Download size={16} />}
                  loading={saver.pending}
                  onPress={() => saver.start(libraryUrl('clip', done.id), `${name}-upscaled.mp4`)}
                >
                  {saver.label('Download upscaled')}
                </Button>
                <Button
                  variant="ghost"
                  icon={<ExternalLink size={16} />}
                  onPress={() => window.open(libraryUrl('clip', done.id), '_blank', 'noopener')}
                >
                  Open full size
                </Button>
              </div>
              <Text tone="muted" size="sm" as="p" className={styles.resultNote}>
                {upscalerName(done.upscaler)}
              </Text>
            </>
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
