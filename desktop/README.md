# Render to Film for macOS and Windows

The Bay app's Koa server and React client in an Electron window. The server runs in an Electron utility process on a loopback port and the window loads that origin, so the client and the API are the same code the web app runs. `platform/` replaces what Bay provides; see `platform/README.md`.

Nothing here changes `bay deploy`: the root `package.json`, lockfile, `Dockerfile` and `tsconfig.json` do not know about this folder, and `.dockerignore` leaves it out of the image.

## Install

Node 22.12 or newer, then:

```sh
cd desktop
npm install
```

This fetches ffmpeg and the Higgsfield CLI. Electron's own binary downloads the first time it runs.

## Run

```sh
npm run dev
```

That is a build, then `electron .`. After changing `platform/`, `main/`, `preload/` or anything under `src/`, run it again: the server, main and preload are bundles.

The first run on the default data folder offers to import the library in `<repo>/.localdev/harness`.

## Build

```sh
npm run dist
```

This writes `release/Render to Film-<version>-arm64.dmg` and a zip on a Mac, and the x64 NSIS installer on Windows. Each platform builds on itself, because npm installs only the host's sharp and ffmpeg. The Windows build comes from the GitHub Actions workflow.

Builds carry no Developer ID or Windows certificate. The Mac app gets an ad-hoc signature (`scripts/after-pack.cjs`), which costs nothing and is what lets macOS treat it as unidentified, not broken. There is no auto-update, because Squirrel.Mac refuses unsigned apps.

## First open

**macOS.** Drag the app to Applications and open it. macOS refuses the first time. On macOS 15 and later, open System Settings, then Privacy & Security, and press Open Anyway. On older versions, right-click the app and choose Open. Or, in Terminal:

```sh
xattr -dr com.apple.quarantine "/Applications/Render to Film.app"
```

macOS then asks once whether the app may use its Keychain item, on the first launch of each new version. Choose Always Allow: that item is what keeps your saved keys sealed. If you choose Deny, the app says so and closes, and your keys stay as they are.

**Windows.** SmartScreen shows "Windows protected your PC". Press More info, then Run anyway.

## Where your work lives

| | macOS | Windows |
|---|---|---|
| Library, uploads, tasks | `~/Library/Application Support/Render to Film/data` | `%AppData%\Render to Film\data` |
| Server log | `.../Render to Film/logs/server.log` | `...\Render to Film\logs\server.log` |
| Sealed data key | `.../Render to Film/data-key.sealed` | `...\Render to Film\data-key.sealed` |

Help in the menu opens the data folder and the log. Saved keys and tokens are sealed with AES-256-GCM under a data key held by the Keychain or DPAPI. The Higgsfield CLI keeps its own sign-in; the app never reads it.

To bring a library from another folder, start the app once from a terminal with `--import <folder>` while the data folder is still empty. The folder is only read. Keys sealed by another install cannot be opened here and stay behind, so add those again in Settings.

## Updating

Download the new dmg or installer from the releases page and install it over the old one. Your data stays where it is. Settings has a Check for updates link.

## Headless server, for tests

`scripts/serve.mjs` runs the built server without Electron, for the stress scripts, the shooter and CI:

```sh
npm run build
node scripts/serve.mjs --port 3962 --data-dir <dir> --token <token> --simulate
```

Use the ports 3961 to 3999, never 5173 or 3001. Boot the built bundle in every check: a load-time crash still passes `npm run build`.

## Launch flags

For CI and tests. In normal use there are none.

| Flag | What it does |
|---|---|
| `--simulate` | Offers the simulator provider and makes it the default. Keeps to a mock keychain, so a test run never touches the real one. |
| `--port N` | The preferred port, instead of 47821. A busy port falls back to a random free one. |
| `--token T` | The per-launch token, instead of a random one. |
| `--data-dir D` | Keeps the data, the Chromium profile, the key and the log under `D`. The single-instance lock moves with it. |
| `--import FROM` | Offers to import `FROM` when the data folder has no library. |
| `--import-yes` | Imports without asking, for CI. |
| `--screenshot FILE` | Writes the window to `FILE` 5 seconds after load, then quits. |

`RTF_DEVTOOLS=1` adds Developer Tools to the View menu. `RTF_PREFERRED_PORT` sets the preferred port.

## Paid tests

Nothing here spends money by default. Checks run on the simulator, or on Higgsfield with `REAL_GEN=dry` (uploads and `generate cost` only, free), with fake keys. A real generation happens only after the person paying has said yes to the stated quote, one still per provider:

- Higgsfield: Nano Banana 2.1 at 1K, at the quote `generate cost` gives.
- Runway API: `nano_banana_2.1` at 1K, 4 credits on the rate card.

Run those on the real app with `npm run dev`, then confirm the still appears and record the credits spent. Never point a test at the real data folder with a provider other than the simulator unless that is the test.
