import { documentStore } from '../storage.ts';
import type { TextProvider } from './providers.ts';

/**
 * What the owner's own Anthropic and OmegaPlus keys have been used for: the
 * last 200 calls plus running totals, overall and per provider, in
 * `ai-text/<owner>/usage.json`. src/ai-text.ts records each call when it
 * finishes; the Settings card reads the totals. Calls through Runway are
 * billed by Runway and not counted here. No prompt text and no key.
 */

export type UsageEntry = {
  at: string;
  provider: TextProvider;
  /** The model that answered (the Settings choice). */
  model: string;
  /** The model the caller named, which a provider other than Runway ignores. */
  requestedModel: string;
  /** The task's `name`: which planner, check or editor turn. */
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  usd: number | null;
  ok: boolean;
};

export type UsageTotals = { calls: number; inputTokens: number; outputTokens: number; usd: number };

export type UsageDoc = {
  entries: UsageEntry[];
  totals: UsageTotals;
  byProvider: Partial<Record<TextProvider, UsageTotals>>;
};

const MAX_ENTRIES = 200;

const store = documentStore<UsageDoc>({ prefix: 'ai-text/' });
const keyFor = (owner: string) => `${owner}/usage.json`;

const zero = (): UsageTotals => ({ calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 });

function add(totals: UsageTotals | undefined, entry: UsageEntry): UsageTotals {
  const t = totals ?? zero();
  return {
    calls: t.calls + 1,
    inputTokens: t.inputTokens + entry.inputTokens,
    outputTokens: t.outputTokens + entry.outputTokens,
    // Only a priced call adds dollars; the rest count tokens only.
    usd: entry.usd !== null && Number.isFinite(entry.usd) ? Math.round((t.usd + entry.usd) * 1e6) / 1e6 : t.usd,
  };
}

function normalise(doc: Partial<UsageDoc> | undefined): UsageDoc {
  return { entries: doc?.entries ?? [], totals: doc?.totals ?? zero(), byProvider: doc?.byProvider ?? {} };
}

/** Zero totals when nothing has been recorded yet. */
export async function readUsage(owner: string): Promise<UsageDoc> {
  return normalise((await store.get(keyFor(owner)))?.value);
}

export function recordUsage(owner: string, entry: UsageEntry): Promise<UsageDoc> {
  return store.update(keyFor(owner), (current) => {
    const doc = normalise(current);
    return {
      entries: [...doc.entries, entry].slice(-MAX_ENTRIES),
      totals: add(doc.totals, entry),
      byProvider: { ...doc.byProvider, [entry.provider]: add(doc.byProvider[entry.provider], entry) },
    };
  });
}
