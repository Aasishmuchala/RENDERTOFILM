import { Group, Input, Label, NumberField } from 'react-aria-components';

import styles from './NumberInput.module.css';

export type NumberInputProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  /** Shown after the number, e.g. "s". */
  unit?: string | undefined;
  disabled?: boolean | undefined;
};

/** A small number field; arrow keys step it, typing commits on blur or Enter. */
export function NumberInput({ label, value, onChange, min, max, step = 0.1, unit, disabled = false }: NumberInputProps) {
  return (
    <NumberField
      value={value}
      onChange={(v) => {
        if (!Number.isNaN(v)) onChange(v);
      }}
      minValue={min}
      maxValue={max}
      step={step}
      isDisabled={disabled}
      formatOptions={{ maximumFractionDigits: 2 }}
      className={styles.field}
    >
      <Label className={styles.label}>{label}</Label>
      <Group className={styles.group}>
        <Input className={styles.input} />
        {unit && (
          <span className={styles.unit} aria-hidden>
            {unit}
          </span>
        )}
      </Group>
    </NumberField>
  );
}
