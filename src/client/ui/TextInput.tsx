import type { KeyboardEvent } from 'react';
import { Input, Label, TextField } from 'react-aria-components';

import styles from './TextInput.module.css';

export type TextInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string | undefined;
  label?: string | undefined;
  'aria-label'?: string | undefined;
  type?: 'text' | 'email' | 'url' | 'search' | 'password' | undefined;
  disabled?: boolean | undefined;
  autoFocus?: boolean | undefined;
  maxLength?: number | undefined;
  onPressEnter?: (() => void) | undefined;
  className?: string | undefined;
};

export function TextInput({
  value,
  onChange,
  placeholder,
  label,
  'aria-label': ariaLabel,
  type = 'text',
  disabled = false,
  autoFocus,
  maxLength,
  onPressEnter,
  className,
}: TextInputProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    // An IME commit (confirming a CJK candidate) also arrives as Enter —
    // `isComposing` (and the legacy keyCode 229) marks those, and firing the
    // callback there would submit half-typed text.
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    // Without this, an input inside a <form> also triggers native form
    // submission, which navigates away and drops the in-flight mutation.
    e.preventDefault();
    onPressEnter?.();
  };

  return (
    <TextField
      value={value}
      onChange={onChange}
      type={type}
      isDisabled={disabled}
      aria-label={label ? undefined : ariaLabel}
      className={[styles.field, className].filter(Boolean).join(' ')}
    >
      {label && <Label className={styles.label}>{label}</Label>}
      <Input
        placeholder={placeholder}
        autoFocus={autoFocus}
        maxLength={maxLength}
        onKeyDown={onPressEnter ? handleKeyDown : undefined}
        className={styles.input}
      />
    </TextField>
  );
}
