// The Koa server as an Electron utility process: a busy server never freezes the
// window, and a crash here is a restart, not a dead app. The token and the data
// key go over its MessagePort, never argv or env.
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { app, utilityProcess, type UtilityProcess } from 'electron';

import { pickPort } from './ports.ts';

const HEALTH_MS = 20_000;
const HEALTH_POLL_MS = 150;
const STOP_MS = 3_000;
const CRASH_WINDOW_MS = 60_000;
const CRASH_LIMIT = 3;
const BACKOFF_MS = [1_000, 2_000, 4_000];
const LOG_BYTES = 10 * 1024 * 1024;
const LOG_FILES = 3;

export type ServerOptions = {
  port: number | undefined;
  token: string;
  secretKey: string;
  dataDir: string;
  logDir: string;
  simulate: boolean;
};

export type ServerHooks = {
  /** The server came back on another port: the window has to follow it. */
  onOriginChange: (origin: string) => void;
  /** Three crashes in a minute. Resolves true to try again. */
  onCrashLoop: (logFile: string) => Promise<boolean>;
};

function redact(text: string, secrets: string[]): string {
  return secrets.reduce((out, secret) => out.replaceAll(secret, '[redacted]'), text);
}

/** server.log and two older files, each up to 10 MB. Losing a log line never stops the app. */
class ServerLog {
  private size = 0;

  constructor(readonly file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    if (existsSync(file)) this.size = statSync(file).size;
  }

  write(text: string) {
    try {
      const bytes = Buffer.byteLength(text);
      if (this.size + bytes > LOG_BYTES) this.rotate();
      appendFileSync(this.file, text);
      this.size += bytes;
    } catch {
      // a full disk: the server still runs
    }
  }

  private rotate() {
    for (let n = LOG_FILES - 1; n > 0; n -= 1) {
      const older = n === 1 ? this.file : `${this.file}.${n - 1}`;
      if (existsSync(older)) renameSync(older, `${this.file}.${n}`);
    }
    this.size = 0;
  }
}

/** The bundled Higgsfield CLI, outside the asar. Unset when it is missing, so PATH can still answer. */
function higgsfieldBin(): string | undefined {
  const root = app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked');
  const file = path.join(root, 'node_modules', '@higgsfield', 'cli', 'vendor', process.platform === 'win32' ? 'hf.exe' : 'hf');
  return existsSync(file) ? file : undefined;
}

export class ServerHost {
  /** Runs out on a provider, as the server last said, and whose they are. */
  active = 0;
  provider = '';

  private child: UtilityProcess | undefined;
  private port: number;
  private stopping = false;
  private crashes: number[] = [];
  private restart: NodeJS.Timeout | undefined;
  private readonly log: ServerLog;

  constructor(
    private readonly options: ServerOptions,
    private readonly hooks: ServerHooks
  ) {
    this.port = options.port ?? 0;
    this.log = new ServerLog(path.join(options.logDir, 'server.log'));
  }

  get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  get logFile(): string {
    return this.log.file;
  }

  /** Starts the server; true once it answers health, false after 20 s. */
  async start(): Promise<boolean> {
    await this.fork(this.options.port);
    const deadline = Date.now() + HEALTH_MS;
    while (Date.now() < deadline && !this.stopping) {
      if (await this.healthy()) return true;
      await sleep(HEALTH_POLL_MS);
    }
    return false;
  }

  /** Asks the server to finish, and pulls the plug after 3 s. */
  async stop(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.restart);
    const { child } = this;
    if (!child) return;
    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
    });
    child.postMessage({ type: 'shutdown' });
    const deadline = setTimeout(() => child.kill(), STOP_MS);
    await exited;
    clearTimeout(deadline);
  }

  private async healthy(): Promise<boolean> {
    try {
      const answer = await fetch(`${this.origin}/__bay/health`, { signal: AbortSignal.timeout(2_000) });
      return answer.ok;
    } catch {
      return false;
    }
  }

  private async fork(preferred: number | undefined) {
    const before = this.port;
    this.port = await pickPort(preferred);
    if (this.stopping) return;
    if (before && before !== this.port) this.hooks.onOriginChange(this.origin);
    const { REAL_GEN_HF_BIN: pinned, RTF_DESKTOP_TOKEN: _token, RTF_SECRET_KEY: _key, ...inherited } = process.env;
    const hfBin = pinned ?? higgsfieldBin();
    const child = utilityProcess.fork(path.join(app.getAppPath(), 'dist', 'server', 'index.mjs'), [], {
      env: {
        ...inherited,
        PORT: String(this.port),
        RTF_DATA_DIR: this.options.dataDir,
        RTF_ASSETS_DIR: app.isPackaged ? path.join(process.resourcesPath, 'assets') : path.join(app.getAppPath(), 'platform', 'assets'),
        BAY_ENV: 'desktop',
        NODE_ENV: 'production',
        RTF_PACKAGED: app.isPackaged ? '1' : '',
        RTF_SIMULATOR: this.options.simulate ? '1' : '',
        BAY_APP_NAME: 'render-to-film',
        BAY_APP_TITLE: 'Render to Film',
        BAY_APP_URL: this.origin,
        BAY_ORCHESTRATOR_URL: this.origin,
        // A Finder launch has a bare PATH, and Settings' install fallback lands here.
        ...(process.platform === 'darwin' ? { PATH: `${inherited['PATH'] ?? ''}:/opt/homebrew/bin:/usr/local/bin` } : {}),
        ...(hfBin ? { REAL_GEN_HF_BIN: hfBin } : {}),
      },
      stdio: 'pipe',
      serviceName: 'render-to-film-server',
    });
    this.child = child;
    this.pipe(child.stdout);
    this.pipe(child.stderr);
    child.once('spawn', () => {
      child.postMessage({ type: 'boot', token: this.options.token, secretKey: this.options.secretKey });
    });
    child.on('message', (message: { type?: string; active?: number; provider?: string }) => {
      if (message?.type !== 'jobs') return;
      this.active = message.active ?? 0;
      this.provider = message.provider ?? '';
    });
    child.once('exit', () => this.onExit(child));
  }

  /** By whole lines, so a secret can never straddle two chunks and slip past the redaction. */
  private pipe(stream: NodeJS.ReadableStream | null) {
    let pending = '';
    stream?.on('data', (chunk: Buffer) => {
      const lines = `${pending}${chunk.toString('utf8')}`.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) this.log.write(`${redact(line, [this.options.token, this.options.secretKey])}\n`);
    });
  }

  private async onExit(child: UtilityProcess) {
    if (this.child === child) this.child = undefined;
    if (this.stopping) return;
    this.active = 0;
    this.provider = '';
    const now = Date.now();
    this.crashes = [...this.crashes.filter((at) => now - at < CRASH_WINDOW_MS), now];
    const delay = BACKOFF_MS[Math.min(this.crashes.length, BACKOFF_MS.length) - 1] ?? 0;
    if (this.crashes.length >= CRASH_LIMIT) {
      if (!(await this.hooks.onCrashLoop(this.log.file))) return;
      this.crashes = [];
    }
    if (this.stopping) return;
    this.restart = setTimeout(() => void this.fork(this.port), delay);
  }
}
