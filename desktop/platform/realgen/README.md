# realgen — real stills and clips on Higgsfield (local only)

The stub (`../bay/tasks.js`) hands image and video tasks to this folder when `REAL_GEN` is set; with it unset the simulator runs exactly as before.

- **off** (default): simulator, canned crane shot.
- **dry**: inputs uploaded (free) and quoted with `generate cost` (free, validates every param); no `create`; the result is a canned asset after 3 s; the ledger records `dry-submit`.
- **higgsfield**: upload once → `cost` → budget check → `generate create` (no `--wait`) → `generate wait <id>` → download. One `create` per task, ever.

| env | default | meaning |
|---|---|---|
| `RTF_DATA_DIR` | none, required | the data folder (`.localdev/harness` in the harness, which its `dev.mjs` sets) |
| `REAL_GEN` | off | `dry` or `higgsfield` |
| `REAL_GEN_BUDGET` | 60 | credits per session + mode, summed from the ledger; `0` refuses every paid run |
| `REAL_GEN_SESSION` | local date | budget bucket; a new label starts a new budget |
| `REAL_GEN_HF_BIN` | `/usr/local/bin/higgsfield` | absolute path to the CLI |
| `REAL_GEN_WAIT_TIMEOUT` | 30m | `generate wait --timeout` |

Launch entries (`/Users/aasish/Desktop/test/.claude/launch.json`; all share port 5173, run one at a time):
```json
{ "name": "rendertofilm-real", "runtimeExecutable": "node", "runtimeArgs": ["/Users/aasish/Desktop/RENDERTOFILM/.localdev/harness/dev.mjs"], "port": 5173,
  "env": { "RTF_DATA_DIR": "/Users/aasish/Desktop/RENDERTOFILM/.localdev/harness", "REAL_GEN": "higgsfield", "REAL_GEN_BUDGET": "60", "REAL_GEN_HF_BIN": "/usr/local/bin/higgsfield", "PATH": "/opt/homebrew/opt/node@22/bin:/usr/local/bin:/usr/bin:/bin" } },
{ "name": "rendertofilm-dry", "runtimeExecutable": "node", "runtimeArgs": ["/Users/aasish/Desktop/RENDERTOFILM/.localdev/harness/dev.mjs"], "port": 5173,
  "env": { "RTF_DATA_DIR": "/Users/aasish/Desktop/RENDERTOFILM/.localdev/harness", "REAL_GEN": "dry", "REAL_GEN_HF_BIN": "/usr/local/bin/higgsfield", "PATH": "/opt/homebrew/opt/node@22/bin:/usr/local/bin:/usr/bin:/bin" } }
```

Files (under `$RTF_DATA_DIR/storage/`):
- `higgsfield-ledger.jsonl` — one line per quote, refused, dry-submit, submit, resume, result, error (with session, mode, taskId, args, credits, jobId).
- `tasks.json` — each run's `task.real` (state, model, params, mediaIds, credits, jobId, error).
- `realgen/uploads.json` — upload ids by input SHA-1 (delete it to force fresh uploads); `realgen/inputs/` — remote inputs fetched once.
- `realgen/jobs/<taskId>.create.json`, `.wait.json` — the CLI's raw replies, written before they are parsed.
- `realgen/results/<taskId>.<ext>` — the downloaded result, served as `/__mock/storage/realgen/results/<taskId>.<ext>`.
- `GET http://localhost:3001/__mock/realgen/status` — mode, budget, spent, remaining, runs in flight, last 20 ledger lines.

Restarts: a run with a job id is followed again with `generate wait` (free); a run that may have reached `create` without an id is marked failed and never resubmitted; anything earlier fails as uncharged. Inspect any job with `higgsfield generate get <jobId> --json` (its id is in the ledger and in `jobs/<taskId>.create.json`).

Paid smoke (user-gated):
1. Start `rendertofilm-real`; `curl -s localhost:3001/__mock/realgen/status` shows `"mode": "higgsfield"`.
2. Stills tab, Nano Banana 2.1 at 1K (1.5 cr): the image appears; `realgen/jobs/<id>.create.json` has an `id`; `realgen/results/<id>.png` exists; the ledger has `submit` and `result`.
3. Clips tab, Kling 3 Pro (7.5 cr) or Gen-4 Turbo (→ kling3_0 std, 6.25 cr): read the `quote` line from the status endpoint and confirm with the user first.

| kept simulated | `claude_api` (text follows app Settings), `media_processing_v2`, `workflow_aleph_2`, unknown types |
|---|---|

| pass-through (result = input) | `magnific_*`, `flux_video_upscale` |
|---|---|

| real upscale | `media_upscale` → `bytedance_video_upscale` 4k standard aigc (4 cr), the parent clip as `--video-references`, no prompt; an unknown parent stays simulated. The Animate tab's "Runway Video Upscale" and the Recreate in 4K step 2 both run it. |
|---|---|

| mapped clips (video references) | `kling_4_0` → `kling4_0` (Recreate in 4K step 1): `mode` reference-to-video when `referenceVideos` is sent, else image-to-video; 3-15 s as sent; 720p or 1080p; the first reference image is `--start-image`, each `referenceVideos` url a `--video-references`. `seedance_2` / `seedance_2_fast` take `referenceVideos` too (3 at most, the rest noted and dropped); `seedance_2_5` takes none (noted). |
|---|---|

| fallbacks (noted in the ledger) | Gen-4.5 / Gen-4 Turbo / LTX → `kling3_0` std; Krea / Gen-4 Image → `nano_banana_pro`; Seedream 5 3k → 2k; Flux 2 Max 4 MP → 2k |
|---|---|

`argsFor` leaves `--prompt` out when a decision's prompt is `null` (`bytedance_video_upscale` refuses it with `Unknown params: prompt`); an empty string is still sent.

Tests: `node --test .router/realgen-mapping.test.mjs .router/realgen-dry.test.mjs` (the dry e2e runs on a temp copy with a fake CLI; only `generate cost` reaches Higgsfield).
