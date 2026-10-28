import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  isPresetId,
  maskKey,
  newServerId,
  publicView,
  readConnections,
  summarizeTools,
  updateConnections,
  updateServer,
  withSession,
} from './connections.ts';
import { ownerKey } from './library.ts';
import { createSeevioVideo, getSeevioTask, verifySeevioKey } from './seevio.ts';
import { publicProcedure, router } from './trpc.ts';

/**
 * The Settings tab: Runway sign-in status, Runway MCP, Higgsfield and other MCP servers
 * (sign in, test, run a tool), and provider API keys (Seevio). Every
 * credential stays on the server in the visitor's own `connections/`
 * document (src/connections.ts); answers carry only what the page shows.
 */

const serverId = z.string().min(1).max(64);

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

export const settingsRouter = router({
  /** Runway session state for the Runway card; `signInUrl` opens the popup. */
  runway: publicProcedure.query(({ ctx }) => ({
    signedIn: !!ctx.runway,
    viewer: ctx.viewer,
    signInUrl: ctx.signInUrl ?? null,
  })),

  connections: publicProcedure.query(async ({ ctx }) => {
    const owner = await ownerKey(ctx.req);
    const doc = await readConnections(owner);
    return {
      servers: doc.servers.map(publicView),
      apiKeys: { seevio: maskKey(doc.apiKeys.seevio) },
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
