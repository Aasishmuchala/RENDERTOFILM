import { useState } from 'react';
import { GalleryHorizontal, LoaderCircle, RotateCcw, SunMedium, Trash2 } from 'lucide-react';

import { classifyRunwayError, errorMessage } from './lib/runwayErrors.ts';
import type { CastSheet } from './CastSheetField.tsx';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { ImageDropZone } from './ui/ImageDropZone.tsx';
import { ImagePicker, type ImagePickerItem } from './ui/ImagePicker.tsx';
import { RunwayErrorNotice } from './ui/RunwayErrorNotice.tsx';
import { SkeletonBlock } from './ui/Skeleton.tsx';
import { Text } from './ui/Text.tsx';
import styles from './Studio.module.css';

export type LightReferenceFieldProps = {
  /** Same shape as a cast sheet: a local preview, and its hosted URL once uploaded. */
  image: CastSheet | null;
  uploading: boolean;
  /** The upload failure (the route's body or an Error), shown beside the zone. */
  error: unknown;
  /** Set while an area is marked: the rest of the frame keeps the render's light. */
  lockedReason?: string | undefined;
  modelName: string;
  disabled?: boolean | undefined;
  onFile: (file: File) => void;
  onRemove: () => void;
  /** Finished stills whose light can be matched, newest first. */
  stills: readonly ImagePickerItem[];
  /** The library behind `stills` is still loading. */
  stillsLoading?: boolean | undefined;
  /** Why the library could not be loaded, when it could not. */
  stillsError?: unknown;
  onRetryStills?: (() => void) | undefined;
  /** The still being matched, when the reference is one of the visitor's stills. */
  matched: ImagePickerItem | null;
  onMatch: (stillId: string | null) => void;
};

/**
 * The optional lighting reference in the Look step: a photo whose light the
 * still copies, and nothing else from it. While one is in, the look presets
 * are switched off.
 */
export function LightReferenceField({
  image,
  uploading,
  error,
  lockedReason,
  modelName,
  disabled = false,
  onFile,
  onRemove,
  stills,
  stillsLoading = false,
  stillsError,
  onRetryStills,
  matched,
  onMatch,
}: LightReferenceFieldProps) {
  const locked = disabled || uploading || lockedReason !== undefined;
  const [picking, setPicking] = useState(false);
  if (matched) {
    return (
      <div className={styles.lightRef}>
        <div className={styles.castHead}>
          <Text as="span" size="sm" className={styles.castTitle}>
            Lighting reference: one of your stills
          </Text>
          <Text tone="muted" size="sm" as="p">
            Every view you shoot now gets this still&rsquo;s exact light, for a matching series. Swap the render in step 1 for each view.
          </Text>
        </div>
        <div className={styles.castBody}>
          <figure className={styles.castThumb}>
            <img
              className={styles.image}
              src={matched.src}
              alt={`Matching the light of ${matched.alt}`}
              data-dimmed={lockedReason ? '' : undefined}
            />
          </figure>
          <div className={styles.castSide}>
            <Text tone="muted" size="sm" as="p" className={styles.castName}>
              {matched.caption}
            </Text>
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 size={14} />}
              disabled={disabled}
              onPress={() => onMatch(null)}
              aria-label="Stop matching this still's light"
            >
              Stop matching
            </Button>
          </div>
        </div>
        {lockedReason && (
          <Text tone="muted" size="sm" as="p">
            {lockedReason}
          </Text>
        )}
      </div>
    );
  }
  return (
    <div className={styles.lightRef}>
      <div className={styles.castHead}>
        <Text as="span" size="sm" className={styles.castTitle}>
          Lighting reference (optional)
        </Text>
        <Text tone="muted" size="sm" as="p">
          A photo whose light to match: time of day, sun, shadows, sky and grade. Nothing else in it is copied.
        </Text>
      </div>

      <div className={styles.castBody}>
        <div className={styles.castZone}>
          <ImageDropZone
            onFile={onFile}
            disabled={locked}
            actionLabel={image ? 'Replace' : 'Choose photo'}
            label="Drop or choose a lighting reference"
          >
            {image ? (
              <figure className={styles.castThumb}>
                <img
                  className={styles.image}
                  src={image.src}
                  alt={`Lighting reference: ${image.name}`}
                  data-dimmed={uploading || lockedReason ? '' : undefined}
                />
                {uploading && (
                  <span className={styles.castLoader} role="status">
                    <LoaderCircle size={18} className={styles.castSpin} aria-hidden />
                    <span>Uploading…</span>
                  </span>
                )}
              </figure>
            ) : (
              <div className={styles.castEmpty}>
                {uploading ? (
                  <LoaderCircle size={18} className={styles.castSpin} aria-hidden />
                ) : (
                  <SunMedium size={18} aria-hidden />
                )}
                <span>{uploading ? 'Uploading…' : 'Drop a lighting photo here'}</span>
              </div>
            )}
          </ImageDropZone>
        </div>

        <div className={styles.castSide}>
          {image && (
            <>
              <Text tone="muted" size="sm" as="p" className={styles.castName}>
                {image.name}
              </Text>
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 size={14} />}
                disabled={disabled || uploading}
                onPress={onRemove}
                aria-label="Remove lighting reference"
              >
                Remove
              </Button>
            </>
          )}
        </div>
      </div>

      {!image && (
        <div className={styles.lightPick}>
          {picking ? (
            <>
              {stills.length > 0 ? (
                <ImagePicker
                  label="Match the light of one of your stills"
                  items={stills}
                  value={null}
                  onChange={(id) => {
                    setPicking(false);
                    onMatch(id);
                  }}
                  disabled={locked}
                />
              ) : stillsLoading ? (
                <div role="status" aria-live="polite">
                  <Text tone="muted" size="sm" as="p">
                    Loading your stills…
                  </Text>
                  <SkeletonBlock height={72} />
                </div>
              ) : stillsError != null ? (
                <>
                  <Alert tone="error" title="Your stills could not be loaded">
                    {errorMessage(stillsError)}
                  </Alert>
                  {onRetryStills && (
                    <Button size="sm" icon={<RotateCcw size={14} />} onPress={onRetryStills}>
                      Try again
                    </Button>
                  )}
                </>
              ) : (
                <Text tone="muted" size="sm" as="p">
                  No finished stills yet. Make one, then match the next views to its light.
                </Text>
              )}
              <Button size="sm" variant="ghost" onPress={() => setPicking(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              icon={<GalleryHorizontal size={14} />}
              disabled={locked}
              onPress={() => setPicking(true)}
            >
              Match one of your stills
            </Button>
          )}
        </div>
      )}
      {lockedReason && image && (
        <Text tone="muted" size="sm" as="p">
          {lockedReason}
        </Text>
      )}
      {error != null &&
        (classifyRunwayError(error).signIn || classifyRunwayError(error).consent ? (
          <RunwayErrorNotice error={error} modelName={modelName} />
        ) : (
          <Alert tone="error" title="The lighting reference didn't upload">
            {errorMessage(error)}
          </Alert>
        ))}
    </div>
  );
}
