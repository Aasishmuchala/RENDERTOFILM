import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ToggleButton, ToggleButtonGroup, type Key } from 'react-aria-components';

import { frameLabel, type CutFrame, type FrameMode } from '../../master.ts';
import maskStyles from './MaskPainter.module.css';
import styles from './FrameWindow.module.css';

/** The arrow keys' step along the clip, as a share of how far the window can travel; Shift takes the larger one. */
const NUDGE = 0.02;
const NUDGE_LARGE = 0.1;

const VERTICAL = 9 / 16;

const TALL_NOTE = 'This clip is already taller than 9:16.';

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const pct = (n: number) => `${n * 100}%`;

export type FrameWindowProps = {
  /** The cut's poster; null shows a neutral stand-in of the clip's shape. */
  poster: string | null;
  /** The clip's own size. */
  width: number;
  height: number;
  value: CutFrame;
  onChange: (next: CutFrame) => void;
  disabled?: boolean | undefined;
};

/**
 * Where a cut sits in the 9:16 file. Crop slides a 9:16 window along the clip
 * (drag it, or press the arrow keys); Fit shows the whole clip on black. A clip
 * already taller than 9:16 can only fit.
 */
export function FrameWindow({ poster, width, height, value, onChange, disabled = false }: FrameWindowProps) {
  const ratio = width > 0 && height > 0 ? width / height : 16 / 9;
  const tall = ratio <= VERTICAL + 1e-6;
  const mode: FrameMode = tall ? 'fit' : value.mode;
  /** The window's width as a share of the clip's: the 9:16 slice of its height. */
  const span = Math.min(1, VERTICAL / ratio);
  const x = clamp01(value.x);
  const [dragging, setDragging] = useState(false);
  const windowRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ from: number; x: number; stage: number } | null>(null);

  const place = (next: number) => onChange({ mode: value.mode, x: Math.round(clamp01(next) * 1e4) / 1e4 });

  function down(e: PointerEvent<HTMLDivElement>) {
    if (disabled || e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Grabbing the clip off the window brings the window under the pointer.
    const at = (e.clientX - rect.left) / rect.width;
    const left = (1 - span) * x;
    let start = x;
    if ((at < left || at > left + span) && span < 1) {
      start = clamp01((at - span / 2) / (1 - span));
      place(start);
    }
    drag.current = { from: e.clientX, x: start, stage: rect.width };
    setDragging(true);
    windowRef.current?.focus({ preventScroll: true });
  }

  function dragMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    const travel = d ? d.stage * (1 - span) : 0;
    if (!d || travel <= 0) return;
    place(d.x + (e.clientX - d.from) / travel);
  }

  function up() {
    drag.current = null;
    setDragging(false);
  }

  function nudge(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const step = e.shiftKey ? NUDGE_LARGE : NUDGE;
    const to =
      e.key === 'ArrowLeft' || e.key === 'ArrowDown'
        ? x - step
        : e.key === 'ArrowRight' || e.key === 'ArrowUp'
          ? x + step
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? 1
              : null;
    if (to === null) return;
    e.preventDefault();
    place(to);
  }

  function pickMode(keys: Set<Key>) {
    const [first] = keys;
    if (first !== undefined) onChange({ mode: first === 'crop' ? 'crop' : 'fit', x: value.x });
  }

  return (
    <div role="group" aria-label="9:16 window" className={styles.frame}>
      <ToggleButtonGroup
        aria-label="How this cut fills the 9:16 frame"
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[mode]}
        onSelectionChange={pickMode}
        isDisabled={disabled}
        className={`${maskStyles.segment} ${styles.modes}`}
      >
        {/* The button drops a title of its own, and a disabled one gives no hover; the wrapper carries the tooltip. */}
        <span className={styles.hint} title={tall ? TALL_NOTE : undefined}>
          <ToggleButton
            id="crop"
            isDisabled={tall}
            className={maskStyles.segItem}
            {...(tall ? { 'aria-label': `Crop. ${TALL_NOTE}` } : {})}
          >
            Crop
          </ToggleButton>
        </span>
        <ToggleButton id="fit" className={maskStyles.segItem}>
          Fit
        </ToggleButton>
      </ToggleButtonGroup>
      {mode === 'crop' ? (
        <div
          className={styles.stage}
          style={{ aspectRatio: `${width} / ${height}` }}
          data-dragging={dragging || undefined}
          data-disabled={disabled || undefined}
          onPointerDown={down}
          onPointerMove={dragMove}
          onPointerUp={up}
          onPointerCancel={up}
        >
          {poster ? <img className={styles.image} src={poster} alt="" draggable={false} /> : <div className={styles.blank} aria-hidden />}
          <div
            ref={windowRef}
            className={styles.window}
            style={{ left: pct((1 - span) * x), width: pct(span) }}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label="9:16 window position"
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(x * 100)}
            aria-valuetext={frameLabel({ mode: 'crop', x })}
            aria-disabled={disabled || undefined}
            onKeyDown={nudge}
          />
        </div>
      ) : (
        <div className={styles.fit} aria-hidden>
          {poster ? (
            <img className={styles.fitImage} src={poster} alt="" draggable={false} />
          ) : (
            <div
              className={styles.fitBlank}
              style={{ aspectRatio: `${ratio}`, ...(ratio >= VERTICAL ? { width: '100%' } : { height: '100%' }) }}
            />
          )}
        </div>
      )}
      <p className={styles.label} aria-live="polite">
        {frameLabel({ mode, x })}
      </p>
    </div>
  );
}
