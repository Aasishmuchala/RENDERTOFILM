import { AtSign, X } from 'lucide-react';
import { useState } from 'react';
import {
  Button as AriaButton,
  Input,
  Label,
  Tag,
  TagGroup,
  TagList,
} from 'react-aria-components';

import { MAX_TAGS, normalizeTag } from '../../tags.ts';
import styles from './TagEditor.module.css';

export type TagEditorProps = {
  /** What is being tagged, for the accessible names ("Tags for Golden hour"). */
  label: string;
  tags: readonly string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean | undefined;
};

/**
 * Removable `@tag` chips plus an input: Enter, comma or space adds what was
 * typed (normalized by src/tags.ts), Backspace in an empty input drops the
 * last tag.
 */
export function TagEditor({ label, tags, onChange, disabled = false }: TagEditorProps) {
  const [draft, setDraft] = useState('');
  const full = tags.length >= MAX_TAGS;

  const add = (raw: string) => {
    const tag = normalizeTag(raw);
    setDraft('');
    if (tag && !tags.includes(tag) && !full) onChange([...tags, tag]);
  };
  const commit = () => add(draft);

  return (
    <div className={styles.editor} data-disabled={disabled || undefined}>
      {tags.length > 0 && (
        <TagGroup
          aria-label={`Tags for ${label}`}
          onRemove={(keys) => onChange(tags.filter((t) => !keys.has(t)))}
          className={styles.group}
        >
          <TagList className={styles.list}>
            {tags.map((t) => (
              <Tag key={t} id={t} textValue={`@${t}`} className={styles.tag} isDisabled={disabled}>
                @{t}
                <AriaButton slot="remove" className={styles.remove} aria-label={`Remove @${t}`}>
                  <X size={12} aria-hidden />
                </AriaButton>
              </Tag>
            ))}
          </TagList>
        </TagGroup>
      )}
      <Label className={styles.field}>
        <AtSign size={12} aria-hidden className={styles.at} />
        <span className={styles.srOnly}>Add a tag to {label}</span>
        <Input
          className={styles.input}
          value={draft}
          disabled={disabled || full}
          placeholder={full ? `Up to ${MAX_TAGS} tags` : 'Add tag'}
          maxLength={40}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,\s]$/.test(v)) {
              add(v.slice(0, -1));
            } else {
              setDraft(v);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={commit}
        />
      </Label>
    </div>
  );
}

export type TagPickerProps = {
  label: string;
  /** Every tag on offer, with how many items carry it. */
  options: readonly { tag: string; count: number }[];
  selected: readonly string[];
  onChange: (tags: string[]) => void;
};

/** A row of `@tag` chips that toggle on and off, for filtering by tag. */
export function TagPicker({ label, options, selected, onChange }: TagPickerProps) {
  return (
    <TagGroup
      aria-label={label}
      selectionMode="multiple"
      selectedKeys={new Set(selected)}
      onSelectionChange={(keys) =>
        onChange(keys === 'all' ? options.map((o) => o.tag) : [...keys].map(String))
      }
      className={styles.picker}
    >
      <TagList className={styles.pickerList}>
        {options.map((o) => (
          <Tag key={o.tag} id={o.tag} textValue={`@${o.tag}, ${o.count} ${o.count === 1 ? 'item' : 'items'}`} className={styles.pick}>
            @{o.tag}
            <span className={styles.count}>{o.count}</span>
          </Tag>
        ))}
      </TagList>
    </TagGroup>
  );
}
