# render-to-film — Bay App

**Bay owns this file.** `bay update --base` (and `bay update --sdk`, `bay add`) regenerates it from the current platform template. Put project-specific guidance — including a pointer to your own docs — under **Project notes** at the bottom, between the `bay:custom` markers; that region is the only part that survives a refresh. Anything you add elsewhere in this file is replaced (Bay saves the previous copy under `.bay/backups/`).

This is a Bay app. Bay is an internal platform that handles deployment, routing, auth, and infrastructure so you can focus on the app logic.

## Sandbox

All `bay` CLI commands (`bay deploy`, `bay dev`, `bay add`, etc.) require network and filesystem access beyond the default Claude Code sandbox. Run them with the sandbox disabled.

Three local workflows need the same treatment, and each fails with a bare `EPERM` rather than a sandbox message: `npm install` / `pnpm install` (registry access), anything run through `tsx` (`npx tsx script.ts` — `tsx` opens a Unix socket under `$TMPDIR`), and any test or server that binds a localhost port. To stop disabling the sandbox per command, set `sandbox.network.allowLocalBinding` and `sandbox.network.allowAllUnixSockets` in `~/.claude/settings.json`.

## Quick reference

| Action | Command |
|--------|---------|
| Run locally | `bay dev` |
| Deploy | `bay deploy` |
| Deploy without waiting for it to finish | `bay deploy --detach` (prints a deploy id), then `bay deploys wait <id>` (or poll `bay deploys`) |
| View logs | `bay logs` |
| Inspect or stop a deploy stuck in `releasing` | `bay deploys log <id> --release` · `bay deploys cancel <id>` |
| Deploy sits in `queued` | `bay deploys wait <id>` (do not cancel and redeploy — that loses its place in line) |
| Add a feature | `bay add <feature>` then `bay update` |
| Read platform docs | `bay docs` · `bay docs advanced <topic>` |
| Inspect this app | `bay describe render-to-film` |
| See how people use this app | `bay insights render-to-film` (visits, people, top users; `bay docs advanced app-analytics`) |
| Destroy | `bay destroy render-to-film` |
| Destroy (keep data) | `bay destroy render-to-film --keep-data` |
| Report a Bay bug, friction, or missing feature | `bay feedback "<what happened / what you wished existed>"` |

**Deploys can outlast a single tool call.** `bay deploy` blocks until the deploy finishes (build + rollout, up to 20 minutes) — if your tool-call timeout is shorter than that, use `bay deploy --detach` (returns as soon as the deploy is accepted). Then prefer `bay deploys wait <id> --app render-to-film` with the deploy id `--detach` printed, which blocks until that deploy finishes and exits 0 (healthy), 1 (failed), or 2 (timeout), so you never string-match a phase name (without an id, `wait` picks the app's newest deploy and refuses it when that one is already terminal and stale, rather than reporting an old deploy as this one's result) (don't pipe it — a pipeline reports the last command's status, so use `set -o pipefail` or read `$?` before piping); pass `--timeout <s>` to keep the call inside your own budget. `bay deploys wait` needs Bay CLI 3.97.0 or newer: an older CLI rejects it with `error: unknown option '--app'` (or `'--timeout'`, or `error: too many arguments`), so run `bay update --self` and retry instead of switching to polling. If a call must stay short, poll `bay deploys render-to-film` every 10–20s until the phase is terminal (`healthy` = succeeded, `failed`). In a script, read `bay deploys render-to-film --json` and check `.[0].phase` instead of parsing the table. A deploy that sits in `releasing` is running this app's `deploy.release` command in its own Job pod, which `bay logs` cannot reach: `bay deploy` and `bay deploys wait` print that Job's status while they wait, `bay deploys log <id> --release` shows the pod's output, and `bay deploys cancel <id>` ends it (then `bay deploys retry <id>`).

**An unknown option usually means an old CLI.** If a command or flag documented here fails with `error: unknown option`, `error: unknown command`, or `error: too many arguments`, run `bay update --self` and retry. Do not conclude it does not exist. Bay ships CLI updates most days, and `bay update --base` refreshes this file from your Bay deployment, which is often ahead of the CLI you installed. If `bay update --self` itself fails because the package registry rejected your credential, install the CLI straight from your Bay deployment instead: open `<your Bay deployment URL>/api/cli/tarball` in a browser — it sits behind the same Google login as the launcher, not the registry — then run `npm install -g ~/Downloads/bay-cli-<version>.tgz`. That installs the CLI your deployment was built with, which may trail the published version slightly. A `503` there simply means this deployment does not offer the download; nothing is broken, so fix the registry credential instead. If `bay update --self` fails with `EACCES` or `EPERM`, npm's global prefix is root-owned: ask the user to run `npm config set prefix ~/.npm-global`, put `export PATH="$HOME/.npm-global/bin:$PATH"` in their shell profile (it must come before the old prefix, or the old `bay` keeps running), open a new shell, run `npm install -g @runway/bay-cli` and confirm with `bay --version` — do not run `sudo` yourself. If `bay deploy` refuses to run because the CLI is outdated, update it the same way; do not pass `--dangerously-ignore-outdated`, which is for pinned CI runners.

**`bay docs` is the source of truth — not the Bay source.** For platform topics
(AWS/IRSA access, Twingate, k8s overrides, custom Dockerfiles) read `bay docs` and
`bay docs advanced <topic>`; for this app's live state (ServiceAccount, IAM role,
features, pods) run `bay describe render-to-film`. Do **not** answer from a local checkout
of the `bay` CLI/orchestrator or from bundled plugin docs — both lag the deployed
platform, so they'll send you down stale paths.

**Feature docs:** After running `bay add`, run `bay update` and read `.bay/docs.md` for feature-specific environment variables, code examples, and usage patterns.

## How Bay apps work

A Bay app is a container that listens on a port. Bay builds the image, pushes it, creates the k8s resources, and assigns the app its own URL. Bay injects that URL into the container as `BAY_APP_URL` — read it there at runtime, or get it from `bay describe render-to-film` or the `URL:` line `bay deploy` prints. Never construct it by hand; the host differs per Bay deployment.

**Requirements:**
- Listen on `$PORT` (default 3000)
- Respond 200 on `GET /__bay/health` (Bay uses this for readiness/liveness probes)
- A `Dockerfile` is optional — Bay auto-generates one from your project (Node/Python). Add `bay add dockerfile-node` (or `-spa`/`-python`/`-rust`) only if you need to customize the build.

**Auth is handled for you.** All internal Bay apps are behind Google OAuth (restricted to runwayml.com). User identity is available in request headers:
- `X-Auth-Request-Email` — user's email
- `X-Auth-Request-Name` — user's display name
- `X-Auth-Request-User` — user ID

**404 pages (internal apps).** Return 404 with an empty body — the internal gateway rewrites bodyless 4xx/5xx into a branded error page for the user. If your framework sends `Cannot GET /foo` or `404 page not found`, the user sees that text instead. `BayApp` does this automatically; for other frameworks:

- Koa (without `BayApp`): `app.use((ctx) => { ctx.status = 404; ctx.body = ''; })` after your routes
- Express: `app.use((_req, res) => res.status(404).end())` after your routes
- FastAPI: `@app.exception_handler(404)` returning `Response(status_code=404)`
- axum: `Router::new().fallback(|| async { StatusCode::NOT_FOUND })`

Only the internal gateway brands these. An external (internet-facing) app has no such filter, so a bodyless 4xx/5xx reaches the browser as 0 bytes — a blank tab. External apps must send their own error body.

**Pods get replaced without a deploy.** Bay runs apps on shared nodes, so the cluster replaces a pod whenever it consolidates or reclaims a node — no deploy behind it, no warning. Anything held only in the process (an in-flight batch, a warm cache, half-finished verification state) dies with it. The pod gets a short stop window first, which `bay describe render-to-film` prints under `Pods`; a Node process with no `SIGTERM` handler exits the moment SIGTERM lands, so register one if the process must flush on the way out. Keep multi-minute work resumable — record progress in a database or object store, or run it as a `type: job` app — and read `bay docs advanced troubleshooting` for the rest.

**Cookies your app sets.** Name every session, CSRF or other trusted cookie `__Host-<name>` and set it `Secure`, `Path=/`, with no `Domain` (in Koa, `new BayApp({ proxy: true })` so `ctx.secure` is true behind the edge). Apps share a parent domain with other apps — on `runway.studio` with every other customer's — so a plain-named cookie can be shadowed by a sibling host; a `__Host-` one cannot. Names starting `__Host-bay_`, `__Secure-bay_` or `bay_runway_token_`, and `BayIdToken` / `BayAccessToken`, are the platform's. See `bay docs sdk bay-app` (Cookies).

In Koa, always drain the body with `ctx.body = ''`. `ctx.body = null` (or leaving it unset) makes Koa send a 204 with no body — or its own `Not Found` text — instead of the empty 404 the gateway looks for.

## Environment variables

Bay injects these into every app container:

| Variable | Value | Always present |
|----------|-------|:-:|
| `PORT` | Port to listen on (default 3000) | Yes |
| `BAY_ENV` | `production` | Yes |
| `BAY_APP_NAME` | `render-to-film` | Yes |
| `BAY_APP_URL` | Public URL of this app — Bay sets it; don't construct it | Yes |
| `BAY_ORCHESTRATOR_URL` | Control plane URL | Yes |
| `AWS_REGION` | AWS region (`us-east-1`) | Yes |

Feature-specific env vars (present only when the feature is enabled via `bay add`):

| Variable | Feature | Description |
|----------|---------|-------------|
| `BAY_DB_URL` | `db` | Postgres connection string; unqualified names resolve to the app's schema because the search path is set on its database role, and the URL restates it as `options=-c search_path=<schema>,public` |
| `BAY_DB_SCHEMA` | `db` | The app's schema name (e.g. `bay_my_app`). Clients that ignore the server search path — Prisma — must be pointed at it explicitly (`schema=$BAY_DB_SCHEMA`) |
| `BAY_S3_BUCKET` | `storage` | S3 bucket name |
| `BAY_S3_PREFIX` | `storage` | S3 key prefix scoped to this app |

## Adding features

Use `bay add <feature>` to enable platform capabilities. Each feature provisions shared infrastructure and injects the corresponding env vars. If you pass an unknown feature name, the CLI prints the list of available features.

## bay.yaml

The manifest file. Declares what the app needs. Example with features:

```yaml
name: render-to-film
title: New App
description: What this app does
visibility: everyone

features:
  db:
    type: postgres
  storage:
    type: s3
```

Visibility options: `everyone` (all runwayml.com), `private` (owner only), or an object with `users` and/or `groups` lists.

## SDK (optional)

The `@runway/bay` SDK is an optional TypeScript utility library. Use it if you want pre-configured clients; skip it if you prefer direct dependencies.

```
npm install @runway/bay
```

### Available imports

| Import | What it provides | Status |
|--------|-----------------|--------|
| `@runway/bay` | `BayApp` class (HTTP routing, event handlers), `BayContext` handler context type | Working |
| `@runway/bay/db` | TypeORM DataSource factory | Working |
| `@runway/bay/logging` | Structured JSON logger | Working |
| `@runway/bay/runway` | Runway API client + auth middleware | Working |
| `@runway/bay/storage` | S3 object helpers for the app's own prefix | Working |
| `@runway/bay/testing` | Test harness (fire HTTP requests, inspect) | Working |

### BayApp class

```typescript
import { BayApp } from '@runway/bay';

const app = new BayApp();

app.get('/dashboard', async (ctx) => {
  const { email } = ctx.state.user;
  ctx.body = { user: email, status: 'ok' };
});

await app.start();
```

BayApp is built on Koa. Use `app.use()` for middleware and `app.koa` for direct Koa access. It automatically serves `/__bay/health`. It does not install a `SIGTERM` handler — if your app must flush or checkpoint before the pod goes away, register your own (see "Pods get replaced without a deploy" above).

To extract a handler into its own function, type its context as `BayContext` — no `@koa/router` dependency needed:

```typescript
import { type BayContext, BayApp } from '@runway/bay';

async function showUser(ctx: BayContext) {
  ctx.body = { userId: ctx.params['id'] };
}

const app = new BayApp();
app.get('/users/:id', showUser);
```

### Storage

Turn storage on with `bay add storage`, which installs the two AWS SDK packages `@runway/bay/storage` imports (`@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` — optional peers of `@runway/bay`, absent from this template, so importing the helpers without them fails at module resolution) and writes the full storage guidance into `.bay/docs.md`. Then use the helpers rather than a raw S3 client:

```typescript
import { deleteObject, getObject, list, putObject } from '@runway/bay/storage';

await putObject('my-file.json', JSON.stringify(data), {
  contentType: 'application/json',
});

const bytes = await getObject('my-file.json'); // null when it isn't there
const { objects, folders } = await list('reports/');
await deleteObject('my-file.json'); // succeeds even when it isn't there
```

Every key is relative to the app's prefix — never prepend `BAY_S3_PREFIX` yourself. The helpers are also the only storage path that works in a Bay Studio preview, where the pod holds no bucket credentials and they go through Bay's storage broker to the app's real prefix.

They cover put, get, delete, list, and `presignUpload()` (a URL the browser `PUT`s to directly). `deleteObject(key)` addresses exactly one key and never a prefix — deleting a whole prefix is `bay storage rm -r` from the CLI. Everything else about storage — media serving, presigned uploads, local dev — is in `bay docs sdk storage`.

### Using direct dependencies instead of SDK

You can always use direct dependencies instead of (or alongside) the SDK.

For storage, keep writes on the `@runway/bay/storage` helpers even when the rest of the app uses direct dependencies. Don't write with a raw `@aws-sdk/client-s3` client (`PutObjectCommand`, `DeleteObjectCommand`, multipart uploads): it reaches nothing in a Studio preview, misses the changes Bay makes centrally to how the helpers write, and `bay deploy` warns about it. Reads through a raw client still work. For a large body, mint a `presignUpload()` URL and let the browser `PUT` straight to S3.

## Common patterns

### HTTP API

```javascript
const http = require('http');
const server = http.createServer((req, res) => {
  if (req.url === '/__bay/health') {
    res.writeHead(200);
    return res.end('ok');
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ hello: 'world' }));
});
server.listen(process.env.PORT || 3000);
```

### Express app

```javascript
const express = require('express');
const app = express();
app.get('/__bay/health', (req, res) => res.send('ok'));
app.get('/', (req, res) => res.json({ user: req.headers['x-auth-request-email'] }));
app.listen(process.env.PORT || 3000);
```

### Postgres + Express

```javascript
const express = require('express');
const { Pool } = require('pg');
const app = express();
const pool = new Pool({ connectionString: process.env.BAY_DB_URL });

app.get('/__bay/health', (req, res) => res.send('ok'));
app.get('/items', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM items');
  res.json(rows);
});
app.listen(process.env.PORT || 3000);
```

## Local development

Run `bay dev` to start the app locally with file watching. It sets up `BAY_ENV=development`, `BAY_APP_NAME`, `PORT`, and feature-specific env vars. Open `http://localhost:3000` to test.

## Reporting Bay problems and friction

`bay feedback "<message>"` records the feedback on this Bay deployment and routes it onward to the Bay team where the deployment allows it. Use it proactively whenever the Bay platform gets in your way — and especially when you **struggle, work around something, or wish a command / feature / flag / SDK helper existed**. Those friction notes are the most valuable signal the team gets; keep the bar low ("I wished `bay X` existed", "this took three tries because Y"). Also report platform bugs, deploys that fail for a platform reason, and docs that don't match what you observe. This is for the platform itself, not bugs in this app's own code. The message can be an argument or piped on stdin; Bay attaches the CLI version, app name, and platform automatically.

## What NOT to do

- **Don't configure auth** — it's handled at the gateway level
- **Don't hardcode URLs or credentials** — use the injected env vars
- **Don't set up infrastructure manually** — use `bay add` features
- **Don't skip the health check** — Bay needs `GET /__bay/health` returning 200
- **Don't use port 80 or 443** — listen on `$PORT` (3000)
- **Don't hold multi-minute work only in memory** — a replaced pod loses it

## Project notes

Project-specific agent guidance goes between the markers below and survives `bay update --base`.

<!-- bay:custom:start -->
<!-- Add project-specific agent guidance here. `bay update --base` preserves everything between these two markers. -->
- **Settings tab** (`src/client/SettingsPage.tsx`, `src/settings-api.ts`): Runway sign-in status, built-in Runway MCP (`https://mcp.runwayml.com`) and Higgsfield MCP (`https://mcp.higgsfield.ai/mcp`), both OAuth, other MCP servers, and the Seevio API key.
- MCP is a small built-in client (`src/mcp.ts`, plain `fetch`, Streamable HTTP + OAuth/PKCE) — no extra packages. OAuth popups go through `/api/mcp/oauth/start` and `/callback` (`src/api-routes.ts`).
- Every credential lives server side in the visitor's `connections/<owner>.json` document (`src/connections.ts`); the client only ever gets `publicView` / `maskKey`.
- Seevio (`src/seevio.ts`): Bearer key against `https://api.seevio.ai` — the visitor's own key, else the app's `SEEVIO_API_KEY` secret (Runway App Studio → App settings → Secrets); `settings.seevioGenerate` starts a video, `settings.seevioTask` polls it.
- **Lifestyle tab** (`src/client/LifestylePage.tsx`, moments in `src/lifestyle.ts`): a render re-shot as a residents' moment, after Lodha's residential brand films. It has no router of its own — every take is `createShot` with `moment`, so it follows the Stills logic exactly (same models, looks, people options, cast sheet, people check, upscale). The moment replaces the activity in `buildCinematicPrompt`, lets its small `props` past "Only what's in the image", and adds `LIFESTYLE_FEEL`. Stills record `moment` (auto tag `@lifestyle`).
- **Lodha light** (`lodha-light` in `LOOKS`, `src/looks.ts`): soft warm backlight, haze, creamy low-contrast highlights and lifted shadows. It is a normal look, so Stills and the Director planner offer it too; the Lifestyle tab lists it first.
<!-- bay:custom:end -->
