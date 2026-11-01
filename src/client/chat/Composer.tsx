import type { ChatMode } from '../../chat/domain.ts';
import { ToggleButton } from '../ui/ToggleButton.tsx';
import { ArrowUp, CircleAlert, LoaderCircle, Music, Paperclip, RotateCw, Square, X } from 'lucide-react';
import { type KeyboardEvent, type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';

import type { Attachment } from '../lib/useChat.ts';
import { Button } from '../ui/Button.tsx';
import styles from './Composer.module.css';

const MODES: { id: ChatMode; label: string; note: string }[] = [
  { id: 'director', label: 'Director', note: 'Finds the best way to shoot each image.' },
  { id: 'lifestyle', label: 'Lifestyle', note: 'Shows the architecture naturally, with real people.' },
];

export type ComposerProps = {
  mode: ChatMode;
  onMode: (mode: ChatMode) => void;
  attachments: Attachment[];
  /** Why files were refused. */
  notes: string[];
  /** Why the last send failed. */
  error: string | null;
  sending: boolean;
  /** A Turn is live: the server takes no message now, so the button stops it instead. */
  live: boolean;
  /** Chat can answer: the owner has an Anthropic key. */
  ready: boolean;
  /** The page is showing. Hidden, the field has no size to measure. */
  active?: boolean | undefined;
  onAddFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  /** Sends a file that failed up again. */
  onRetry: (id: string) => void;
  /** Answers whether the message went, so what was typed stays when it did not. */
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
  inputRef?: RefObject<HTMLTextAreaElement | null> | undefined;
};

const ACCEPT = 'image/jpeg,image/png,image/webp,audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,audio/aac,audio/flac';
const MAX_LENGTH = 4000;
const FILE_FAILED = 'Retry or remove any file that failed, then send.';

type TileProps = { attachment: Attachment; sending: boolean; onRemove: () => void; onRetry: () => void };

function Tile({ attachment, sending, onRemove, onRetry }: TileProps) {
  const { name, preview, state } = attachment;
  const remove = useRef<HTMLButtonElement>(null);
  return (
    <li className={styles.tile}>
      {preview ? (
        <img src={preview} alt={name} className={styles.picture} />
      ) : (
        <span className={styles.music} title={name}>
          <Music size={14} aria-hidden />
          <span className={styles.musicName}>{name}</span>
        </span>
      )}
      {state === 'uploading' && (
        <span className={styles.uploading} role="status" aria-label={`Uploading ${name}`}>
          <LoaderCircle size={16} aria-hidden className={styles.spin} />
        </span>
      )}
      {state === 'failed' && (
        <AriaButton
          className={styles.retry}
          aria-label={`Retry ${name}`}
          onPress={() => {
            // This button leaves with the failure, and focus stays on the tile.
            remove.current?.focus();
            onRetry();
          }}
        >
          <RotateCw size={16} aria-hidden />
        </AriaButton>
      )}
      {/* Already on its way once sending, so the tile cannot promise to hold it back. */}
      <AriaButton ref={remove} className={styles.remove} aria-label={`Remove ${name}`} isDisabled={sending} onPress={onRemove}>
        <X size={14} aria-hidden />
      </AriaButton>
    </li>
  );
}

/**
 * The thick-glass bar at the foot of the page: the files going with the message,
 * a field that grows to six lines, and one button that sends or stops. Enter
 * sends and Shift+Enter starts a new line.
 */
export function Composer({
  mode,
  onMode,
  attachments,
  notes,
  error,
  sending,
  live,
  ready,
  active = true,
  onAddFiles,
  onRemove,
  onRetry,
  onSend,
  onStop,
  inputRef,
}: ComposerProps) {
  const [text, setText] = useState('');
  const own = useRef<HTMLTextAreaElement>(null);
  const field = inputRef ?? own;
  const picker = useRef<HTMLInputElement>(null);

  // The field grows to its words: measured again as they change, as the page comes
  // into view and as the window changes width. Hidden, it measures 0, which is no height.
  const grow = useCallback(() => {
    const el = field.current;
    if (!el) return;
    const was = el.style.height;
    el.style.height = 'auto';
    const grown = el.scrollHeight;
    el.style.height = grown > 0 ? `${grown}px` : was;
  }, [field]);

  useLayoutEffect(() => {
    if (active) grow();
  }, [active, grow, text]);

  useEffect(() => {
    if (!active) return;
    window.addEventListener('resize', grow);
    return () => window.removeEventListener('resize', grow);
  }, [active, grow]);

  const uploading = attachments.some((a) => a.state === 'uploading');
  const failed = attachments.some((a) => a.state === 'failed');
  const canSend = ready && !sending && !live && !uploading && !failed && text.trim() !== '';
  const problems = [
    ...attachments.flatMap((a) => (a.error ? [`${a.name}: ${a.error}`] : [])),
    ...(failed ? [FILE_FAILED] : []),
    ...notes,
    ...(error ? [error] : []),
  ];

  const submit = async () => {
    if (!canSend) return;
    const sent = text;
    if (!(await onSend(sent))) return;
    // Only what went: words typed while it was going are the next message.
    setText((now) => (now.startsWith(sent) ? now.slice(sent.length).trimStart() : now));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void submit();
  };

  return (
    <div className={styles.composer}>
      {attachments.length > 0 && (
        <ul className={styles.tiles} aria-label="Files going with this message">
          {attachments.map((attachment) => (
            <Tile
              key={attachment.id}
              attachment={attachment}
              sending={sending}
              onRemove={() => onRemove(attachment.id)}
              onRetry={() => onRetry(attachment.id)}
            />
          ))}
        </ul>
      )}
      {problems.map((problem) => (
        <p key={problem} role="alert" className={styles.problem}>
          <CircleAlert size={14} aria-hidden />
          {problem}
        </p>
      ))}
      <div className={styles.modes} role="group" aria-label="What to make">
        {MODES.map(({ id, label }) => (
          <ToggleButton key={id} selected={mode === id} onChange={() => onMode(id)}>
            {label}
          </ToggleButton>
        ))}
        <span className={styles.modeNote}>{MODES.find((m) => m.id === mode)?.note}</span>
      </div>
      <div className={styles.row}>
        <Button
          variant="ghost"
          className={styles.round}
          aria-label="Add renders or music"
          icon={<Paperclip size={18} aria-hidden />}
          onPress={() => picker.current?.click()}
        />
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          accept={ACCEPT}
          onChange={(e) => {
            onAddFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <textarea
          ref={field}
          className={styles.field}
          rows={1}
          aria-label="Message"
          maxLength={MAX_LENGTH}
          placeholder="Say what you need"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {live ? (
          <Button className={styles.round} aria-label="Stop" icon={<Square size={14} aria-hidden />} onPress={onStop} />
        ) : (
          <Button
            variant="primary"
            className={styles.round}
            aria-label="Send"
            icon={<ArrowUp size={18} aria-hidden />}
            disabled={!canSend}
            loading={sending}
            onPress={() => void submit()}
          />
        )}
      </div>
    </div>
  );
}
