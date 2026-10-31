# desktop/platform

The tracked platform layer of the desktop app: file-backed stand-ins for Runway's private `@runway/bay` and `@runway/bay-react`, the Higgsfield bridge, and the simulator's stills and clip. Nothing under `src/` imports this folder by path; the local harness reaches it through the `node_modules/@runway/*` symlinks, and the desktop build through aliases on those same specifiers.

This folder is the only thing `bay deploy` never sees. `.dockerignore` excludes `desktop/`, so the Bay image is built from exactly what it was built from before this folder existed.

| Folder | What it is |
|---|---|
| `bay/` | `@runway/bay`: identity, errors and the `/__mock/*` file server (`runway.js`), tasks and `RunwayClient` (`tasks.js`), storage on disk (`storage.js`), file locations (`paths.js`) |
| `bay-react/` | `@runway/bay-react`: the sign-in, credits and preview-bridge widgets, and the tokens |
| `providers/` | The owner's provider behind `bay/tasks.js`: Higgsfield (`higgsfield.js`), the Runway developer API (`runway-api.js`, `runway-mapping.js`, `runway-rates.js`) and the simulator (`simulator.js`); `types.js` is the contract |
| `realgen/` | Stills and clips on Higgsfield through its CLI (`README.md` has the modes and files) |
| `assets/` | The simulator's seven results, served at `/__mock/assets/*` |

## Env and boot (server process)

`RTF_DATA_DIR` (required; harness: `<repo>/.localdev/harness`), `RTF_ASSETS_DIR` (default `<platform>/assets`), `PORT` (main picks it: `RTF_PREFERRED_PORT` default `47821`, else a free random one), `BAY_ENV=desktop`, `NODE_ENV=production` (packaged; serves the built client), `RTF_SIMULATOR=1` (enables the simulator provider and makes it the default for a fresh owner), `RTF_PACKAGED=1` (packaged app: a missing secret key is fatal), `REAL_GEN=dry` (Higgsfield quote-only, for free checks), `REAL_GEN_HF_BIN`, `RTF_FFMPEG` (override the ffmpeg path). Secrets arrive on `process.parentPort` as `{ type: 'boot', token: <64 hex>, secretKey: <64 hex> }` when `process.parentPort` exists; otherwise `RTF_DESKTOP_TOKEN` and `RTF_SECRET_KEY` from env (harness, CI); with neither, the guard allows no API call until boot (`/__bay/health` stays open) and the secret key is written to `<data>/dev-secret.key` with a console warning (never when `RTF_PACKAGED=1`: exit 1 with `Render to Film: no secret key; refusing to start.`). The server tells main `{ type: 'jobs', active: n }` whenever the count of runs in `submitted | waiting | downloading` changes.

Importing `bay/runway.js` or `bay/storage.js` without `RTF_DATA_DIR` throws `RTF_DATA_DIR is not set`, and there is deliberately no default here: a server that lost its data folder must stop, not write somewhere else. Each place that starts the code sets it: `.localdev/harness/dev.mjs` for the harness and every launch entry, and for a check that imports a `src/` module on the way, `import './rtf-data-dir.ts';` as its first import (`.router/rtf-data-dir.ts`).
