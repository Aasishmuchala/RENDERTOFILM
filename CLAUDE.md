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
- **Lifestyle tab** (`src/client/LifestylePage.tsx`, router `lifestyle` in `src/lifestyle-api.ts`, prompts in `src/lifestyle.ts`): its own batch job. Upload up to 24 renders → a Claude planner tags each one (chapter, shot grammar wide/mid/close/detail/empty, keep-list, people brief, cast roles) into an editable plan → one generated cast sheet per chapter, always on Nano Banana 2.1 4K (`CAST_SHEET_MODEL` in `src/lifestyle.ts`; an uploaded sheet overrides) → every frame is shot in two passes: GPT Image 2.5 Sunburst draws an x-ray plate (`buildLifestylePrompt` with `plate: true`: flat, neutral, deep focus, every decision — camera, sun direction, people at true scale, plant species, materials — legible), then Nano Banana 2.1 4K develops it into the final with the look (`buildDevelopPrompt`: light quality and falloff, the lens's depth of field with no new foreground layer, filmic colour, vegetation/material texture; the light reference rides as image 3). New two-pass takes record `plate: true` and `pass2Request` picks the develop; older takes keep today's finish (`buildPass2Prompt`, which also carries the close-range vegetation and material texture brief, `VEGETATION_TEXTURE` / `MATERIAL_TEXTURE`; keep it under 4000 characters, the lowest cap of any pass-2 model). Cast sheets stand people beside a seat, tree, lamp post or doorway in the render's own camera. Pass 2 starts on the job poll under a per-take claim (`advancePasses`), so it is billed once; `retryPass2` re-sends a failed one. The cast-sheet sentence names exactly the frame's roles. `.router/` holds the checks (`lifestyle-prompts.ts`, `lifestyle-plate.ts`, `lifestyle-pass2.ts`, `lifestyle-cast.ts`, `stills-snapshot.ts`). Single-pass frames keep the filmic recipe unchanged. Lighting is designed per frame by the planner (`sun`: one of seven positions relative to the camera, agreeing with the render's own shadows; `light`: a ≤300-character brief of pools, shade and where the people stand), editable on the frame card; chapters carry key:fill ratios and Kelvin splits. Lit prompts keep one shadow family; the develop relights in place (`inPlace`: never moves or enlarges people, never adds a foreground layer at the frame's edges). `.router/lifestyle-light.ts` checks it. The plate adds nothing either: `PLATE_ADD_NOTHING` (short form first when over the cap), planting at the render's own sizes (`PLATE_PLANTING`), people among what is already there (`plateScaleText`), and a brief's depth-of-field clauses dropped (`plateBrief`); `.router/lifestyle-plate.ts` checks it, including the 2026-10-30 real frame.
- **Lodha light** (`lodha-light` in `LOOKS`, `src/looks.ts`): soft low sun, clean air and neutral colour (no haze, no golden cast). It is a normal look, so Stills and the Director planner offer it too.
- **AI text and vision** (Settings; `src/ai-text.ts`, `src/ai-text/providers.ts`, `src/ai-text/usage.ts`): every planner, the people check, the close-up finder and the AI editor call `createTextTask` / `textTaskSnapshot`. Provider Runway (default) sends the same `claude_api` task as before; Anthropic (official SDK, default `claude-opus-5-5`) or OmegaPlus (Anthropic-compatible gateway, live model list) use the owner's own key from `connections/`, run as `ai_` pseudo-tasks persisted under `ai-text/<owner>/`. A live call is never marked interrupted by age (15 min only for a job no process is running, 45 min ceiling); one call is capped at 5 min × 1 retry. `.router/claude-callsites.ts --compare` proves the Runway request bodies are unchanged.
- **Local dev** (git-excluded `.localdev/`): `@runway/*` are symlinks to `desktop/platform/`; the rest of `node_modules` links into `.localdev/deps`. `REAL_GEN=higgsfield` (launch `rendertofilm-real`, budget `REAL_GEN_BUDGET`, default 60 credits/day) sends image and video tasks to the Higgsfield CLI (`desktop/platform/realgen/`, ledger in `.localdev/harness/storage/higgsfield-ledger.jsonl`); `REAL_GEN=dry` quotes only; unset is the simulator.
- **Layout** (`DESIGN.md` §3 and §8): full-screen canvas, dark glass. The shell (`src/client/layouts/AppShell.tsx`, `Nav.tsx`) is a glass top bar with one menu button (Chat is home; no dock, tab bar or Shoot sheet any more, see Chat and Handoffs below) and `--app-header/--app-subnav` (`--app-dock` and `--app-bottom` stay defined, at 0). Every page except Settings (a centred glass sheet) renders one `layouts/Workspace.tsx`: canvas (states `empty | preview | live | free`, never an empty box), floating inspector with a sticky footer (one primary + `ui/CostLine`), filmstrip, phone bottom sheet with detents (`raiseSheet`), `i` hides the inspector. The phone layout is `PHONE_QUERY` (under 480 px, or portrait under 900); a landscape window from 480 gets the side inspector, and a short one (under 640 tall) tightens the bands and moves the picture's actions up into the toolbar band. Pages stay always mounted. Stress scripts live outside the repo; `.router/ui/shoot.cjs` is the screenshot gate.
- **Direction** (`src/direction.ts`, pure; source `vendor/director-skill/`, DirectorSKILL, MIT): `DIRECTION_DOCTRINE` is appended to the Director and Lifestyle planner system prompts; `directorStyle` (one of 20 lenses or `none`) on both plan inputs adds `lensBlock()` to the planner prompt; the Direction style select is `src/client/director/DirectionStyle.tsx`. Planner JSON is unchanged. `.router/direction.ts` checks it.
- **Realism** (`src/realism.ts`, pure; source `vendor/visual-realism/`, MIT): cue-triggered physical realism clauses (people, water, glass, contact, light) in the Lifestyle plate (posture and contact only), develop and pass 2 (compact, under 4000), and Director frames through an opt-in `buildCinematicPrompt` option; Stills never gets it (`stills-snapshot --compare` stays byte-identical). `.router/realism.ts` checks it.
- **Shot director** (`src/shot-director.ts`, pure; router `shot` in `src/shot-director-api.ts`; UI `src/client/ShotDirector.tsx` + `src/client/lib/useShotPlan.ts`): every video path (Video tab Animate, Director film step, Recreate in 4K) can be directed from what the first image shows, and the director is on by default on all of them, including the Director tab batch ("Direct N shots" before "Make N clips"; the switch is remembered per browser). One vision text call (`createTextTask`, name `render-to-film shot director`) returns an inventory of visible elements, a camera move described against them, what moves (only things that move in life), what the people already there do, beats, focus and the end frame; `resolveShotPlan` validates it in code: a person the image lacks is removed, a moving element not in the inventory is dropped, and the camera grammar is enforced (`FREE_MOVES` always; `REVEAL_MOVES` only when the clip can end on a crop of the same image, which the server cuts with sharp and uploads; arcs always downgrade). With the switch off, prompts are byte-identical to before (`.router/video-prompt.ts --compare`); `.router/shot-director.ts` holds the vectors; `.router/claude-callsites.ts` pins 6 sites. The planner never creates a video task; the primary button reads "Direct the shot" until a plan is on screen.
- **Desktop app** (`desktop/`; users start at `desktop/README.md`): an Electron shell for macOS (Apple silicon) and Windows (x64) around the same Koa server and React client. The server runs in a utility process on a loopback origin behind a per-launch token (`desktop/platform/bay/guard.js`). `desktop/platform/` is the tracked stand-in for `@runway/bay*`; the harness uses it too through the `node_modules/@runway/*` symlinks, so a change there reaches both, and the desktop bundle only after `npm run build` in `desktop/`. Generation is chosen per owner in Settings: Higgsfield through its bundled CLI, the Runway developer API, or the simulator under `--simulate` (`desktop/platform/providers/`, dispatched by `bay/tasks.js`). What each offers is `Capabilities` (`src/capabilities.ts`); the model table is Phase 12 decision 3 in `.router/PLAN.md`; the env contract is `desktop/platform/README.md`. `bay deploy` never sees any of this: `.dockerignore` excludes `desktop/` and `.github/`. Tests: `desktop/scripts/serve.mjs` is the headless server and `desktop/scripts/smoke.mjs` one pass through it, on your own ports, never 5173 or 3001. Boot the bundle, because a load-time crash still passes `npm run build`. Never launch the app with a bare `open`, always `--data-dir`: a bare launch runs on the real profile and Keychain. CI is `.github/workflows/desktop.yml`, and its smoke runs the unpacked app, not the installer.
- **Chat** (home page, `DEFAULT_PAGE = 'chat'`; `src/chat/*`, router `chat` in `src/chat-api.ts`, SSE route `src/chat-events.ts`, page `src/client/ChatPage.tsx` + `src/client/chat/*`, hook `src/client/lib/useChat.ts`): the user drops up to 24 renders and says what they need. A manual streaming loop on `@anthropic-ai/sdk` (`loop.ts` `runTurn`, at most 12 model calls a Turn; `model-client.ts` `createAnthropicClient`, `RTF_ANTHROPIC_BASE_URL` points it at a fake) calls 12 zod-checked tools (`contracts.ts`, classes read / text / local / propose / cancel; `tools/read.ts`, `tools/actions.ts`). Tools go through the existing routers with `createCaller`, so Stills, video and `claude_api` request bodies stay byte-identical (`--compare` guards); the loop itself bypasses `createTextTask` and is pinned by its own tests. It needs `resolveTextProvider(owner)` to be `anthropic`; otherwise a setup card. State is JSON documents (`store.ts`: `chat/`, `chat-events/` at 100 events a segment, assets under `chat-assets/`). `driver.ts` `tick(ctx, owner)` advances `lifestyle.job`, `storyboard.job`, `closeups.job`, `edit.project`, the library settle and the RunEngine (`runs.ts`, `pipeline.ts`) under their existing claims: on desktop `startDriver()` (from `src/index.ts` when `BAY_ENV=desktop`) ticks `LOCAL_OWNER` every 3 s and `desktop/main/main.ts` keeps the app alive with a tray and no suspension while Runs are active; on Bay `useChat` polls `chat.tick` every 3 s while a Turn or Run is live, so a closed tab pauses Runs. The SSE route (`GET /api/chat/events?thread=<id>`, `Last-Event-ID` backfill, 25 s heartbeat, ids and status only and never URLs, bypasses `rewriteJsonAnswer`) only shortens latency: the page works on `chat.thread` polling. Checks: `.router/chat-*.test.ts`, the fake Anthropic server `.router/fake-anthropic/server.mjs` (`--port N --scenario file.json [--requests out.jsonl]`, real SSE framing, 400s a thinking block it did not send byte for byte), and the acceptance test `.router/chat-e2e.test.ts` (6 renders and one sentence to a mastered film on the simulator, spend zero; `chat-e2e.README.md`; sandbox off, `npm run build` in `desktop/` first). Vocabulary is `GLOSSARY.md`; the plan is `.router/PLAN-13.md`.
- **Spend gate** (`src/chat/gate.ts`, types and `canRelease` in `src/chat/domain.ts`): `propose_run` makes a Quote (the `RunSpec` bound by `specHash`, priced by the provider through `RunwayClient.quote(type, options)`; the simulator table in `desktop/platform/providers/simulator.js`: image 4, pass-2 image 4, cast sheet 4 a chapter, video 5 a second, text and media processing 0), open 30 minutes, then `approved | declined | expired`; a changed spec is a new hash and a new Quote, the old one `declined` as `superseded`. There is no `start_run` tool: the model can only propose, and the Gate releases a Quote by a click (`chat.decide`), a typed yes (`parseYes`, only from a real user message newer than the latest open Quote), an Allowance that covers it (per owner and day, in the provider's own unit, default 0, set in Settings, Chat; off on Bay) or a price of 0 (source `free`). A price that rose, changed unit or is unknown refuses the release. Allowance use is reserved on start and reconciled on the result (`chat/<owner>/ledger.json`); every decision is one audit row (`chat/<owner>/audit/<yyyy-mm-dd>.json`, exported by `chat.auditCsv`). A Step writes its `intent` before any paid call, and one with an intent and no task id after a crash is `submit_unknown` and never sent again (`RunEngine.resumeAll`). Bay quotes show no amount ("billed to your Runway credits") and always need a click.
- **Mastering** (desktop only; pure graph builder and QC reader `desktop/platform/master.js`, the `master` operation in `desktop/platform/ffmpeg.js`, shared names `src/master.ts`, procedures `edit.exportMaster`, `edit.setMusic`, `edit.setTitles` in `src/edit-api.ts`): the cut becomes one file per Deliverable (`h264`, `hevc10`, `prores`, `vertical` = 9:16; `.router/master-presets.ts` fails when `src/master.ts` and `master.js` disagree). Recipe (research Q6): conform with `out_color_matrix=bt709` and `setparams`, H.264 High CRF 16 `-g 12 -bf 2`, AAC 320k at 48 kHz, the music bed through a two-pass `loudnorm` to -14 LUFS / -2 dBTP (`MASTER_TARGETS`), every cut and fade snapped to whole frames. QC (`parseQc`, `ebur128`) reads the file back: loudness within 1 LU, true peak at or under -1.5 dBFS, frame count within one, tags bt709 / bt709 / bt709 / tv; the report rides on the export artifact (`metadata.qc`) and shows on the Editing row, and a film with no music is silent and says so. Bay keeps `timeline_export` byte-identical (`.router/desktop-export.test.ts` pins it) and `capabilities.master` is false there. The cut carries a `rev`: `saveTimeline` takes `baseRev` and answers `CONFLICT` when it is stale. Checks: `.router/master.test.mjs`, `desktop-ffmpeg-master.test.mjs`.
- **Sidecars** (`desktop/platform/sidecars.js`, names in `src/sidecars.ts`, Settings, Power tools in `src/client/settings/PowerTools.tsx`): FilmCraft 0.15.0 and LightCraft 0.16.0 are optional command-line tools, never required. `PINS` holds each version and, per platform (`darwin-arm64`, `win32-x64`), the release asset and its sha256; `resolve(id)` takes `RTF_FILMCRAFT_BIN` / `RTF_LIGHTCRAFT_BIN` (final when set), a saved path, our download under `<data>/sidecars/<id>/`, then `PATH`; `status(id)` is a `SidecarStatus` and anything but the pinned version is `ok: false`. A download happens only on the user's confirm in Settings, is hash-checked before anything is unpacked, and a mismatch installs nothing. FilmCraft runs `conform_otio` (`desktop/platform/filmcraft.js`, `edit.conformFilmcraft`, OTIO from `src/interchange.ts`), LightCraft runs `relight` (`desktop/platform/lightcraft.js`, `relightStill`, the Still page's Relight menu); each is refused before a task exists when its tool is not ready, and `capabilities.sidecars` is false on Bay. Notices live in `desktop/THIRD_PARTY_NOTICES.md` (both elected under Apache-2.0; ArtCraft is not included, and its name and marks are not used). The macOS ffmpeg from `ffmpeg-static` reports nonfree: `desktop/scripts/check-ffmpeg-licence.mjs --warn` runs in `dist` and CI, and `.github/workflows/ffmpeg.yml` builds the GPL replacement (open question 1). Real-binary tests skip unless `RTF_REAL_FILMCRAFT_BIN` and `RTF_REAL_LIGHTCRAFT_BIN` are set (`.router/filmcraft-sidecar.test.mjs`, `lightcraft-sidecar.test.mjs`, `desktop-sidecars.test.mjs`).
- **Handoffs** (`src/client/handoff.ts`, page list in `src/client/nav.ts`): the address is the payload, `#<page>?k=v` (`parseHash`, `formatHash` with sorted keys, `GoTo(page, params)` for pages). Only `job`, `frame`, `still`, `clip`, `export`, `mode`, `preset`, `q` and `gallery` ride along; anything else is dropped. `#closeups`, `#location` and `#surroundings` alias to `#stills?mode=…`, and an unknown page is `chat`. The menu order is Director, Lifestyle, Still, Video, Editing, Library, Settings; page ids (`stills`, `edit`) never change, only labels do, and Still holds the modes Still, Close-ups and Location (`StillModes.tsx`). A chat result carries "Open in <page>" through a handoff (`#edit?export=<id>`); to link somewhere new, add the key to `KEYS` and read it in the page.
- **Monochrome** (DESIGN.md §2): the chrome is black and white and only pictures carry colour. Every colour in `src/client/styles/tokens.css` has equal channels (R=G=B); primary and selected are solid white (`--bay-accent`) with black text (`--bay-text-on-accent`); status is a glyph plus a label, never a hue (`--bay-ok/warn/err/info-*` are one white on `#1f1f1f`); glass is `--glass-saturate: 0`, `--glass-dim` (.55, a `brightness()`) and `grayscale(1)` in `glass.css`; the focus ring is two-tone; links are ink with an underline; `prefers-reduced-transparency` and `prefers-contrast` go opaque. Add no hex or `rgba(` number and no hue in a module. `.router/monochrome-tokens.mjs` pins the values, and `.router/ui/shoot.cjs` samples every chrome element's computed colours for `max(r,g,b) - min(r,g,b) <= 2` (pictures, `img`, `video`, `canvas` and `svg` are skipped; `--no-mono` turns it off).
- **Chat modes and shot craft**: the chat box offers Director (the best way to shoot each image) and Lifestyle (the architecture shown naturally with real people); `chat.send` takes `mode`, kept on the Thread, and `MODE_BRIEF` (`src/chat/system-prompt.ts`) follows the frozen prompt. A Director plan opens on the Director page from the chat; no Run can shoot a storyboard yet. `SHOT_CRAFT` (`src/direction.ts`, CC BY 4.0, `vendor/ai-film-knowledge-base/`) is mandatory in the Director planner and in `shot.plan` from the Director page (`craft: true`), and never reaches Lifestyle or Stills.
<!-- bay:custom:end -->
