# Render to Film for macOS and Windows

The Bay app's Koa server and React client in an Electron window. The server runs in an Electron utility process on a loopback port and the window loads that origin, so the client and the API are the same code the web app runs. `platform/` replaces what Bay provides; see `platform/README.md`.

Nothing here changes `bay deploy`: the root `package.json`, lockfile, `Dockerfile` and `tsconfig.json` do not know about this folder, and `.dockerignore` leaves it out of the image.

## Install

Node 22.12 or newer, then:

```sh
cd desktop
npm install
```

This fetches ffmpeg and the Higgsfield CLI. Electron's own binary downloads the first time it runs. FilmCraft and LightCraft are not fetched here: they are optional, and come only when you ask (see Power tools).

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

**macOS.** Drag the app to Applications and open it. macOS refuses the first time, because the app has no Developer ID. Get past that in one of these ways:

- On macOS 15 and later: open System Settings, then Privacy & Security, and press Open Anyway.
- On older versions: right-click the app, choose Open, and confirm.
- On any version, in Terminal:

```sh
xattr -dr com.apple.quarantine "/Applications/Render to Film.app"
```

Gatekeeper's wording was not observed: nobody has seen these dialogs on this build yet, so the steps above are what to expect, and the words on your screen may differ.

macOS then asks once whether the app may use its Keychain item, on the first launch of each new version. Choose Always Allow: that item is what keeps your saved keys sealed. If you choose Deny, the app says so and closes, and your keys stay as they are.

**Windows.** SmartScreen shows "Windows protected your PC". Press More info, then Run anyway. This was not observed either: CI runs the unpacked app, which never meets SmartScreen.

## Where your work lives

| | macOS | Windows |
|---|---|---|
| Library, uploads, tasks | `~/Library/Application Support/Render to Film/data` | `%AppData%\Render to Film\data` |
| Server log | `.../Render to Film/logs/server.log` | `...\Render to Film\logs\server.log` |
| Sealed data key | `.../Render to Film/data-key.sealed` | `...\Render to Film\data-key.sealed` |

Help in the menu opens the data folder and the log. Saved keys and tokens are sealed with AES-256-GCM under a data key held by the Keychain or DPAPI. The Higgsfield CLI keeps its own sign-in; the app never reads it.

Each saved document is written to a temporary file and renamed into place, and an identical copy stays beside it as `<name>.bak`. If a document cannot be read, the damaged file is set aside as `<name>.corrupt-<time>` and the backup takes its name. Both kinds of spare file can be left alone. Delete a `.corrupt-` file once you know you do not need it.

## Importing a library

Choose Import library… from the menu and pick a folder that holds `storage/` and `uploads/`: another install's `data` folder, or the harness's `.localdev/harness`. The folder is only read.

The import runs while the data folder has no library yet, so do it before your first still. Keys sealed by another install cannot be opened here and stay behind, so add those again in Settings.

From a terminal, `--import <folder>` offers the same import at launch. A dev run on the default data folder offers `<repo>/.localdev/harness` by itself.

## Choosing who generates

Open Settings (`Cmd+,` on a Mac, `Ctrl+,` on Windows), go to Generation, and pick a Provider. A new install starts on Higgsfield.

| Provider | Sign in | Billed to | Cost line |
|---|---|---|---|
| Higgsfield | Press Sign in with Higgsfield and finish in your browser | Your Higgsfield credits, up to the Daily Higgsfield budget (300 unless you change it) | The exact quote for the run |
| Runway API | Paste an API key from dev.runwayml.com | Your Runway API credits, at $0.01 each | The published rate for the model |

Switching keeps the models you picked. A model the new provider does not offer says "Not offered by <provider>. Pick another model." and holds the primary button until you do. A run already started stays with the provider that started it.

Planning text is separate. The planners, the people check, the close-up finder and the AI editor need an Anthropic or OmegaPlus key, under AI text and vision in Settings, whichever provider generates.

## The chat

Chat is the first page. Drop renders in and say what you need, and the assistant plans it and shows a priced quote. Nothing is billed until you say yes: press the quote's button, type yes to the latest quote, or set an Allowance that covers it. An approved quote becomes a Run: plan, cast, stills, direct, clips, cut, master and QC, ending at a finished master and a link into Editing.

Chat needs a direct Anthropic key, whichever provider generates: pick Anthropic and add the key under AI text and vision in Settings, then set the model and the Allowance under Chat. Without the key, Chat shows a setup card. The Allowance is per day, in the provider's own unit (credits on Higgsfield and the simulator, dollars on the Runway API), and starts at 0, so every quote waits for your yes. A quote that costs nothing (local work only) starts by itself. Every decision is written to `<data>/storage/chat/<owner>/audit/`, one file a day.

## Background runs

A Run is a file on disk, and the app carries it on while it runs.

- **Keep running.** While any generation or Run is active, closing the last window does not quit the app. A Mac app always stayed open; a Windows app used to quit with its last window and now waits. A tray icon (menu bar on a Mac, notification area on Windows) holds the way back: Open Render to Film, and Quit. The app also asks the system not to suspend it (`prevent-app-suspension`), and tells the server when the computer wakes.
- **Idle.** Once nothing is running, a Windows app with no window quits after about 15 seconds; a Mac app stays in the Dock as usual.
- **Quit.** Quit while a generation is still running and the app says so, and offers to keep open. The work continues at the provider. A Run that was between steps simply pauses.
- **Next launch.** The Run carries on from where it was. A step that had written what it was about to send but had no task id yet is marked "submit unknown" and is never sent again, so a crash cannot bill twice.
- **Stop.** The Stop button on a Run stops following it. A task already sent to the provider is not cancelled, and the button says so.

## Mastering

The Editing page's primary button is Master. It makes one finished file for each format you tick, with the music bed mixed in and the sound mastered, and reads each file back to check it.

| Deliverable | File | What it is |
|---|---|---|
| H.264 for web | `.mp4` | H.264 High, 8-bit, CRF 16, a keyframe every 12 frames, AAC 320 kbit/s at 48 kHz |
| HEVC 10-bit for review | `.mp4` | HEVC 10-bit, CRF 16, tagged `hvc1` so QuickTime opens it |
| ProRes 422 HQ master | `.mov` | ProRes 422 HQ, 10-bit 4:2:2, 16-bit PCM sound |
| 9:16 for social | `.mp4` | The H.264 recipe at 1080 x 1920; each cut either crops a window of its clip or sits whole on black |

Every file is converted to Rec.709 and tagged BT.709 (colour space, primaries, transfer and limited range). Sound is the music bed, trimmed and faded to the film's length, then normalised in two passes to -14 LUFS with a true-peak ceiling of -2 dBTP. A clip's own sound is not used, and with no music bed the file has no sound track.

**QC.** Each file is read back and gets a QC report on its row: integrated loudness (it must sit within 1 LU of -14 LUFS), true peak (at or under -1.5 dBFS, because the meter reads a little hotter than the normaliser), the frame count against the plan (within one frame), and the four colour tags. The report says pass or fail and gives a sentence for each finding. A film with no sound has nothing to measure, so QC says that and judges the picture alone.

Mastering is a desktop operation. The Bay web app keeps its silent, untagged export (`capabilities.master` is false there).

## Power tools

Two optional command-line editors can be added under Settings, Power tools. The app works without them and nothing downloads until you ask.

| Tool | Pinned version | What the app uses it for |
|---|---|---|
| FilmCraft (`filmcraft-cli`) | 0.15.0 | Renders the cut through FilmCraft's engine instead of ffmpeg: the Editing page's Conform in FilmCraft button, a second way out beside Master (`conform_otio`). Until the tool is ready the page says where to set it up |
| LightCraft (`lightcraft-cli`) | 0.16.0 | Relights a finished still on this computer: the Relight menu on the Still page appears once it is ready |

Each tool is pinned to one version and, per platform, one release file and its sha256 (`platform/sidecars.js`), because these CLIs rename commands between releases. A different version on your computer is reported as such and is not used. There are three ways to have one:

- **On this computer.** The app looks at `RTF_FILMCRAFT_BIN` or `RTF_LIGHTCRAFT_BIN` (when set, that path is final), then a path you saved, then the app's own download, then `PATH`.
- **Choose a file.** Paste the path of a copy you already have. It is saved only if it runs and is the pinned version.
- **Download.** Press Download and confirm. The app fetches the pinned release from `github.com/storytold/<tool>` over https, checks its sha256 before anything is unpacked, and keeps it under `<data>/sidecars/`. A file that does not match is deleted and nothing is installed ("Download did not match the pinned hash; nothing was installed."); a failed download leaves any earlier copy in place. On a Mac the app clears the downloaded file's quarantine flag, and says so if it cannot. Remove deletes the download and forgets a saved path.

A tool that has no build for your platform reads "Not available for this platform yet." Both are pinned for macOS (Apple silicon) and Windows (x64). Both ran on a Mac with the pinned versions: Windows and the packaged app are not yet verified for either, and a server crash in the middle of a run can leave the tool's process running.

## Third-party software and the ffmpeg licence

`THIRD_PARTY_NOTICES.md` (in this folder) lists the licences of what the app ships and of the two tools it can fetch. FilmCraft is used under the Apache License 2.0, one of the two it offers. The ArtCraft name belongs to its owners: the app contains no ArtCraft code and does not depend on it. The installer carries the notices file in the app's resources folder.

**ffmpeg is an open question.** The macOS ffmpeg that npm's `ffmpeg-static` bundles reports that it was built with nonfree parts, and such a binary cannot be handed to anyone else. Today that is a warning, not a stop: `npm run dist` runs `scripts/check-ffmpeg-licence.mjs --warn`, and so does CI, so the state shows on every build. The recommendation in `.router/PLAN-13.md` (open question 1) is to keep the current binary for staff-only builds, warn at `dist`, and block once the replacement exists. The replacement is a GPL ffmpeg 7.1.5 built from FFmpeg's own signed source, by `.github/workflows/ffmpeg.yml` (run by hand; it uploads an artifact and touches no release). Someone checks that artifact on macOS 13, bundles it, and then takes `--warn` out of `scripts/build.mjs`, after which a nonfree binary stops `dist`. Until then, do not give a macOS build to anyone outside the team. `node scripts/check-ffmpeg-licence.mjs` with no flag asks the binary now: it exits 2 on nonfree parts. The same check runs in both CI jobs.

## Limits

- A master's sound is the music bed alone: a clip's own sound is dropped, and a film with no bed has no sound track. Trim and stitch encode video only.
- Recreate in 4K needs Higgsfield. On the Runway API it is off and says so.
- Grades and AI edits need the Runway API. On Higgsfield they are off, and export still works.
- The Mac build runs on Apple silicon only. There is no Intel build. The Windows build is x64.

## Getting a new version

There is no auto-update. Open the releases page with Check for updates in Settings, or with Releases on GitHub in the Help menu, download the new dmg or installer, and install it over the old one. Your data stays where it is. Expect the first-open steps again, because each download is a new unsigned file.

To publish one, push a `desktop-v*` tag. The workflow builds both platforms and attaches the files to a draft release, which someone then publishes by hand.

## Tests

Never launch the app with a bare `open`, and always pass `--data-dir`. A bare launch runs on the real profile and creates a real key and Keychain item. On a Mac:

```sh
open "release/mac-arm64/Render to Film.app" --args --simulate --data-dir <dir>
```

A quarantined copy runs from an AppTranslocation path, so match that path when you look for its process. The paid tests below are the one exception to `--data-dir`, and only after the yes they ask for.

### Headless server

`scripts/serve.mjs` runs the built server without Electron, for the stress scripts, the shooter and CI:

```sh
npm run build
node scripts/serve.mjs --port 3962 --data-dir <dir> --token <token> --simulate
```

Use the ports 3961 to 3999, never 5173 or 3001. Boot the built bundle in every check: a load-time crash still passes `npm run build`.

### Chat end to end

`.router/chat-e2e.test.ts` is the acceptance test: six renders and "Make a one-minute lifestyle film with people" go through chat on the built server, on the simulator, with a scripted fake Anthropic server (`.router/fake-anthropic/server.mjs`, reached through `RTF_ANTHROPIC_BASE_URL`), and a click approves the quote. It ends in a mastered film with a QC report and a link into Editing, and spends nothing. It takes about three minutes at `RTF_SIM_SPEED=8`, binds two ports of 4670 to 4679, and needs a fresh `npm run build` first (`.router/chat-e2e.README.md`). Like the rest of `.router/`, it runs only on a developer's machine.

### CI

`.github/workflows/desktop.yml` runs on pushes to the `desktop` branch, on `desktop-v*` tags and by hand. It builds on `macos-latest` and `windows-latest`, then runs `scripts/smoke.mjs` on the simulator against what it just packaged. Run 41185396614 passed on both at commit 554ff0e.

That smoke runs the unpacked app (`release/mac-arm64`, `release/win-unpacked`), not the installer. The dmg and the NSIS installer are built and uploaded but nothing runs them, so a first open on a real machine is still the only test of those. `.router/` and `.localdev/` are git-excluded, so their checks run only on a developer's machine, and CI installs only `desktop/`.

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
