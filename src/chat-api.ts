import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { resolveChatTarget } from './ai-text.ts';
import type {
  Asset,
  AuditRow,
  Event,
  Message,
  MessageView,
  Quote,
  QuoteView,
  ReleaseRefused,
  RunView,
  Thread,
  ThreadSummary,
  ThreadView,
  Unit,
} from './chat/domain.ts';
import { CHAT_MODES, parseYes } from './chat/domain.ts';
import { threadQuoteIds } from './chat/gate.ts';
import { runView } from './chat/pipeline.ts';
import { createStore } from './chat/store.ts';
import { readChatSettings, writeChatSettings } from './connections.ts';
import { ownsAsset } from './edits.ts';
import { imageSlot, MAX_INPUT_PIXELS, sharp } from './imaging.ts';
import { ownerKey } from './library.ts';
import { documentStore, getObject } from './storage.ts';
import { type Context, publicProcedure, router, signedInProcedure } from './trpc.ts';

/**
 * The chat page's router (PLAN-13 section 5). `send` keeps the user's message and
 * starts a Turn in the background; a typed yes to the open Quote goes through the
 * Gate like a click, unless the Quote has no price, which only a click releases, and
 * anything else typed declines it. `decide` is the click. `tick` is Bay's clock; the
 * desktop has its own (src/chat/driver.ts).
 *
 * The driver is loaded on first use, not imported: it holds the RunEngine, which
 * calls AppRouter, and AppRouter holds this router, so this file must be able to
 * load with nothing of that behind it. Every procedure names its answer for the
 * same reason: an answer inferred through the driver would be inferred through
 * AppRouter itself.
 */

const NEEDS_KEY = 'Chat needs an Anthropic or OmegaPlus key. Add one in Settings.';
const BUSY = 'The assistant is still answering.';
const DECIDED = 'That quote has already been decided.';
/** What a card says when a click found the work dearer than the Quote it pressed. */
const PRICE_CHANGED = 'The price changed since this quote was made. Check the new quote and run that one.';
/** The long edge a render is sent to the model at. */
const LONG_EDGE = 1920;
const JPEG_QUALITY = 85;
const AUDIO = /\.(mp3|wav|m4a|aac|flac)$/i;
/** `chat.thread` resends this many seqs behind `since`: a seq is given out before its Event lands, so one can arrive late. */
const OVERLAP_SEQS = 20;
/** An `[event]` line is the app talking to the model. The system prompt says one approves nothing. */
const EVENT_LINE = '[event] ';
/** What the model reads after a typed yes that released nothing: the Quote has no price, which only a click releases. */
const NEEDS_CLICK =
  `${EVENT_LINE}quote.needs_click This quote has no price, so a typed yes does not approve it and nothing has started. ` +
  'It is still open: tell the user to press Run on its card.';
/** The same, for a yes to a Quote that had run out of time: the Gate has marked it expired. */
const EXPIRED =
  `${EVENT_LINE}quote.expired The quote the user said yes to had run out of time, so it approved nothing and nothing has started. ` +
  'If the user still wants it, propose the run again for a fresh quote.';
/** The same, for a yes to a Quote that got dearer: a new Quote is on the thread in its place. */
const REPRICED =
  `${EVENT_LINE}quote.repriced The price changed since the quote the user said yes to, so it approved nothing and nothing has started. ` +
  'A new quote is on its card with the new price: tell the user, and ask them to approve that one.';
/** The same, for a yes whose price could not be read again: the Quote stays open. */
const UNPRICED =
  `${EVENT_LINE}quote.unpriced The price could not be checked, so the yes approved nothing and nothing has started. ` +
  'The quote is still open: ask the user to try again in a moment.';
const CSV_COLUMNS = [
  'at',
  'threadId',
  'turnId',
  'tool',
  'decision',
  'source',
  'quoteId',
  'amount',
  'unit',
  'actualAmount',
  'provider',
  'model',
  'remoteIds',
  'outcomeIds',
  'reason',
] as const;

const store = createStore();
/** One unit's use of the Allowance. */
type Use = { reserved: number; spent: number };
/** The Gate's own `chat/<owner>/ledger.json`: what the Allowance has paid for on `day`, in `unit` and, in `other`, in the rest. */
const ledgers = documentStore<Use & { day: string; unit?: Unit; other?: Partial<Record<Unit, Use>> }>({ prefix: 'chat/' });

const loadDriver = () => import('./chat/driver.ts');

const refuse = (code: TRPCError['code'], message: string) => new TRPCError({ code, message });

// ---------------------------------------------------------------------------
// Views

/** A message's words. A block can hold an image or a thinking signature, and none of that leaves the server. */
function wordsOf(content: unknown[]): string {
  return content
    .flatMap((block) => {
      const { type, text } = block as { type?: unknown; text?: unknown };
      return type === 'text' && typeof text === 'string' ? [text] : [];
    })
    .join('\n');
}

const messageView = ({ content, ...message }: Message): MessageView => ({ ...message, text: wordsOf(content) });

/**
 * A person's words are the messages their Turns were started from. Every other
 * user-role message is the app talking to the model (an `[event]` line, the loop's
 * nudge after an empty answer, a tool result) and shows as nobody's words, however
 * it reads; and what a person typed shows, however that reads.
 */
function threadView({ messages, ...thread }: Thread): ThreadView {
  const typed = new Set(thread.turns.flatMap(({ trigger }) => (trigger.kind === 'user' ? [trigger.messageSeq] : [])));
  const fromTheApp = (m: MessageView) => m.role === 'user' && !typed.has(m.seq);
  return { ...thread, messages: messages.map(messageView).filter((m) => m.text !== '' && !fromTheApp(m)) };
}

async function threadQuotes(owner: string, threadId: string): Promise<Quote[]> {
  const quotes = await Promise.all((await threadQuoteIds(owner, threadId)).map((id) => store.quote(owner, id)));
  return quotes.flatMap((q) => (q ? [q] : []));
}

/** The Quote in front of the user, whether or not it is still in time: the Gate's clock has the last word on that. */
async function newestOpenQuote(owner: string, threadId: string): Promise<Quote | undefined> {
  return (await threadQuotes(owner, threadId)).filter((q) => q.state === 'open').sort((a, b) => b.createdAt - a.createdAt)[0];
}

/** The Gate's day: the owner's local calendar day, `yyyy-mm-dd`. */
function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Read from the ledger, because the Gate's own "left" stops at 0 and says nothing once the Allowance is off. */
async function usedToday(owner: string, unit: Unit): Promise<number> {
  const ledger = (await ledgers.get(`${owner}/ledger.json`))?.value;
  if (ledger?.day !== today()) return 0;
  const use = (ledger.unit ?? unit) === unit ? ledger : ledger.other?.[unit];
  return use ? Math.round((use.reserved + use.spent) * 1e6) / 1e6 : 0;
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = Array.isArray(value) ? value.join(' ') : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** RFC 4180: CRLF line ends, and a cell with a comma, a quote or a line end is quoted. */
function auditCsv(rows: AuditRow[]): string {
  const row = (r: AuditRow) =>
    CSV_COLUMNS.map((column) => csvCell(column === 'at' ? new Date(r.at).toISOString() : r[column])).join(',');
  return [CSV_COLUMNS.join(','), ...rows.map(row)].map((line) => `${line}\r\n`).join('');
}

// ---------------------------------------------------------------------------
// A user message

type AssetInput = { key: string; width: number; height: number; name: string };

async function imageBlock(bytes: Buffer) {
  const jpeg = await imageSlot(() =>
    sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
      .autoOrient()
      .resize({ width: LONG_EDGE, height: LONG_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer()
  ).catch((cause: unknown) => {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'That file is not a picture that can be read.', cause });
  });
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } };
}

/** The asset's document and the block the model reads it by: an image as itself, audio as a line naming it. */
async function attachment(input: AssetInput): Promise<{ asset: Asset; block: unknown }> {
  const stored = await getObject(input.key);
  if (!stored) throw refuse('BAD_REQUEST', 'That file is no longer there. Add it again.');
  const bytes = Buffer.from(stored);
  const common = { key: input.key, name: input.name, bytes: bytes.length, addedAt: Date.now() };
  if (AUDIO.test(input.key)) {
    return {
      asset: { ...common, kind: 'audio' },
      block: { type: 'text', text: `Music attached: ${input.name} (${input.key})` },
    };
  }
  return {
    asset: { ...common, kind: 'image', width: input.width, height: input.height },
    block: await imageBlock(bytes),
  };
}

/** What the model is told after a typed yes that released nothing. */
const TOLD: Partial<Record<ReleaseRefused, string>> = {
  unknown_cost: NEEDS_CLICK,
  expired: EXPIRED,
  repriced: REPRICED,
  unpriced: UNPRICED,
};

/**
 * What a typed message does to the Quote in front of the user: anything but a yes
 * declines it, and a yes approves it. A yes that releases nothing, because the Quote
 * has no price (it stays open for its card), had run out of time (the Gate marks it
 * expired), got dearer (a new Quote takes its place) or could not be priced again, is
 * told to the Turn that follows: a person must not read "yes" as done, nor the model
 * answer as if it were. One out of time that gets other words is left to the Gate,
 * which marks it at the next proposal.
 */
async function answerQuote(ctx: Context, owner: string, threadId: string, text: string): Promise<void> {
  const open = await newestOpenQuote(owner, threadId);
  if (!open) return;
  const { approveQuote, servicesFor } = await loadDriver();
  const services = servicesFor(ctx);
  if (!parseYes(text)) {
    if (Date.now() < open.expiresAt) await services.gate.decline(owner, open.id, 'user');
    return;
  }
  const approved = await approveQuote(ctx, owner, services, open.id, 'text');
  if (approved.ok) return;
  const told = TOLD[approved.reason];
  if (told) await store.appendMessage(owner, threadId, { role: 'user', content: [{ type: 'text', text: told }], at: Date.now() });
}

const assetInput = z.object({
  key: z.string().min(1).max(200),
  width: z.number().int().min(0).max(65536),
  height: z.number().int().min(0).max(65536),
  name: z.string().max(200),
});

const sendInput = z.object({
  threadId: z.string().min(1).max(64).optional(),
  // Trimmed here: the yes grammar is anchored and a trailing newline is not a yes.
  text: z.string().trim().min(1, 'Say what you need.').max(4000, 'That message is too long.'),
  assets: z.array(assetInput).max(24, 'A message takes 24 files at most.'),
  mode: z.enum(CHAT_MODES).optional(),
});

function releaseError(reason: Exclude<ReleaseRefused, 'repriced'>): TRPCError {
  if (reason === 'not_found') return refuse('NOT_FOUND', 'That quote is no longer there.');
  if (reason === 'decided') return refuse('CONFLICT', DECIDED);
  if (reason === 'expired') return refuse('PRECONDITION_FAILED', 'That quote has expired. Ask for a new one.');
  if (reason === 'unpriced') return refuse('PRECONDITION_FAILED', 'The price could not be checked, so nothing has started. Try again in a moment.');
  if (reason === 'spec_changed') return refuse('CONFLICT', 'That quote no longer matches what was priced. Ask for a new one.');
  return refuse('PRECONDITION_FAILED', 'That quote cannot be released.');
}

export const chatRouter = router({
  threads: publicProcedure.query(async ({ ctx }): Promise<ThreadSummary[]> => {
    return store.threads(await ownerKey(ctx.req));
  }),

  /** The newest thread when no id is given. `quotes` redraws the cards still in the Gate's index. */
  thread: publicProcedure
    .input(z.object({ id: z.string().min(1).max(64).optional(), since: z.number().int().min(0).optional() }))
    .query(async ({ ctx, input }): Promise<{ thread: ThreadView; events: Event[]; quotes: QuoteView[] } | null> => {
      const owner = await ownerKey(ctx.req);
      const id = input.id ?? (await store.threads(owner))[0]?.id;
      const thread = id ? await store.thread(owner, id) : null;
      if (!thread) return null;
      const after = Math.max(0, (input.since ?? 0) - OVERLAP_SEQS);
      const [events, quotes] = await Promise.all([store.eventsSince(owner, thread.id, after), threadQuotes(owner, thread.id)]);
      return { thread: threadView(thread), events, quotes };
    }),

  /** Keeps the message and starts a Turn in the background. A Turn already running in the thread refuses it. */
  send: signedInProcedure.input(sendInput).mutation(async ({ ctx, input }): Promise<{ threadId: string; turnId: string }> => {
    const owner = await ownerKey(ctx.req);
    const target = await resolveChatTarget(owner);
    if (!target) throw refuse('PRECONDITION_FAILED', NEEDS_KEY);
    if (!input.assets.every((a) => ownsAsset(owner, a.key))) {
      throw refuse('BAD_REQUEST', 'That file is not one of your uploads.');
    }
    const { holdThread, letGo, liveElsewhere, startTurn } = await loadDriver();

    const existing = input.threadId ? await store.thread(owner, input.threadId) : null;
    if (input.threadId && !existing) throw refuse('NOT_FOUND', 'That chat no longer exists.');
    let threadId = existing?.id;
    let hold = existing ? holdThread(owner, existing.id) : null;
    try {
      if (existing && (await liveElsewhere(owner, existing))) throw refuse('CONFLICT', BUSY);
      const read = [];
      // One at a time: a message can hold 24 renders of 25 MB each.
      for (const asset of input.assets) read.push(await attachment(asset));
      if (!threadId) {
        threadId = (await store.createThread(owner, input.text.slice(0, 60))).id;
        hold = holdThread(owner, threadId);
      }
      if (input.mode && input.mode !== existing?.mode) await store.setMode(owner, threadId, input.mode);
      for (const { asset } of read) await store.addAsset(owner, threadId, asset);
      const messageSeq = await store.appendMessage(owner, threadId, {
        role: 'user',
        content: [{ type: 'text', text: input.text }, ...read.map((r) => r.block)],
        at: Date.now(),
      });
      await answerQuote(ctx, owner, threadId, input.text);
      const turnId = await startTurn(ctx, owner, threadId, { kind: 'user', messageSeq }, hold!, target);
      return { threadId, turnId };
    } catch (err) {
      if (threadId && hold) letGo(owner, threadId, hold);
      throw err;
    }
  }),

  /**
   * The click. An approve starts the Run and gives the clock one Tick; the views are
   * as they then stand. A Quote that got dearer starts nothing: the card gets the new
   * Quote to offer and `priceChanged`, the sentence that says why.
   */
  decide: signedInProcedure
    .input(z.object({ quoteId: z.string().min(1).max(64), decision: z.enum(['approve', 'decline']) }))
    .mutation(async ({ ctx, input }): Promise<{ quote: QuoteView; run?: RunView; priceChanged?: string }> => {
      const owner = await ownerKey(ctx.req);
      const { approveQuote, servicesFor, tick } = await loadDriver();
      const services = servicesFor(ctx);
      if (input.decision === 'decline') {
        const quote = await store.quote(owner, input.quoteId);
        if (!quote) throw releaseError('not_found');
        if (quote.state !== 'open') throw releaseError(quote.state === 'expired' ? 'expired' : 'decided');
        return { quote: await services.gate.decline(owner, quote.id, 'user') };
      }
      const approved = await approveQuote(ctx, owner, services, input.quoteId, 'click');
      if (!approved.ok) {
        if (approved.reason === 'repriced') return { quote: approved.quote, priceChanged: PRICE_CHANGED };
        throw releaseError(approved.reason);
      }
      await tick(ctx, owner).catch((err: unknown) => console.warn('[chat] tick', err));
      const run = await store.run(owner, approved.run.id);
      return { quote: approved.quote, run: runView(run ?? approved.run) };
    }),

  stop: signedInProcedure
    .input(z.object({ threadId: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
      const { stopTurn } = await loadDriver();
      stopTurn(await ownerKey(ctx.req), input.threadId);
      return { ok: true };
    }),

  /** Bay's clock. A desktop's Driver ticks by itself, and a visitor with no session has nothing to advance. */
  tick: publicProcedure.query(async ({ ctx }): Promise<{ advanced: number }> => {
    if (process.env['BAY_ENV'] === 'desktop') return { advanced: 0 };
    const owner = await ownerKey(ctx.req);
    const { tick } = await loadDriver();
    return tick(ctx, owner);
  }),

  runs: publicProcedure
    .input(z.object({ active: z.boolean().optional() }))
    .query(async ({ ctx, input }): Promise<RunView[]> => {
      const runs = await store.runs(await ownerKey(ctx.req), input.active ? { active: true } : {});
      return runs.map(runView);
    }),

  run: signedInProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .query(async ({ ctx, input }): Promise<RunView | null> => {
      const run = await store.run(await ownerKey(ctx.req), input.id);
      return run ? runView(run) : null;
    }),

  allowance: publicProcedure.query(async ({ ctx }): Promise<{ unit: Unit; perDay: number; usedToday: number }> => {
    const owner = await ownerKey(ctx.req);
    const { unit, allowancePerDay: perDay } = await readChatSettings(owner);
    return { unit, perDay, usedToday: await usedToday(owner, unit) };
  }),

  setAllowance: signedInProcedure
    .input(z.object({ perDay: z.number().min(0).max(100_000) }))
    .mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
      await writeChatSettings(await ownerKey(ctx.req), { allowancePerDay: input.perDay });
      return { ok: true };
    }),

  auditCsv: signedInProcedure
    .input(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A day looks like 2026-10-31.').optional() }))
    .query(async ({ ctx, input }): Promise<string> => {
      return auditCsv(await store.audit(await ownerKey(ctx.req), input.day));
    }),
});
