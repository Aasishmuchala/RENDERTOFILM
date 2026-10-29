import { randomUUID } from 'node:crypto';

import {
  type AuthServerMetadata,
  McpAuthError,
  McpSession,
  type McpTool,
  refreshTokens,
  type TokenSet,
} from './mcp.ts';
import { documentStore } from './storage.ts';

/**
 * Each person's connected MCP servers — Higgsfield (built in) plus any they
 * add — in one document under `connections/`, beside their library. Tokens
 * live only here, server side; the client is sent `publicView` and never a
 * credential.
 */

export const HIGGSFIELD_ID = 'higgsfield';
export const HIGGSFIELD_URL = 'https://mcp.higgsfield.ai/mcp';
export const RUNWAY_MCP_ID = 'runway';
export const RUNWAY_MCP_URL = 'https://mcp.runwayml.com';
const MAX_SERVERS = 20;
/** An OAuth round trip left unfinished this long is dropped. */
const PENDING_TTL_MS = 15 * 60_000;
/** Refresh a token this close to expiry rather than send a dead one. */
const REFRESH_SKEW_MS = 60_000;

export type ServerAuth =
  | { kind: 'none' }
  | { kind: 'bearer'; token: string }
  | {
      kind: 'oauth';
      clientId: string;
      clientSecret?: string | undefined;
      redirectUri: string;
      meta: AuthServerMetadata;
      tokens?: TokenSet | undefined;
    };

export interface McpServerRecord {
  id: string;
  name: string;
  url: string;
  preset?: Preset | undefined;
  enabled: boolean;
  auth: ServerAuth;
  connectedAt?: string | undefined;
  lastError?: string | undefined;
  /** The last `tools/list`, so the page can show them without a round trip. */
  tools?: { name: string; description?: string | undefined }[] | undefined;
}

export interface PendingOAuth {
  state: string;
  verifier: string;
  serverId: string;
  createdAt: number;
}

/** A provider API key (Seevio today), kept server side like the MCP tokens. */
export interface ApiKeyRecord {
  key: string;
  savedAt: string;
  verifiedAt?: string | undefined;
}

export type ApiKeyProvider = 'seevio' | 'anthropic' | 'omegaplus';

/** Who answers the app's text-and-vision (`claude_api`) calls. */
export type AiTextProvider = 'runway' | 'anthropic' | 'omegaplus';

/** The Settings choice; `model` is unset for Runway, which takes the model each caller names. */
export interface AiTextChoice {
  provider: AiTextProvider;
  model?: string | undefined;
  updatedAt: string;
}

export interface ConnectionsDoc {
  servers: McpServerRecord[];
  pending: PendingOAuth[];
  apiKeys: Partial<Record<ApiKeyProvider, ApiKeyRecord>>;
  aiText?: AiTextChoice | undefined;
}

const store = documentStore<ConnectionsDoc>({ prefix: 'connections/' });

export type Preset = 'higgsfield' | 'runway';

/** Built-in servers: always listed, first, signed in or not; never removable. */
const PRESETS: readonly McpServerRecord[] = [
  { id: RUNWAY_MCP_ID, name: 'Runway MCP', url: RUNWAY_MCP_URL, preset: 'runway', enabled: true, auth: { kind: 'none' } },
  { id: HIGGSFIELD_ID, name: 'Higgsfield', url: HIGGSFIELD_URL, preset: 'higgsfield', enabled: true, auth: { kind: 'none' } },
];

export function isPresetId(id: string): boolean {
  return PRESETS.some((p) => p.id === id);
}

function withPresets(doc: Partial<ConnectionsDoc> | undefined): ConnectionsDoc {
  const saved = doc?.servers ?? [];
  const pending = (doc?.pending ?? []).filter((p) => Date.now() - p.createdAt < PENDING_TTL_MS);
  const apiKeys = doc?.apiKeys ?? {};
  const presets = PRESETS.map((p) => saved.find((s) => s.id === p.id) ?? { ...p });
  const others = saved.filter((s) => !isPresetId(s.id));
  return { servers: [...presets, ...others], pending, apiKeys, aiText: doc?.aiText };
}

export async function readConnections(owner: string): Promise<ConnectionsDoc> {
  return withPresets((await store.get(`${owner}.json`))?.value);
}

/** Read-modify-write; `mutate` must not mutate in place, as it can be retried. */
export async function updateConnections(
  owner: string,
  mutate: (doc: ConnectionsDoc) => ConnectionsDoc
): Promise<ConnectionsDoc> {
  return store.update(`${owner}.json`, (current) => {
    const next = mutate(withPresets(current));
    return {
      servers: next.servers.slice(0, MAX_SERVERS),
      pending: next.pending.slice(-10),
      apiKeys: next.apiKeys,
      aiText: next.aiText,
    };
  });
}

export function updateServer(
  owner: string,
  id: string,
  patch: (server: McpServerRecord) => McpServerRecord
): Promise<ConnectionsDoc> {
  return updateConnections(owner, (doc) => ({
    ...doc,
    servers: doc.servers.map((s) => (s.id === id ? patch(s) : s)),
  }));
}

export function newServerId(): string {
  return randomUUID().slice(0, 8);
}

export function isConnected(server: McpServerRecord): boolean {
  if (server.auth.kind === 'bearer') return true;
  if (server.auth.kind === 'oauth') return !!server.auth.tokens?.accessToken;
  // An open server (no auth) counts once it has answered a test.
  return !!server.connectedAt;
}

/** What the Settings page may see: no tokens, no client secrets. */
export function publicView(server: McpServerRecord) {
  return {
    id: server.id,
    name: server.name,
    url: server.url,
    preset: server.preset ?? null,
    enabled: server.enabled,
    authKind: server.auth.kind,
    connected: isConnected(server),
    connectedAt: server.connectedAt ?? null,
    expiresAt: server.auth.kind === 'oauth' ? (server.auth.tokens?.expiresAt ?? null) : null,
    lastError: server.lastError ?? null,
    tools: server.tools ?? [],
  };
}

export type PublicServer = ReturnType<typeof publicView>;

/** A usable access token for `server`, refreshing (and saving) it if due. */
async function accessTokenFor(owner: string, server: McpServerRecord): Promise<string | undefined> {
  const auth = server.auth;
  if (auth.kind === 'none') return undefined;
  if (auth.kind === 'bearer') return auth.token;
  const tokens = auth.tokens;
  if (!tokens) throw new McpAuthError(`Sign in to ${server.name} first.`);
  const due = tokens.expiresAt !== undefined && tokens.expiresAt - REFRESH_SKEW_MS < Date.now();
  if (!due) return tokens.accessToken;
  if (!tokens.refreshToken) throw new McpAuthError(`Your ${server.name} sign-in expired. Sign in again.`);
  const fresh = await refreshTokens({
    tokenEndpoint: auth.meta.token_endpoint,
    refreshToken: tokens.refreshToken,
    clientId: auth.clientId,
    clientSecret: auth.clientSecret,
    resource: server.url,
  });
  const saved: TokenSet = { ...fresh, refreshToken: fresh.refreshToken ?? tokens.refreshToken };
  await updateServer(owner, server.id, (s) =>
    s.auth.kind === 'oauth' ? { ...s, auth: { ...s.auth, tokens: saved } } : s
  );
  return saved.accessToken;
}

/**
 * Opens a session on one of the owner's servers and runs `work` in it. A
 * sign-in failure is written back to the record so the page shows it.
 */
export async function withSession<T>(
  owner: string,
  server: McpServerRecord,
  work: (session: McpSession) => Promise<T>
): Promise<T> {
  try {
    const token = await accessTokenFor(owner, server);
    const session = await new McpSession(server.url, token).connect();
    return await work(session);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateServer(owner, server.id, (s) => ({ ...s, lastError: message })).catch(() => undefined);
    throw err;
  }
}

export function summarizeTools(tools: McpTool[]): McpServerRecord['tools'] {
  return tools.slice(0, 200).map((t) => ({
    name: t.name,
    description: t.description?.slice(0, 300),
  }));
}

/** The last four characters, the only part of a key the page is shown. */
export function maskKey(record: ApiKeyRecord | undefined) {
  if (!record) return null;
  return { last4: record.key.slice(-4), savedAt: record.savedAt, verifiedAt: record.verifiedAt ?? null };
}
