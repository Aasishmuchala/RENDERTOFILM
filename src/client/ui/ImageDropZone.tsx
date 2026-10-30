import { ImageUp } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Button as AriaButton,
  DropZone,
  FileTrigger,
} from 'react-aria-components';

import styles from './ImageDropZone.module.css';

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

export type ImageDropZoneProps = {
  onFile?: ((file: File) => void) | undefined;
  /** Take several images at once (dropped or picked); `onFile` is then unused. */
  onFiles?: ((files: File[]) => void) | undefined;
  disabled?: boolean | undefined;
  /** Shown inside the zone (the current image); the prompt overlays it. */
  children?: ReactNode | undefined;
  /** Label of the pick-a-file button; defaults to "Replace render". */
  actionLabel?: string | undefined;
  /** The drop zone's accessible name, naming the task ("Drop or choose the source render"). */
  label?: string | undefined;
};

/** Drop an image on it, or press it to pick one (or several, with `onFiles`). PNG, JPEG or WebP. */
export function ImageDropZone({
  onFile,
  onFiles,
  disabled = false,
  children,
  actionLabel = 'Replace render',
  label = 'Drop an image here',
}: ImageDropZoneProps) {
  return (
    <DropZone
      aria-label={label}
      className={styles.zone}
      isDisabled={disabled}
      getDropOperation={(types) =>
        ACCEPTED.some((t) => types.has(t)) ? 'copy' : 'cancel'
      }
      onDrop={async (e) => {
        const files: File[] = [];
        for (const item of e.items) {
          if (item.kind === 'file' && ACCEPTED.includes(item.type)) {
            files.push(await item.getFile());
            if (!onFiles) break;
          }
        }
        if (files.length === 0) return;
        if (onFiles) onFiles(files);
        else onFile?.(files[0]!);
      }}
    >
      {children}
      <FileTrigger
        acceptedFileTypes={ACCEPTED}
        allowsMultiple={onFiles !== undefined}
        onSelect={(files) => {
          const picked = files ? Array.from(files) : [];
          if (picked.length === 0) return;
          if (onFiles) onFiles(picked);
          else onFile?.(picked[0]!);
        }}
      >
        <AriaButton className={styles.trigger} isDisabled={disabled}>
          <ImageUp size={14} aria-hidden />
          {actionLabel}
        </AriaButton>
      </FileTrigger>
    </DropZone>
  );
}
