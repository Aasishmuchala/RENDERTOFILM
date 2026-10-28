import { ImagePlus, LoaderCircle, Plus, Trash2, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { classifyRunwayError, errorMessage } from './lib/runwayErrors.ts';
import { isUploadFailure, uploadRender } from './lib/uploadRender.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { ChooserDialog } from './ui/ChooserDialog.tsx';
import { ImageDropZone } from './ui/ImageDropZone.tsx';
import { ImagePicker, type ImagePickerItem } from './ui/ImagePicker.tsx';
import { RunwayErrorNotice } from './ui/RunwayErrorNotice.tsx';
import { Select } from './ui/Select.tsx';
import { Text } from './ui/Text.tsx';
import styles from './Studio.module.css';

/**
 * One image for a clip: a library still (`stillId`, signed by the server) or
 * an upload (`uploadUrl`, from POST /api/upload, ready once `uploading` ends).
 */
export type FrameImage = {
  key: string;
  src: string;
  name: string;
  stillId?: string | undefined;
  uploadUrl?: string | undefined;
  uploading?: boolean | undefined;
  /** An upload's own pixel size, so a clip can take the shape of its first frame. */
  width?: number | undefined;
  height?: number | undefined;
};

/** A frame between first and last; `at` is how far into the clip, 0 to 1. */
export type MiddleFrame = FrameImage & { at: number };

export type Slot = 'first' | 'last' | 'middle' | 'ref';

type FrameState = {
  first: FrameImage | null;
  last: FrameImage | null;
  middle: MiddleFrame[];
  refs: FrameImage[];
};

const EMPTY: FrameState = { first: null, last: null, middle: [], refs: [] };

const tenth = (at: number) => Math.min(9, Math.max(1, Math.round(at * 10)));

/**
 * Add a frame in between without moving the others: it takes the free tenth
 * of the clip that sits farthest from every frame already placed (and from
 * the clip's start and end), so it lands in the largest gap.
 */
function insertInLargestGap(middle: MiddleFrame[], img: FrameImage): MiddleFrame[] {
  const taken = [0, 10, ...middle.map((m) => tenth(m.at))];
  let best = 5;
  let bestGap = -1;
  for (let t = 1; t <= 9; t++) {
    if (taken.includes(t)) continue;
    const gap = Math.min(...taken.map((x) => Math.abs(x - t)));
    if (gap > bestGap) {
      best = t;
      bestGap = gap;
    }
  }
  return [...middle, { ...img, at: best / 10 }].sort((a, b) => a.at - b.at);
}

/** Keys of in-between frames that share a point in the clip with another. */
export function duplicateMiddle(middle: readonly MiddleFrame[]): Set<string> {
  const out = new Set<string>();
  middle.forEach((m, i) => {
    if (middle.some((o, j) => j !== i && tenth(o.at) === tenth(m.at))) out.add(m.key);
  });
  return out;
}

let counter = 0;
const nextKey = () => `frame-${Date.now().toString(36)}-${counter++}`;

function revoke(img: FrameImage | null | undefined) {
  if (img?.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
}

/** The images picked on the Video tab: frames, in-between frames and extras. */
export function useVideoFrames() {
  const [state, setState] = useState<FrameState>(EMPTY);
  const [frameError, setFrameError] = useState<unknown>(null);
  const [refError, setRefError] = useState<unknown>(null);
  const live = useRef(state);
  live.current = state;
  useEffect(
    () => () => {
      const s = live.current;
      [s.first, s.last, ...s.middle, ...s.refs].forEach(revoke);
    },
    []
  );

  const place = useCallback((slot: Slot, img: FrameImage) => {
    setState((s) => {
      switch (slot) {
        case 'first':
          revoke(s.first);
          return { ...s, first: img };
        case 'last':
          revoke(s.last);
          return { ...s, last: img };
        case 'middle':
          return { ...s, middle: insertInLargestGap(s.middle, img) };
        case 'ref':
          return { ...s, refs: [...s.refs, img] };
      }
    });
  }, []);

  const patch = useCallback((key: string, p: Partial<FrameImage>) => {
    const upd = <T extends FrameImage>(i: T): T => (i.key === key ? { ...i, ...p } : i);
    setState((s) => ({
      first: s.first && upd(s.first),
      last: s.last && upd(s.last),
      middle: s.middle.map(upd),
      refs: s.refs.map(upd),
    }));
  }, []);

  const remove = useCallback((key: string) => {
    setState((s) => {
      const hit = [s.first, s.last, ...s.middle, ...s.refs].find((i) => i?.key === key);
      revoke(hit);
      return {
        first: s.first?.key === key ? null : s.first,
        last: s.last?.key === key ? null : s.last,
        middle: s.middle.filter((m) => m.key !== key),
        refs: s.refs.filter((r) => r.key !== key),
      };
    });
  }, []);

  const setAt = useCallback((key: string, at: number) => {
    setState((s) => ({
      ...s,
      middle: s.middle.map((m) => (m.key === key ? { ...m, at } : m)).sort((a, b) => a.at - b.at),
    }));
  }, []);

  const addStill = useCallback(
    (slot: Slot, still: { id: string; src: string; name: string }) => {
      place(slot, { key: nextKey(), src: still.src, name: still.name, stillId: still.id });
    },
    [place]
  );

  const addFile = useCallback(
    async (slot: Slot, file: File) => {
      const setErr = slot === 'ref' ? setRefError : setFrameError;
      setErr(null);
      const key = nextKey();
      place(slot, { key, src: URL.createObjectURL(file), name: file.name, uploading: true });
      try {
        const { width, height } = await measure(file);
        const uploadUrl = await uploadRender(file);
        patch(key, { uploadUrl, uploading: false, width, height });
      } catch (e) {
        remove(key);
        // The route's body, so a sign-in or consent refusal shows its prompt.
        setErr(
          isUploadFailure(e)
            ? classifyRunwayError(e.body).signIn || classifyRunwayError(e.body).consent
              ? e.body
              : { message: e.message }
            : e instanceof Error
              ? e
              : { message: 'That image could not be uploaded. Try again.' }
        );
      }
    },
    [place, patch, remove]
  );

  return {
    ...state,
    frameError,
    refError,
    clearErrors: () => {
      setFrameError(null);
      setRefError(null);
    },
    uploading: [state.first, state.last, ...state.middle, ...state.refs].some((i) => i?.uploading),
    addStill,
    addFile,
    remove,
    setAt,
  };
}

export type VideoFramesApi = ReturnType<typeof useVideoFrames>;

/** An image file's own pixel size. */
async function measure(file: Blob): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    throw new Error('That file could not be read as an image. Use a PNG, JPEG or WebP.');
  }
}

/**
 * The wire form of the first frame: a still id, or an upload with its pixel
 * size (the clip is shaped like this frame).
 */
export function firstFrameRef(
  img: FrameImage
): { stillId: string } | { uploadUrl: string; width: number; height: number } | null {
  if (img.stillId) return { stillId: img.stillId };
  return img.uploadUrl && img.width && img.height
    ? { uploadUrl: img.uploadUrl, width: img.width, height: img.height }
    : null;
}

/** The wire form of an image: a still id or an uploaded URL. */
export function frameRef(img: FrameImage): { stillId: string } | { uploadUrl: string } | null {
  if (img.stillId) return { stillId: img.stillId };
  return img.uploadUrl ? { uploadUrl: img.uploadUrl } : null;
}

type ChooserTarget = { slot: Slot; title: string };

/** Pick a finished still, or upload an image, for one slot. */
function ImageChooser({
  target,
  items,
  onStill,
  onFile,
  onClose,
}: {
  target: ChooserTarget | null;
  items: readonly ImagePickerItem[];
  onStill: (item: ImagePickerItem) => void;
  onFile: (file: File) => void;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(12);
  return (
    <ChooserDialog isOpen={target !== null} title={target?.title ?? ''} onClose={onClose}>
      {items.length === 0 ? (
        <Text tone="muted" size="sm" as="p">
          You have no finished stills yet. Upload an image instead.
        </Text>
      ) : (
        <ImagePicker
          label="Film still"
          value={null}
          items={items.slice(0, shown)}
          onChange={(id) => {
            const item = items.find((i) => i.id === id);
            if (item) onStill(item);
          }}
        />
      )}
      {items.length > shown && (
        <div>
          <Button size="sm" variant="ghost" onPress={() => setShown((n) => n + 12)}>
            Show {Math.min(12, items.length - shown)} more
          </Button>
        </div>
      )}
      <ImageDropZone onFile={onFile} actionLabel="Upload an image">
        <div className={styles.chooserUpload}>
          <ImagePlus size={18} aria-hidden />
          <span>Or drop an image here (PNG, JPEG or WebP)</span>
        </div>
      </ImageDropZone>
    </ChooserDialog>
  );
}

function Thumb({ img, alt }: { img: FrameImage; alt: string }) {
  return (
    <figure className={styles.frameThumb}>
      <img className={styles.image} src={img.src} alt={alt} data-dimmed={img.uploading ? '' : undefined} />
      {img.uploading && (
        <span className={styles.frameBusy} role="status">
          <LoaderCircle size={16} className={styles.castSpin} aria-hidden />
          <span>Uploading…</span>
        </span>
      )}
    </figure>
  );
}

function UploadError({ error, modelName, title }: { error: unknown; modelName: string; title: string }) {
  if (error == null) return null;
  const c = classifyRunwayError(error);
  return c.signIn || c.consent ? (
    <RunwayErrorNotice error={error} modelName={modelName} />
  ) : (
    <Alert tone="error" title={title}>
      {errorMessage(error)}
    </Alert>
  );
}

export type FramesFieldProps = {
  frames: VideoFramesApi;
  modelName: string;
  /** Most ordered frames the model takes (first + in between + last). */
  limit: number;
  seconds: number;
  /** The still picked in step 1, the default first frame. */
  picked: { src: string; name: string } | null;
  items: readonly ImagePickerItem[];
  /** Models that take a last frame / frames in between, for the muted notes. */
  endModels: readonly string[];
  middleModels: readonly string[];
  /** The model takes a last frame or extra images, not both, and extras are in use. */
  lastBlockedByExtras: boolean;
  disabled: boolean;
};

/** First frame, optional in-between frames and an optional last frame. */
export function FramesField({
  frames,
  modelName,
  limit,
  seconds,
  picked,
  items,
  endModels,
  middleModels,
  lastBlockedByExtras,
  disabled,
}: FramesFieldProps) {
  const [chooser, setChooser] = useState<ChooserTarget | null>(null);
  const canLast = limit >= 2;
  const maxMiddle = Math.max(0, limit - 2);
  const canMiddle = maxMiddle > 0;
  const usedMiddle = frames.middle.slice(0, maxMiddle);
  const dupes = duplicateMiddle(usedMiddle);

  const choose = (slot: Slot, title: string) => setChooser({ slot, title });
  const pickStill = (item: ImagePickerItem) => {
    if (!chooser) return;
    frames.addStill(chooser.slot, { id: item.id, src: item.src, name: item.alt.split(', made with')[0] ?? 'Still' });
    setChooser(null);
  };
  const pickFile = (file: File) => {
    if (!chooser) return;
    void frames.addFile(chooser.slot, file);
    setChooser(null);
  };

  const first = frames.first;
  const last = frames.last;
  const lastLocked = !canLast || lastBlockedByExtras;
  const canAddMiddle = canMiddle && usedMiddle.length < maxMiddle;
  return (
    <div className={styles.frameList}>
      {!first && (
        <Text tone="muted" size="sm" as="p" className={styles.frameNote}>
          {picked
            ? 'The shot starts on the still you picked in step 1. Set frames only if you need them.'
            : 'Pick a still in step 1; the shot starts on it.'}
        </Text>
      )}

      {first && (
        <div className={styles.frameRow}>
          <Thumb img={first} alt={`First frame: ${first.name}`} />
          <div className={styles.frameBody}>
            <Text as="span" size="sm" className={styles.frameTitle}>
              First frame
            </Text>
            <Text tone="muted" size="sm" as="p" className={styles.frameName}>
              {first.name}
            </Text>
            <div className={styles.frameActions}>
              <Button
                size="sm"
                variant="ghost"
                icon={<ImagePlus size={14} />}
                disabled={disabled}
                onPress={() => choose('first', 'Choose the first frame')}
              >
                Change
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Undo2 size={14} />}
                disabled={disabled}
                onPress={() => frames.remove(first.key)}
              >
                Use picked still
              </Button>
            </div>
          </div>
        </div>
      )}

      {usedMiddle.map((m, i) => {
        const duplicate = dupes.has(m.key);
        return (
        <div className={styles.frameRow} key={m.key}>
          <Thumb img={m} alt={`Frame ${i + 2}: ${m.name}`} />
          <div className={styles.frameBody}>
            <Text as="span" size="sm" className={styles.frameTitle}>
              Frame {i + 2} of the shot
            </Text>
            <Text tone="muted" size="sm" as="p" className={styles.frameName}>
              {m.name}
            </Text>
            <div className={styles.framePosition}>
              <Select
                label={`Frame ${i + 2} reached at`}
                options={POSITIONS.map((p) => ({
                  id: String(p),
                  name: `${((p / 10) * seconds).toFixed(1)} s`,
                }))}
                value={String(Math.min(9, Math.max(1, Math.round(m.at * 10))))}
                onChange={(id) => frames.setAt(m.key, Number(id) / 10)}
                disabled={disabled}
                showHint={false}
              />
            </div>
            {duplicate && (
              <p className={styles.frameDuplicate} role="alert">
                Another frame sits at the same point. Move one of them to continue.
              </p>
            )}
            <div className={styles.frameActions}>
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 size={14} />}
                disabled={disabled}
                aria-label={`Remove frame ${i + 2}`}
                onPress={() => frames.remove(m.key)}
              >
                Remove
              </Button>
            </div>
          </div>
        </div>
        );
      })}

      {last && (
        <div className={styles.frameRow} data-locked={lastLocked ? '' : undefined}>
          <Thumb img={last} alt={`Last frame: ${last.name}`} />
          <div className={styles.frameBody}>
            <Text as="span" size="sm" className={styles.frameTitle}>
              Last frame
            </Text>
            <Text tone="muted" size="sm" as="p" className={styles.frameName}>
              {canLast ? last.name : 'Not sent with this model'}
            </Text>
            <div className={styles.frameActions}>
              <Button
                size="sm"
                variant="ghost"
                icon={<ImagePlus size={14} />}
                disabled={disabled || lastLocked}
                onPress={() => choose('last', 'Choose the last frame')}
              >
                Change
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<X size={14} />}
                disabled={disabled}
                aria-label="Remove the last frame"
                onPress={() => frames.remove(last.key)}
              >
                Remove
              </Button>
            </div>
          </div>
        </div>
      )}

      {(!first || canAddMiddle || (!last && !lastLocked)) && (
        <div className={styles.frameOptions}>
          {!first && (
            <Button
              size="sm"
              icon={<Plus size={14} />}
              disabled={disabled}
              onPress={() => choose('first', 'Choose the first frame')}
            >
              First frame
            </Button>
          )}
          {canAddMiddle && (
            <Button
              size="sm"
              icon={<Plus size={14} />}
              disabled={disabled}
              onPress={() => choose('middle', 'Add a frame in between')}
            >
              Frame in between
            </Button>
          )}
          {!last && !lastLocked && (
            <Button
              size="sm"
              icon={<Plus size={14} />}
              disabled={disabled}
              onPress={() => choose('last', 'Choose the last frame')}
            >
              Last frame
            </Button>
          )}
        </div>
      )}

      {!canLast && (
        <Text tone="muted" size="sm" as="p" className={styles.frameNote}>
          {modelName} starts on the first frame only and can&rsquo;t take a last frame
          {frames.last ? ', so your last frame is kept but not sent' : ''}. Models with a last frame:{' '}
          {endModels.join(', ')}.
        </Text>
      )}
      {canLast && !canMiddle && (
        <Text tone="muted" size="sm" as="p" className={styles.frameNote}>
          {modelName} takes a first and a last frame
          {middleModels.length > 0 ? `. Frames in between work with ${middleModels.join(', ')}.` : '.'}
          {frames.middle.length > 0 ? ' Your frames in between are kept but not sent.' : ''}
        </Text>
      )}
      {canLast && lastBlockedByExtras && (
        <Text tone="muted" size="sm" as="p" className={styles.frameNote}>
          {modelName} can use a last frame or extra images, not both. Remove the extra images to add a last frame.
        </Text>
      )}
      {canMiddle && frames.middle.length > maxMiddle && (
        <Text tone="muted" size="sm" as="p" className={styles.frameNote}>
          {modelName} takes {maxMiddle} frames in between; the others are kept but not sent.
        </Text>
      )}

      <UploadError error={frames.frameError} modelName={modelName} title="That image didn't upload" />
      <ImageChooser
        target={chooser}
        items={items}
        onStill={pickStill}
        onFile={pickFile}
        onClose={() => setChooser(null)}
      />
    </div>
  );
}

const POSITIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export type RefsFieldProps = {
  frames: VideoFramesApi;
  modelName: string;
  /** Extra images the model takes; 0 = none. */
  limit: number;
  items: readonly ImagePickerItem[];
  extraModels: readonly string[];
  /** Why adding is off for a model that does take extras (a last frame is set). */
  blockedReason?: string | undefined;
  disabled: boolean;
  /** Append `@imgN` to the direction. */
  onInsert: (handle: string) => void;
};

/** The extra images, each named @img1, @img2 … in order. */
export function RefsField({
  frames,
  modelName,
  limit,
  items,
  extraModels,
  blockedReason,
  disabled,
  onInsert,
}: RefsFieldProps) {
  const [open, setOpen] = useState(false);
  const supported = limit > 0;
  const full = frames.refs.length >= limit;
  const locked = disabled || !supported || blockedReason !== undefined;
  return (
    <div className={styles.frameList}>
      {frames.refs.length === 0 ? (
        <Text tone="muted" size="sm" as="p">
          {supported
            ? 'No extra images yet. Add a bench, a person, a material or any detail, then name it in your direction.'
            : `${modelName} can't take extra images. Pick ${extraModels.join(', ')} to use them.`}
        </Text>
      ) : (
        <div className={styles.refGrid}>
          {frames.refs.map((r, i) => (
            <figure className={styles.refCard} key={r.key}>
              <Thumb img={r} alt={`@img${i + 1}: ${r.name}`} />
              <div className={styles.refFoot}>
                <button
                  type="button"
                  className={styles.handleChip}
                  disabled={disabled}
                  aria-label={`Insert @img${i + 1} into the direction`}
                  onClick={() => onInsert(`@img${i + 1}`)}
                >
                  @img{i + 1}
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<X size={14} />}
                  disabled={disabled}
                  aria-label={`Remove @img${i + 1}`}
                  onPress={() => frames.remove(r.key)}
                />
              </div>
            </figure>
          ))}
        </div>
      )}
      <div>
        <Button
          size="sm"
          icon={<ImagePlus size={14} />}
          disabled={locked || full}
          onPress={() => setOpen(true)}
        >
          {full && supported ? `All ${limit} added` : 'Add an image'}
        </Button>
      </div>
      {!supported && frames.refs.length > 0 && (
        <Text tone="muted" size="sm" as="p" className={styles.frameNote}>
          {modelName} can&rsquo;t take extra images, so these are kept but not sent. Models that can:{' '}
          {extraModels.join(', ')}.
        </Text>
      )}
      {supported && frames.refs.length > 0 && (
        <Text tone="muted" size="sm" as="p" className={styles.frameNote}>
          Removing an image renumbers the rest. {modelName} takes up to {limit}.
        </Text>
      )}
      {blockedReason && (
        <Text tone="muted" size="sm" as="p" className={styles.frameNote}>
          {blockedReason}
        </Text>
      )}
      <UploadError error={frames.refError} modelName={modelName} title="That image didn't upload" />
      <ImageChooser
        target={open ? { slot: 'ref', title: `Add @img${frames.refs.length + 1}` } : null}
        items={items}
        onStill={(item) => {
          frames.addStill('ref', { id: item.id, src: item.src, name: item.alt.split(', made with')[0] ?? 'Still' });
          setOpen(false);
        }}
        onFile={(file) => {
          void frames.addFile('ref', file);
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
