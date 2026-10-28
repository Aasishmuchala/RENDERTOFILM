import { LoaderCircle, Trash2, Users } from 'lucide-react';

import { classifyRunwayError, errorMessage } from './lib/runwayErrors.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { ImageDropZone } from './ui/ImageDropZone.tsx';
import { RunwayErrorNotice } from './ui/RunwayErrorNotice.tsx';
import { Text } from './ui/Text.tsx';
import styles from './Studio.module.css';

/** The cast sheet the visitor picked: a local preview, and its hosted URL once uploaded. */
export type CastSheet = {
  src: string;
  name: string;
  hostedUrl?: string | undefined;
};

export type CastSheetFieldProps = {
  sheet: CastSheet | null;
  uploading: boolean;
  /** The upload failure (the route's body or an Error), shown beside the zone. */
  error: unknown;
  /** False when the chosen image model takes only the render. */
  supported: boolean;
  modelName: string;
  /** Up to two models that do take a cast sheet. */
  alternatives: readonly string[];
  disabled?: boolean | undefined;
  onFile: (file: File) => void;
  onRemove: () => void;
};

/**
 * The optional second drop zone in the People section: photos of the people
 * to cast. Smaller than the render's zone, with a thumbnail and Remove once
 * uploaded, and a plain notice when the model can't take it.
 */
export function CastSheetField({
  sheet,
  uploading,
  error,
  supported,
  modelName,
  alternatives,
  disabled = false,
  onFile,
  onRemove,
}: CastSheetFieldProps) {
  const locked = disabled || uploading || !supported;
  return (
    <div className={styles.cast}>
      <div className={styles.castHead}>
        <Text as="span" size="sm" className={styles.castTitle}>
          Cast sheet (optional)
        </Text>
        <Text tone="muted" size="sm" as="p">
          Photos of the people to cast; their faces, build and clothing are matched
        </Text>
      </div>

      <div className={styles.castBody}>
        <div className={styles.castZone}>
          <ImageDropZone
            onFile={onFile}
            disabled={locked}
            actionLabel={sheet ? 'Replace' : 'Choose photo'}
          >
            {sheet ? (
              <figure className={styles.castThumb}>
                <img
                  className={styles.image}
                  src={sheet.src}
                  alt={`Cast sheet: ${sheet.name}`}
                  data-dimmed={uploading || !supported ? '' : undefined}
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
                  <Users size={18} aria-hidden />
                )}
                <span>{uploading ? 'Uploading…' : 'Drop a cast sheet here'}</span>
              </div>
            )}
          </ImageDropZone>
        </div>

        <div className={styles.castSide}>
          {sheet && (
            <>
              <Text tone="muted" size="sm" as="p" className={styles.castName}>
                {sheet.name}
              </Text>
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 size={14} />}
                disabled={disabled || uploading}
                onPress={onRemove}
                aria-label="Remove cast sheet"
              >
                Remove
              </Button>
            </>
          )}
        </div>
      </div>

      {!supported && (
        <Alert tone="warning" title="No cast sheet with this model">
          {modelName} can&rsquo;t take a cast sheet
          {alternatives.length > 0 ? `; pick ${alternatives.join(' or ')}` : ''}.
          {sheet ? ' Your uploaded sheet is kept but will not be sent.' : ''}
        </Alert>
      )}
      {error != null &&
        (classifyRunwayError(error).signIn || classifyRunwayError(error).consent ? (
          <RunwayErrorNotice error={error} modelName={modelName} />
        ) : (
          <Alert tone="error" title="The cast sheet didn't upload">
            {errorMessage(error)}
          </Alert>
        ))}
    </div>
  );
}
