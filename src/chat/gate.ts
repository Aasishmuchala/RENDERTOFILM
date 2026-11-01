// The spend gate (PLAN-13 section 3, decision 2). A Quote is a free priced
// proposal; it becomes a Run only through `release`: a click, a typed yes, an
// Allowance that covers it, or a price of 0. The model never reaches this door:
// the tool that proposes returns a Quote and nothing more. Every decision is
// written to the audit log. Takes its seams (Store, Pricer, clock, settings) by
// injection; the ledger and the open-Quote index are the only documents it owns.
// The Allowance governs unattended spend only: a click and a typed yes stay out of
// the ledger.
import { documentStore } from '../storage.ts';
import {
  type ApprovalSource,
  type AuditRow,
  canRelease,
  type Gate,
  type Pricer,
  type Quote,
  QUOTE_TTL_MS,
  type ReleaseRefused,
  type Repriced,
  type RunSpec,
  type SpecPrice,
  specHash,
  type Store,
  type Unit,
} from './domain.ts';

export type GateDeps = {
  store: Store;
  pricer: Pricer;
  now(): number;
  /** The owner's Allowance: perDay 0 means none; `unit` is the unit it is counted in. */
  settings(owner: string): Promise<{ allowancePerDay: number; unit: Unit }>;
};

/** One unit's Allowance use. `held` is what each reserved Quote holds, so a reconcile moves it once. */
type Totals = { reserved: number; spent: number; held: Record<string, number> };

/**
 * `chat/<owner>/ledger.json`: today's Allowance use. The top level is the unit used
 * last (a document from before there was a unit is taken to be in the current one)
 * and `other` keeps the rest, so credits spent stay spent after a reserve in dollars.
 */
type Ledger = Totals & { day: string; unit?: Unit; other?: Partial<Record<Unit, Totals>> };

/** `chat/<owner>/quote-index/<threadId>.json`: the Quotes a thread may still have open (the Store lists none). */
type QuoteIndex = { ids: string[] };

/** How long a price is waited for: a provider that hangs refuses one click, and holds up nothing else. */
const PRICE_LIMIT_MS = 10_000;

const ledgers = documentStore<Ledger>({ prefix: 'chat/' });
const indexes = documentStore<QuoteIndex>({ prefix: 'chat/' });

const indexKey = (owner: string, threadId: string) => `${owner}/quote-index/${threadId}.json`;

/** The Quotes a thread may still have open, newest proposal only: what a Quote card and a repeat check read. */
export async function threadQuoteIds(owner: string, threadId: string): Promise<string[]> {
  return (await indexes.get(indexKey(owner, threadId)))?.value.ids ?? [];
}

// One decision at a time per owner, so two clicks on one Quote release it once and
// two proposals for one spec make one Quote. Module level: every Gate shares it.
const queues = new Map<string, Promise<unknown>>();

function serial<T>(owner: string, work: () => Promise<T>): Promise<T> {
  const run = (queues.get(owner) ?? Promise.resolve()).catch(() => {}).then(work);
  queues.set(owner, run);
  void run
    .finally(() => {
      if (queues.get(owner) === run) queues.delete(owner);
    })
    .catch(() => {});
  return run;
}

/** The owner's local calendar day, `yyyy-mm-dd`: what "per day" means to the person. */
function dayOf(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Credits are whole numbers but dollars are not; keeps 0.1 + 0.2 out of the ledger. */
const round = (n: number) => Math.round(n * 1e6) / 1e6;

const noUse = (): Totals => ({ reserved: 0, spent: 0, held: {} });

/** The ledger as of `day` with `unit` on top: a document from an earlier day counts as empty, and no amount crosses units. */
function ledgerFor(doc: Ledger | undefined, day: string, unit: Unit): Ledger {
  if (!doc || doc.day !== day) return { day, unit, ...noUse() };
  const { reserved, spent, held = {} } = doc;
  const on = doc.unit ?? unit;
  if (on === unit) return { ...doc, unit, held };
  const { [unit]: kept = noUse(), ...rest } = doc.other ?? {};
  return { day, unit, ...kept, other: { ...rest, [on]: { reserved, spent, held } } };
}

/** A cost: what a provider can really have charged. */
const isCost = (n: number | null): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** Why a price read just now stops a Quote from being released: higher or in another unit, or not a price at all. */
function priceMoved(q: Quote, fresh: SpecPrice | null): 'repriced' | 'unpriced' | null {
  if (!fresh) return 'unpriced';
  if (q.amount === null) return null;
  if (!isCost(fresh.amount)) return 'unpriced';
  return fresh.unit !== q.unit || fresh.amount > q.amount ? 'repriced' : null;
}

export function createGate(deps: GateDeps): Gate {
  const { store, pricer } = deps;
  const ledgerKey = (owner: string) => `${owner}/ledger.json`;

  async function readLedger(owner: string, unit: Unit): Promise<Ledger> {
    return ledgerFor((await ledgers.get(ledgerKey(owner)))?.value, dayOf(deps.now()), unit);
  }

  async function audit(owner: string, row: Omit<AuditRow, 'at'>): Promise<void> {
    await store.appendAudit(owner, { ...row, at: deps.now() });
  }

  async function allowanceLeft(owner: string): Promise<number | null> {
    const { allowancePerDay, unit } = await deps.settings(owner);
    if (!(allowancePerDay > 0)) return null;
    const ledger = await readLedger(owner, unit);
    return Math.max(0, round(allowancePerDay - ledger.reserved - ledger.spent));
  }

  async function reserve(owner: string, quote: Quote): Promise<void> {
    const amount = quote.amount;
    if (amount === null || !(amount > 0)) return;
    const day = dayOf(deps.now());
    await ledgers.update(ledgerKey(owner), (current) => {
      const ledger = ledgerFor(current, day, quote.unit);
      if (quote.id in ledger.held) return ledger;
      return { ...ledger, reserved: round(ledger.reserved + amount), held: { ...ledger.held, [quote.id]: amount } };
    });
  }

  // A Quote reserved on an earlier day was dropped with that ledger, so it has nothing
  // to move here and a Run crossing midnight records no actual on day two. A hold moves
  // in the Quote's own unit, whichever the Allowance is counted in by now. A person's
  // yes was never reserved, so the ledger stays out of it, and only the row is written:
  // what the Run really cost. An actual above the hold is recorded as it is: the truth,
  // even past the day's Allowance. One that is not a cost at all counts as the hold.
  // The row is written once: the Quote is marked after it, so a row that could not be
  // written is left for the next reconcile, and one that was is never written again.
  async function reconcile(owner: string, quoteId: string, actual: number | null): Promise<void> {
    const q = await store.quote(owner, quoteId);
    if (q?.reconciledAt !== undefined) return;
    const day = dayOf(deps.now());
    let settled = null as { held: number; spent: number } | null;
    await ledgers.update(ledgerKey(owner), (current) => {
      const ledger = ledgerFor(current, day, q?.unit ?? current?.unit ?? 'credits');
      settled = null;
      const held = ledger.held[quoteId];
      if (held === undefined) return ledger;
      const { [quoteId]: _moved, ...rest } = ledger.held;
      const spent = isCost(actual) ? actual : held;
      settled = { held, spent };
      return {
        ...ledger,
        reserved: Math.max(0, round(ledger.reserved - held)),
        spent: round(ledger.spent + spent),
        held: rest,
      };
    });
    if (!q || (!settled && q.source !== 'click' && q.source !== 'text')) return;
    await audit(owner, {
      threadId: q.threadId,
      turnId: q.turnId,
      decision: 'reconcile',
      quoteId,
      amount: settled?.held ?? q.amount,
      actualAmount: settled?.spent ?? (isCost(actual) ? actual : q.amount),
      unit: q.unit,
    });
    await store.saveQuote(owner, { ...q, reconciledAt: deps.now() });
  }

  /** Marks an open Quote declined and writes the audit row. The caller holds the owner's turn. */
  async function declineNow(owner: string, q: Quote, reason: 'user' | 'superseded' | 'expired'): Promise<Quote> {
    const declined: Quote = { ...q, state: 'declined', reason, decidedAt: deps.now() };
    await store.saveQuote(owner, declined);
    await audit(owner, {
      threadId: q.threadId,
      turnId: q.turnId,
      decision: reason === 'user' ? 'decline' : reason,
      quoteId: q.id,
      amount: q.amount,
      unit: q.unit,
    });
    return declined;
  }

  /** Marks an open Quote out of time. The row goes first, so it is never decided with no row. */
  async function expireNow(owner: string, q: Quote, now: number): Promise<void> {
    await audit(owner, {
      threadId: q.threadId,
      turnId: q.turnId,
      decision: 'expired',
      quoteId: q.id,
      amount: q.amount,
      unit: q.unit,
    });
    await store.saveQuote(owner, { ...q, state: 'expired', decidedAt: now });
  }

  /** Writes down a release that was refused, and answers it. */
  async function denied<R extends ReleaseRefused>(owner: string, q: Quote, source: ApprovalSource, reason: R) {
    await audit(owner, {
      threadId: q.threadId,
      turnId: q.turnId,
      decision: 'deny',
      reason,
      source,
      quoteId: q.id,
      amount: q.amount,
      unit: q.unit,
    });
    return { ok: false as const, reason };
  }

  /** The thread's Quotes that can still be released; one that ran out of time is marked expired on the way. */
  async function openQuotes(owner: string, threadId: string): Promise<Quote[]> {
    const now = deps.now();
    const open: Quote[] = [];
    for (const id of await threadQuoteIds(owner, threadId)) {
      const q = await store.quote(owner, id);
      if (!q || q.state !== 'open') continue;
      if (now >= q.expiresAt) await expireNow(owner, q, now);
      else open.push(q);
    }
    return open;
  }

  async function indexQuotes(owner: string, threadId: string, ids: string[]): Promise<void> {
    await indexes.update(indexKey(owner, threadId), () => ({ ids }));
  }

  /** A price, or a rejection once PRICE_LIMIT_MS is up. */
  async function priceNow(owner: string, spec: RunSpec): Promise<SpecPrice> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('The price took too long to read.')), PRICE_LIMIT_MS);
    });
    try {
      return await Promise.race([pricer.price(owner, spec), limit]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * What a Quote about to be released costs now, null when that cannot be read.
   * Read before the owner's turn, so a slow pricer holds up one click and not the
   * rest. `undefined` for a Quote with nothing to check: free, or one that the
   * checks in the owner's turn refuse anyway.
   */
  async function priceAgain(owner: string, quoteId: string): Promise<Repriced> {
    const q = await store.quote(owner, quoteId);
    if (!q || q.amount === 0 || q.state !== 'open' || !(deps.now() < q.expiresAt)) return undefined;
    if (specHash(q.spec) !== q.specHash) return undefined;
    return priceNow(owner, q.spec).catch(() => null);
  }

  return {
    propose: async (owner, threadId, turnId, spec: RunSpec, given?: SpecPrice) => {
      // Always priced, since the hash covers a plan's id and not the plan, and priced
      // first, so a slow pricer holds up this proposal and not the owner's clicks.
      const priced = given ?? (await priceNow(owner, spec));
      return serial(owner, async () => {
        const hash = specHash(spec);
        const open = await openQuotes(owner, threadId);
        const same = open.find((q) => q.specHash === hash && q.amount === priced.amount && q.unit === priced.unit);
        if (same) return same;

        for (const q of open) await declineNow(owner, q, 'superseded');

        const now = deps.now();
        const quote: Quote = {
          id: crypto.randomUUID(),
          threadId,
          turnId,
          specHash: hash,
          spec,
          unit: priced.unit,
          amount: priced.amount,
          items: priced.items,
          ...(priced.note === undefined ? {} : { note: priced.note }),
          createdAt: now,
          expiresAt: now + QUOTE_TTL_MS,
          state: 'open',
        };
        const row = { threadId, turnId, quoteId: quote.id, amount: quote.amount, unit: quote.unit };
        if (quote.amount === 0) {
          quote.state = 'approved';
          quote.source = 'free';
          quote.decidedAt = now;
          // Before the Quote is saved, as in a release: never approved with no row.
          await audit(owner, { ...row, decision: 'approve', source: 'free' });
        }
        await store.saveQuote(owner, quote);
        await indexQuotes(owner, threadId, quote.state === 'open' ? [quote.id] : []);
        if (quote.state === 'open') await audit(owner, { ...row, decision: 'propose' });
        return quote;
      });
    },

    price: priceNow,
    priceAgain,

    release: async (owner, quoteId, source: ApprovalSource, read?: { fresh: Repriced }) => {
      const fresh = read ? read.fresh : await priceAgain(owner, quoteId);
      return serial(owner, async () => {
        const q = await store.quote(owner, quoteId);
        if (!q) return { ok: false as const, reason: 'not_found' as const };
        if (source === 'free' && q.amount !== 0) throw new Error('only a Quote that costs nothing is released as free');

        const now = deps.now();
        let left: number | null = null;
        if (source === 'allowance') {
          const settings = await deps.settings(owner);
          left = settings.unit === q.unit ? await allowanceLeft(owner) : null;
        }
        const verdict = canRelease(q, now, left, source);
        if (!verdict.ok) {
          if (verdict.reason === 'expired' && q.state === 'open') await expireNow(owner, q, now);
          return denied(owner, q, source, verdict.reason);
        }
        if (specHash(q.spec) !== q.specHash) return denied(owner, q, source, 'spec_changed');
        const moved = fresh === undefined ? null : priceMoved(q, fresh);
        if (moved === 'unpriced') return denied(owner, q, source, moved);
        if (moved === 'repriced') {
          await declineNow(owner, q, 'superseded');
          return denied(owner, q, source, moved);
        }

        const approved: Quote = { ...q, state: 'approved', source, decidedAt: now };
        // The row first, so a failed audit leaves the Quote open and nothing held,
        // never approved with no row. Then the money, before the Quote reads approved:
        // a failure after that leaves a reservation to expire with the day, never an
        // approval nobody paid for.
        await audit(owner, {
          threadId: q.threadId,
          turnId: q.turnId,
          decision: 'approve',
          source,
          quoteId: q.id,
          amount: q.amount,
          unit: q.unit,
        });
        if (source === 'allowance') await reserve(owner, approved);
        await store.saveQuote(owner, approved);
        return { ok: true as const, quote: approved };
      });
    },

    decline: (owner, quoteId, reason) =>
      serial(owner, async () => {
        const q = await store.quote(owner, quoteId);
        if (!q) throw new Error(`quote ${quoteId} not found`);
        return q.state === 'open' ? declineNow(owner, q, reason) : q;
      }),

    allowanceLeft,
    reserve,
    reconcile: (owner, quoteId, actual) => serial(owner, () => reconcile(owner, quoteId, actual)),
    audit,
  };
}
