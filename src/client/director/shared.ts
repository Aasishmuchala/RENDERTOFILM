import type { SelectOption } from '../ui/Select.tsx';

/** The planner's pick on top, under "Recommended", then every preset. */
export function withPick<T extends { id: string; name: string; hint: string }>(
  list: readonly T[],
  pick: string,
  why: string,
  all: string
): SelectOption[] {
  const chosen = list.find((x) => x.id === pick);
  return [
    ...(chosen ? [{ id: chosen.id, name: chosen.name, hint: why || chosen.hint, group: 'Recommended for this frame' }] : []),
    ...list.filter((x) => x.id !== pick).map((x) => ({ id: x.id, name: x.name, hint: x.hint, group: all })),
  ];
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'frame';
}
