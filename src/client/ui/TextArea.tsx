import {
  Label,
  Text as AriaText,
  TextArea as AriaTextArea,
  TextField,
} from 'react-aria-components';

import styles from './TextArea.module.css';

export type TextAreaProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string | undefined;
  rows?: number | undefined;
  label?: string | undefined;
  'aria-label'?: string | undefined;
  disabled?: boolean | undefined;
  autoFocus?: boolean | undefined;
  className?: string | undefined;
  /** Enter (without Shift) calls this; Shift+Enter still adds a line. */
  onSubmit?: (() => void) | undefined;
  /**
   * Shows a "412 / 600" counter that turns red past the limit. Typing past
   * it is still allowed, so a paste is never silently cut; the caller blocks
   * submit.
   */
  maxLength?: number | undefined;
};

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
  label,
  'aria-label': ariaLabel,
  disabled = false,
  autoFocus,
  className,
  onSubmit,
  maxLength,
}: TextAreaProps) {
  return (
    <TextField
      value={value}
      onChange={onChange}
      isDisabled={disabled}
      aria-label={label ? undefined : ariaLabel}
      className={[styles.field, className].filter(Boolean).join(' ')}
    >
      {label && <Label className={styles.label}>{label}</Label>}
      <AriaTextArea
        placeholder={placeholder}
        rows={rows}
        autoFocus={autoFocus}
        className={styles.textarea}
        onKeyDown={
          onSubmit
            ? (e) => {
                if (e.key !== 'Enter' || e.shiftKey) return;
                if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
                e.preventDefault();
                onSubmit();
              }
            : undefined
        }
      />
      {maxLength !== undefined && (
        <AriaText
          slot="description"
          className={styles.counter}
          data-over={value.length > maxLength ? '' : undefined}
        >
          {value.length} / {maxLength}
        </AriaText>
      )}
    </TextField>
  );
}
