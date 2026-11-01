import type { IncomingMessage } from 'node:http';

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { resolveChatTarget } from './ai-text.ts';
import {
  ANTHROPIC_MODELS,
  AiTextError,
  defaultModelFor,
  listOmegaModels,
  type TextProvider,
  verifyKey,
} from './ai-text/providers.ts';
import { readUsage } from './ai-text/usage.ts';
import { type Capabilities, capabilitiesOf } from './capabilities.ts';
import {
  DEFAULT_GENERATION_BUDGET,
  isPresetId,
  maskKey,
  newServerId,
  publicView,
  readChatSettings,
  readConnections,
  summarizeTools,
  updateConnections,
  updateServer,
  withSession,
  writeChatSettings,
} from './connections.ts';
import { ownerKey, readLibrary } from './library.ts';
import { createSeevioVideo, getSeevioTask, verifySeevioKey } from './seevio.ts';
import { SIDECAR_LABELS, type SidecarId, type SidecarStatus } from './sidecars.ts';
import { publicProcedure, router } from './trpc.ts';

/**
 * The Settings tab: Runway sign-in status, Runway MCP, Higgsfield and other MCP servers
 * (sign in, test, run a tool), provider API keys (Seevio, Anthropic,
 * OmegaPlus, the Runway API), who answers the app's text-and-vision calls and
 * the chat agent's model and Allowance; in the desktop app also who generates
 * (Higgsfield or the Runway API) and the power tools (sidecars). Every
 * credential stays on the server in the visitor's own `connections/`
 * document (src/connections.ts); answers carry only what the page shows.
 */

const serverId = z.string().min(1).max(64);
const aiTextProvider = z.enum(['anthropic', 'omegaplus']);
const sidecarId = z.enum(['filmcraft', 'lightcraft']);

/** The server's bound for the Allowance, per day in its own unit. */
const ALLOWANCE_MAX = 100_000;

/** What a chat setting may be. `ChatSettings.effort` has one value, so that is the only one taken. */
const chatSettings = z.object({
  model: z
    .string()
    .refine((id) => ANTHROPIC_MODELS.some((m) => m.id === id), 'That model is not available on Anthropic.')
    .optional(),
  effort: z.literal('high').optional(),
  allowancePerDay: z.number().min(0).max(ALLOWANCE_MAX).optional(),
  unit: z.enum(['credits', 'usd']).optional(),
});

const providerName = (provider: TextProvider) => (provider === 'anthropic' ? 'Anthropic' : 'OmegaPlus');
const keyMissing = (provider: TextProvider) =>
  new TRPCError({ code: 'BAD_REQUEST', message: `Save an ${providerName(provider)} API key first.` });

async function serverOrThrow(owner: string, id: string) {
  const server = (await readConnections(owner)).servers.find((s) => s.id === id);
  if (!server) throw new TRPCError({ code: 'NOT_FOUND', message: 'That MCP server is no longer in your settings.' });
  return server;
}

/** The app-wide key, set as a secret in Runway App Studio (App settings → Secrets). */
function seevioAppKey(): string | undefined {
  return process.env['SEEVIO_API_KEY']?.trim() || undefined;
}

/** The visitor's own key wins; otherwise the app's `SEEVIO_API_KEY` secret. */
async function seevioKeyOrThrow(owner: string): Promise<string> {
  const key = (await readConnections(owner)).apiKeys.seevio?.key ?? seevioAppKey();
  if (!key) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Add your Seevio API key in Settings, or set a SEEVIO_API_KEY secret for the app.' });
  }
  return key;
}

/** What the desktop app's client adds to `ctx.runway`; Bay's client has none of it. */
interface DesktopClient {
  account?: () => Promise<{
    label: string;
    email?: string | undefined;
    credits?: number | undefined;
    signedIn: boolean;
  } | null>;
  /** Rejects when the key does not work, with `status` 401 or 403 when Runway refused it. */
  verifyRunwayKey?: (key: string) => Promise<unknown>;
  higgsfield?: {
    login: () => Promise<unknown>;
    logout: () => Promise<unknown>;
    status: () => Promise<
      { path: string; version: string; bundled: boolean } | { missing: true; install: string }
    >;
  };
}

const desktopClient = (runway: unknown) => runway as DesktopClient | undefined;

/** Who can generate here: nobody to choose on Bay; the simulator only when the server was started with it. */
function generationOptions(caps: Capabilities) {
  if (!caps.desktop) return [];
  const options: { id: 'higgsfield' | 'runway' | 'simulator'; name: string }[] = [
    { id: 'higgsfield', name: 'Higgsfield' },
    { id: 'runway', name: 'Runway API' },
  ];
  if (process.env['RTF_SIMULATOR'] === '1') options.push({ id: 'simulator', name: 'Simulator' });
  return options;
}

type SidecarProgress = { received: number; total: number | null };

/** What this router calls in desktop/platform/sidecars.js. */
interface SidecarsModule {
  status: (id: SidecarId) => Promise<SidecarStatus>;
  setPath: (id: SidecarId, file: string) => Promise<SidecarStatus>;
  download: (id: SidecarId, options: { onProgress: (progress: SidecarProgress) => void }) => Promise<string>;
  remove: (id: SidecarId) => Promise<void>;
}

/** A sidecar's status, with the download this server is running or last lost. */
export type SidecarRow = SidecarStatus & { download: SidecarProgress | null; downloadError: string | null };

/**
 * The downloads by tool: `progress` while one runs, the sentence when the last
 * one failed. The desktop server is one process for one person, so memory is
 * enough: a restart loses a sentence, and sidecars.js sweeps its own work folder.
 */
const sidecarDownloads = new Map<SidecarId, { progress: SidecarProgress | null; error: string | null }>();

const sidecarIds = Object.keys(SIDECAR_LABELS) as SidecarId[];
const sidecarBusy = () => new TRPCError({ code: 'CONFLICT', message: 'This tool is already downloading.' });

/**
 * desktop/platform/sidecars.js, which `bay deploy` never sees: desktop/ is left
 * out of the Bay image, where `pnpm run build` runs tsc and esbuild. So the
 * compiler is told to expect the missing file, and the `try` is what lets
 * esbuild leave an import it cannot find; the desktop build bundles this one.
 */
async function sidecarsModule(): Promise<SidecarsModule> {
  try {
    // @ts-expect-error No types here either way: untyped JS on desktop, no file at all on Bay.
    return (await import('../desktop/platform/sidecars.js')) as SidecarsModule;
  } catch (cause) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Power tools did not load.', cause });
  }
}

/** Signed in and in the desktop app, like every write on the Generation card. */
async function sidecarsOrThrow(ctx: { req: IncomingMessage; runway: unknown }) {
  if (!capabilitiesOf(ctx.runway).desktop) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Power tools are a desktop setting.' });
  }
  await ownerKey(ctx.req);
  return sidecarsModule();
}

/**
 * The download state is read before the status, so a row never says the
 * download is over while its status is from before the install.
 */
async function sidecarRow(sidecars: SidecarsModule, id: SidecarId): Promise<SidecarRow> {
  const running = sidecarDownloads.get(id);
  const status = await sidecars.status(id);
  // A tool that works ends the last failure for good, however it came to work.
  if (status.ok && !sidecarDownloads.get(id)?.progress) sidecarDownloads.delete(id);
  return { ...status, download: running?.progress ?? null, downloadError: status.ok ? null : (running?.error ?? null) };
}

/** sidecars.js refuses in one sentence with no path in it, so that sentence is the answer. */
function sidecarRefusal(err: unknown) {
  const message = err instanceof Error ? err.message : 'That did not work. Try it again.';
  return new TRPCError({ code: 'UNPROCESSABLE_CONTENT', message });
}

export const settingsRouter = router({
  /** Runway session state for the Runway card; `signInUrl` opens the popup. */
  runway: publicProcedure.query(({ ctx }) => ({
    signedIn: !!ctx.runway,
    viewer: ctx.viewer,
    signInUrl: ctx.signInUrl ?? null,
  })),

  /** What this server offers; no `capabilities()` on the client means Bay, which offers everything. */
  capabilities: publicProcedure.query(({ ctx }) => capabilitiesOf(ctx.runway)),

  /**
   * The desktop app's paid runs held up for a key, for the shell's notice: a
   * live task says why in its `error`. The sentence comes from the provider,
   * the count from the library's pending takes.
   */
  waitingRuns: publicProcedure.query(async ({ ctx }): Promise<{ count: number; message?: string | undefined }> => {
    if (!capabilitiesOf(ctx.runway).desktop) return { count: 0 };
    const lib = await readLibrary(await ownerKey(ctx.req));
    const pending = [...lib.stills, ...lib.clips].filter((item) => item.status === 'pending');
    const snaps = await Promise.all(pending.map((item) => ctx.runway?.taskSnapshot(item.id).catch(() => null)));
    const waits = snaps.flatMap((snap) => (snap && !snap.done && snap.error ? [snap.error] : []));
    return { count: waits.length, message: waits[0] };
  }),

  /** The Generation card: the provider, its daily budget, who to choose from and the account behind it. */
  generation: publicProcedure.query(async ({ ctx }) => {
    const owner = await ownerKey(ctx.req);
    const caps = capabilitiesOf(ctx.runway);
    const saved = (await readConnections(owner)).generation;
    const account = await desktopClient(ctx.runway)?.account?.().catch(() => null);
    return {
      provider: saved?.provider ?? caps.provider,
      budget: saved?.budget ?? DEFAULT_GENERATION_BUDGET,
      options: generationOptions(caps),
      account: account ?? null,
    };
  }),

  /** Desktop only. Leaving `budget` out keeps the saved one. */
  setGeneration: publicProcedure
    .input(
      z.object({
        provider: z.enum(['higgsfield', 'runway', 'simulator']),
        budget: z.number().int().min(0).max(100000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const caps = capabilitiesOf(ctx.runway);
      if (!caps.desktop) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choosing a provider is a desktop setting.' });
      }
      if (!generationOptions(caps).some((o) => o.id === input.provider)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That provider is not offered here.' });
      }
      const owner = await ownerKey(ctx.req);
      const updatedAt = new Date().toISOString();
      await updateConnections(owner, (doc) => ({
        ...doc,
        generation: { provider: input.provider, budget: input.budget ?? doc.generation?.budget, updatedAt },
      }));
    }),

  /** The Chat card: what the agent runs on, and whether it can run. It needs an Anthropic or OmegaPlus key. */
  chat: publicProcedure.query(async ({ ctx }) => {
    const owner = await ownerKey(ctx.req);
    const [settings, target] = await Promise.all([readChatSettings(owner), resolveChatTarget(owner)]);
    return { ...settings, provider: target?.provider ?? ('runway' as const), ready: target !== null, models: ANTHROPIC_MODELS };
  }),

  /** Saves the fields sent; the others keep what they were. */
  setChat: publicProcedure
    .input(chatSettings)
    .mutation(async ({ ctx, input }) => writeChatSettings(await ownerKey(ctx.req), input)),

  /** The Power tools card; nothing on Bay, where the module is not even in the image. */
  sidecars: publicProcedure.query(async ({ ctx }): Promise<SidecarRow[]> => {
    if (!capabilitiesOf(ctx.runway).desktop) return [];
    const sidecars = await sidecarsOrThrow(ctx);
    return Promise.all(sidecarIds.map((id) => sidecarRow(sidecars, id)));
  }),

  /** Starts the user's download and answers at once; `sidecars` shows how it goes. */
  sidecarDownload: publicProcedure.input(z.object({ id: sidecarId })).mutation(async ({ ctx, input }) => {
    const sidecars = await sidecarsOrThrow(ctx);
    const { id } = input;
    if (sidecarDownloads.get(id)?.progress) throw sidecarBusy();
    const state = { progress: { received: 0, total: null } as SidecarProgress, error: null };
    sidecarDownloads.set(id, state);
    // Not awaited: it can take minutes, and its end is reported through `sidecars`.
    void sidecars
      .download(id, {
        onProgress: (progress) => {
          state.progress = progress;
        },
      })
      .then(
        () => sidecarDownloads.delete(id),
        (err: unknown) => {
          const error = err instanceof Error ? err.message : 'The download failed. Try it again.';
          sidecarDownloads.set(id, { progress: null, error });
        }
      );
    return { started: true as const };
  }),

  /** Deletes our download and forgets a saved path; a file the user keeps elsewhere stays, and the answer shows it. */
  sidecarRemove: publicProcedure.input(z.object({ id: sidecarId })).mutation(async ({ ctx, input }) => {
    const sidecars = await sidecarsOrThrow(ctx);
    if (sidecarDownloads.get(input.id)?.progress) throw sidecarBusy();
    await sidecars.remove(input.id).catch((err: unknown) => {
      throw sidecarRefusal(err);
    });
    sidecarDownloads.delete(input.id);
    return sidecarRow(sidecars, input.id);
  }),

  /**
   * Keeps a file the user chose once it answers with the pinned version; the answer says what it found either way.
   * Refused during a download, which ends by replacing any saved choice.
   */
  sidecarSetPath: publicProcedure
    .input(z.object({ id: sidecarId, path: z.string().trim().min(1, 'Enter the path to the program.').max(4096) }))
    .mutation(async ({ ctx, input }) => {
      const sidecars = await sidecarsOrThrow(ctx);
      if (sidecarDownloads.get(input.id)?.progress) throw sidecarBusy();
      return sidecars.setPath(input.id, input.path).catch((err: unknown) => {
        throw sidecarRefusal(err);
      });
    }),

  /** Runs the CLI's own browser sign-in, which the app never sees; answers once it has finished. */
  higgsfieldLogin: publicProcedure.mutation(async ({ ctx }) => {
    const higgsfield = desktopClient(ctx.runway)?.higgsfield;
    if (!higgsfield) return { supported: false as const };
    try {
      await higgsfield.login();
    } catch {
      throw new TRPCError({ code: 'UNPROCESSABLE_CONTENT', message: 'Higgsfield sign-in did not finish. Try again.' });
    }
    return { supported: true as const };
  }),

  higgsfieldLogout: publicProcedure.mutation(async ({ ctx }) => {
    const higgsfield = desktopClient(ctx.runway)?.higgsfield;
    if (!higgsfield) return { supported: false as const };
    await higgsfield.logout();
    return { supported: true as const };
  }),

  /** Which Higgsfield CLI the app would run, or how to install one. */
  higgsfieldStatus: publicProcedure.query(async ({ ctx }) => {
    const higgsfield = desktopClient(ctx.runway)?.higgsfield;
    if (!higgsfield) return { supported: false as const };
    return { supported: true as const, ...(await higgsfield.status()) };
  }),

  connections: publicProcedure.query(async ({ ctx }) => {
    const owner = await ownerKey(ctx.req);
    const doc = await readConnections(owner);
    return {
      servers: doc.servers.map(publicView),
      apiKeys: { seevio: maskKey(doc.apiKeys.seevio), runwayapi: maskKey(doc.apiKeys.runwayapi) },
      /** Whether the app has a `SEEVIO_API_KEY` secret to fall back on. */
      seevioAppKey: !!seevioAppKey(),
    };
  }),

  addServer: publicProcedure
    .input(
      z.object({
        name: z.string().trim().min(1, 'Give the server a name.').max(60),
        url: z
          .string()
          .trim()
          .url('Enter the full server address, starting with https://')
          .refine((u) => u.startsWith('https://') || u.startsWith('http://localhost'), 'Use an https:// address.'),
        token: z.string().trim().max(4096).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      const id = newServerId();
      await updateConnections(owner, (doc) => {
        if (doc.servers.length >= 20) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'You have 20 servers already. Remove one first.' });
        }
        return {
          ...doc,
          servers: [
            ...doc.servers,
            {
              id,
              name: input.name,
              url: input.url,
              enabled: true,
              auth: input.token ? { kind: 'bearer', token: input.token } : { kind: 'none' },
            },
          ],
        };
      });
      return { id };
    }),

  removeServer: publicProcedure.input(z.object({ id: serverId })).mutation(async ({ ctx, input }) => {
    if (isPresetId(input.id)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Built-in servers stay listed. Sign out of it instead.' });
    }
    const owner = await ownerKey(ctx.req);
    await updateConnections(owner, (doc) => ({ ...doc, servers: doc.servers.filter((s) => s.id !== input.id) }));
  }),

  setEnabled: publicProcedure
    .input(z.object({ id: serverId, enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      await updateServer(owner, input.id, (s) => ({ ...s, enabled: input.enabled }));
    }),

  /** Use a pasted access token instead of OAuth (servers without sign-in). */
  setToken: publicProcedure
    .input(z.object({ id: serverId, token: z.string().trim().min(1, 'Paste the token first.').max(4096) }))
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      await updateServer(owner, input.id, (s) => ({
        ...s,
        auth: { kind: 'bearer', token: input.token },
        connectedAt: new Date().toISOString(),
        lastError: undefined,
      }));
    }),

  /** Forget the server's tokens (sign out); the server itself stays listed. */
  disconnect: publicProcedure.input(z.object({ id: serverId })).mutation(async ({ ctx, input }) => {
    const owner = await ownerKey(ctx.req);
    await updateServer(owner, input.id, (s) => ({
      ...s,
      auth: { kind: 'none' },
      connectedAt: undefined,
      lastError: undefined,
      tools: undefined,
    }));
  }),

  /** Opens a session, lists the tools and remembers them. */
  test: publicProcedure.input(z.object({ id: serverId })).mutation(async ({ ctx, input }) => {
    const owner = await ownerKey(ctx.req);
    const server = await serverOrThrow(owner, input.id);
    const { serverName, tools } = await withSession(owner, server, async (session) => ({
      serverName: session.serverName,
      tools: await session.listTools(),
    }));
    await updateServer(owner, input.id, (s) => ({
      ...s,
      tools: summarizeTools(tools),
      connectedAt: s.connectedAt ?? new Date().toISOString(),
      lastError: undefined,
    }));
    return { serverName: serverName ?? null, toolCount: tools.length };
  }),

  /** One tool's input schema, for the tool runner's argument hint. */
  toolSchema: publicProcedure
    .input(z.object({ id: serverId, name: z.string().min(1).max(200) }))
    .query(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      const server = await serverOrThrow(owner, input.id);
      const tools = await withSession(owner, server, (session) => session.listTools());
      return tools.find((t) => t.name === input.name)?.inputSchema ?? null;
    }),

  /**
   * Runs one tool on one of the visitor's servers. On Higgsfield a
   * generation spends their own Higgsfield credits.
   */
  callTool: publicProcedure
    .input(
      z.object({
        id: serverId,
        name: z.string().min(1).max(200),
        args: z.record(z.string(), z.unknown()).default({}),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      const server = await serverOrThrow(owner, input.id);
      if (!server.enabled) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `${server.name} is turned off in Settings.` });
      }
      return withSession(owner, server, (session) => session.callTool(input.name, input.args));
    }),

  setSeevioKey: publicProcedure
    .input(z.object({ key: z.string().trim().min(8, 'That looks too short to be a Seevio key.').max(512) }))
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      await verifySeevioKey(input.key);
      const now = new Date().toISOString();
      await updateConnections(owner, (doc) => ({
        ...doc,
        apiKeys: { ...doc.apiKeys, seevio: { key: input.key, savedAt: now, verifiedAt: now } },
      }));
    }),

  clearSeevioKey: publicProcedure.mutation(async ({ ctx }) => {
    const owner = await ownerKey(ctx.req);
    await updateConnections(owner, (doc) => {
      const { seevio: _removed, ...rest } = doc.apiKeys;
      return { ...doc, apiKeys: rest };
    });
  }),

  /** The desktop app's Runway API key; checked with Runway first when the client can. */
  setRunwayApiKey: publicProcedure
    .input(z.object({ key: z.string().trim().min(8, 'That looks too short to be a Runway API key.').max(512) }))
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      const verify = desktopClient(ctx.runway)?.verifyRunwayKey;
      try {
        await verify?.call(ctx.runway, input.key);
      } catch (err) {
        // No `cause` and none of its text: nothing here may carry the key into a log line or an answer.
        const { status } = err as { status?: number };
        throw new TRPCError({
          code: 'UNPROCESSABLE_CONTENT',
          message:
            status === 401 || status === 403
              ? 'The Runway API refused that key. Check it and try again.'
              : 'The Runway API could not check that key. Try again in a moment.',
        });
      }
      const now = new Date().toISOString();
      await updateConnections(owner, (doc) => ({
        ...doc,
        apiKeys: { ...doc.apiKeys, runwayapi: { key: input.key, savedAt: now, verifiedAt: verify ? now : undefined } },
      }));
    }),

  clearRunwayApiKey: publicProcedure.mutation(async ({ ctx }) => {
    const owner = await ownerKey(ctx.req);
    await updateConnections(owner, (doc) => {
      const { runwayapi: _removed, ...rest } = doc.apiKeys;
      return { ...doc, apiKeys: rest };
    });
  }),

  /**
   * The AI text and vision card: who answers the `claude_api` calls, the
   * saved keys (last four only), the models to pick from and what the
   * visitor's own keys have been used for.
   */
  aiText: publicProcedure.query(async ({ ctx }) => {
    const owner = await ownerKey(ctx.req);
    const [doc, omega, usage] = await Promise.all([readConnections(owner), listOmegaModels(), readUsage(owner)]);
    const provider = doc.aiText?.provider ?? 'runway';
    // The model a call would use: the saved one while the provider still lists
    // it (any, when OmegaPlus did not answer), else the provider's default.
    const saved = doc.aiText?.model;
    const ids = provider === 'anthropic' ? ANTHROPIC_MODELS.map((m) => m.id) : omega.models.map((m) => m.id);
    const listed = (id: string) => ids.includes(id) || (provider === 'omegaplus' && omega.source === 'fallback');
    return {
      provider,
      model: provider === 'runway' ? null : saved && listed(saved) ? saved : defaultModelFor(provider, omega.models),
      keys: { anthropic: maskKey(doc.apiKeys.anthropic), omegaplus: maskKey(doc.apiKeys.omegaplus) },
      anthropicModels: ANTHROPIC_MODELS,
      omegaModels: omega.models,
      omegaSource: omega.source,
      usage: usage.totals,
      usageByProvider: {
        anthropic: usage.byProvider.anthropic ?? null,
        omegaplus: usage.byProvider.omegaplus ?? null,
      },
    };
  }),

  /** Runway, or a provider with a saved key and one of its models (its default when none is named). */
  setAiText: publicProcedure
    .input(
      z.object({
        provider: z.enum(['runway', 'anthropic', 'omegaplus']),
        model: z.string().min(1).max(80).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      const updatedAt = new Date().toISOString();
      const provider = input.provider;
      if (provider === 'runway') {
        await updateConnections(owner, (doc) => ({ ...doc, aiText: { provider, updatedAt } }));
        return;
      }
      if (!(await readConnections(owner)).apiKeys[provider]) throw keyMissing(provider);
      // OmegaPlus: its live list, else the last good one, else the built-in one.
      const omegaModels = provider === 'omegaplus' ? (await listOmegaModels()).models : undefined;
      const ids = omegaModels ? omegaModels.map((m) => m.id) : ANTHROPIC_MODELS.map((m) => m.id);
      const model = input.model ?? defaultModelFor(provider, omegaModels);
      if (!ids.includes(model)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `That model is not available on ${providerName(provider)}.` });
      }
      await updateConnections(owner, (doc) => {
        // Again inside the write: the key may have been removed meanwhile.
        if (!doc.apiKeys[provider]) throw keyMissing(provider);
        return { ...doc, aiText: { provider, model, updatedAt } };
      });
    }),

  /**
   * Checks the key with the provider, then stores it; the page only ever sees
   * its last four characters. A visitor still on Runway is moved onto that
   * provider (its default model) in the same write: saving a key means "use
   * it". One already on the other provider stays there. The answer says who
   * answers now and whether this save switched it.
   */
  setAiTextKey: publicProcedure
    .input(
      z.object({
        provider: aiTextProvider,
        key: z.string().trim().min(8, 'That looks too short to be an API key.').max(512),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const owner = await ownerKey(ctx.req);
      try {
        await verifyKey(input.provider, input.key);
      } catch (err) {
        // No `cause`: a 5xx logs its cause, and nothing here may carry the key into a log line.
        if (err instanceof AiTextError) {
          throw new TRPCError({ code: err.status === 400 ? 'BAD_REQUEST' : 'UNPROCESSABLE_CONTENT', message: err.message });
        }
        throw new TRPCError({
          code: 'UNPROCESSABLE_CONTENT',
          message: `${providerName(input.provider)} could not check that key. Try again in a moment.`,
        });
      }
      const now = new Date().toISOString();
      const provider = input.provider;
      const model = defaultModelFor(provider, provider === 'omegaplus' ? (await listOmegaModels()).models : undefined);
      const { aiText } = await updateConnections(owner, (doc) => ({
        ...doc,
        apiKeys: { ...doc.apiKeys, [provider]: { key: input.key, savedAt: now, verifiedAt: now } },
        aiText: (doc.aiText?.provider ?? 'runway') === 'runway' ? { provider, model, updatedAt: now } : doc.aiText,
      }));
      return {
        // Only a switch made by this save carries its timestamp.
        switched: aiText?.provider === provider && aiText.updatedAt === now,
        provider: aiText?.provider ?? 'runway',
        model: aiText?.model ?? null,
      };
    }),

  /** Forgets the key; if that provider was answering, Runway takes over again. */
  clearAiTextKey: publicProcedure.input(z.object({ provider: aiTextProvider })).mutation(async ({ ctx, input }) => {
    const owner = await ownerKey(ctx.req);
    const updatedAt = new Date().toISOString();
    await updateConnections(owner, (doc) => {
      const { [input.provider]: _removed, ...rest } = doc.apiKeys;
      return {
        ...doc,
        apiKeys: rest,
        aiText: doc.aiText?.provider === input.provider ? { provider: 'runway', updatedAt } : doc.aiText,
      };
    });
  }),

  /** Seevio video generation with the visitor's own key; poll `seevioTask`. */
  seevioGenerate: publicProcedure
    .input(
      z.object({
        model: z.string().min(1).max(64).default('seedance-2-5'),
        prompt: z.string().trim().min(1, 'Write a prompt first.').max(4000),
        options: z.record(z.string(), z.unknown()).default({}),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const key = await seevioKeyOrThrow(await ownerKey(ctx.req));
      return createSeevioVideo(key, { ...input.options, model: input.model, prompt: input.prompt });
    }),

  seevioTask: publicProcedure
    .input(z.object({ taskId: z.string().min(1).max(128) }))
    .query(async ({ ctx, input }) => {
      const key = await seevioKeyOrThrow(await ownerKey(ctx.req));
      return getSeevioTask(key, input.taskId);
    }),
});
