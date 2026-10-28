import { Clapperboard, Download, Image as ImageIcon, Maximize2, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

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
import { clipAutoTags, normalizeTag, stillAutoTags } from '../tags.ts';
import { DeleteItemDialog, type DeleteTarget } from './DeleteItemDialog.tsx';
import { Section } from './layouts/Section.tsx';
import { libraryUrl, stillThumbUrl, stillViewUrl, useDownload } from './lib/download.ts';
import { trpc } from './trpc.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { EmptyState } from './ui/EmptyState.tsx';
import { FilterChips } from './ui/FilterChips.tsx';
import { Lightbox } from './ui/Lightbox.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { RunwayErrorNotice } from './ui/RunwayErrorNotice.tsx';
import { SkeletonBlock } from './ui/Skeleton.tsx';
import { TagEditor, TagPicker } from './ui/TagEditor.tsx';
import { Text } from './ui/Text.tsx';
import { TextInput } from './ui/TextInput.tsx';
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

/**
 * Every still and clip the visitor has made, newest first, with automatic
 * @tags (look, day/night, people, model) plus their own. Search matches
 * captions and tags; `@name` in the search box or a tag chip filters by tag.
 */
export function LibraryPage({ active, onGoToStills }: { active: boolean; onGoToStills: () => void }) {
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

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of items) for (const t of new Set([...it.tags, ...it.auto])) counts.set(t, (counts.get(t) ?? 0) + 1);
    // The visitor's own tags first, then the automatic ones, each by use.
    const own = new Set(items.flatMap((it) => it.tags));
    return [...counts]
      .map(([tag, count]) => ({ tag, count, own: own.has(tag) }))
      .sort((a, b) => Number(b.own) - Number(a.own) || b.count - a.count || a.tag.localeCompare(b.tag));
  }, [items]);

  const filtered = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const tagWords = words.filter((w) => w.startsWith('@')).map((w) => normalizeTag(w)).filter((t): t is string => !!t);
    const textWords = words.filter((w) => !w.startsWith('@'));
    return items.filter((it) => {
      if (kind !== 'all' && it.kind !== kind) return false;
      const all = [...it.tags, ...it.auto];
      if (!picked.every((t) => all.includes(t))) return false;
      if (!tagWords.every((t) => all.some((x) => x.startsWith(t)))) return false;
      return textWords.every((w) => it.text.includes(w));
    });
  }, [items, kind, picked, query]);

  const filtering = kind !== 'all' || picked.length > 0 || query.trim() !== '';
  const clear = () => {
    setKind('all');
    setPicked([]);
    setQuery('');
  };

  return (
    <div className={styles.screen}>
      <PageHeader
        title="Library"
        description="Every image and video you make here is saved automatically. Tag them with @names to find them later."
      />
      <Section label="The library">
        {library.isPending ? (
          <div className={styles.grid} aria-label="Loading your library">
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonBlock key={i} height={200} />
            ))}
          </div>
        ) : library.error ? (
          <RunwayErrorNotice error={library.error} modelName="Runway" onRetry={() => void library.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title="Nothing saved yet"
            hint="Make a still on the Stills tab, or animate one on the Video tab. Everything you make lands here."
            action={
              <Button variant="primary" icon={<ImageIcon size={16} />} onPress={onGoToStills}>
                Make a still
              </Button>
            }
          />
        ) : (
          <div className={styles.page}>
            <div className={styles.toolbar}>
              <div className={styles.search}>
                <TextInput
                  type="search"
                  aria-label="Search the library"
                  placeholder="Search, or type @tag"
                  value={query}
                  onChange={(v) => {
                    setQuery(v);
                    setShown(PAGE);
                  }}
                />
              </div>
              <FilterChips
                label="Show"
                options={KINDS}
                value={kind}
                onChange={(v) => {
                  setKind(v);
                  setShown(PAGE);
                }}
              />
              {tagCounts.length > 0 && (
                <div className={styles.tags}>
                  <TagPicker
                    label="Filter by tag"
                    options={tagCounts}
                    selected={picked}
                    onChange={(t) => {
                      setPicked(t);
                      setShown(PAGE);
                    }}
                  />
                </div>
              )}
            </div>
            <div className={styles.summary}>
              <Text tone="muted" size="sm">
                {filtering
                  ? `${filtered.length} of ${items.length} ${items.length === 1 ? 'item' : 'items'}`
                  : `${items.length} ${items.length === 1 ? 'item' : 'items'}`}
              </Text>
              {filtering && (
                <Button size="sm" variant="ghost" onPress={clear}>
                  Clear filters
                </Button>
              )}
            </div>
            {filtered.length === 0 ? (
              <EmptyState
                title="Nothing matches"
                hint="Try another word or tag, or clear the filters."
                action={<Button onPress={clear}>Clear filters</Button>}
              />
            ) : (
              <>
                <div className={styles.grid}>
                  {filtered.slice(0, shown).map((it) => (
                    <LibraryCard
                      key={`${it.kind}:${it.id}`}
                      item={it}
                      onZoom={() => setZoom({ src: stillViewUrl(it.id), title: it.title })}
                      onTag={(t) => setPicked((p) => (p.includes(t) ? p : [...p, t]))}
                      onDelete={() => setDeleting({ kind: it.kind, id: it.id, title: it.title })}
                    />
                  ))}
                </div>
                {filtered.length > shown && (
                  <Button className={styles.more} onPress={() => setShown((n) => n + PAGE)}>
                    Show more ({filtered.length - shown} left)
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </Section>
      <Lightbox
        src={zoom?.src ?? null}
        alt={zoom?.title ?? ''}
        title={zoom?.title ?? ''}
        onClose={() => setZoom(null)}
      />
      <DeleteItemDialog target={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

function LibraryCard({
  item,
  onZoom,
  onTag,
  onDelete,
}: {
  item: Item;
  onZoom: () => void;
  onTag: (tag: string) => void;
  onDelete: () => void;
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
  const pending = item.kind === 'still' ? item.still.status === 'pending' : item.clip.status === 'pending';
  const filename = item.kind === 'still' ? `film-still-${fileSlug(stillTitle(item.still))}.png` : `film-clip-${item.id.slice(0, 8)}.mp4`;
  // Thumbnails share one landscape frame so the grid reads as a contact
  // sheet; a portrait take is shown whole inside it rather than cropped.
  const portrait = item.still ? item.still.height > item.still.width : false;

  return (
    <figure className={styles.card}>
      <div className={styles.media} data-portrait={portrait || undefined}>
        {pending ? (
          <div className={styles.pending}>
            <SkeletonBlock height="100%" />
            <span className={styles.pendingLabel}>
              <Text tone="muted" size="sm">
                Still rendering…
              </Text>
            </span>
          </div>
        ) : item.kind === 'still' ? (
          <button type="button" className={styles.zoom} onClick={onZoom} aria-label={`View ${item.title} full size`}>
            <img src={stillThumbUrl(item.id)} alt={item.title} loading="lazy" decoding="async" className={styles.img} />
            <span className={styles.zoomIcon} aria-hidden>
              <Maximize2 size={14} />
            </span>
          </button>
        ) : (
          <video
            className={styles.img}
            src={libraryUrl('clip', item.id)}
            poster={item.still ? stillThumbUrl(item.still.id) : undefined}
            controls
            playsInline
            preload="none"
            aria-label={item.title}
          />
        )}
        <span className={styles.badge} aria-hidden>
          {item.kind === 'still' ? <ImageIcon size={12} /> : <Clapperboard size={12} />}
        </span>
      </div>
      <figcaption className={styles.caption}>
        <div className={styles.titleRow}>
          <div className={styles.titleText}>
            <Text size="sm">{item.title}</Text>
            <Text tone="muted" size="sm">
              {item.detail}
            </Text>
          </div>
          {!pending && (
            <span className={styles.cardActions}>
              <Button
                size="sm"
                variant="ghost"
                icon={<Download size={14} />}
                aria-label={saver.pending ? saver.label(`Download ${item.title}`) : `Download ${item.title}`}
                loading={saver.pending}
                onPress={() => saver.start(libraryUrl(item.kind, item.id), filename)}
              />
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 size={14} />}
                aria-label={`Delete ${item.title}`}
                onPress={onDelete}
              />
            </span>
          )}
        </div>
        <div className={styles.autoTags} aria-label="Automatic tags">
          {item.auto.map((t) => (
            <button key={t} type="button" className={styles.autoTag} onClick={() => onTag(t)} aria-label={`Filter by @${t}`}>
              @{t}
            </button>
          ))}
        </div>
        <TagEditor
          label={item.title}
          tags={item.tags}
          onChange={(tags) => setTags.mutate({ kind: item.kind, id: item.id, tags })}
        />
        {saver.error && (
          <Alert tone="error" title="Download failed">
            {saver.error}
          </Alert>
        )}
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
      </figcaption>
    </figure>
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
  const look = still ? sourceName(still) : '';
  const motion = motionLabel(c.motion, c.moveStyle, c.speed);
  const res = videoResolutionName(c.videoModel, c.resolution);
  const base = [look, motion].filter(Boolean).join(', ') || 'Clip';
  return c.upscaleOf ? `${base}, upscaled ${c.scale ?? ''}×` : res ? `${base}, ${res}` : base;
}
