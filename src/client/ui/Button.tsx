import { LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button as AriaButton } from 'react-aria-components';

import styles from './Button.module.css';

export type ButtonProps = {
  variant?: 'primary' | 'default' | 'ghost' | 'danger' | undefined;
  size?: 'sm' | 'md' | undefined;
  icon?: ReactNode | undefined;
  loading?: boolean | undefined;
  disabled?: boolean | undefined;
  onPress?: (() => void) | undefined;
  type?: 'button' | 'submit' | undefined;
  'aria-label'?: string | undefined;
  autoFocus?: boolean | undefined;
  className?: string | undefined;
  children?: ReactNode | undefined;
};

export function Button({
  variant = 'default',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  onPress,
  type = 'button',
  'aria-label': ariaLabel,
  autoFocus,
  className,
  children,
}: ButtonProps) {
  const spinnerSize = size === 'sm' ? 14 : 16;
  return (
    <AriaButton
      type={type}
      isDisabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      onPress={onPress}
      className={[styles.button, styles[variant], styles[size], className]
        .filter(Boolean)
        .join(' ')}
    >
      {loading ? (
        <LoaderCircle size={spinnerSize} className={styles.spinner} />
      ) : (
        icon
      )}
      {children}
    </AriaButton>
  );
}
