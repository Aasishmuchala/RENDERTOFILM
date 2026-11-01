import {
  Brush,
  Check,
  Contrast,
  Eraser,
  Lasso,
  Maximize2,
  Redo2,
  Scan,
  SquareDashed,
  Trash2,
  Undo2,
  X,
  ZoomIn,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import {
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
  ToggleButton,
  ToggleButtonGroup,
  type Key,
} from 'react-aria-components';

import {
  closePolygon,
  maskCoverage,
  paintStroke,
  paintStrokes,
  polygonArea,
  type MaskStroke,
} from '../lib/mask.ts';
import { Button } from './Button.tsx';
import styles from './MaskPainter.module.css';

type Tool = 'brush' | 'box' | 'lasso' | 'erase';
type Size = 's' | 'm' | 'l';
type Point = [number, number];

/** Brush diameters, as a share of the image width. */
const SIZES: Record<Size, number> = { s: 0.015, m: 0.035, l: 0.075 };

/** A click this close (normalised) to a lasso's first point closes it. */
const LASSO_CLOSE = 0.01;
/** A closed lasso smaller than this share of the image is a slip, not a mark. */
const LASSO_MIN_AREA = 0.0005;

/** The full-size view: zoom and where the picture's top-left sits, in pixels. */
type View = { z: number; x: number; y: number };
const FIT: View = { z: 1, x: 0, y: 0 };
const MAX_ZOOM = 6;

/** Keep the zoom in range and the picture covering its frame. */
function clampView(v: View, w: number, h: number): View {
  const z = Math.min(MAX_ZOOM, Math.max(1, v.z));
  if (z === 1) return FIT;
  return { z, x: Math.min(0, Math.max(w * (1 - z), v.x)), y: Math.min(0, Math.max(h * (1 - z), v.y)) };
}

export type MaskPainterProps = {
  src: string;
  alt: string;
  /** The render's own size, so the mark keeps its shape. */
  width: number;
  height: number;
  strokes: readonly MaskStroke[];
  onChange: (strokes: MaskStroke[]) => void;
  /** Leave marking mode (the mark stays). */
  onDone: () => void;
  disabled?: boolean | undefined;
};

/**
 * Paint the part of an image that may change. Brush, box, lasso and eraser,
 * three brush sizes, undo/redo (Ctrl/Cmd+Z, Shift for redo), invert and clear
 * (both undoable) and a full-size view, zoomable and pannable, for precise
 * edges. The marked area shows white inside a black outline (`MarkFilter`), so
 * it reads on any render.
 */
export function MaskPainter({ src, alt, width, height, strokes, onChange, onDone, disabled = false }: MaskPainterProps) {
  const [tool, setTool] = useState<Tool>('brush');
  const [size, setSize] = useState<Size>('m');
  const [redo, setRedo] = useState<MaskStroke[]>([]);
  const [big, setBig] = useState(false);
  const [view, setView] = useState<View>(FIT);
  /** The lasso being clicked out, shared by the small and the full-size picture. */
  const [lasso, setLasso] = useState<Point[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const coverage = useMemo(() => maskCoverage(strokes, width, height), [strokes, width, height]);

  const add = useCallback(
    (s: MaskStroke) => {
      onChange([...strokes, s]);
      setRedo([]);
    },
    [strokes, onChange]
  );
  const closeLasso = useCallback(
    (points: Point[]) => {
      setLasso([]);
      const closed = closePolygon(points);
      if (closed && polygonArea(closed) >= LASSO_MIN_AREA) add({ type: 'polygon', erase: false, points: closed });
    },
    [add]
  );
  const pickTool = useCallback((t: Tool) => {
    setTool(t);
    setLasso([]);
  }, []);
  const undo = useCallback(() => {
    const last = strokes[strokes.length - 1];
    if (!last) return;
    onChange(strokes.slice(0, -1));
    setRedo((r) => [...r, last]);
  }, [strokes, onChange]);
  const redoLast = useCallback(() => {
    const next = redo[redo.length - 1];
    if (!next) return;
    onChange([...strokes, next]);
    setRedo((r) => r.slice(0, -1));
  }, [redo, strokes, onChange]);

  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      // A hidden tab (display: none) keeps this mounted; it must not swallow undo.
      if (rootRef.current?.offsetParent == null) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) redoLast();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [disabled, undo, redoLast]);

  // Enter closes the open lasso and Escape drops it; neither reaches a dialog
  // that would close on Escape.
  useEffect(() => {
    if (disabled || tool !== 'lasso' || lasso.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      if (rootRef.current?.offsetParent == null) return;
      // A field elsewhere on the page keeps its own Enter and Escape.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Enter') closeLasso(lasso);
      else setLasso([]);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [disabled, tool, lasso, closeLasso]);

  // A reopened full-size view starts fitted.
  useEffect(() => setView(FIT), [big]);

  const toolbar = (
    <Toolbar
      tool={tool}
      size={size}
      onTool={pickTool}
      onSize={setSize}
      disabled={disabled}
    />
  );
  const actions = (
    <div className={styles.actions}>
      <Button size="sm" variant="ghost" icon={<Undo2 size={14} />} aria-label="Undo" disabled={disabled || strokes.length === 0} onPress={undo} />
      <Button size="sm" variant="ghost" icon={<Redo2 size={14} />} aria-label="Redo" disabled={disabled || redo.length === 0} onPress={redoLast} />
      <Button size="sm" variant="ghost" icon={<Contrast size={14} />} disabled={disabled} onPress={() => add({ type: 'invert' })}>
        Invert
      </Button>
      <Button
        size="sm"
        variant="ghost"
        icon={<Trash2 size={14} />}
        disabled={disabled || coverage === 0}
        onPress={() => add({ type: 'clear' })}
      >
        Clear
      </Button>
    </div>
  );
  const surface = (large: boolean) => (
    <MaskSurface
      src={src}
      alt={alt}
      width={width}
      height={height}
      strokes={strokes}
      tool={disabled ? null : tool}
      brush={SIZES[size]}
      onStroke={add}
      lasso={lasso}
      onLasso={setLasso}
      onLassoClose={closeLasso}
      zoom={large ? view.z : 1}
      large={large}
    />
  );
  const status = (
    <p className={styles.status} aria-live="polite">
      {coverage === 0
        ? tool === 'box'
          ? 'Drag a box over the area that may change.'
          : tool === 'lasso'
            ? 'Click around the area that may change; click the first point or press Enter to close.'
            : 'Paint over the area that may change. Everything else stays exactly as rendered.'
        : `About ${Math.max(1, Math.round(coverage * 100))}% of the frame is marked. Only this area will change.`}
    </p>
  );

  return (
    <div className={styles.painter} ref={rootRef}>
      {toolbar}
      {surface(false)}
      <div className={styles.footer}>
        {actions}
        <div className={styles.actions}>
          <Button size="sm" variant="ghost" icon={<Maximize2 size={14} />} disabled={disabled} onPress={() => setBig(true)}>
            Full size
          </Button>
          <Button size="sm" icon={<Check size={14} />} onPress={onDone}>
            Done
          </Button>
        </div>
      </div>
      {status}

      <ModalOverlay className={styles.overlay} isOpen={big} isDismissable onOpenChange={setBig}>
        <Modal className={styles.modal}>
          <Dialog className={styles.dialog} aria-label="Mark the area to edit">
            <div className={styles.bar}>
              <Heading slot="title" className={styles.title}>
                Mark the area to edit
              </Heading>
              <Button variant="ghost" size="sm" icon={<X size={14} />} aria-label="Close full size" onPress={() => setBig(false)} />
            </div>
            <div className={styles.bar}>
              {toolbar}
              {actions}
              <div className={styles.actions}>
                <span className={styles.zoomChip}>
                  <ZoomIn size={14} aria-hidden />
                  {`${view.z.toFixed(1)}\u00d7`}
                </span>
                <Button size="sm" variant="ghost" icon={<Scan size={14} />} disabled={view.z === 1} onPress={() => setView(FIT)}>
                  Fit
                </Button>
              </div>
            </div>
            <ZoomFrame
              view={view}
              onView={setView}
              width={`min(calc(100vw - 80px), calc((100vh - 230px) * ${width / height}))`}
            >
              {surface(true)}
            </ZoomFrame>
            <div className={styles.bar}>
              {status}
              <Button variant="primary" size="sm" icon={<Check size={14} />} onPress={() => setBig(false)}>
                Done
              </Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </div>
  );
}

/**
 * The full-size picture's window. Wheel zooms 1x to 6x about the pointer;
 * Space with a drag, or the middle button, pans. The picture sits on a layer
 * that is translated then scaled (origin top-left), so its canvas keeps its own
 * resolution and `at()` still reads the pointer off `getBoundingClientRect`.
 */
function ZoomFrame({
  view,
  onView,
  width,
  children,
}: {
  view: View;
  onView: Dispatch<SetStateAction<View>>;
  width: string;
  children: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState(false);
  const [dragging, setDragging] = useState(false);
  const spaceRef = useRef(false);
  const over = useRef(false);
  const drag = useRef<{ x: number; y: number; from: View } | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = frame.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const lines = e.deltaMode === 1 ? 33 : 1;
      const k = Math.exp(-e.deltaY * lines * 0.0015);
      onView((v) => {
        const z = Math.min(MAX_ZOOM, Math.max(1, v.z * k));
        // The picture point under the pointer stays under it.
        const cx = (px - v.x) / v.z;
        const cy = (py - v.y) / v.z;
        return clampView({ z, x: px - cx * z, y: py - cy * z }, frame.clientWidth, frame.clientHeight);
      });
    };
    frame.addEventListener('wheel', onWheel, { passive: false });
    const ro = new ResizeObserver(() => onView((v) => clampView(v, frame.clientWidth, frame.clientHeight)));
    ro.observe(frame);
    return () => {
      frame.removeEventListener('wheel', onWheel);
      ro.disconnect();
    };
  }, [onView]);

  // Space is the pan key only while the pointer is over the picture, so it
  // still presses whatever button has focus anywhere else.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const down = e.type === 'keydown';
      if (down ? !over.current && !spaceRef.current : !spaceRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      spaceRef.current = down;
      setSpace(down);
    };
    const release = () => {
      spaceRef.current = false;
      setSpace(false);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('blur', release);
    };
  }, []);

  function panStart(e: PointerEvent<HTMLDivElement>) {
    if (!(e.button === 1 || (e.button === 0 && spaceRef.current))) return;
    // Captured here so the picture underneath never starts a stroke.
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, from: view };
    setDragging(true);
  }
  function panMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    const frame = frameRef.current;
    if (!d || !frame) return;
    onView(clampView({ z: d.from.z, x: d.from.x + e.clientX - d.x, y: d.from.y + e.clientY - d.y }, frame.clientWidth, frame.clientHeight));
  }
  function panEnd() {
    drag.current = null;
    setDragging(false);
  }

  return (
    <div
      ref={frameRef}
      className={styles.bigFrame}
      style={{ width }}
      data-pan={dragging ? 'drag' : space ? 'ready' : undefined}
      onPointerDownCapture={panStart}
      onPointerMove={panMove}
      onPointerUp={panEnd}
      onPointerCancel={panEnd}
      onPointerEnter={() => (over.current = true)}
      onPointerLeave={() => (over.current = false)}
    >
      <div className={styles.zoomLayer} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
        {children}
      </div>
    </div>
  );
}

function Toolbar({
  tool,
  size,
  onTool,
  onSize,
  disabled,
}: {
  tool: Tool;
  size: Size;
  onTool: (t: Tool) => void;
  onSize: (s: Size) => void;
  disabled: boolean;
}) {
  const pick = <T extends string>(set: (v: T) => void) => (keys: Set<Key>) => {
    const [first] = keys;
    if (first !== undefined) set(String(first) as T);
  };
  return (
    <div className={styles.toolbar}>
      <ToggleButtonGroup
        aria-label="Marking tool"
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[tool]}
        onSelectionChange={pick(onTool)}
        isDisabled={disabled}
        className={styles.segment}
      >
        <ToggleButton id="brush" className={styles.segItem}>
          <Brush size={14} aria-hidden />
          Brush
        </ToggleButton>
        <ToggleButton id="box" className={styles.segItem}>
          <SquareDashed size={14} aria-hidden />
          Box
        </ToggleButton>
        <ToggleButton id="lasso" className={styles.segItem}>
          <Lasso size={14} aria-hidden />
          Lasso
        </ToggleButton>
        <ToggleButton id="erase" className={styles.segItem}>
          <Eraser size={14} aria-hidden />
          Erase
        </ToggleButton>
      </ToggleButtonGroup>
      {tool !== 'box' && tool !== 'lasso' && (
        <ToggleButtonGroup
          aria-label="Brush size"
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[size]}
          onSelectionChange={pick(onSize)}
          isDisabled={disabled}
          className={styles.segment}
        >
          {(['s', 'm', 'l'] as const).map((s) => (
            <ToggleButton
              key={s}
              id={s}
              className={styles.segItem}
              aria-label={{ s: 'Small brush', m: 'Medium brush', l: 'Large brush' }[s]}
            >
              <span className={styles.dot} data-size={s} aria-hidden />
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      )}
    </div>
  );
}

/**
 * The mark's two tones, for the canvas that points at `id`: the strokes at half
 * strength inside a solid 1 px outline. The outline is the painted shape grown
 * by a pixel with the shape cut back out, so it follows erased bites and the
 * render still shows through the fill; doubled, because an antialiased edge
 * shares it between two pixels. Opacity on the canvas would fade it too.
 */
function MarkFilter({ id }: { id: string }) {
  return (
    <svg className={styles.markFilter} aria-hidden>
      <filter id={id} colorInterpolationFilters="sRGB">
        <feMorphology in="SourceAlpha" operator="dilate" radius="1" result="grown" />
        <feComposite in="grown" in2="SourceAlpha" operator="out" />
        <feComponentTransfer result="ring">
          <feFuncA type="linear" slope="2" />
        </feComponentTransfer>
        <feFlood className={styles.markOutline} />
        <feComposite in2="ring" operator="in" result="outline" />
        <feComponentTransfer in="SourceGraphic" result="fill">
          <feFuncA type="linear" slope="0.5" />
        </feComponentTransfer>
        <feMerge>
          <feMergeNode in="outline" />
          <feMergeNode in="fill" />
        </feMerge>
      </filter>
    </svg>
  );
}

/** The image with the mark painted over it; draws when `tool` is set. */
function MaskSurface({
  src,
  alt,
  width,
  height,
  strokes,
  tool,
  brush,
  onStroke,
  lasso = [],
  onLasso,
  onLassoClose,
  zoom = 1,
  large = false,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  strokes: readonly MaskStroke[];
  tool: Tool | null;
  brush: number;
  onStroke?: ((s: MaskStroke) => void) | undefined;
  /** The lasso being clicked out, and how to extend or close it. */
  lasso?: readonly Point[] | undefined;
  onLasso?: ((points: Point[]) => void) | undefined;
  onLassoClose?: ((points: Point[]) => void) | undefined;
  /** The full-size view's zoom, so marks drawn over the picture keep their size. */
  zoom?: number | undefined;
  large?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const filterId = useId();
  const draft = useRef<MaskStroke | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [shownWidth, setShownWidth] = useState(0);

  // The tint, read from the theme once per stroke (and on redraw), not per move.
  const tint = useRef('#f5f5f5');
  const readTint = () => {
    const c = canvasRef.current && getComputedStyle(canvasRef.current).getPropertyValue('--bay-accent').trim();
    if (c) tint.current = c;
    return tint.current;
  };

  const redraw = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    paintStrokes(ctx, draft.current ? [...strokes, draft.current] : strokes, readTint());
  }, [strokes]);
  const redrawRef = useRef(redraw);
  redrawRef.current = redraw;
  useEffect(redraw, [redraw]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(wrap.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(wrap.clientHeight * dpr));
      setShownWidth(wrap.clientWidth);
      redrawRef.current();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const at = (e: PointerEvent<HTMLCanvasElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)];
  };

  function down(e: PointerEvent<HTMLCanvasElement>) {
    if (!tool || e.button !== 0) return;
    readTint();
    if (tool === 'lasso') {
      const [x, y] = at(e);
      const first = lasso[0];
      const last = lasso[lasso.length - 1];
      const r = e.currentTarget.getBoundingClientRect();
      if (first && Math.hypot(x - first[0], y - first[1]) < LASSO_CLOSE) onLassoClose?.([...lasso]);
      else if (!last || Math.hypot((x - last[0]) * r.width, (y - last[1]) * r.height) >= 1.5) onLasso?.([...lasso, [x, y]]);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = at(e);
    draft.current =
      tool === 'box'
        ? { type: 'box', erase: false, x0: x, y0: y, x1: x, y1: y }
        : { type: 'brush', erase: tool === 'erase', size: brush, points: [[x, y]] };
    if (draft.current.type === 'brush') {
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) paintStroke(ctx, draft.current, tint.current);
    } else redraw();
  }

  function move(e: PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    // In the picture's own pixels, which a zoom layer above does not change.
    const k = r.width > 0 ? e.currentTarget.clientWidth / r.width : 1;
    setCursor({ x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k });
    const d = draft.current;
    if (!d) return;
    const [x, y] = at(e);
    if (d.type === 'box') {
      d.x1 = x;
      d.y1 = y;
      redraw();
    } else if (d.type === 'brush') {
      const last = d.points[d.points.length - 1]!;
      if (Math.hypot((x - last[0]) * r.width, (y - last[1]) * r.height) < 1.5) return;
      d.points.push([x, y]);
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) paintStroke(ctx, { ...d, points: [last, [x, y]] }, tint.current);
    }
  }

  function up() {
    const d = draft.current;
    draft.current = null;
    if (!d) return;
    if (d.type === 'box' && (Math.abs(d.x1 - d.x0) < 0.004 || Math.abs(d.y1 - d.y0) < 0.004)) {
      redraw();
      return;
    }
    onStroke?.(d);
  }

  const diameter = brush * shownWidth;
  const shownHeight = (shownWidth * height) / width;
  return (
    <div
      ref={wrapRef}
      className={[styles.surface, large ? styles.surfaceLarge : ''].filter(Boolean).join(' ')}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <img className={styles.image} src={src} alt={alt} draggable={false} />
      <MarkFilter id={filterId} />
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        style={{ filter: `url("#${filterId}")` }}
        data-tool={tool ?? undefined}
        aria-hidden
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={() => setCursor(null)}
        onDoubleClick={() => {
          if (tool === 'lasso' && lasso.length > 0) onLassoClose?.([...lasso]);
        }}
      />
      {tool === 'lasso' && lasso.length > 0 && shownWidth > 0 && (
        <svg className={styles.lassoPath} width={shownWidth} height={shownHeight} aria-hidden>
          <polyline
            className={styles.lassoLine}
            strokeWidth={1 / zoom}
            strokeDasharray={`${4 / zoom} ${3 / zoom}`}
            points={[...lasso, ...(cursor ? [[cursor.x / shownWidth, cursor.y / shownHeight] as Point] : [])]
              .map(([x, y]) => `${x * shownWidth},${y * shownHeight}`)
              .join(' ')}
          />
          {lasso.map(([x, y], i) => (
            <circle key={i} className={styles.lassoDot} cx={x * shownWidth} cy={y * shownHeight} r={2 / zoom} />
          ))}
        </svg>
      )}
      {tool && tool !== 'box' && tool !== 'lasso' && cursor && (
        <span
          className={styles.cursor}
          data-erase={tool === 'erase' || undefined}
          aria-hidden
          style={{ width: diameter, height: diameter, left: cursor.x - diameter / 2, top: cursor.y - diameter / 2 }}
        />
      )}
    </div>
  );
}

export type MaskOverlayProps = {
  strokes: readonly MaskStroke[];
};

/** A read-only tint of the mark, laid over an image of the same shape. */
export function MaskOverlay({ strokes }: MaskOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const filterId = useId();
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const color = getComputedStyle(canvas).getPropertyValue('--bay-accent').trim() || '#f5f5f5';
    paintStrokes(ctx, strokesRef.current, color);
  }, []);
  useEffect(draw, [strokes, draw]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      draw();
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);
  return (
    <>
      <MarkFilter id={filterId} />
      <canvas ref={canvasRef} className={styles.overlayCanvas} style={{ filter: `url("#${filterId}")` }} aria-hidden />
    </>
  );
}
