// Runs the built server (desktop/dist/server/index.mjs) on its own, without
// Electron: the headless pair for stress scripts, the shooter and CI.
//   node scripts/serve.mjs --port 3962 --data-dir <dir> [--token T] [--print-token]
//                          [--simulate] [--secret-key <64 hex>]
// The token defaults to a random one and the secret key to a fresh one, so a
// harness never shares either with the app. Neither is printed unless asked.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(DESKTOP, 'dist', 'server', 'index.mjs');

function fail(message) {
  console.error(`serve: ${message}`);
  process.exit(1);
}

let args;
try {
  args = parseArgs({
    options: {
      port: { type: 'string' },
      'data-dir': { type: 'string' },
      token: { type: 'string' },
      'print-token': { type: 'boolean', default: false },
      simulate: { type: 'boolean', default: false },
      'secret-key': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  }).values;
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const port = Number(args.port);
if (!args.port || !Number.isInteger(port) || port < 1 || port > 65535) {
  fail('--port N is required (1 to 65535)');
}
if (!args['data-dir']) fail('--data-dir DIR is required');
const dataDir = path.resolve(args['data-dir']);
const secretKey = args['secret-key'] ?? randomBytes(32).toString('hex');
if (!/^[0-9a-fA-F]{64}$/.test(secretKey)) fail('--secret-key must be 64 hex characters');
const token = args.token ?? randomBytes(32).toString('hex');
if (!existsSync(SERVER)) fail(`${SERVER} not found. Run "npm run build" in desktop/ first.`);

if (args['print-token']) console.log(`token: ${token}`);

const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [SERVER], {
  cwd: DESKTOP,
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: String(port),
    RTF_DATA_DIR: dataDir,
    RTF_ASSETS_DIR: path.join(DESKTOP, 'platform', 'assets'),
    RTF_DESKTOP_TOKEN: token,
    RTF_SECRET_KEY: secretKey,
    ...(args.simulate ? { RTF_SIMULATOR: '1' } : {}),
    BAY_ENV: 'desktop',
    NODE_ENV: 'production',
    BAY_APP_NAME: 'render-to-film',
    BAY_APP_TITLE: 'Render to Film',
    BAY_APP_URL: origin,
    BAY_ORCHESTRATOR_URL: origin,
  },
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', (error) => fail(`could not start the server: ${error.message}`));
child.on('exit', (code, signal) => {
  process.exit(code ?? (signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1));
});
