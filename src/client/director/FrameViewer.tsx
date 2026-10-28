import { Clapperboard, Download } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { Still } from '../../api.ts';
import { imageModelName } from '../../models.ts';
import type { FrameChoice, FramePlan, StoryboardJob } from '../../storyboard-api.ts';
import { libraryUrl, stillThumbUrl, stillViewUrl, useDownload } from '../lib/download.ts';
import { Alert } from '../ui/Alert.tsx';
import { Button } from '../ui/Button.tsx';
import { CompareSlider } from '../ui/CompareSlider.tsx';
import { FullscreenDialog } from '../ui/FullscreenDialog.tsx';
import { ImagePicker } from '../ui/ImagePicker.tsx';
import { RenderingStatus } from '../ui/RenderingStatus.tsx';
import { RunwayErrorNotice } from '../ui/RunwayErrorNotice.tsx';
import { Text } from '../ui/Text.tsx';
import { ToggleButton } from '../ui/ToggleButton.tsx';
import own from '../DirectorPage.module.css';
import { FrameControls } from './FrameControls.tsx';
import { slugify } from './shared.ts';
import { TakeImage } from './TakeImage.tsx';

type SaveState = 'saving' | 'saved' | { error: unknown };

export type FrameViewerProps = {
  job: StoryboardJob;
  frames: readonly FramePlan[];
  /** The frame on screen (its image index), or null when closed. */
  image: number | null;
  onImage: (image: number | null) => void;
  takes: ReadonlyMap<number, Still>;
  /** Every finished take per frame, newest first. */
  allTakes: ReadonlyMap<number, Still[]>;
  drafts: Record<number, FrameChoice>;
  saves: Record<number, SaveState>;
  shooting: Record<number, boolean>;
  shootErrors: Record<number, unknown>;
  onChoose: (image: number, patch: FrameChoice) => void;
  onShoot: (image: number) => Promise<void>;
};

/** Whether an image URL loads, without showing it: the uploads expire after a day or so. */
function useImageLoads(url: string | undefined): boolean | null {
  const [state, setState] = useState<{ url: string | undefined; ok: boolean | null }>({ url, ok: null });
  useEffect(() => {
    if (!url) return;
    let live = true;
    const probe = new Image();
    probe.onload = () => live && setState({ url, ok: true });
    probe.onerror = () => live && setState({ url, ok: false });
    probe.src = url;
    return () => {
      live = false;
    };
  }, [url]);
  if (!url) return false;
  return state.url === url ? state.ok : null;
}

/**
 * The big screen for one storyboard frame: the take filling the window,
 * compared against the uploaded image with a wipe, beside its light, camera
 * and people so it can be reshot right there. Arrow keys step through the
 * story.
 */
export function FrameViewer({
  job,
  frames,
  image,
  onImage,
  takes,
  allTakes,
  drafts,
  saves,
  shooting,
  shootErrors,
  onChoose,
  onShoot,
}: FrameViewerProps) {
  const [compare, setCompare] = useState(true);
  const saver = useDownload();
  const index = frames.findIndex((f) => f.image === image);
  const frame = index >= 0 ? frames[index] : undefined;
  const img = frame ? job.images[frame.image] : undefined;
  const sourceOk = useImageLoads(img?.url);
  const take = frame ? takes.get(frame.image) : undefined;
  const rendering = frame ? Boolean(shooting[frame.image]) || take?.status === 'pending' : false;
  const done = take?.status === 'succeeded' ? take : undefined;
  const choice = frame ? drafts[frame.image] : undefined;
  const save = frame ? saves[frame.image] : undefined;
  // Only finished takes can be picked; a pending or failed one would not show.
  const others = useMemo(
    () => (frame ? (allTakes.get(frame.image) ?? []).filter((t) => t.status === 'succeeded') : []),
    [allTakes, frame]
  );
  const takeItems = useMemo(
    () =>
      others.map((s, i) => ({
        id: s.id,
        src: stillThumbUrl(s.id),
        alt: `Take ${others.length - i}`,
        caption: i === 0 ? `Take ${others.length}, newest` : `Take ${others.length - i}`,
      })),
    [others]
  );
  if (!frame) return <FullscreenDialog isOpen={false} title="" onClose={() => onImage(null)}>{null}</FullscreenDialog>;

  const order = index + 1;
  const title = `${order}. ${frame.title}`;
  const aspect = done ? `${done.width} / ${done.height}` : img ? `${img.width} / ${img.height}` : '16 / 9';
  const prev = index > 0 ? frames[index - 1] : undefined;
  const next = index < frames.length - 1 ? frames[index + 1] : undefined;
  const showCompare = compare && done && img && sourceOk === true;

  return (
    <FullscreenDialog
      isOpen
      title={title}
      onClose={() => onImage(null)}
      onPrev={prev ? () => onImage(prev.image) : undefined}
      onNext={next ? () => onImage(next.image) : undefined}
      aside={
        <div className={own.viewerAside}>
          <div className={own.cardText}>
            <Text tone="muted" size="sm" as="p">
              Frame {order} of {frames.length}, {frame.space === 'interior' ? 'interior' : 'exterior'}
            </Text>
            {frame.beat && (
              <Text tone="secondary" size="sm" as="p">
                {frame.beat}
              </Text>
            )}
          </div>

          {done && (
            <div className={own.cardActions}>
              <ToggleButton
                selected={Boolean(choice?.selected)}
                onChange={(selected) => onChoose(frame.image, { selected })}
              >
                {choice?.selected ? 'In the film' : 'Use in film'}
              </ToggleButton>
              {img && sourceOk !== false && (
                <ToggleButton selected={compare} onChange={setCompare}>
                  Compare with your image
                </ToggleButton>
              )}
              <Button
                size="sm"
                variant="ghost"
                icon={<Download size={14} />}
                loading={saver.pending}
                onPress={() => saver.start(libraryUrl('still', done.id), `storyboard-${order}-${slugify(frame.title)}.png`)}
              >
                {saver.label('Download')}
              </Button>
            </div>
          )}
          {saver.error && (
            <Alert tone="error" title="Download failed">
              {saver.error}
            </Alert>
          )}

          {others.length > 1 && (
            <div className={own.viewerTakes}>
              <Text size="sm" as="p">
                Takes
              </Text>
              <ImagePicker
                label="Takes of this frame"
                items={takeItems}
                value={done?.id ?? null}
                onChange={(id) => onChoose(frame.image, { take: id })}
                disabled={rendering}
              />
            </div>
          )}

          <FrameControls
            frame={frame}
            choice={choice}
            disabled={rendering}
            onChoose={onChoose}
            onShoot={(i) => void onShoot(i)}
          />

          <div className={own.viewerShoot}>
            <Button
              variant="primary"
              icon={<Clapperboard size={16} />}
              loading={rendering}
              onPress={() => void onShoot(frame.image)}
            >
              {rendering ? 'Shooting…' : done || take?.status === 'failed' ? 'Reshoot this frame' : 'Shoot this frame'}
            </Button>
            <span className={own.saveState} role="status">
              {save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved' : ''}
            </span>
          </div>
          <Text tone="muted" size="sm" as="p">
            A reshoot with {imageModelName(job.imageModel)} costs the same as a still, billed to your own Runway credits.
            The earlier take stays under Takes.
          </Text>
          {save && typeof save === 'object' && <RunwayErrorNotice error={save.error} modelName="your storyboard" />}
          <RunwayErrorNotice
            error={shootErrors[frame.image]}
            modelName={imageModelName(job.imageModel)}
            onRetry={() => void onShoot(frame.image)}
          />
        </div>
      }
    >
      <div className={own.viewerPicture} style={{ aspectRatio: aspect, ['--ar' as string]: aspect }}>
        {rendering ? (
          <RenderingStatus label={shooting[frame.image] ? 'Starting the take…' : 'Shooting the frame…'} runKey={take?.id ?? `${job.id}-${frame.image}`} />
        ) : showCompare ? (
          <CompareSlider
            key={done.id}
            className={own.viewerCompare}
            before={img.url}
            after={stillViewUrl(done.id)}
            afterFallback={stillThumbUrl(done.id)}
            beforeAlt={`Your image: ${img.name || frame.title}`}
            afterAlt={`Film still: ${frame.title}`}
            aspectRatio={aspect}
          />
        ) : done ? (
          <TakeImage key={done.id} full stillId={done.id} alt={`Film still: ${frame.title}`} className={own.viewerImage} />
        ) : take?.status === 'failed' ? (
          <div className={own.viewerNote}>
            <Alert tone="error" title="This frame didn't render">
              {take.error ?? 'Shoot it again.'}
            </Alert>
          </div>
        ) : img && sourceOk !== false ? (
          <img className={`${own.viewerImage} ${own.source}`} src={img.url} alt={`Your image: ${img.name || frame.title}`} />
        ) : (
          <div className={own.viewerNote}>
            <Text tone="muted" size="sm" as="p">
              This frame isn't shot yet, and its uploaded image is no longer kept.
            </Text>
          </div>
        )}
      </div>
      {done && compare && img && sourceOk === false && (
        <Text tone="muted" size="sm" as="p" className={own.viewerCaption}>
          Your uploaded image is no longer kept, so only the film still can be shown.
        </Text>
      )}
    </FullscreenDialog>
  );
}
