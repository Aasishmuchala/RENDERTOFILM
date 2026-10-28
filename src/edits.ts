import { documentStore } from './storage.ts';
import type { EditDoc } from './timeline.ts';

export type * from './timeline.ts';

export const MAX_TIMELINE = 24;
export const MAX_MEMORY = 30;
const MAX_MESSAGES = 60;

export const EMPTY_EDIT: EditDoc = {
  timeline: [],
  transition: 'hard',
  fadeSeconds: 0.5,
  derived: [],
  exports: [],
  messages: [],
  memory: [],
};

/** One document per person under `edits/`, beside their library. */
const store = documentStore<EditDoc>({ prefix: 'edits/' });

export async function readEdit(owner: string): Promise<EditDoc> {
  const doc = await store.get(`${owner}.json`);
  return { ...EMPTY_EDIT, ...doc?.value };
}

/** Read-modify-write; `mutate` must return new arrays, as it can be retried. */
export async function updateEdit(
  owner: string,
  mutate: (doc: EditDoc) => EditDoc
): Promise<EditDoc> {
  return store.update(`${owner}.json`, (current) => {
    const next = mutate({ ...EMPTY_EDIT, ...current });
    return {
      ...next,
      timeline: next.timeline.slice(0, MAX_TIMELINE),
      derived: next.derived.slice(0, 200),
      exports: next.exports.slice(0, 30),
      messages: next.messages.slice(-MAX_MESSAGES),
      memory: next.memory.slice(0, MAX_MEMORY),
    };
  });
}

/** Every task id the Edit tab owns, for the library media route. */
export function editOwns(doc: EditDoc, id: string): boolean {
  return (
    doc.derived.some((d) => d.id === id) ||
    doc.exports.some((e) => e.finalId === id)
  );
}
