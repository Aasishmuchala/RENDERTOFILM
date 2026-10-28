import styles from './FilterChips.module.css';
import { Select } from './Select.tsx';

export type FilterChipsProps = {
  label: string;
  options: readonly { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
};

/** A single-choice filter above a list, as a compact dropdown. */
export function FilterChips({ label, options, value, onChange }: FilterChipsProps) {
  return (
    <div className={styles.group}>
      <Select label={label} options={options} value={value} onChange={onChange} showHint={false} />
    </div>
  );
}
