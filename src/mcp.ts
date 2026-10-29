import { createHash, randomBytes } from 'node:crypto';

/**
 * A small client for remote MCP servers over Streamable HTTP, plus the OAuth
 * 2.1 pieces (discovery, dynamic client registration, PKCE, token exchange)
 * that a server like Higgsfield's asks for. Plain `fetch`, no SDK: the app
 * only needs `initialize`, `tools/list` and `tools/call`.
 */

const PROTOCOL_VERSION = '2025-06-18';
const CLIENT_INFO = { name: 'render-to-film', version: '1.0.0' };
/** A tool call (a Higgsfield generation) can take a while to answer. */
const CALL_TIMEOUT_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 20_000;

export interface McpTool {
  name: string;
  description?: string | undefined;
  inputSchema?: unknown;
}

export interface McpToolResult {
  content: unknown[];
  structuredContent?: unknown;
  isError?: boolean | undefined;
}

/** The server refused the credentials (or asked for some): sign in again. */
export class McpAuthError extends Error {
  // 412, not 401: a 401 would read to the client as "sign in to Runway".
  readonly status = 412;
  readonly expose = true;
  constructor(message = 'This MCP server needs you to sign in again.') {
    super(message);
    this.name = 'McpAuthError';
  }
}

/** Anything else the server got wrong, phrased for the person reading it. */
export class McpError extends Error {
  readonly status = 422;
  readonly expose = true;
  constructor(message: string) {
    super(message);
    this.name = 'McpError';
  }
}

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
};

/** Pulls the JSON-RPC answer with `id` out of a JSON or SSE response body. */
async function readRpcResponse(res: Response, id: number): Promise<JsonRpcResponse> {
  const type = res.headers.get('content-type') ?? '';
  const text = await res.text();
  if (type.includes('text/event-stream')) {
    for (const event of text.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      try {
        const msg = JSON.parse(data) as JsonRpcResponse;
        if (msg.id === id) return msg;
      } catch {
        // A keep-alive or a non-JSON event; keep reading.
      }
    }
    throw new McpError('The MCP server closed the stream without answering.');
  }
  try {
    const parsed = JSON.parse(text) as JsonRpcResponse | JsonRpcResponse[];
    const msg = Array.isArray(parsed) ? parsed.find((m) => m.id === id) : parsed;
    if (msg) return msg;
  } catch {
    // Fall through to the error below.
  }
  throw new McpError(`The MCP server sent an answer this app can't read (${res.status}).`);
}

/** One MCP session against one server, opened with `connect()`. */
export class McpSession {
  private sessionId: string | undefined;
  private nextId = 1;
  serverName: string | undefined;
  private readonly url: string;
  private readonly accessToken: string | undefined;

  constructor(url: string, accessToken?: string | undefined) {
    this.url = url;
    this.accessToken = accessToken;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': PROTOCOL_VERSION,
    };
    if (this.accessToken) h['authorization'] = `Bearer ${this.accessToken}`;
    if (this.sessionId) h['mcp-session-id'] = this.sessionId;
    return h;
  }

  private async post(body: unknown, timeoutMs: number): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(this.url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      throw new McpError(
        timedOut
          ? 'The MCP server took too long to answer. Try again in a moment.'
          : `Couldn't reach the MCP server at ${this.url}. Check the address.`
      );
    }
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel();
      throw new McpAuthError();
    }
    return res;
  }

  async request(method: string, params: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
    const id = this.nextId++;
    const res = await this.post({ jsonrpc: '2.0', id, method, params }, timeoutMs);
    if (!res.ok) {
      await res.body?.cancel();
      throw new McpError(`The MCP server answered ${res.status} to ${method}.`);
    }
    const msg = await readRpcResponse(res, id);
    if (msg.error) throw new McpError(msg.error.message || `${method} failed.`);
    return msg.result;
  }

  async connect(): Promise<this> {
    const id = this.nextId++;
    const res = await this.post(
      {
        jsonrpc: '2.0',
        id,
        method: 'initialize',
        params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
      },
      DEFAULT_TIMEOUT_MS
    );
    if (!res.ok) {
      await res.body?.cancel();
      throw new McpError(`The MCP server refused to start a session (${res.status}).`);
    }
    this.sessionId = res.headers.get('mcp-session-id') ?? undefined;
    const msg = await readRpcResponse(res, id);
    if (msg.error) throw new McpError(msg.error.message || 'The MCP server refused to start a session.');
    const info = (msg.result as { serverInfo?: { name?: string } } | undefined)?.serverInfo;
    this.serverName = info?.name;
    const ack = await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, DEFAULT_TIMEOUT_MS);
    await ack.body?.cancel();
    return this;
  }

  async listTools(): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = (await this.request('tools/list', cursor ? { cursor } : {})) as {
        tools?: McpTool[];
        nextCursor?: string;
      };
      tools.push(...(result.tools ?? []));
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const result = (await this.request('tools/call', { name, arguments: args }, CALL_TIMEOUT_MS)) as McpToolResult;
    return { content: result.content ?? [], structuredContent: result.structuredContent, isError: result.isError };
  }
}

// ---------------------------------------------------------------- OAuth ----

export interface AuthServerMetadata {
  issuer?: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  /**
   * What to ask for: the MCP server's own 401 challenge scope, else its
   * protected-resource `scopes_supported` (as the MCP spec says), never the
   * sign-in server's whole catalog, which can list scopes this app isn't
   * allowed (Higgsfield's Clerk lists `private_metadata` and then refuses it).
   */
  requestScopes?: string[] | undefined;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string | undefined;
  /** Epoch ms; absent when the server didn't say. */
  expiresAt?: number | undefined;
  scope?: string | undefined;
}

async function getJson<T>(url: string): Promise<T | undefined> {
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'mcp-protocol-version': PROTOCOL_VERSION },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel();
      return undefined;
    }
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

/** `<origin>/.well-known/<name><path>`, the RFC 8414 / 9728 well-known form. */
function wellKnown(base: URL, name: string, withPath: boolean): string {
  const path = withPath && base.pathname !== '/' ? base.pathname.replace(/\/+$/, '') : '';
  return `${base.origin}/.well-known/${name}${path}`;
}

/**
 * Finds the authorization server for an MCP server: the protected-resource
 * metadata its 401 points at (or the well-known path), then that server's
 * own metadata. Falls back to the MCP server's origin, which is how older
 * servers publish it.
 */
export async function discoverAuthServer(serverUrl: string): Promise<AuthServerMetadata> {
  const server = new URL(serverUrl);
  const prmCandidates: string[] = [];
  let challengeScopes: string[] | undefined;
  try {
    const probe = await fetch(serverUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
      }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    await probe.body?.cancel();
    const challenge = probe.headers.get('www-authenticate') ?? '';
    const match = /resource_metadata="([^"]+)"/i.exec(challenge);
    if (match?.[1]) prmCandidates.push(new URL(match[1], server).toString());
    const scope = /scope="([^"]*)"/i.exec(challenge)?.[1]?.split(/\s+/).filter(Boolean);
    if (scope?.length) challengeScopes = scope;
  } catch {
    // Unreachable right now; the well-known paths below may still answer.
  }
  prmCandidates.push(
    wellKnown(server, 'oauth-protected-resource', true),
    wellKnown(server, 'oauth-protected-resource', false)
  );

  let issuer: URL = new URL(server.origin);
  let resourceScopes: string[] | undefined;
  for (const url of prmCandidates) {
    const prm = await getJson<{ authorization_servers?: string[]; scopes_supported?: string[] }>(url);
    const first = prm?.authorization_servers?.[0];
    if (first) {
      issuer = new URL(first);
      if (prm.scopes_supported?.length) resourceScopes = prm.scopes_supported;
      break;
    }
  }
  const requestScopes = challengeScopes ?? resourceScopes;

  for (const url of [
    wellKnown(issuer, 'oauth-authorization-server', true),
    wellKnown(issuer, 'oauth-authorization-server', false),
    wellKnown(issuer, 'openid-configuration', true),
    `${issuer.toString().replace(/\/+$/, '')}/.well-known/openid-configuration`,
  ]) {
    const meta = await getJson<AuthServerMetadata>(url);
    if (meta?.authorization_endpoint && meta.token_endpoint) return { ...meta, requestScopes };
  }
  throw new McpError(
    "This MCP server doesn't publish an OAuth sign-in. Paste an access token instead."
  );
}

/** Registers this app as an OAuth client (RFC 7591) for one redirect URI. */
export async function registerClient(
  meta: AuthServerMetadata,
  redirectUri: string
): Promise<{ clientId: string; clientSecret?: string | undefined }> {
  if (!meta.registration_endpoint) {
    throw new McpError(
      "This MCP server doesn't let apps register for sign-in. Paste an access token instead."
    );
  }
  const res = await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'Render to Film',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      // Register for exactly what sign-in will ask for, so it isn't refused.
      ...(meta.requestScopes?.length ? { scope: meta.requestScopes.join(' ') } : {}),
    }),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new McpError(`The MCP server refused to register this app for sign-in (${res.status}).`);
  }
  const body = (await res.json()) as { client_id?: string; client_secret?: string };
  if (!body.client_id) throw new McpError('The MCP server registered this app without a client id.');
  return { clientId: body.client_id, clientSecret: body.client_secret };
}

export function createPkce(): { verifier: string; challenge: string; state: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(18).toString('base64url');
  return { verifier, challenge, state };
}

export function authorizationUrl(opts: {
  meta: AuthServerMetadata;
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
  resource: string;
}): string {
  const url = new URL(opts.meta.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('code_challenge', opts.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', opts.state);
  url.searchParams.set('resource', opts.resource);
  const scopes = opts.meta.requestScopes ?? opts.meta.scopes_supported;
  if (scopes?.length) url.searchParams.set('scope', scopes.join(' '));
  return url.toString();
}

async function tokenRequest(
  tokenEndpoint: string,
  params: Record<string, string | undefined>
): Promise<TokenSet> {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) form.set(k, v);
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: form,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) {
    await res.body?.cancel();
    if (res.status === 400 || res.status === 401) throw new McpAuthError();
    throw new McpError(`The sign-in server answered ${res.status}. Try again in a moment.`);
  }
  const body = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!body.access_token) throw new McpError('The sign-in server returned no access token.');
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: body.expires_in ? Date.now() + body.expires_in * 1000 : undefined,
    scope: body.scope,
  };
}

export function exchangeCode(opts: {
  tokenEndpoint: string;
  code: string;
  verifier: string;
  clientId: string;
  clientSecret?: string | undefined;
  redirectUri: string;
  resource: string;
}): Promise<TokenSet> {
  return tokenRequest(opts.tokenEndpoint, {
    grant_type: 'authorization_code',
    code: opts.code,
    code_verifier: opts.verifier,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    redirect_uri: opts.redirectUri,
    resource: opts.resource,
  });
}

export function refreshTokens(opts: {
  tokenEndpoint: string;
  refreshToken: string;
  clientId: string;
  clientSecret?: string | undefined;
  resource: string;
}): Promise<TokenSet> {
  return tokenRequest(opts.tokenEndpoint, {
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    resource: opts.resource,
  });
}
