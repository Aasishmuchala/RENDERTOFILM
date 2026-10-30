import {
  createContext,
  type ReactNode,
  type SyntheticEvent,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import styles from '../layouts/AppShell.module.css';

/**
 * The ambient backdrop (DESIGN.md 2.5): a heavily blurred, dimmed copy of the
 * current frame under the whole app, so the glass chrome picks up its light.
 * The active page names the frame with `useAmbient(thumbUrl)`; with nothing
 * named the room falls back to a static warm gradient. The layer's look lives
 * in AppShell.module.css because only the shell renders it.
 */

type AmbientApi = {
  /** `owner` (one per `useAmbient` call) now names the frame. */
  claim: (owner: string, url: string | null) => void;
  /** Back to the default gradient, unless another owner took over since. */
  release: (owner: string) => void;
};

const AmbientUrlContext = createContext<string | null>(null);
const AmbientApiContext = createContext<AmbientApi | null>(null);

/** True inside the page that is showing; App's `Panel` provides it. */
export const PageActiveContext = createContext<boolean>(false);

export function usePageActive(): boolean {
  return useContext(PageActiveContext);
}

export function AmbientProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ owner: string | null; url: string | null }>({ owner: null, url: null });
  const api = useMemo<AmbientApi>(
    () => ({
      claim: (owner, url) => setState((s) => (s.owner === owner && s.url === url ? s : { owner, url })),
      release: (owner) => setState((s) => (s.owner === owner ? { owner: null, url: null } : s)),
    }),
    []
  );
  return (
    <AmbientApiContext.Provider value={api}>
      <AmbientUrlContext.Provider value={state.url}>{children}</AmbientUrlContext.Provider>
    </AmbientApiContext.Provider>
  );
}

/**
 * Light the room with `url` (a thumbnail, never a full-size image) while this
 * page is the one showing; `null`/`undefined` is the default gradient.
 * Calls from hidden pages are ignored, and leaving the page hands the room
 * back, so a page that never calls this (Library, Settings) gets the default.
 * An unsent upload's local url is fine: the room gets a small copy of it.
 */
export function useAmbient(url: string | null | undefined): void {
  const active = usePageActive();
  const api = useContext(AmbientApiContext);
  const owner = useId();
  const next = useSmallCopy(url ?? null);
  // While a local image's small copy is being made, the room keeps the light it has.
  const last = useRef<string | null>(null);
  if (next !== PENDING) last.current = next;
  const value = next === PENDING ? last.current : next;
  useEffect(() => {
    if (!active || !api) return;
    api.claim(owner, value);
    return () => api.release(owner);
  }, [active, api, owner, value]);
}

const PENDING = Symbol('pending');
/** Wide enough for a 48 px blur over the whole window; a few KB to decode. */
const SMALL_WIDTH = 192;
const SMALL_KEEP = 16;
const smallCopies = new Map<string, Promise<string>>();

/**
 * A local image (an upload's `blob:` or `data:` url, which can be a full-size
 * render) lights the room through a small copy, made once per url and kept
 * for the last few; server thumbnails are already small and pass through.
 * If the copy can't be made the original is used.
 */
function useSmallCopy(url: string | null): string | null | typeof PENDING {
  const local = url !== null && /^(blob|data):/.test(url);
  const [copy, setCopy] = useState<{ from: string; url: string } | null>(null);
  useEffect(() => {
    if (!local || url === null) return;
    let live = true;
    void smallCopy(url).then((small) => {
      if (live) setCopy({ from: url, url: small });
    });
    return () => {
      live = false;
    };
  }, [local, url]);
  if (!local) return url;
  return copy?.from === url ? copy.url : PENDING;
}

function smallCopy(url: string): Promise<string> {
  let made = smallCopies.get(url);
  if (!made) {
    made = downscale(url).catch(() => url);
    smallCopies.set(url, made);
    if (smallCopies.size > SMALL_KEEP) {
      const [oldest, gone] = smallCopies.entries().next().value as [string, Promise<string>];
      smallCopies.delete(oldest);
      // An <img> that already shows it keeps its pixels after the url is revoked.
      void gone.then((u) => u !== oldest && URL.revokeObjectURL(u));
    }
  }
  return made;
}

async function downscale(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  const bitmap = await createImageBitmap(blob, { resizeWidth: SMALL_WIDTH, resizeQuality: 'medium' });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    const small = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.8));
    if (!small) throw new Error('no small copy');
    return URL.createObjectURL(small);
  } finally {
    bitmap.close();
  }
}

const REDUCED_TRANSPARENCY = '(prefers-reduced-transparency: reduce)';

function ambientAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  const blur =
    typeof CSS !== 'undefined' &&
    (CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'));
  return blur && !window.matchMedia(REDUCED_TRANSPARENCY).matches;
}

/**
 * The fixed, `aria-hidden` layer with two stacked images: a new frame loads in
 * the hidden one, then the two cross-fade (opacity, 1.2 s). Not rendered under
 * reduced transparency or without backdrop-filter support: the ground is then
 * solid and the glass falls back to its solid fill.
 */
export function AmbientLayer() {
  const url = useContext(AmbientUrlContext);
  const [allowed, setAllowed] = useState(ambientAllowed);

  useEffect(() => {
    const query = window.matchMedia(REDUCED_TRANSPARENCY);
    const onChange = () => setAllowed(ambientAllowed());
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  if (!allowed) return null;
  return <AmbientImages url={url} />;
}

type Layer = 0 | 1;

function AmbientImages({ url }: { url: string | null }) {
  // Two layers: `front` is the one showing (when `shown`); the other loads the next frame.
  const [layers, setLayers] = useState<[string | null, string | null]>([null, null]);
  const [front, setFront] = useState<Layer>(0);
  const [shown, setShown] = useState(false);
  const wanted = useRef<string | null>(null);
  const imgs = useRef<[HTMLImageElement | null, HTMLImageElement | null]>([null, null]);

  useEffect(() => {
    wanted.current = url;
    if (!url) {
      setShown(false);
      return;
    }
    if (layers[front] === url) {
      setShown(true);
      return;
    }
    const back: Layer = front === 0 ? 1 : 0;
    const ready = imgs.current[back];
    if (layers[back] === url && ready?.complete && ready.naturalWidth > 0) {
      // Already loaded in the hidden layer (the frame we just left): fade straight to it.
      setFront(back);
      setShown(true);
      return;
    }
    setLayers((l) => (back === 0 ? [url, l[1]] : [l[0], url]));
    // `layers` and `front` are read for this decision only; the load handler does the swap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const onLoad = (i: Layer) => (e: SyntheticEvent<HTMLImageElement>) => {
    if (!wanted.current || e.currentTarget.getAttribute('src') !== wanted.current) return;
    setFront(i);
    setShown(true);
  };
  // A frame that will not load leaves the room on the default gradient, not on the last page's frame.
  const onError = (e: SyntheticEvent<HTMLImageElement>) => {
    if (e.currentTarget.getAttribute('src') === wanted.current) setShown(false);
  };

  return (
    <div className={`ambient ${styles.ambient}`} aria-hidden>
      {layers.map((src, n) => {
        const i = n as Layer;
        return src ? (
          <img
            key={i}
            ref={(el) => {
              imgs.current[i] = el;
            }}
            src={src}
            alt=""
            decoding="async"
            draggable={false}
            className={styles.ambientImage}
            data-shown={shown && front === i ? '' : undefined}
            onLoad={onLoad(i)}
            onError={onError}
          />
        ) : null;
      })}
    </div>
  );
}
