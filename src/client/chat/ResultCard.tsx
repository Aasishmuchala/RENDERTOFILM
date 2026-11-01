import { ImageOff } from 'lucide-react';
import { useState } from 'react';

import type { Handoff } from '../handoff.ts';
import { libraryUrl, stillThumbUrl } from '../lib/download.ts';
import { Button } from '../ui/Button.tsx';
import styles from './ResultCard.module.css';

export type ResultKind = 'still' | 'clip' | 'edit';

export type ResultItem = {
  id: string;
  name: string;
  /**
   * A film's file (`ExportJob.finalId`). Its `id` is the export's, which opens
   * Editing but names no file, so without this a film shows no frame.
   */
  mediaId?: string | undefined;
};

export type ResultCardProps = {
  kind: ResultKind;
  items: ResultItem[];
  onOpen: (handoff: Handoff) => void;
  onKeep?: ((id: string) => void) | undefined;
  onDiscard?: ((id: string) => void) | undefined;
};

const NOUNS: Record<ResultKind, [one: string, many: string]> = {
  still: ['still', 'stills'],
  clip: ['clip', 'clips'],
  edit: ['film', 'films'],
};

/**
 * One picture in a card, or a video's first frame. A picture that fails hands
 * over to `fallback`, a video of the same thing; a file that has gone leaves a
 * quiet frame, not a broken image.
 */
export function Thumb({
  src,
  alt,
  video = false,
  fallback,
  className,
}: {
  src: string;
  alt: string;
  video?: boolean | undefined;
  fallback?: string | undefined;
  className?: string | undefined;
}) {
  const [gone, setGone] = useState(false);
  const frame = [styles.thumb, className].filter(Boolean).join(' ');
  if (gone && fallback) return <Thumb src={fallback} alt={alt} video className={className} />;
  if (gone) {
    return (
      <span className={`${frame} ${styles.gone}`} role="img" aria-label={alt}>
        <ImageOff size={16} aria-hidden />
      </span>
    );
  }
  return video ? (
    <video className={frame} src={src} aria-label={alt} preload="metadata" muted playsInline onError={() => setGone(true)} />
  ) : (
    <img className={frame} src={src} alt={alt} loading="lazy" onError={() => setGone(true)} />
  );
}

/** Where one result can go, best first. */
export function resultOpens(kind: ResultKind, id: string): { label: string; handoff: Handoff }[] {
  if (kind === 'still') {
    return [
      { label: 'Open in Video', handoff: { page: 'video', params: { still: id } } },
      { label: 'Open in Library', handoff: { page: 'library', params: { still: id } } },
    ];
  }
  if (kind === 'clip') {
    return [
      { label: 'Open in Editing', handoff: { page: 'edit', params: { clip: id } } },
      { label: 'Open in Library', handoff: { page: 'library', params: { clip: id } } },
    ];
  }
  return [{ label: 'Open in Editing', handoff: { page: 'edit', params: { export: id } } }];
}

/**
 * What a tile shows, or null when the item names no file. Only a clip from an
 * uploaded image has a poster, so a Run's clips show their own first frame.
 */
function mediaOf(kind: ResultKind, { id, mediaId }: ResultItem) {
  if (kind === 'still') return { src: stillThumbUrl(id) };
  if (kind === 'clip') return { src: `${libraryUrl('clip', id)}?poster`, fallback: libraryUrl('clip', id) };
  return mediaId ? { src: libraryUrl('edit', mediaId), video: true } : null;
}

/** What a Run made, pictures first: each one with the pages it can go on to. */
export function ResultCard({ kind, items, onOpen, onKeep, onDiscard }: ResultCardProps) {
  const [one, many] = NOUNS[kind];
  const title = `${items.length} ${items.length === 1 ? one : many}`;
  return (
    <div className={styles.card} role="group" aria-label={title}>
      <p className={styles.title}>{title}</p>
      <ul className={styles.grid}>
        {items.map((item) => {
          const media = mediaOf(kind, item);
          return (
            <li key={item.id} className={styles.tile}>
              {media && <Thumb {...media} alt={item.name} />}
              <span className={styles.name} title={item.name}>
                {item.name}
              </span>
              {resultOpens(kind, item.id).map((open, i) => (
                <Button
                  key={open.label}
                  variant={i === 0 ? 'default' : 'ghost'}
                  size="sm"
                  aria-label={`${open.label}: ${item.name}`}
                  onPress={() => onOpen(open.handoff)}
                >
                  {open.label}
                </Button>
              ))}
              {(onKeep || onDiscard) && (
                <div className={styles.verdict}>
                  {onKeep && (
                    <Button variant="ghost" size="sm" aria-label={`Keep ${item.name}`} onPress={() => onKeep(item.id)}>
                      Keep
                    </Button>
                  )}
                  {onDiscard && (
                    <Button variant="ghost" size="sm" aria-label={`Discard ${item.name}`} onPress={() => onDiscard(item.id)}>
                      Discard
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
