import { ChevronRight, Clapperboard, Download, Image as ImageIcon, Maximize2, Play, Scissors, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button as AriaButton, Disclosure, DisclosurePanel } from 'react-aria-components';

import type { Clip, Still } from '../api.ts';
import { litFromReference, lookLabel } from '../looks.ts';
import { locationName } from '../location.ts';
import { settingName } from '../surroundings.ts';
import {
  imageModelName,
  imageResolutionName,
  motionLabel,
  videoModelName,
  videoResolutionName,
} from '../models.ts';
import { recreateTitle } from '../recreate.ts';
import { clipAutoTags, normalizeTag, stillAutoTags } from '../tags.ts';
import { DeleteItemDialog, type DeleteTarget } from './DeleteItemDialog.tsx';
import { formatHash, type GoTo, type Handoff } from './handoff.ts';
import { Section } from './layouts/Section.tsx';
import { PHONE_QUERY, Workspace } from './layouts/Workspace.tsx';
import { clipPosterUrl, libraryUrl, NO_POSTER, stillThumbUrl, stillViewUrl, useDownload } from './lib/download.ts';
import { trpc } from './trpc.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { EmptyState } from './ui/EmptyState.tsx';
import { FilterChips } from './ui/FilterChips.tsx';
import { Lightbox } from './ui/Lightbox.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { Elapsed } from './ui/RenderingStatus.tsx';
import { RunwayErrorNotice } from './ui/RunwayErrorNotice.tsx';
import { SkeletonBlock } from './ui/Skeleton.tsx';
import { TagEditor, TagPicker } from './ui/TagEditor.tsx';
import { Text } from './ui/Text.tsx';
import { TextInput } from './ui/TextInput.tsx';
import { useHandoff } from './VideoPage.tsx';
import styles from './LibraryPage.module.css';

type Item =
  | { kind: 'still'; id: string; createdAt: string; still: Still; auto: string[]; tags: string[]; title: string; detail: string; text: string }
  | { kind: 'clip'; id: string; createdAt: string; clip: Clip; still: Still | undefined; auto: string[]; tags: string[]; title: string; detail: string; text: string };

const KINDS = [
  { id: 'all', name: 'All' },
  { id: 'still', name: 'Images' },
  { id: 'clip', name: 'Videos' },
] as const;

const PAGE = 24;
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

const keyOf = (it: Item) => `${it.kind}:${it.id}`;

/**
 * A machine-made batch id rather than a word: a test or job run's tag such as
 * `@g15-mvu1cm4w` (a base-36 timestamp after the prefix) or a matched-light
 * `@series-1a2b3c`. Its last part is six or more letters and digits mixed.
 */
const isBatchTag = (tag: string) => {
  const last = tag.split('-').pop() ?? '';
  return tag.includes('-') && last.length >= 6 && /[0-9]/.test(last) && /[a-z]/.test(last);
};
const isPending = (it: Item) => (it.kind === 'still' ? it.still.status === 'pending' : it.clip.status === 'pending');

/** Whether an item passes the kind, the picked tags and the search words (`@name` is a tag). */
function matches(it: Item, kind: string, picked: string[], query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const tagWords = words.filter((w) => w.startsWith('@')).map((w) => normalizeTag(w)).filter((t): t is string => !!t);
  const textWords = words.filter((w) => !w.startsWith('@'));
  if (kind !== 'all' && it.kind !== kind) return false;
  const all = [...it.tags, ...it.auto];
  if (!picked.every((t) => all.includes(t))) return false;
  if (!tagWords.every((t) => all.some((x) => x.startsWith(t)))) return false;
  return textWords.every((w) => it.text.includes(w));
}

/**
 * Every still and clip the visitor has made, newest first, with automatic
 * @tags (look, day/night, people, model) plus their own. Search matches
 * captions and tags; `@name` in the search box or a tag chip filters by tag.
 * A contact sheet fills the canvas; selecting a picture opens it in the
 * inspector, where it is tagged, downloaded or deleted.
 */
export function LibraryPage({
  active,
  handoff,
  onGoTo,
  onGoToStills,
}: {
  active: boolean;
  /** What the address asks for: a search (`q`), or a `still` or `clip` to select. */
  handoff?: Handoff | undefined;
  /** Opens another page with a selection loaded; with none, the address does it. */
  onGoTo?: GoTo | undefined;
  onGoToStills: () => void;
}) {
  const library = trpc.library.useQuery(undefined, {
    // Only while this tab is on screen; the tab making something polls it itself.
    refetchInterval: (q) =>
      active &&
      (q.state.data?.stills.some((s) => s.status === 'pending') ||
        q.state.data?.clips.some((c) => c.status === 'pending'))
        ? 10_000
        : false,
  });
  const [kind, setKind] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [shown, setShown] = useState(PAGE);
  const [zoom, setZoom] = useState<{ src: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /** The card the address named, until it has scrolled into view. */
  const [reveal, setReveal] = useState<string | null>(null);

  const items = useMemo<Item[]>(() => {
    const data = library.data;
    if (!data) return [];
    const stills: Item[] = data.stills
      .filter((s) => s.status !== 'failed')
      .map((s) => {
        const tags = s.tags ?? [];
        const auto = stillAutoTags(s);
        const title = stillTitle(s);
        const detail = `${imageModelName(s.imageModel)}, ${formatDate(s.createdAt)}`;
        return {
          kind: 'still',
          id: s.id,
          createdAt: s.createdAt,
          still: s,
          auto,
          tags,
          title,
          detail,
          text: [title, detail, s.direction, s.people, ...auto, ...tags].join(' ').toLowerCase(),
        };
      });
    const clips: Item[] = data.clips
      .filter((c) => c.status !== 'failed')
      .map((c) => {
        const still = data.stills.find((s) => s.id === c.stillId);
        const tags = c.tags ?? [];
        const auto = clipAutoTags(c, still);
        const title = clipTitle(c, still);
        const detail = `${videoModelName(c.videoModel)}, ${formatDate(c.createdAt)}`;
        return {
          kind: 'clip',
          id: c.id,
          createdAt: c.createdAt,
          clip: c,
          still,
          auto,
          tags,
          title,
          detail,
          text: [title, detail, c.direction, ...auto, ...tags].join(' ').toLowerCase(),
        };
      });
    return [...stills, ...clips].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [library.data]);

  // Every tag by use, most used first; machine batch ids fold into their own group.
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of items) for (const t of new Set([...it.tags, ...it.auto])) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [items]);
  const namedTags = useMemo(() => tagCounts.filter((t) => !isBatchTag(t.tag)), [tagCounts]);
  const batchTags = useMemo(() => tagCounts.filter((t) => isBatchTag(t.tag)), [tagCounts]);

  const filtered = useMemo(
    () => items.filter((it) => matches(it, kind, picked, query)),
    [items, kind, picked, query]
  );

  // The inspector shows the selected item while the filters keep it on the sheet.
  const current = selected === null ? undefined : filtered.find((it) => keyOf(it) === selected);

  const filtering = kind !== 'all' || picked.length > 0 || query.trim() !== '';
  const clear = () => {
    setKind('all');
    setPicked([]);
    setQuery('');
  };
  const addFilter = (t: string) => setPicked((p) => (p.includes(t) ? p : [...p, t]));
  const goTo: GoTo =
    onGoTo ??
    ((page, params) => {
      window.location.hash = formatHash(page, params);
    });

  // The address asks once, when the library can answer; after that the sheet
  // is the visitor's. The named item wins over any filter that would hide it.
  const address = useHandoff(handoff);
  const answered = useRef<Handoff | null>(null);
  const askedAgain = useRef<Handoff | null>(null);
  useEffect(() => {
    if (address.page !== 'library' || answered.current === address || library.isPending) return;
    const { q, still, clip } = address.params;
    const key = still ? `still:${still}` : clip ? `clip:${clip}` : null;
    const item = items.find((it) => keyOf(it) === key);
    // A link to something just made can outrun this list: ask once more before giving up on it.
    if (key && !item && askedAgain.current !== address) {
      askedAgain.current = address;
      void library.refetch();
      return;
    }
    answered.current = address;
    const search = q ?? query;
    if (q !== undefined) {
      setQuery(q);
      setShown(PAGE);
    }
    if (!key || !item) return;
    const fits = matches(item, kind, picked, search);
    if (!fits) clear();
    const list = fits ? items.filter((it) => matches(it, kind, picked, search)) : items;
    setShown((n) => Math.max(q === undefined ? n : PAGE, Math.ceil((list.indexOf(item) + 1) / PAGE) * PAGE));
    setSelected(key);
    setReveal(key);
  }, [address, items, library.dataUpdatedAt]);
  useEffect(() => {
    if (reveal) setReveal(null);
  }, [reveal]);

  const toolbar =
    items.length > 0 ? (
      <>
        <div className={styles.search}>
          <TextInput
            type="search"
            aria-label="Search the library"
            placeholder="Search or @tag"
            value={query}
            onChange={(v) => {
              setQuery(v);
              setShown(PAGE);
            }}
          />
        </div>
        <div className={styles.kind}>
          <FilterChips
            label="Show"
            options={KINDS}
            value={kind}
            onChange={(v) => {
              setKind(v);
              setShown(PAGE);
            }}
          />
        </div>
        {filtering && (
          <Button size="sm" variant="ghost" onPress={clear}>
            Clear filters
          </Button>
        )}
      </>
    ) : undefined;

  const sheet = library.isPending ? (
    <div className={styles.sheet}>
      <div className={styles.grid} aria-label="Loading your library">
        {Array.from({ length: 8 }, (_, i) => (
          <SkeletonBlock key={i} height={160} />
        ))}
      </div>
    </div>
  ) : library.error ? (
    <div className={styles.center}>
      <RunwayErrorNotice error={library.error} modelName="Runway" onRetry={() => void library.refetch()} />
    </div>
  ) : items.length === 0 ? (
    <div className={styles.center}>
      <EmptyState
        title="Nothing saved yet"
        hint="Make a still on the Stills tab, or animate one on the Video tab. Everything you make lands here."
        action={
          <Button variant="primary" icon={<ImageIcon size={16} />} onPress={onGoToStills}>
            Make a still
          </Button>
        }
      />
    </div>
  ) : (
    <div className={styles.sheet}>
      <p className={styles.summary}>
        {filtering
          ? `${filtered.length} of ${items.length} ${items.length === 1 ? 'item' : 'items'}`
          : `${items.length} ${items.length === 1 ? 'item' : 'items'}`}
      </p>
      {filtered.length === 0 ? (
        <EmptyState
          title="Nothing matches"
          hint="Try another word or tag, or clear the filters."
          action={<Button onPress={clear}>Clear filters</Button>}
        />
      ) : (
        <>
          <ul className={styles.grid} aria-label="Library items">
            {filtered.slice(0, shown).map((it) => (
              <LibraryCard
                key={keyOf(it)}
                item={it}
                selected={keyOf(it) === selected}
                reveal={keyOf(it) === reveal}
                onSelect={() => setSelected((s) => (s === keyOf(it) ? null : keyOf(it)))}
                onZoom={() => setZoom({ src: stillViewUrl(it.id), title: it.title })}
              />
            ))}
          </ul>
          {filtered.length > shown && (
            <Button className={styles.more} onPress={() => setShown((n) => n + PAGE)}>
              Show more ({filtered.length - shown} left)
            </Button>
          )}
        </>
      )}
    </div>
  );

  const inspector = (
    <>
      <PageHeader
        title="Library"
        description="Every image and video you make here is saved automatically. Tag them with @names to find them later."
      />
      {current ? (
        <ItemInspector
          key={keyOf(current)}
          item={current}
          onZoom={() => setZoom({ src: stillViewUrl(current.id), title: current.title })}
          onTag={addFilter}
          onDelete={() => setDeleting({ kind: current.kind, id: current.id, title: current.title })}
          onGoTo={goTo}
        />
      ) : (
        <Section title="Filter by tag">
          <div className={styles.filters}>
            <Text tone="muted" size="sm">
              {items.length > 0
                ? 'Select a picture to tag it, download it or delete it.'
                : 'Tags appear here once you make something.'}
            </Text>
            {namedTags.length > 0 && (
              <TagPicker
                label="Filter by tag"
                options={namedTags}
                selected={picked.filter((t) => !isBatchTag(t))}
                onChange={(t) => {
                  setPicked((p) => [...t, ...p.filter(isBatchTag)]);
                  setShown(PAGE);
                }}
              />
            )}
            {batchTags.length > 0 && (
              <Disclosure className={styles.batches} defaultExpanded={picked.some(isBatchTag)}>
                <AriaButton slot="trigger" className={styles.batchesTrigger}>
                  <ChevronRight size={14} aria-hidden className={styles.batchesChevron} />
                  Batches
                  <span className={styles.batchesCount}>{batchTags.length}</span>
                </AriaButton>
                <DisclosurePanel>
                  <TagPicker
                    label="Filter by batch"
                    options={batchTags}
                    selected={picked.filter(isBatchTag)}
                    onChange={(t) => {
                      setPicked((p) => [...p.filter((x) => !isBatchTag(x)), ...t]);
                      setShown(PAGE);
                    }}
                  />
                </DisclosurePanel>
              </Disclosure>
            )}
          </div>
        </Section>
      )}
    </>
  );

  return (
    <>
      <Workspace
        page="library"
        canvasState="free"
        canvas={sheet}
        canvasToolbar={toolbar}
        inspector={inspector}
        raiseSheet={selected}
      />
      <Lightbox
        src={zoom?.src ?? null}
        alt={zoom?.title ?? ''}
        title={zoom?.title ?? ''}
        onClose={() => setZoom(null)}
      />
      <DeleteItemDialog target={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}

/**
 * One picture on the contact sheet: the whole card selects it (a toggle); a
 * still keeps its zoom button, a clip its play button (Phase 9 clip cards:
 * the poster until it is pressed, then the player with its controls).
 */
function LibraryCard({
  item,
  selected,
  reveal,
  onSelect,
  onZoom,
}: {
  item: Item;
  selected: boolean;
  /** Scroll to this card: the address named it. */
  reveal: boolean;
  onSelect: () => void;
  onZoom: () => void;
}) {
  const pending = isPending(item);
  const card = useRef<HTMLLIElement>(null);
  useEffect(() => {
    // On a phone the sheet rises over the lower half, so the card goes above it.
    if (reveal) card.current?.scrollIntoView({ block: window.matchMedia(PHONE_QUERY).matches ? 'start' : 'center' });
  }, [reveal]);
  // Thumbnails share one frame so the grid reads as a contact sheet; a
  // portrait take is shown whole inside it rather than cropped.
  const portrait = item.still ? item.still.height > item.still.width : false;

  return (
    <li ref={card} className={styles.card}>
      <button type="button" className={styles.select} aria-pressed={selected} aria-label={item.title} onClick={onSelect}>
        <span className={styles.media} data-portrait={portrait || undefined}>
          <ItemPicture item={item} pending={pending} />
          <span className={styles.badge} aria-hidden>
            {item.kind === 'still' ? <ImageIcon size={12} /> : <Clapperboard size={12} />}
          </span>
        </span>
        <span className={styles.caption}>{item.title}</span>
      </button>
      {!pending && (
        <span className={styles.over}>
          {item.kind === 'still' ? (
            <button type="button" className={styles.zoom} onClick={onZoom} aria-label={`View ${item.title} full size`}>
              <Maximize2 size={14} aria-hidden />
            </button>
          ) : (
            <ClipPlayer item={item} />
          )}
        </span>
      )}
    </li>
  );
}

/** How long it has been, in a line that stands still: the coarse clock for reduced motion. */
function standingElapsed(since: number): string {
  const minutes = Math.floor((Date.now() - since) / 60_000);
  return minutes < 1 ? 'under a minute' : `${minutes} min`;
}

/** The still, or the clip's poster (its own, else its still's, else the plain tile). */
function ItemPicture({ item, pending }: { item: Item; pending: boolean }) {
  if (pending) {
    const since = Date.parse(item.createdAt);
    return (
      <span className={styles.pending}>
        <Text tone="muted" size="sm">
          Rendering…{' '}
          {/* A ticking clock would be read out every second. */}
          <span aria-hidden>
            {window.matchMedia(REDUCED_MOTION).matches ? standingElapsed(since) : <Elapsed since={since} />}
          </span>
        </Text>
      </span>
    );
  }
  const src =
    item.kind === 'still'
      ? stillThumbUrl(item.id)
      : // `item.still` is the clip's still while that is in the library.
        (clipPosterUrl(item.clip, { has: (id) => id === item.still?.id }) ?? NO_POSTER);
  return <img src={src} alt="" loading="lazy" decoding="async" className={styles.img} />;
}

/** A clip's play button; once pressed, the player takes the poster's place and plays. */
function ClipPlayer({ item }: { item: Extract<Item, { kind: 'clip' }> }) {
  const [playing, setPlaying] = useState(false);
  return playing ? (
    <video
      className={styles.player}
      src={libraryUrl('clip', item.id)}
      poster={clipPosterUrl(item.clip, { has: (id) => id === item.still?.id }) ?? NO_POSTER}
      controls
      autoPlay
      playsInline
      aria-label={item.title}
    />
  ) : (
    <button type="button" className={styles.play} onClick={() => setPlaying(true)} aria-label={'Play ' + item.title}>
      <Play size={18} aria-hidden />
    </button>
  );
}

/** The selected item in the inspector: its picture, tags, and what can be done with it. */
function ItemInspector({
  item,
  onZoom,
  onTag,
  onDelete,
  onGoTo,
}: {
  item: Item;
  onZoom: () => void;
  onTag: (tag: string) => void;
  onDelete: () => void;
  onGoTo: GoTo;
}) {
  const saver = useDownload();
  const utils = trpc.useUtils();
  const setTags = trpc.setTags.useMutation({
    onMutate: async ({ kind, id, tags }) => {
      await utils.library.cancel();
      const before = utils.library.getData();
      utils.library.setData(undefined, (lib) =>
        lib &&
        (kind === 'still'
          ? { ...lib, stills: lib.stills.map((s) => (s.id === id ? { ...s, tags } : s)) }
          : { ...lib, clips: lib.clips.map((c) => (c.id === id ? { ...c, tags } : c)) })
      );
      return { before };
    },
    onError: (_err, _input, context) => {
      if (context?.before) utils.library.setData(undefined, context.before);
    },
    onSettled: () => void utils.library.invalidate(),
  });
  const pending = isPending(item);
  const filename = item.kind === 'still' ? `film-still-${fileSlug(stillTitle(item.still))}.png` : `film-clip-${item.id.slice(0, 8)}.mp4`;
  const portrait = item.still ? item.still.height > item.still.width : false;

  return (
    <Section title="Item">
      <div className={styles.item}>
        <div className={styles.preview} data-portrait={portrait || undefined}>
          <ItemPicture item={item} pending={pending} />
          {!pending && item.kind === 'clip' && (
            <span className={styles.over}>
              <ClipPlayer item={item} />
            </span>
          )}
        </div>
        <div className={styles.itemText}>
          <p className={styles.itemTitle}>{item.title}</p>
          <Text tone="muted" size="sm">
            {item.kind === 'still' ? 'Image' : 'Video'}, {item.detail}
          </Text>
        </div>
        <div className={styles.itemTags}>
          <TagEditor
            label={item.title}
            tags={item.tags}
            onChange={(tags) => setTags.mutate({ kind: item.kind, id: item.id, tags })}
          />
          <div className={styles.saveState} aria-live="polite">
            {setTags.isPending ? (
              <Text tone="muted" size="sm">
                Saving…
              </Text>
            ) : setTags.error ? (
              <Text size="sm" className={styles.saveError}>
                Couldn't save tags: {setTags.error.message}
              </Text>
            ) : setTags.isSuccess ? (
              <Text tone="muted" size="sm">
                Saved
              </Text>
            ) : null}
          </div>
        </div>
        {item.auto.length > 0 && (
          <div className={styles.autoTags} role="group" aria-label="Automatic tags">
            {item.auto.map((t) => (
              <button key={t} type="button" className={styles.autoTag} onClick={() => onTag(t)} aria-label={`Filter by @${t}`}>
                @{t}
              </button>
            ))}
          </div>
        )}
        {!pending && (
          <div className={styles.itemActions}>
            <Button
              icon={<Download size={16} />}
              aria-label={saver.pending ? saver.label(`Download ${item.title}`) : `Download ${item.title}`}
              loading={saver.pending}
              onPress={() => saver.start(libraryUrl(item.kind, item.id), filename)}
            >
              {saver.pending ? saver.label('Download') : 'Download'}
            </Button>
            {item.kind === 'still' && (
              <Button icon={<Maximize2 size={16} />} onPress={onZoom}>
                View full size
              </Button>
            )}
            {item.kind === 'still' ? (
              <Button icon={<Clapperboard size={16} />} onPress={() => onGoTo('video', { still: item.id })}>
                Make a video
              </Button>
            ) : (
              <Button icon={<Scissors size={16} />} onPress={() => onGoTo('edit', { clip: item.id })}>
                Open in Editing
              </Button>
            )}
            <Button variant="ghost" icon={<Trash2 size={16} />} aria-label={`Delete ${item.title}`} onPress={onDelete}>
              Delete
            </Button>
          </div>
        )}
        {saver.error && (
          <Alert tone="error" title="Download failed">
            {saver.error}
          </Alert>
        )}
      </div>
    </Section>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function stillTitle(s: Still): string {
  const res = imageResolutionName(s.imageModel, s.resolution);
  const size = s.upscaleOf ? `, upscaled ${s.scale ?? ''}×` : res ? `, ${res}` : '';
  if (s.location) return `Location: ${locationName(s.location)}${size}`;
  if (s.surroundings) return `Surroundings: ${settingName(s.surroundings.setting)}${size}`;
  if (s.storyboard) return `Storyboard ${s.storyboard.order}: ${s.storyboard.title}${size}`;
  const look = lookLabel(s.look, litFromReference(s));
  return `${look}${s.crowd !== 'none' ? ', people' : ''}${size}`;
}

/** The still a clip was made from, named the way its library card names it. */
function sourceName(s: Still): string {
  if (s.location) return locationName(s.location);
  if (s.surroundings) return settingName(s.surroundings.setting);
  if (s.storyboard) return s.storyboard.title;
  return lookLabel(s.look, litFromReference(s));
}

function fileSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'still';
}

function clipTitle(c: Clip, still: Still | undefined): string {
  if (c.recreate) return recreateTitle(c.recreate);
  const look = still ? sourceName(still) : '';
  const motion = motionLabel(c.motion, c.moveStyle, c.speed);
  const res = videoResolutionName(c.videoModel, c.resolution);
  const base = [look, motion].filter(Boolean).join(', ') || 'Clip';
  return c.upscaleOf ? `${base}, upscaled ${c.scale ?? ''}×` : res ? `${base}, ${res}` : base;
}
