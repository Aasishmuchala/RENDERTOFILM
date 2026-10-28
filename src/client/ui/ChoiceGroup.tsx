import { Select } from './Select.tsx';

export type Choice = { id: string; name: string; hint?: string | undefined };

export type ChoiceGroupProps = {
  label: string;
  choices: readonly Choice[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean | undefined;
};

/** Picking one of a set of presets: a dropdown, with the chosen hint below. */
export function ChoiceGroup({ label, choices, value, onChange, disabled = false }: ChoiceGroupProps) {
  return <Select label={label} options={choices} value={value} onChange={onChange} disabled={disabled} />;
}
