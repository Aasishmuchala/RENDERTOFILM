import { CircleCheck, Circle } from 'lucide-react';
import type { ReactNode } from 'react';
import { ToggleButton as AriaToggleButton } from 'react-aria-components';

import styles from './ToggleButton.module.css';

export type ToggleButtonProps = {
  selected: boolean;
  onChange: (selected: boolean) => void;
  children: ReactNode;
  disabled?: boolean | undefined;
  'aria-label'?: string | undefined;
};

/** A small on/off pill ("Use in film"): a ring when off, a filled check in the accent when on. */
export function ToggleButton({ selected, onChange, children, disabled = false, 'aria-label': ariaLabel }: ToggleButtonProps) {
  return (
    <AriaToggleButton
      className={styles.toggle}
      isSelected={selected}
      onChange={onChange}
      isDisabled={disabled}
      aria-label={ariaLabel}
    >
      {selected ? <CircleCheck size={14} aria-hidden /> : <Circle size={14} aria-hidden />}
      <span>{children}</span>
    </AriaToggleButton>
  );
}
