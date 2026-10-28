import { Brush, Check, Eraser, Maximize2, Redo2, SquareDashed, Trash2, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import {
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
  ToggleButton,
  ToggleButtonGroup,
  type Key,
} from 'react-aria-components';

import { maskCoverage, paintStroke, paintStrokes, type MaskStroke } from '../lib/mask.ts';
import { Button } from './Button.tsx';
import styles from './MaskPainter.module.css';

type Tool = 'brush' | 'box' | 'erase';
type Size = 's' | 'm' | 'l';

/** Brush diameters, as a share of the image width. */
const SIZES: Record<Size, number> = { s: 0.015, m: 0.035, l: 0.075 };

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
 * Paint the part of an image that may change. Brush, box and eraser, three
 * brush sizes, undo/redo (Ctrl/Cmd+Z, Shift for redo), clear (undoable) and
 * a full-size view for precise edges. The marked area shows tinted in the
 * accent colour.
 */
export function MaskPainter({ src, alt, width, height, strokes, onChange, onDone, disabled = false }: MaskPainterProps) {
  const [tool, setTool] = useState<Tool>('brush');
  const [size, setSize] = useState<Size>('m');
  const [redo, setRedo] = useState<MaskStroke[]>([]);
  const [big, setBig] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const coverage = useMemo(() => maskCoverage(strokes, width, height), [strokes, width, height]);

  const add = useCallback(
    (s: MaskStroke) => {
      onChange([...strokes, s]);
      setRedo([]);
    },
    [strokes, onChange]
  );
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

  const toolbar = (
    <Toolbar
      tool={tool}
      size={size}
      onTool={setTool}
      onSize={setSize}
      disabled={disabled}
    />
  );
  const actions = (
    <div className={styles.actions}>
      <Button size="sm" variant="ghost" icon={<Undo2 size={14} />} aria-label="Undo" disabled={disabled || strokes.length === 0} onPress={undo} />
      <Button size="sm" variant="ghost" icon={<Redo2 size={14} />} aria-label="Redo" disabled={disabled || redo.length === 0} onPress={redoLast} />
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
      large={large}
    />
  );
  const status = (
    <p className={styles.status} aria-live="polite">
      {coverage === 0
        ? tool === 'box'
          ? 'Drag a box over the area that may change.'
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
            </div>
            <div
              className={styles.bigFrame}
              style={{ width: `min(calc(100vw - 80px), calc((100vh - 230px) * ${width / height}))` }}
            >
              {surface(true)}
            </div>
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
        <ToggleButton id="erase" className={styles.segItem}>
          <Eraser size={14} aria-hidden />
          Erase
        </ToggleButton>
      </ToggleButtonGroup>
      {tool !== 'box' && (
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
  large?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draft = useRef<MaskStroke | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [shownWidth, setShownWidth] = useState(0);

  // The tint, read from the theme once per stroke (and on redraw), not per move.
  const tint = useRef('#b5562b');
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

  const at = (e: PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)];
  };

  function down(e: PointerEvent<HTMLCanvasElement>) {
    if (!tool || e.button !== 0) return;
    readTint();
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
    setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
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
  return (
    <div
      ref={wrapRef}
      className={[styles.surface, large ? styles.surfaceLarge : ''].filter(Boolean).join(' ')}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <img className={styles.image} src={src} alt={alt} draggable={false} />
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        data-tool={tool ?? undefined}
        aria-hidden
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={() => setCursor(null)}
      />
      {tool && tool !== 'box' && cursor && (
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
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const color = getComputedStyle(canvas).getPropertyValue('--bay-accent').trim() || '#b5562b';
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
  return <canvas ref={canvasRef} className={styles.overlayCanvas} aria-hidden />;
}
