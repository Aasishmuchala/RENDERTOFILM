import { useEffect, useState } from 'react';

import { DEFAULT_DIRECTOR_LENS, DIRECTOR_LENSES, directorLensById, type DirectorLensId } from '../../direction.ts';
import { Select, type SelectOption } from '../ui/Select.tsx';

/** "None (house style)" first, then the twenty directors by name; the chosen one's summary shows under the field. */
const OPTIONS: readonly SelectOption[] = DIRECTOR_LENSES.map((l) => ({
  id: l.id,
  name: l.id === 'none' ? 'None (house style)' : l.name,
  hint: l.summary,
}));

const storeKey = (page: 'director' | 'lifestyle' | 'video') => `render-to-film:${page}:direction-style`;

/** The page's direction style for its next plan, remembered in this browser; an id no longer offered reads as none. */
export function useDirectionStyle(page: 'director' | 'lifestyle' | 'video') {
  const [style, setStyle] = useState<DirectorLensId>(() => {
    try {
      return directorLensById(localStorage.getItem(storeKey(page)) ?? undefined)?.id ?? DEFAULT_DIRECTOR_LENS;
    } catch {
      return DEFAULT_DIRECTOR_LENS;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storeKey(page), style);
    } catch {
      // Private mode: the choice still works for this visit.
    }
  }, [page, style]);
  return [style, setStyle] as const;
}

export type DirectionStyleSelectProps = {
  value: DirectorLensId;
  onChange: (id: DirectorLensId) => void;
  disabled?: boolean | undefined;
};

/** The director lens the planner directs the whole plan with (src/direction.ts). */
export function DirectionStyleSelect({ value, onChange, disabled }: DirectionStyleSelectProps) {
  return (
    <Select
      label="Direction style"
      options={OPTIONS}
      value={value}
      onChange={(id) => onChange(directorLensById(id)?.id ?? DEFAULT_DIRECTOR_LENS)}
      disabled={disabled}
    />
  );
}

/** "Directed in the manner of Denis Villeneuve", or undefined for none and plans made before lenses. */
export function directedLine(id: string | undefined): string | undefined {
  const lens = directorLensById(id);
  if (!lens || lens.id === 'none') return undefined;
  return `Directed in the manner of ${lens.id === 'coen-brothers' ? 'the Coen Brothers' : lens.name}`;
}
