// The chat agent's five read tools (PLAN-13 section 5): project_get, library_search,
// image_inspect, run_get, capabilities_get. All free, none changes anything. Each is a thin
// adapter over a seam the loop hands it (the existing routers through createCaller, the chat
// Store, the Run engine's snapshot, the provider's capabilities and the stored assets), so
// the tools import no concrete adapter. A text answer is one JSON block under 4000
// characters and carries ids and keys, never a URL; an image answer is one JPEG block and a
// caption.
import sharp from 'sharp';

import type { Capabilities } from '../../capabilities.ts';
import { readCapped } from '../../imaging.ts';
import type { Clip, Still } from '../../library.ts';
import { ANIMATE_VIDEO_MODELS } from '../../models.ts';
import { safeFetch } from '../../safe-fetch.ts';
import { clipAutoTags, stillAutoTags } from '../../tags.ts';
import { parseToolInput, TOOLS, type ToolInputs, type ToolName } from '../contracts.ts';
import type { Quote, ToolImpl, ToolRunCtx } from '../domain.ts';
import { runView } from '../pipeline.ts';

type Result = { content: unknown[]; isError?: boolean };

const MAX_TEXT = 4000;
/** The long edge an image answer is fitted to, and the ceiling no answer passes. */
const LONG_EDGE = 1920;
const MAX_EDGE = 3000;
const JPEG_QUALITY = 85;
/** A run's label can be the raw provider error; this is all of it a listing carries. */
const MAX_LABEL = 200;
const DEFAULT_LIMIT = 12;
/** Rates are one line per model alias; more than this is a catalogue, not an answer. */
const MAX_RATES = 24;

// ---------------------------------------------------------------------------
// Answers

const fail = (message: string): Result => ({ content: [{ type: 'text', text: message }], isError: true });
const answer = (value: unknown): Result => ({ content: [{ type: 'text', text: fit(value) }] });

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

type Listed = { label: string; total: number };

/**
 * Every array reachable from `node`, labelled by the key that holds it. `outer` gets the
 * arrays that hold a non-empty array of their own. True when `node` is or holds a non-empty array.
 */
function listsIn(node: unknown, label: string, out: Map<unknown[], string>, outer: Set<unknown[]>): boolean {
  if (Array.isArray(node)) {
    out.set(node, label);
    let holds = false;
    for (const item of node) holds = listsIn(item, label, out, outer) || holds;
    if (holds) outer.add(node);
    return node.length > 0;
  }
  if (node !== null && typeof node === 'object') {
    let holds = false;
    for (const [key, value] of Object.entries(node)) holds = listsIn(value, key, out, outer) || holds;
    return holds;
  }
  return false;
}

/**
 * JSON text under MAX_TEXT. When the value is longer, the biggest innermost list gives up
 * its tail until it fits, and a note says how much is shown (a trailing element of a bare
 * array, a `note` field of an object).
 */
function fit(value: unknown): string {
  let text = JSON.stringify(value);
  if (text.length <= MAX_TEXT) return text;
  const root: unknown = JSON.parse(text);
  const first = new Map<unknown[], string>();
  listsIn(root, 'results', first, new Set());
  const whole = new Map<unknown[], Listed>([...first].map(([list, label]) => [list, { label, total: list.length }]));
  for (;;) {
    const now = new Map<unknown[], string>();
    const outer = new Set<unknown[]>();
    listsIn(root, 'results', now, outer);
    const cut = [...now.keys()].filter((list) => list.length < (whole.get(list)?.total ?? list.length));
    const note = `Showing ${cut.map((l) => `${l.length} of ${whole.get(l)!.total} ${whole.get(l)!.label}`).join(', ')}. The rest is left out.`;
    const noted = Array.isArray(root) ? [...root, { note }] : { ...(root as object), note };
    text = JSON.stringify(cut.length ? noted : root);
    if (text.length <= MAX_TEXT) return text;
    let biggest: unknown[] | undefined;
    let size = 0;
    for (const list of now.keys()) {
      const n = list.length && !outer.has(list) ? JSON.stringify(list).length : 0;
      if (n > size) [biggest, size] = [list, n];
    }
    if (!biggest) return JSON.stringify({ note: 'The answer was too large to show.' });
    biggest.length -= Math.max(1, Math.ceil(biggest.length / 4));
  }
}

const reasonOf = (err: unknown): string => clip(err instanceof Error && err.message ? err.message : 'That did not work.', 300);

/** A tool: its contract definition, input validated, a thrown error turned into one sentence. */
function tool<N extends ToolName>(name: N, body: (input: ToolInputs[N], ctx: ToolRunCtx) => Promise<Result>): ToolImpl {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) throw new Error(`contracts.ts has no tool ${name}`);
  return {
    def,
    async run(input, ctx) {
      const parsed = parseToolInput(name, input);
      if (!parsed.ok) return fail(parsed.message);
      try {
        return await body(parsed.value, ctx);
      } catch (err) {
        return fail(reasonOf(err));
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Names

const stillName = (s: Still): string =>
  s.lifestyle?.title ?? s.storyboard?.title ?? s.closeup?.subject ?? `Still ${s.id.slice(0, 8)}`;

function clipName(c: Clip, stills: Still[]): string {
  const source = stills.find((s) => s.id === c.stillId);
  return [source ? stillName(source) : 'Clip', c.motion, c.seconds ? `${c.seconds}s` : ''].filter(Boolean).join(', ');
}

/** The tags a search reads: the visitor's own, then the ones derived from the settings. */
function tagsOf(own: string[] | undefined, derive: () => string[]): string[] {
  try {
    return [...(own ?? []), ...derive()];
  } catch {
    // A damaged row must not take the whole search down.
    return own ?? [];
  }
}

// ---------------------------------------------------------------------------
// project_get

/** Open quotes of the thread. The Store lists none, so they are found through the events that name them. */
async function openQuotes(ctx: ToolRunCtx): Promise<Quote[]> {
  const ids = new Set<string>();
  for (const ev of await ctx.store.eventsSince(ctx.owner, ctx.threadId, 0)) {
    const id = ev.payload['quoteId'];
    if (typeof id === 'string') ids.add(id);
  }
  const now = Date.now();
  const found = await Promise.all([...ids].map((id) => ctx.store.quote(ctx.owner, id)));
  return found.filter((q): q is Quote => q !== null && q.threadId === ctx.threadId && q.state === 'open' && q.expiresAt > now);
}

/** The edit as it stands, for `timeline_edit`'s baseRev; a chat with no edit yet reads as none. */
async function editOf(ctx: ToolRunCtx) {
  try {
    const { rev, transition, fadeSeconds, timeline } = await ctx.trpc.edit.project();
    const cuts = timeline.map(({ clipId, sourceStart, duration }) => ({ clipId, sourceStart, duration }));
    return { rev, transition, fadeSeconds, cuts };
  } catch {
    return null;
  }
}

const projectGet = tool('project_get', async (_input, ctx) => {
  // The thread this turn runs in, whatever id the model passed: it can only read its own.
  const thread = await ctx.store.thread(ctx.owner, ctx.threadId);
  if (!thread) return fail('This chat was not found.');
  const [runs, quotes, library, edit] = await Promise.all([
    ctx.store.runs(ctx.owner, { threadId: ctx.threadId }),
    openQuotes(ctx),
    ctx.trpc.library(),
    editOf(ctx),
  ]);
  return answer({
    assets: thread.assets.map((a) => ({ key: a.key, name: a.name, width: a.width, height: a.height })),
    runs: [...runs]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => {
        const v = runView(r);
        return { id: v.id, kind: v.kind, state: v.state, percent: v.percent, label: clip(v.label, MAX_LABEL) };
      }),
    openQuotes: quotes.map((q) => ({
      id: q.id,
      kind: q.spec.kind,
      amount: q.amount,
      unit: q.unit,
      expiresAt: q.expiresAt,
    })),
    library: { stills: library.stills.length, clips: library.clips.length },
    edit,
  });
});

// ---------------------------------------------------------------------------
// library_search

type Row = { id: string; name: string; status: string; kind: 'still' | 'clip' | 'edit'; at: number; words: string[] };

const libraryRows = {
  async still(ctx: ToolRunCtx): Promise<Row[]> {
    const { stills } = await ctx.trpc.library();
    return stills.map((s) => ({
      id: s.id,
      name: stillName(s),
      status: s.status,
      kind: 'still',
      at: Date.parse(s.createdAt),
      words: tagsOf(s.tags, () => stillAutoTags(s)),
    }));
  },
  async clip(ctx: ToolRunCtx): Promise<Row[]> {
    const { stills, clips } = await ctx.trpc.library();
    return clips.map((c) => ({
      id: c.id,
      name: clipName(c, stills),
      status: c.status,
      kind: 'clip',
      at: Date.parse(c.createdAt),
      words: tagsOf(c.tags, () => clipAutoTags(c, stills.find((s) => s.id === c.stillId))),
    }));
  },
  /** The Edit tab keeps films as exports of its timeline. */
  async edit(ctx: ToolRunCtx): Promise<Row[]> {
    const { exports } = await ctx.trpc.edit.project();
    return exports.map((e) => ({
      id: e.id,
      name: `Film, ${e.cuts} ${e.cuts === 1 ? 'cut' : 'cuts'}, ${Math.round(e.seconds)}s`,
      status: e.status,
      kind: 'edit',
      at: Date.parse(e.createdAt),
      words: [],
    }));
  },
};

const librarySearch = tool('library_search', async (input, ctx) => {
  const query = input.query?.trim().toLowerCase() ?? '';
  const rows = (await libraryRows[input.kind](ctx))
    .filter((r) => !query || [r.name, ...r.words].some((w) => w.toLowerCase().includes(query)))
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, input.limit ?? DEFAULT_LIMIT);
  return answer(rows.map(({ id, name, status, kind }) => ({ id, name, status, kind })));
});

// ---------------------------------------------------------------------------
// image_inspect

/** What `chat-assets/<owner>/` keys look like: one file name below the owner's folder. */
function ownAsset(owner: string, key: string): boolean {
  const prefix = `chat-assets/${owner}/`;
  return key.startsWith(prefix) && /^[A-Za-z0-9][\w.-]*$/.test(key.slice(prefix.length));
}

/** The bytes and the name of the picture the input points at; a string when it cannot be had. */
async function pictureOf(
  input: ToolInputs['image_inspect'],
  ctx: ToolRunCtx
): Promise<{ bytes: Buffer; name: string } | string> {
  if (input.assetKey !== undefined) {
    const key = input.assetKey;
    if (!ownAsset(ctx.owner, key)) return 'That is not one of the renders uploaded to this chat.';
    const thread = await ctx.store.thread(ctx.owner, ctx.threadId);
    const name = thread?.assets.find((a) => a.key === key)?.name ?? key.slice(key.lastIndexOf('/') + 1);
    try {
      return { bytes: await ctx.readAsset(key), name };
    } catch {
      return 'That uploaded render could not be read.';
    }
  }
  const id = input.stillId!;
  const still = (await ctx.trpc.library()).stills.find((s) => s.id === id);
  if (!still) return 'That still is not in the library.';
  if (still.status !== 'succeeded') return 'That still is not finished yet.';
  // The same poll the Still tab shows: a marked edit answers as its composite, never the raw result.
  const { url } = await ctx.trpc.shotStatus({ id });
  if (!url) return 'That still has no picture to show yet.';
  try {
    // Timed and size-capped as the other image paths are; a stalled or endless body ends here.
    return { bytes: await readCapped(url, 'still', safeFetch), name: stillName(still) };
  } catch {
    return 'That still could not be fetched.';
  }
}

const imageInspect = tool('image_inspect', async (input, ctx) => {
  const picture = await pictureOf(input, ctx);
  if (typeof picture === 'string') return fail(picture);
  const { bytes, name } = picture;
  let meta: sharp.Metadata;
  try {
    meta = await sharp(bytes).metadata();
  } catch {
    return fail('That file is not a picture that can be read.');
  }
  // The region is in the upright picture; an EXIF turn of a quarter swaps its sides.
  const quarter = (meta.orientation ?? 1) >= 5;
  const width = (quarter ? meta.height : meta.width) ?? 0;
  const height = (quarter ? meta.width : meta.height) ?? 0;
  if (!width || !height) return fail('That file is not a picture that can be read.');
  let pipeline = sharp(bytes).rotate();
  const r = input.region;
  if (r) {
    const left = Math.min(Math.round(r.x * width), width - 1);
    const top = Math.min(Math.round(r.y * height), height - 1);
    pipeline = pipeline.extract({
      left,
      top,
      width: Math.max(1, Math.min(Math.round(r.w * width), width - left)),
      height: Math.max(1, Math.min(Math.round(r.h * height), height - top)),
    });
  }
  const edge = Math.min(LONG_EDGE, MAX_EDGE);
  const { data, info } = await pipeline
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer({ resolveWithObject: true });
  return {
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: data.toString('base64') } },
      { type: 'text', text: `${info.width}x${info.height} ${r ? 'crop of ' : ''}${name}` },
    ],
  };
});

// ---------------------------------------------------------------------------
// run_get

/** The plan a `direct_shot` asked for: no other tool can read its taskId. */
async function shotPlanOf(taskId: string, ctx: ToolRunCtx) {
  const status = await ctx.trpc.shot.status({ taskId }).catch(() => null);
  if (!status) return fail('There is no run with that id.');
  if (status.status === 'failed') return fail(status.error);
  return answer(status.status === 'done' ? { status: 'done', plan: status.raw } : { status: 'running' });
}

const runGet = tool('run_get', async (input, ctx) => {
  const v = await ctx.runs.snapshot(ctx.owner, input.runId);
  if (!v) return shotPlanOf(input.runId, ctx);
  return answer({
    id: v.id,
    kind: v.kind,
    state: v.state,
    percent: v.percent,
    label: clip(v.label, MAX_LABEL),
    error: v.error === undefined ? undefined : clip(v.error, 300),
    quoteId: v.quoteId,
    spec: v.spec,
    steps: v.steps.map((s) => ({
      id: s.id,
      state: s.state,
      ids: s.ids,
      jobId: s.jobId,
      error: s.error === undefined ? undefined : clip(s.error, 300),
    })),
    outputs: v.outputs,
  });
});

// ---------------------------------------------------------------------------
// capabilities_get

const capabilitiesGet = tool('capabilities_get', async (_input, ctx) => {
  // `master` is the desktop's mastering flag; a provider row without it cannot master.
  const caps = ctx.capabilities() as Capabilities & { master?: boolean };
  const rates = Object.entries(caps.rates ?? {});
  return answer({
    provider: caps.provider,
    imageModels: caps.imageModels,
    // A Run never uses the models kept for Recreate in 4K, so the model is not offered them.
    videoModels: caps.videoModels.filter((id) => ANIMATE_VIDEO_MODELS.some((m) => m.id === id)),
    master: caps.master === true,
    rates: Object.fromEntries(rates.slice(0, MAX_RATES)),
    note: rates.length > MAX_RATES ? `Showing ${MAX_RATES} of ${rates.length} rates.` : undefined,
  });
});

/** The five read tools, in the order the contract lists them. */
export const readTools: ToolImpl[] = [projectGet, librarySearch, imageInspect, runGet, capabilitiesGet];
