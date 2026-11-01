import { ImageUp, PanelRightClose, PanelRightOpen } from 'lucide-react';
import {
  type CSSProperties,
  type JSX,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { type DropItem, DropZone } from 'react-aria-components';

import { usePageActive } from '../lib/ambient.tsx';
import type { PageId } from '../nav.ts';
import { ImageDropZone } from '../ui/ImageDropZone.tsx';
import styles from './Workspace.module.css';

/** Close-ups and Location are Still modes, not pages, and keep their own open state. */
type WorkspacePage = PageId | 'closeups' | 'location';

/**
 * The full-screen canvas every studio page sits in (DESIGN.md 3.3, Phase 9):
 * the picture fills the window, the settings float beside it in one glass
 * inspector that can be hidden, takes ride in a filmstrip above the dock.
 * Pages pass slots, not classes. On phones the inspector is a bottom sheet
 * with three detents (peek, half, full).
 *
 * Canvas states: `empty` is a drop target that is the frame; `preview` shows
 * the source dimmed inside the guides with one line saying what will appear;
 * `live` is a result, a running status or an error inside the frame; `free`
 * is a grid or a player with no frame.
 */

export type CanvasState = 'empty' | 'preview' | 'live' | 'free';

export type WorkspaceProps = {
  /** The persistence key and the active-page check. */
  page: WorkspacePage;
  canvasState: CanvasState;
  /** The picture (img, CompareSlider, video, RenderingStatus, Alert) or, for `free`, the grid or player. */
  canvas?: ReactNode;
  /** The frame's CSS aspect ratio ("16 / 9", "2560 / 1440"); required unless `free`. */
  aspectRatio?: string | undefined;
  /**
   * One line under the picture, set as a camera slate: look, model,
   * resolution. An array (or a string with ` · `) is split into parts with a
   * thin rule between them; empty parts are dropped.
   */
  caption?: ReactNode | undefined;
  /** `preview`: the one line over the dimmed source ("Your film still will appear here"). */
  canvasNote?: ReactNode | undefined;
  /** A floating glass pill at the canvas's top left (view toggles, previous and next, filters). */
  canvasToolbar?: ReactNode | undefined;
  /** Ghost buttons for the current picture (Download, Make a video); the pill under the caption. */
  canvasActions?: ReactNode | undefined;
  /** Images dropped anywhere on the canvas; also the `empty` zone's picker. */
  onDropFiles?: ((files: File[]) => void) | undefined;
  /** The `empty` state's copy; `label` is the drop zone's accessible name. */
  empty?: { title: string; hint: string; action: string; label: string } | undefined;
  /** Sticky above the inspector's body (Video's segmented control). */
  inspectorHead?: ReactNode | undefined;
  /** The page's PageHeader (its one h1) and Sections; this part scrolls. */
  inspector: ReactNode;
  /** The one primary action (Button size="lg") and its CostLine. */
  footer?: ReactNode | undefined;
  /** The filmstrip's content: cards in a row (the page's own radio group or list). */
  strip?: ReactNode | undefined;
  /** 112 or 164 px tall on a desktop, 96 or 148 on a phone; default `strip`. */
  stripSize?: 'strip' | 'timeline' | undefined;
  /** The strip region's name: "Takes", "Frames", "Timeline". */
  stripLabel?: string | undefined;
  /**
   * Phone sheet only: when this value changes after the first render and the
   * sheet is in peek, it rises to half (typically the selected take's id).
   * Does nothing from 900 px.
   */
  raiseSheet?: unknown;
};

/** The class a free-canvas player wears to draw the same outline and corner ticks as a framed picture. */
export const frameGuidesClass: string = styles.frameGuides ?? '';

type Detent = 'peek' | 'half' | 'full';

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];
/** Per page: whether the inspector was left hidden (desktop and tablet only). */
const STORE_KEY = 'render-to-film:inspector:';
/** The phone layout: portrait under 900 px, or anything under 480 (the CSS breakpoints match). */
export const PHONE_QUERY = '(width < 480px), (width < 900px) and (orientation: portrait)';
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const NEXT_DETENT: Record<Detent, Detent> = { peek: 'half', half: 'full', full: 'peek' };
/** Where the `i` shortcut must not fire: typing, or a dialog or popover list with its own keys. */
const TYPING =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="listbox"], [role="menu"], [role="combobox"]';

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

/** Whether the Workspace is in its phone layout (`PHONE_QUERY`): the inspector is a bottom sheet. */
export function usePhoneLayout(): boolean {
  return useMedia(PHONE_QUERY);
}

/** The caption's parts for the slate, or null to show it as given. */
function slateParts(caption: ReactNode): ReactNode[] | null {
  const parts = Array.isArray(caption)
    ? (caption as ReactNode[])
    : typeof caption === 'string' && caption.includes(' · ')
      ? caption.split(' · ')
      : null;
  return parts ? parts.filter((p) => p !== undefined && p !== null && p !== false && p !== '') : null;
}

function readOpen(page: WorkspacePage): boolean {
  try {
    return localStorage.getItem(STORE_KEY + page) !== 'hidden';
  } catch {
    return true;
  }
}

function writeOpen(page: WorkspacePage, open: boolean) {
  try {
    localStorage.setItem(STORE_KEY + page, open ? 'open' : 'hidden');
  } catch {
    // Private mode: the choice just won't survive a reload.
  }
}

/** A token read off the document, for the Web Animations calls. */
function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function springEasing(): string {
  const spring = token('--ease-spring', '');
  const ok = spring.startsWith('linear(') && CSS.supports('transition-timing-function', spring);
  return ok ? spring : 'cubic-bezier(0.22, 1, 0.36, 1)';
}

function durationMs(name: string, fallback: number): number {
  const ms = Number.parseFloat(token(name, `${fallback}ms`));
  return Number.isFinite(ms) ? ms : fallback;
}

async function imageFiles(items: DropItem[]): Promise<File[]> {
  const files: File[] = [];
  for (const item of items) {
    if (item.kind === 'file' && ACCEPTED.includes(item.type)) files.push(await item.getFile());
  }
  return files;
}

export function Workspace({
  page,
  canvasState,
  canvas,
  aspectRatio,
  caption,
  canvasNote,
  canvasToolbar,
  canvasActions,
  onDropFiles,
  empty,
  inspectorHead,
  inspector,
  footer,
  strip,
  stripSize = 'strip',
  stripLabel,
  raiseSheet,
}: WorkspaceProps): JSX.Element {
  const active = usePageActive();
  const phone = useMedia(PHONE_QUERY);
  const wide = !phone;
  const [open, setOpen] = useState(() => readOpen(page));
  const [detent, setDetent] = useState<Detent>('peek');
  /** The phone's peek height: the grabber plus the footer, measured. */
  const [peek, setPeek] = useState<number | null>(null);

  const shown = phone || open;
  const hasStrip = strip !== undefined && strip !== null && strip !== false;
  const hasFooter = footer !== undefined && footer !== null && footer !== false;
  const framed = canvasState !== 'free';
  /** A toolbar gets a band of its own at the canvas's top, so its thin glass never sits on the picture. */
  const band = canvasToolbar !== undefined && canvasToolbar !== null && canvasToolbar !== false;

  const frameRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLParagraphElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const hideRef = useRef<HTMLButtonElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const showRef = useRef<HTMLButtonElement>(null);
  const grabberRef = useRef<HTMLButtonElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  /** Where the picture and its caption sat before a show or hide, for the glide (FLIP). */
  const before = useRef<Map<HTMLElement, DOMRect> | null>(null);
  const focusAfter = useRef(false);

  const toggle = useCallback(() => {
    const reduced = window.matchMedia(REDUCED_MOTION).matches;
    const rects = new Map<HTMLElement, DOMRect>();
    if (!reduced) {
      for (const el of [frameRef.current, captionRef.current, actionsRef.current]) {
        if (el) rects.set(el, el.getBoundingClientRect());
      }
    }
    before.current = rects.size ? rects : null;
    focusAfter.current = true;
    setOpen((was) => {
      writeOpen(page, !was);
      return !was;
    });
  }, [page]);

  // The picture glides to its new size instead of jumping: measure it again
  // after the change and play the difference back as a transform (FLIP), on
  // the frame (the picture and its guides), its caption and its actions.
  useLayoutEffect(() => {
    const rects = before.current;
    before.current = null;
    if (!rects) return;
    const easing = springEasing();
    const duration = durationMs('--dur-3', 320);
    for (const [el, from] of rects) {
      if (!el.isConnected) continue;
      const to = el.getBoundingClientRect();
      if (!from.width || !to.width) continue;
      const scale = el === frameRef.current ? from.width / to.width : 1;
      const dx = from.left + from.width / 2 - (to.left + to.width / 2);
      const dy = from.top + from.height / 2 - (to.top + to.height / 2);
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(scale - 1) < 0.002) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${scale})` }, { transform: 'none' }], {
        duration,
        easing,
      });
    }
  }, [open]);

  // A page coming into view: the inspector slides 12 px in as the panel
  // fades (App.module.css), from 900 px and only when it is open. Not on the
  // first render, and not under reduced motion.
  const wasActive = useRef(active);
  useEffect(() => {
    const was = wasActive.current;
    wasActive.current = active;
    if (!active || was || phone || !open) return;
    if (window.matchMedia(REDUCED_MOTION).matches) return;
    asideRef.current?.animate(
      [
        { opacity: 0, transform: 'translateX(12px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 240, easing: springEasing() }
    );
  }, [active, phone, open]);

  // Focus follows the control: hidden, to the Show button; shown, to Hide.
  useEffect(() => {
    if (!focusAfter.current) return;
    focusAfter.current = false;
    (open ? hideRef.current : showRef.current)?.focus({ preventScroll: true });
  }, [open]);

  // `i` shows and hides the inspector on the page showing, from 900 px, unless the person is typing.
  useEffect(() => {
    if (!active || phone) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'i' || e.repeat || e.isComposing || e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(TYPING)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, phone, toggle]);

  // Phone: a new `raiseSheet` value lifts a resting sheet to half. The value
  // is compared, not counted, so the first render (and a strict-mode replay of
  // it) never moves the sheet.
  const raised = useRef(raiseSheet);
  useEffect(() => {
    if (Object.is(raised.current, raiseSheet)) return;
    raised.current = raiseSheet;
    if (phone) setDetent((d) => (d === 'peek' ? 'half' : d));
  }, [raiseSheet, phone]);

  // Phone: the peek detent is exactly the grabber, the head if there is one and the footer, whatever the footer holds.
  const hasHead = inspectorHead !== undefined && inspectorHead !== null && inspectorHead !== false;
  useLayoutEffect(() => {
    if (!phone) return;
    const grab = grabberRef.current;
    const head = headRef.current;
    const foot = footerRef.current;
    const measure = () => {
      const h = (grab?.parentElement?.offsetHeight ?? 0) + (head?.offsetHeight ?? 0) + (foot?.offsetHeight ?? 0);
      setPeek(h > 0 ? Math.max(44, Math.ceil(h)) : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (grab?.parentElement) observer.observe(grab.parentElement);
    if (head) observer.observe(head);
    if (foot) observer.observe(foot);
    return () => observer.disconnect();
  }, [phone, hasFooter, hasHead]);

  const style = {
    '--ar': aspectRatio ?? '16 / 9',
    ...(phone && peek !== null ? { '--sheet-peek': `${peek}px` } : {}),
  } as CSSProperties;

  const emptyCopy = empty ?? {
    title: 'Drop an image to begin',
    hint: 'PNG, JPEG or WebP.',
    action: 'Choose an image',
    label: 'Drop or choose an image',
  };

  const showCaption = framed && canvasState !== 'empty' && caption !== undefined && caption !== null && caption !== false;
  const slate = showCaption ? slateParts(caption) : null;
  const showActions =
    framed && canvasState !== 'empty' && canvasActions !== undefined && canvasActions !== null && canvasActions !== false;

  const stage = framed ? (
    <div className={styles.stage}>
      <div className={styles.frame} ref={frameRef}>
        <div className={styles.picture} data-state={canvasState}>
          {canvasState === 'empty' ? (
            <div className={styles.empty}>
              <ImageDropZone
                onFiles={onDropFiles}
                label={emptyCopy.label}
                actionLabel={emptyCopy.action}
                disabled={!onDropFiles}
              >
                <div className={styles.emptyBody}>
                  <ImageUp size={28} aria-hidden className={styles.emptyIcon} />
                  <p className={styles.emptyTitle}>{emptyCopy.title}</p>
                  {emptyCopy.hint && <p className={styles.emptyHint}>{emptyCopy.hint}</p>}
                </div>
              </ImageDropZone>
            </div>
          ) : (
            <>
              {canvas}
              {canvasState === 'preview' && canvasNote && <p className={styles.note}>{canvasNote}</p>}
            </>
          )}
        </div>
      </div>
      {showCaption && (
        <p className={styles.caption} ref={captionRef}>
          {slate
            ? slate.map((part, i) => (
                <span key={i} className={styles.slatePart}>
                  {part}
                </span>
              ))
            : caption}
        </p>
      )}
      {showActions && (
        <div className={styles.actions} ref={actionsRef}>
          {canvasActions}
        </div>
      )}
    </div>
  ) : (
    <div className={styles.free}>{canvas}</div>
  );

  const canvasInner = (
    <>
      {band && <div className={styles.toolbar}>{canvasToolbar}</div>}
      {wide && !open && (
        <button
          type="button"
          ref={showRef}
          className={styles.show}
          aria-label="Show controls"
          aria-keyshortcuts="i"
          onClick={toggle}
        >
          <PanelRightOpen size={16} aria-hidden />
          <span>Controls</span>
        </button>
      )}
      {stage}
    </>
  );

  const canvasProps = { className: styles.canvas, 'data-stage': '' };

  return (
    <div
      className={styles.workspace}
      style={style}
      data-open={shown ? '' : undefined}
      data-band={band ? '' : undefined}
      data-caption={showCaption ? '' : undefined}
      data-actions={showActions ? '' : undefined}
      data-strip={hasStrip ? stripSize : undefined}
      data-detent={phone ? detent : undefined}
    >
      <aside aria-label="Controls" className={styles.inspector} inert={!shown} ref={asideRef}>
        {phone && (
          <div className={styles.grabberRow}>
            <button
              type="button"
              ref={grabberRef}
              data-sheet-grabber
              className={styles.grabber}
              aria-label={detent === 'full' ? 'Collapse controls' : 'Expand controls'}
              aria-expanded={detent !== 'peek'}
              onClick={() => setDetent((d) => NEXT_DETENT[d])}
            >
              <span className={styles.grabberPill} aria-hidden />
            </button>
          </div>
        )}
        {(wide || inspectorHead) && (
          <div className={styles.head} ref={headRef}>
            {inspectorHead && <div className={styles.headMain}>{inspectorHead}</div>}
            {wide && (
              <button
                type="button"
                ref={hideRef}
                className={styles.hide}
                aria-label="Hide controls"
                aria-keyshortcuts="i"
                title="Hide controls (i)"
                onClick={toggle}
              >
                <PanelRightClose size={16} aria-hidden />
              </button>
            )}
          </div>
        )}
        <div
          className={styles.body}
          inert={phone && detent === 'peek'}
          aria-hidden={phone && detent === 'peek' ? true : undefined}
        >
          {inspector}
        </div>
        {hasFooter && (
          <div className={styles.footer} ref={footerRef}>
            {footer}
          </div>
        )}
      </aside>

      {onDropFiles && canvasState !== 'empty' ? (
        <DropZone
          {...canvasProps}
          aria-label={empty?.label ?? 'Drop an image to use it'}
          getDropOperation={(types) => (ACCEPTED.some((t) => types.has(t)) ? 'copy' : 'cancel')}
          onDrop={async (e) => {
            const files = await imageFiles(e.items);
            if (files.length) onDropFiles(files);
          }}
        >
          {canvasInner}
        </DropZone>
      ) : (
        <div {...canvasProps}>{canvasInner}</div>
      )}

      {hasStrip && (
        <div role="region" aria-label={stripLabel ?? 'Filmstrip'} className={styles.strip} data-stage>
          <div
            className={styles.stripScroll}
            onWheel={(e) => {
              // A mouse wheel moves the filmstrip sideways, as a trackpad does.
              const el = e.currentTarget;
              if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) el.scrollLeft += e.deltaY;
            }}
          >
            {strip}
          </div>
        </div>
      )}

      {phone && <div className={styles.spacer} aria-hidden />}
    </div>
  );
}
