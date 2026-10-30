import { lookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';

/**
 * Fetching, from the server, an image whose address a visitor handed the app
 * (an uploaded frame's URL is any URL the client sends). Only http and https,
 * and never an address inside a network: loopback, private, link-local (the
 * cloud metadata service), carrier-grade NAT, unspecified, IPv6 unique-local
 * and link-local, and the IPv4-mapped and IPv4-compatible forms of those. The
 * check runs on every address the hostname resolves to at the moment the
 * connection is made (so a name that answers differently between a check and
 * the request gains nothing), and again on every redirect.
 *
 * One exception, in local development only (`BAY_ENV` not `production`): the
 * app's own origin on localhost, where the simulator serves its `/__mock`
 * stills and uploads.
 *
 * Used for the shot director's crop fetch (src/api.ts) and for the input
 * images an Anthropic or OmegaPlus text task reads (src/ai-text/providers.ts).
 */

const BLOCKED = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv4');
}
// `::/96` holds the unspecified address, loopback and the IPv4-compatible forms.
for (const [network, prefix] of [
  ['::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv6');
}

/** Redirects followed (each one checked) before giving up. */
const MAX_REDIRECTS = 3;

/** A URL the server will not fetch. Its message is the visitor's. */
export class UnsafeUrlError extends Error {
  constructor() {
    super('That image is at an address the app may not read. Upload it again, or pick a still from your library.');
    this.name = 'UnsafeUrlError';
  }
}

/** The IPv4 address inside an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`), if it is one. */
function mappedV4(address: string): string | undefined {
  let canonical: string;
  try {
    // WHATWG URL writes any spelling of an IPv6 address in one canonical form.
    canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  } catch {
    return undefined;
  }
  const m = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (!m) return undefined;
  const hi = parseInt(m[1]!, 16);
  const lo = parseInt(m[2]!, 16);
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
}

/** Whether a server-side fetch may not connect to this IP address. */
export function blockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  if (family === 6) {
    const v4 = mappedV4(address);
    if (v4) return BLOCKED.check(v4, 'ipv4');
  }
  return BLOCKED.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

/** A URL's host without the brackets an IPv6 literal carries. */
const hostOf = (url: URL) => url.hostname.replace(/^\[|\]$/g, '');

/** Local development only: the app's own origin on localhost (the simulator's /__mock files). */
function ownDevOrigin(url: URL): boolean {
  if (process.env.BAY_ENV === 'production') return false;
  const host = hostOf(url);
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  return loopback && port === (process.env.PORT ?? '3000');
}

function parse(url: string | URL, base?: URL): URL {
  let parsed: URL;
  try {
    parsed = new URL(url, base);
  } catch {
    throw new UnsafeUrlError();
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new UnsafeUrlError();
  return parsed;
}

/** `dns.lookup`, refusing a name when any address it resolves to is blocked. */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, '', 0);
    if (!addresses.length || addresses.some((a) => blockedAddress(a.address))) {
      return callback(new UnsafeUrlError(), '', 0);
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0]!.address, addresses[0]!.family);
  });
};

/**
 * Throws `UnsafeUrlError` when the URL is provably one the server must not
 * fetch: not http(s), a blocked IP literal, or a name that resolves to a
 * blocked address. A name that does not resolve passes (the fetch fails on
 * its own, and `safeFetch` checks again when it connects).
 */
export async function assertFetchable(url: string): Promise<void> {
  const parsed = parse(url);
  if (ownDevOrigin(parsed)) return;
  const host = hostOf(parsed);
  if (isIP(host)) {
    if (blockedAddress(host)) throw new UnsafeUrlError();
    return;
  }
  const addresses = await new Promise<LookupAddress[]>((resolve) =>
    lookup(host, { all: true }, (err, found) => resolve(err ? [] : found))
  );
  if (addresses.some((a) => blockedAddress(a.address))) throw new UnsafeUrlError();
}

/** One GET, no redirect followed; blocked addresses are refused as the connection is made. */
function getOnce(url: URL, signal: AbortSignal | undefined): Promise<Response> {
  if (ownDevOrigin(url)) return fetch(url, { signal, redirect: 'manual' });
  const host = hostOf(url);
  if (isIP(host) && blockedAddress(host)) return Promise.reject(new UnsafeUrlError());
  return new Promise<Response>((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(
      url,
      { method: 'GET', lookup: guardedLookup, ...(signal ? { signal } : {}) },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status > 599) {
          res.destroy();
          reject(new Error(`Unexpected status ${status}.`));
          return;
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          for (const one of [value ?? []].flat()) headers.append(name, one);
        }
        const empty = status === 204 || status === 205 || status === 304;
        if (empty) res.resume();
        resolve(
          new Response(empty ? null : (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>), {
            status,
            headers,
          })
        );
      }
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * `fetch` for a visitor-supplied URL (GET only): the address checks above on
 * the first request and on each redirect, at most `MAX_REDIRECTS` of them.
 * Rejects with `UnsafeUrlError` for a URL it will not fetch.
 */
export async function safeFetch(url: string, init: { signal?: AbortSignal | undefined } = {}): Promise<Response> {
  let target = parse(url);
  for (let hop = 0; ; hop++) {
    const res = await getOnce(target, init.signal);
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) return res;
    await res.body?.cancel().catch(() => {});
    if (hop >= MAX_REDIRECTS) throw new Error('The image address redirected too many times.');
    target = parse(location, target);
  }
}
