import { Check, ChevronDown } from 'lucide-react';
import {
  Button as AriaButton,
  Header,
  Label,
  ListBox,
  ListBoxItem,
  ListBoxSection,
  Popover,
  Select as AriaSelect,
  SelectValue,
  Text as AriaText,
} from 'react-aria-components';

import styles from './Select.module.css';

export type SelectOption = {
  id: string;
  name: string;
  hint?: string | undefined;
  /** Options sharing a group are listed under one heading, in first-seen order. */
  group?: string | undefined;
};

export type SelectProps = {
  label: string;
  options: readonly SelectOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean | undefined;
  /** Shows the chosen option's hint under the trigger. */
  showHint?: boolean | undefined;
};

/** A dropdown with one-line hints, optionally grouped (by provider, say). */
export function Select({
  label,
  options,
  value,
  onChange,
  disabled = false,
  showHint = true,
}: SelectProps) {
  const groups: { name: string; items: SelectOption[] }[] = [];
  for (const o of options) {
    const name = o.group ?? '';
    let g = groups.find((x) => x.name === name);
    if (!g) groups.push((g = { name, items: [] }));
    g.items.push(o);
  }
  const current = options.find((o) => o.id === value);

  return (
    <AriaSelect
      className={styles.select}
      selectedKey={value}
      onSelectionChange={(key) => {
        if (key != null) onChange(String(key));
      }}
      isDisabled={disabled}
    >
      <Label className={styles.label}>{label}</Label>
      <AriaButton className={styles.trigger}>
        <SelectValue className={styles.value}>
          {current ? (
            <>
              <span className={styles.valueName}>{current.name}</span>
              {current.group && <span className={styles.valueGroup}>{current.group}</span>}
            </>
          ) : (
            'Choose…'
          )}
        </SelectValue>
        <ChevronDown size={16} aria-hidden className={styles.chevron} />
      </AriaButton>
      {showHint && current?.hint && <p className={styles.hint}>{current.hint}</p>}
      <Popover className={styles.popover} offset={6}>
        <ListBox className={styles.list}>
          {groups.map((g) =>
            g.name ? (
              <ListBoxSection key={g.name} id={g.name} className={styles.section}>
                <Header className={styles.header}>{g.name}</Header>
                {g.items.map((o) => (
                  <Item key={o.id} option={o} />
                ))}
              </ListBoxSection>
            ) : (
              g.items.map((o) => <Item key={o.id} option={o} />)
            )
          )}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}

function Item({ option }: { option: SelectOption }) {
  return (
    <ListBoxItem id={option.id} textValue={option.name} className={styles.item}>
      {({ isSelected }) => (
        <>
          <span className={styles.itemText}>
            <AriaText slot="label" className={styles.itemName}>
              {option.name}
            </AriaText>
            {option.hint && (
              <AriaText slot="description" className={styles.itemHint}>
                {option.hint}
              </AriaText>
            )}
          </span>
          {isSelected && <Check size={14} aria-hidden className={styles.check} />}
        </>
      )}
    </ListBoxItem>
  );
}
