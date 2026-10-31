// One pass through a running server on the simulator, for CI and the headless
// pair: the door, the local owner, an upload and one still from start to finish.
//   node scripts/smoke.mjs --base http://127.0.0.1:3977 --token <token>
// Prints `smoke ok` and exits 0, else names the step that failed and exits 1.
// It only generates on the simulator, and it refuses the live ports.
import { parseArgs } from 'node:util';

import sharp from 'sharp';

const BOOT_MS = 60_000;
const SHOT_MS = 60_000;
const POLL_MS = 500;
const REQUEST_MS = 20_000;

function fail(message) {
  console.error(`smoke failed: ${message}`);
  process.exit(1);
}

let args;
try {
  args = parseArgs({
    options: { base: { type: 'string' }, token: { type: 'string' } },
    strict: true,
    allowPositionals: false,
  }).values;
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (!args.base || !args.token) fail('--base URL and --token T are required');
const base = args.base.replace(/\/+$/, '');
if (/:5173|:3001/.test(base)) fail(`${base} is the live app`);
const { token } = args;
const bearer = { authorization: `Bearer ${token}` };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const request = (route, init = {}) => fetch(`${base}${route}`, { signal: AbortSignal.timeout(REQUEST_MS), ...init });

async function step(name, work) {
  try {
    const result = await work();
    console.log(`ok ${name}`);
    return result;
  } catch (error) {
    fail(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

async function trpc(route, init) {
  const res = await request(`/trpc/${route}`, { ...init, headers: { ...bearer, ...init?.headers } });
  const body = await res.json().catch(() => null);
  assert(res.status === 200 && body?.result, `${route} answered ${res.status} ${JSON.stringify(body)?.slice(0, 300)}`);
  return body.result.data;
}

const query = (route, input) =>
  trpc(input === undefined ? route : `${route}?input=${encodeURIComponent(JSON.stringify(input))}`);

const mutate = (route, input) =>
  trpc(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });

await step('health', async () => {
  const end = Date.now() + BOOT_MS;
  let last = 'no answer';
  while (Date.now() < end) {
    try {
      const res = await request('/__bay/health');
      if (res.status === 200) return;
      last = `HTTP ${res.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(POLL_MS);
  }
  throw new Error(`not up after ${BOOT_MS / 1000} s (${last})`);
});

await step('token door', async () => {
  const res = await request(`/__desktop/open?t=${encodeURIComponent(token)}`, { redirect: 'manual' });
  assert(res.status === 302, `open answered ${res.status}`);
  const cookie = res.headers.get('set-cookie') ?? '';
  assert(cookie.startsWith(`rtf_desktop=${token};`), 'open set no rtf_desktop cookie');
  assert(/HttpOnly/i.test(cookie) && /SameSite=Strict/i.test(cookie), 'the cookie is not HttpOnly and SameSite=Strict');
  const shut = await request('/trpc/profile');
  assert(shut.status === 401, `/trpc/profile with no token answered ${shut.status}`);
});

await step('profile', async () => {
  const profile = await query('profile');
  assert(String(profile?.email).endsWith('@local'), `email is ${profile?.email}`);
});

await step('simulator', async () => {
  const caps = await query('settings.capabilities');
  assert(caps?.provider === 'simulator', `the provider is ${caps?.provider}, and this would bill it`);
});

const imageUrl = await step('upload', async () => {
  const png = await sharp({
    create: { width: 64, height: 36, channels: 3, background: { r: 96, g: 128, b: 160 } },
  })
    .png()
    .toBuffer();
  const res = await request('/api/upload', { method: 'POST', headers: { ...bearer, 'content-type': 'image/png' }, body: png });
  const body = await res.json().catch(() => null);
  assert(res.status === 200 && body?.url, `upload answered ${res.status} ${JSON.stringify(body)?.slice(0, 300)}`);
  return body.url;
});

const id = await step('createShot', async () => {
  const shot = await mutate('createShot', {
    imageUrl,
    imageModel: 'nano-banana-2-1',
    look: 'golden-hour',
    width: 64,
    height: 36,
  });
  assert(shot?.id, `no id in ${JSON.stringify(shot)?.slice(0, 300)}`);
  return shot.id;
});

const url = await step('shotStatus', async () => {
  const end = Date.now() + SHOT_MS;
  while (Date.now() < end) {
    const poll = await query('shotStatus', { id });
    if (poll.done) {
      assert(poll.status === 'SUCCEEDED' && poll.url, `finished as ${JSON.stringify(poll).slice(0, 300)}`);
      return poll.url;
    }
    await sleep(POLL_MS);
  }
  throw new Error(`not done after ${SHOT_MS / 1000} s`);
});

await step('result file', async () => {
  const res = await request(new URL(url).pathname, { headers: bearer });
  assert(res.status === 200, `the result answered ${res.status}`);
  assert((await res.arrayBuffer()).byteLength > 0, 'the result is empty');
});

console.log('smoke ok');
