import { Switch as AriaSwitch } from 'react-aria-components';

import styles from './Switch.module.css';

export type SwitchProps = {
  label: string;
  /** One line under the label saying what on means. */
  hint?: string | undefined;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean | undefined;
};

/** An on/off setting: the label and hint on the left, the toggle on the right. */
export function Switch({ label, hint, checked, onChange, disabled = false }: SwitchProps) {
  return (
    <AriaSwitch className={styles.switch} isSelected={checked} onChange={onChange} isDisabled={disabled}>
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {hint && <span className={styles.hint}>{hint}</span>}
      </span>
      <span className={styles.track} aria-hidden>
        <span className={styles.thumb} />
      </span>
    </AriaSwitch>
  );
}
