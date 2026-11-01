import { Check, ZoomIn } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  Label,
  Slider,
  SliderOutput,
  SliderThumb,
  SliderTrack,
  ToggleButton,
  ToggleButtonGroup,
  type Key,
} from 'react-aria-components';

import { atEdge, cropToBlob, fitWindow, MAX_ZOOM, windowPixels, type Window } from '../lib/reframe.ts';
import { Alert } from './Alert.tsx';
import { Button } from './Button.tsx';
import maskStyles from './MaskPainter.module.css';
import sliderStyles from './Slider.module.css';
import styles from './ReframeStage.module.css';

/** How far one pixel of wheel pushes in. */
const WHEEL_RATE = 0.002;

/** The arrow keys' nudge, as a share of the picture; Shift takes the larger one. */
const NUDGE = 0.01;
const NUDGE_LARGE = 0.05;

const ARROWS: Partial<Record<string, [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Where the window sits on the render: its shape, its push-in and its centre. */
type Aim = { aspect: string; zoom: number; cx: number; cy: number };

/** Says why the window stops: at an edge, nothing beyond it exists to show. */
function noteFor(edges: readonly string[]): string {
  if (edges.length === 0) return 'A window on your render. The still shows only what the window holds.';
  const named = edges.length > 1 ? `${edges.slice(0, -1).join(', ')} and ${edges[edges.length - 1]}` : edges[0];
  return `The window touches the render's ${named} edge: nothing beyond it exists, so the frame stops here.`;
}

export type ReframeStageProps = {
  src: string;
  alt: string;
  /** The render's own size. */
  width: number;
  height: number;
  /** The shapes on offer, the first one to start; a null ratio is the render's own. */
  aspects: { id: string; label: string; ratio: number | null }[];
  /** Answers a promise when the frame takes time to land: the stage stays busy until it has. */
  onApply: (blob: Blob, win: Window) => void | Promise<void>;
  /** Leave without changing the render. */
  onCancel: () => void;
  disabled?: boolean | undefined;
};

/**
 * An honest window on the render: drag it, wheel or slide to push in, arrow
 * keys to nudge (Shift for more). It can only crop, so it stops at the render's
 * edges and says so; applying cuts those pixels and adds nothing to any prompt.
 */
export function ReframeStage({ src, alt, width, height, aspects, onApply, onCancel, disabled = false }: ReframeStageProps) {
  const [aim, setAim] = useState<Aim>({ aspect: aspects[0]?.id ?? '', zoom: 1, cx: 0.5, cy: 0.5 });
  const [applying, setApplying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  /** Moves on when the stage goes or its render changes, so a cut still running lands on nothing. */
  const latestCut = useRef(0);
  const noteId = useId();

  // A model change can take the chosen shape away; the first one stands in.
  const shape = (id: string) => aspects.find((a) => a.id === id) ?? aspects[0];
  const windowOf = (a: Aim) => fitWindow(width, height, shape(a.aspect)?.ratio ?? null, a.zoom, a.cx, a.cy);
  const win = windowOf(aim);

  /**
   * Every change lands inside the picture, and the aim keeps the window's true
   * centre, so a push-in starts from what is on screen.
   */
  const move = (change: (a: Aim) => Partial<Aim>) =>
    setAim((a) => {
      const next = { ...a, ...change(a) };
      const placed = windowOf(next);
      return { ...next, cx: placed.x + placed.w / 2, cy: placed.y + placed.h / 2 };
    });
  const moveRef = useRef(move);
  moveRef.current = move;

  useEffect(
    () => () => {
      latestCut.current++;
    },
    [src]
  );

  // The page's primary waits on these buttons, so they open in reach, not below the fold.
  useEffect(() => {
    footerRef.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || disabled) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaY;
      moveRef.current((a) => ({ zoom: Math.min(MAX_ZOOM, Math.max(1, a.zoom * Math.exp(-delta * WHEEL_RATE))) }));
    };
    // React's own wheel listener is passive, and the inspector must not scroll under a push-in.
    surface.addEventListener('wheel', onWheel, { passive: false });
    return () => surface.removeEventListener('wheel', onWheel);
  }, [disabled]);

  function down(e: PointerEvent<HTMLDivElement>) {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, cx: aim.cx, cy: aim.cy };
    setDragging(true);
  }

  function dragMove(e: PointerEvent<HTMLDivElement>) {
    const from = drag.current;
    if (!from) return;
    const r = e.currentTarget.getBoundingClientRect();
    move(() => ({ cx: from.cx + (e.clientX - from.x) / r.width, cy: from.cy + (e.clientY - from.y) / r.height }));
  }

  function up() {
    drag.current = null;
    setDragging(false);
  }

  function nudge(e: KeyboardEvent<HTMLDivElement>) {
    const arrow = ARROWS[e.key];
    if (!arrow || disabled) return;
    e.preventDefault();
    const step = e.shiftKey ? NUDGE_LARGE : NUDGE;
    move((a) => ({ cx: a.cx + arrow[0] * step, cy: a.cy + arrow[1] * step }));
  }

  function pickAspect(keys: Set<Key>) {
    const [first] = keys;
    if (first !== undefined) move(() => ({ aspect: String(first) }));
  }

  async function apply() {
    const img = imgRef.current;
    if (!img) return;
    const cut = ++latestCut.current;
    setApplying(true);
    setFailed(false);
    try {
      const bitmap = await createImageBitmap(img);
      let blob: Blob;
      try {
        blob = await cropToBlob(bitmap, windowPixels(win, width, height));
      } finally {
        bitmap.close();
      }
      if (cut === latestCut.current) await onApply(blob, win);
    } catch {
      setFailed(true);
    } finally {
      setApplying(false);
    }
  }

  const percent = (n: number) => `${n * 100}%`;
  return (
    <div className={styles.stage}>
      <ToggleButtonGroup
        aria-label="Frame shape"
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[shape(aim.aspect)?.id ?? '']}
        onSelectionChange={pickAspect}
        isDisabled={disabled}
        className={`${maskStyles.segment} ${styles.aspects}`}
      >
        {aspects.map((a) => (
          <ToggleButton key={a.id} id={a.id} className={maskStyles.segItem}>
            {a.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <div
        ref={surfaceRef}
        className={styles.surface}
        style={{ aspectRatio: `${width} / ${height}` }}
        role="application"
        aria-label="The window on your render. Drag it, or press the arrow keys to move it; hold Shift to move further."
        aria-describedby={noteId}
        tabIndex={disabled ? -1 : 0}
        data-dragging={dragging || undefined}
        data-disabled={disabled || undefined}
        onPointerDown={down}
        onPointerMove={dragMove}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={nudge}
      >
        <img ref={imgRef} className={styles.image} src={src} alt={alt} draggable={false} />
        <div
          className={styles.window}
          style={{ left: percent(win.x), top: percent(win.y), width: percent(win.w), height: percent(win.h) }}
        />
      </div>
      {/* Not ui/Slider: its fill starts from 0, which is off the rail of a 1 to 6 range. */}
      <Slider
        className={sliderStyles.slider}
        value={aim.zoom}
        onChange={(zoom) => move(() => ({ zoom }))}
        minValue={1}
        maxValue={MAX_ZOOM}
        step={0.05}
        isDisabled={disabled}
      >
        <div className={sliderStyles.head}>
          <Label className={`${sliderStyles.label} ${styles.zoomLabel}`}>
            <ZoomIn size={14} aria-hidden />
            Zoom
          </Label>
          <SliderOutput className={sliderStyles.output}>{`${aim.zoom.toFixed(1)}×`}</SliderOutput>
        </div>
        <SliderTrack className={sliderStyles.track}>
          {({ state }) => (
            <>
              <span className={sliderStyles.rail} />
              <span className={sliderStyles.fill} style={{ left: 0, right: percent(1 - state.getThumbPercent(0)) }} />
              <SliderThumb className={sliderStyles.thumb} />
            </>
          )}
        </SliderTrack>
      </Slider>
      <p id={noteId} className={styles.note} aria-live="polite">
        {noteFor(atEdge(win))}
      </p>
      {failed && <Alert tone="error" title="This frame could not be cut from the render. Try again." />}
      <div ref={footerRef} className={styles.footer}>
        <Button size="sm" variant="ghost" onPress={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={<Check size={14} />}
          loading={applying}
          disabled={disabled}
          onPress={() => void apply()}
        >
          Use this frame
        </Button>
      </div>
    </div>
  );
}
