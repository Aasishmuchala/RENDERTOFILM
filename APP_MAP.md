# Render to Film — app map

How the app works, tab by tab, and what looks fragile. Written 2026-10-28 from a full read of `src/`.
Line numbers are approximate pointers (`file:line`). Findings marked **verified** were re-checked against the code.
Updated 2026-11-01 for the chat-first shell (Phase 13): the page list and the hash routes are in "Pages and hash
routes" below, and each page's own behaviour is still the tab-by-tab text. "Tab" and "page" mean the same thing here.

## The big picture

A Bay app (Koa + tRPC server, React + react-aria client) that turns 3D architectural renders into photoreal
film stills and clips, all on the visitor's own Runway account and credits.

- **Sign-in:** `runwayAuth({ optional: true })` (`src/index.ts`). Anyone can look; every paid call goes through
  `signedInProcedure` (tRPC) or `requireRunwayUser()` (raw routes).
- **Every generation is a Runway task:** the server calls `ctx.runway.createTask(...)`, returns the task id at once,
  and the client polls. When a task finishes, the server patches the record (`settled()`, `src/task-helpers.ts`).
- **Claude is called through Runway too:** `createTask('claude_api', { model: 'claude-sonnet-5-5' | 'claude-opus-5-5', ... }, { internal: true })`
  for the Director planner, Close-ups finder, AI editor and people check.
- **Storage:** no database. One JSON document per person per feature in S3 via `documentStore`, keyed by an owner
  hash (sha256 of the Runway JWT id/email, 24 hex chars; `src/library.ts:157`). Media stays on Runway and is
  re-signed on each request; the app's own S3 holds only thumbs, view copies, masks, render copies and composites.

| Document | Holds | Cap |
|---|---|---|
| `library/<owner>.json` | every Still and Clip | 600 each |
| `storyboards/<owner>.json` | Director jobs | 10 |
| `closeups/<owner>.json` | Close-up jobs | 20 |
| `edits/<owner>.json` | Edit timeline, versions, exports, chat, memory | see Edit |
| `connections/<owner>.json` | MCP servers, tokens, Seevio key (Settings) | 20 servers |

- **Pages share data through the `library` query cache and, for a selection, through the address hash.** All page
  panels stay mounted, so switching pages never loses work in progress. `onAnimate(stillId)` from Stills (and its
  Close-ups and Location modes), Director and Lifestyle opens `#video?still=<id>`; the Video page also keeps the last
  pick in sessionStorage (`pickedStillId`).

## Pages and hash routes

`DEFAULT_PAGE` is `chat` (`src/client/nav.ts`): a bare address, or one that names no page, opens the chat. One menu
button in the top bar lists the other pages, in this order. Each page is one panel that stays mounted; its id is the
address hash, so deep links never change. `src/client/handoff.ts` (`parseHash`, `formatHash`) reads and writes them.

| Hash | Page (menu label) | Notes |
|---|---|---|
| `#chat` | Chat (the brand link, not in the menu) | Home. `#chat?gallery=1` shows the chat's cards on their own, for the screenshot gate |
| `#director` | Director | `?job=<id>` opens a storyboard job |
| `#lifestyle` | Lifestyle | `?job=<id>&frame=<n>` opens a job and a frame |
| `#stills` | Still | Three modes in a row under the top bar: Still, Close-ups, Location. `?mode=closeups` or `?mode=location` picks one; `?job=`, `?clip=`, `?still=` load a selection into it |
| `#video` | Video | `?still=<id>` or `?clip=<id>` loads the first frame or a reference clip; `?preset=<json>` is a whole Video preset (`parseVideoPreset` accepts it whole or not at all) |
| `#edit` | Editing | `?clip=<id>` adds a clip, `?export=<id>` opens a finished export (a master) |
| `#library` | Library | `?q=<text>`, `?still=<id>`, `?clip=<id>` search or select |
| `#settings` | Settings | |

Aliases: `#closeups` is `#stills?mode=closeups`, `#location` and `#surroundings` are `#stills?mode=location`.
`formatHash` sorts the keys, so one handoff is one address. Only these keys ride in an address; anything else is
dropped: `job`, `frame`, `still`, `clip`, `export`, `mode`, `preset`, `q`, `gallery`.

A chat result links out with the same hashes ("Open in Editing" is `#edit?export=<id>`), and a page link back to
the chat is `#chat`.

## Tabs

### Chat — home, plans and runs a film (Phase 13)
Drop up to 24 renders (images, 25 MB each) and say what you need. A manual streaming loop on `@anthropic-ai/sdk`
(`src/chat/loop.ts`) calls 12 tools (`src/chat/contracts.ts`): read tools look at the project, text tools run the
existing planners, local tools crop and edit the cut, and `propose_run` makes a priced Quote. The model never starts
paid work: only a click on the Quote card, a typed yes, an Allowance that covers it, or a price of zero does
(`src/chat/gate.ts`). An approved Quote becomes a Run (plan, cast, stills, direct, clips, cut, master, qc) that goes
on in the background and ends in a finished master and a link into Editing. Needs the owner's own Anthropic key
(Settings, Chat). Code: `src/chat/`, router `chat` in `src/chat-api.ts`, the event stream in `src/chat-events.ts`,
the page in `src/client/ChatPage.tsx` and `src/client/chat/`. Vocabulary: `GLOSSARY.md`; the plan is
`.router/PLAN-13.md`.

### Director — a storyboard planned by Claude
1. Upload up to 12 renders (ephemeral Runway assets, ~1–2 days).
2. Pick one of 10 storylines and optionally write your own story.
3. **Plan:** Claude (Sonnet 5.5) gets the images in batches of 6, one after another (each later batch is told the
   plan so far), and returns, per frame, a story position (1–100), title, beat, a recommended look and a people
   preset with reasons. No camera moves. A batch that fails leaves its images on the board as rendered.
4. **Board:** per frame, change lighting, camera, people and direction; autosaved.
5. **Shoot** a frame (or all) — a Still through the shared `submitStill`, tagged `storyboard`.
6. **Film step:** choose frames, then make one clip per frame in story order (shared `createVideo`).
   Film settings live only in the browser (localStorage).
7. "Cut them on the Edit tab" only switches tabs — no clips or order are passed over.

Code: `src/storyboard-api.ts`, `src/storyboard.ts`, `src/client/DirectorPage.tsx`, `src/client/director/`.

### Stills — the core render → photo step
Drop a render, optionally paint a mask, pick model / resolution / ratio, a look **or** a lighting reference
(photo, or match another still for a series), a camera angle, optional people (crowd, cast sheet), direction and
the "only what's in the image" switch. **Make it cinematic** → `createShot`, polled by `shotStatus`.

- **Prompt:** `buildCinematicPrompt` (`src/looks.ts:575`) — fidelity, materials, light, lens, strict rule, people,
  direction, fixes; shortened to fit each model's prompt cap.
- **Marked edit:** the model must keep the render's shape; afterwards `composite.ts` pastes the render's own pixels
  back outside the mask. Only the composite is ever shown.
- **People check:** Claude (Opus 5.5) scores scale, grounding, light, faces, blend, fidelity; "Fix and re-take"
  feeds its fixes back into `createShot`.
- **Upscale:** Magnific Precision v2 or Creative, 2× or 4× — saved as a new Still with `upscaleOf`.

### Lifestyle — residents enjoying the home (added 2026-10-29)
Modelled on Lodha's brand film "Life in full bloom" (youtube.com/watch?v=er9DOzZ_CYA): quiet, unposed moments of
residents — tea in a glasshouse, a garden walk, yoga on a deck, a butler serving a child, herb picking, a couple on a
bench, a father and daughter on the lawn — in soft, warm, backlit light. Pick one of 12 moments (`src/lifestyle.ts`),
a light (**Lodha light** first), the residents (count, ethnicity, age, wardrobe, cast sheet), model and direction.
Every take is a Stills take: `createShot` with `moment`, so models, people check, fix re-takes and upscale all work
the same. The still records `moment` and gets `@lifestyle`.

### Video — animate a still
Pick a still, video model, resolution, first/last frame (still or upload), extra `@img` references, camera
move / style / speed, length and direction. **Make the video** → `createVideo` (`src/api.ts:960`), which maps each
preset onto that model's own Runway options (`submitVideo`, `:1311`). Up to 6 takes run at once in a take strip.
Clip upscale: Runway Video Upscale (4×) or FLUX Video Upscale (2×, ≤20 s / 50 MB / 2560×1440).

### Close-ups — detail shots from one source (a mode of Still)
Source is a library clip, still or upload. A small job state machine
(`capturing → captured → finding → picked → rendering → done`):
grab 6 frames from a clip (`media_processing_v2` `capture_frames`) → Claude picks 2–6 subjects → one long-lens
"re-shoot" Still per pick through `submitStill`. Code: `src/closeups-api.ts`, `src/client/CloseupsPage.tsx`.

### Location — Google Earth screenshot → aerial photograph (a mode of Still)
Lat/lng (paste "12.97, 77.59" into either field), place name, screenshot, view (match / top-down / oblique),
light (5 options), direction, model. One Still through `submitStill`, then an automatic 2× Magnific Creative
upscale (on by default). Code: `src/location-api.ts`, `src/location.ts`, `src/client/LocationPage.tsx`.
`src/surroundings.ts` is leftover from an older tab and only supplies types and captions for old stills.

### Edit — timeline, colour, AI editor, export
- **Timeline:** up to 24 cuts from your 60 newest clips; trim, reorder, undo/redo; hard cuts or 0.1–4.9 s fades.
- **Colour, two ways:**
  - Built-in look (preset, strength, 4 nudges): drawn live in the browser, free, never baked in on the server.
  - Aleph 2.0 re-render (`workflow_aleph_2`): a new copy, costs credits.
- **Plain-language edits** on one cut (Aleph); every version is kept and selectable.
- **AI editor chat:** Claude (Sonnet 5.5) sees the clips, timeline, presets, memory and the last 8 messages,
  and replies with one JSON plan (timeline, transition, looks, grades, edits, remember / forget, export) that
  `applyPlan` carries out.
- **Export:** `media_processing_v2` `timeline_export` (hard cuts) or trim + `stitch` (fades). The Runway file
  is ungraded; "Download graded film" re-encodes it in the browser (WebGL + MediaRecorder, no audio, the tab must
  stay in front).

On the desktop app, Export film is Master: a music bed (`edit.setMusic`), title cards, and one finished file per
Deliverable (H.264, HEVC 10-bit, ProRes 422 HQ, 9:16), each with a QC report (`edit.exportMaster`, `src/master.ts`,
`desktop/platform/master.js`). The cut carries a `rev`, and `saveTimeline` answers `CONFLICT` when its `baseRev` is
stale, so a page draft cannot overwrite a change the chat made.

Code: `src/edit-api.ts`, `src/editor.ts`, `src/edits.ts`, `src/timeline.ts`, `src/colour.ts`, `src/grades.ts`,
`src/client/EditPage.tsx`, `src/client/lib/gradedFilm.ts`.

### Library — browse
Search, kind filter, tags (automatic plus your own), zoom, download, delete. No animate or upscale here.
Delete also removes upscaled children, the S3 files and the storyboard reference.

### Settings — accounts and connections (added in this session)
Runway sign-in, Runway MCP, Higgsfield MCP, other MCP servers, Seevio key, and since Phase 13 the Chat key,
model and Allowance, and on the desktop the Power tools (FilmCraft, LightCraft). See the project notes in `CLAUDE.md`.

## Models

**Image** (default Nano Banana Pro, 2K): Nano Banana Pro / 2.1 / 2, GPT Image 2.5 Sunburst / Flare / 2,
Seedream 5 Pro / 5, FLUX.2 Max, Grok Imagine 2, Krea Image 3, Gen-4 Image. Catalog: `src/models.ts:15-198`.

**Video** (default Seedance 2): Seedance 2 / 2.5 / 2 Fast, Kling 3 Pro / 3 4K / O3 Pro, Veo 3.1 / 3.1 Fast,
Gen-4.5, Gen-4 Turbo, MiniMax H3, LTX 2.5 Pro, WAN 2.6. Catalog: `src/models.ts:447-610`.
No model takes in-between frames, so that UI never shows.

## What looks fragile

### High — all six fixed on 2026-10-28 (not yet typechecked or run)
1. **Fixed: a failed export could block exporting for good** (Edit). A stitch that failed kept its `stitchAt`
   claim, so after "Check again" nothing moved it and every new export was refused. A failed stitch now releases
   its claim, "Check again" drops a stale one, and a claim with no task id after 3 minutes fails the export so it
   can be checked again. `src/edit-api.ts` (`advanceExports`, `resumeExport`).
2. **Fixed: "Remove the grade" from the AI editor was silently undone** (Edit). The final merge now keeps the
   ungraded copy for cuts the editor ungraded. `src/edit-api.ts` (`applyPlan`).
3. **Fixed: leaving a clip upscale lost it, and pressing again paid twice** (Video). The Video page now keeps each
   take's upscale job and polls it, so focusing another take and coming back finds it.
   `src/client/VideoPage.tsx`, `src/client/UpscaleClip.tsx`.
4. **Fixed: a failed status check re-enabled "Make it cinematic"** (Stills and still upscale). A take stays in
   flight until a final status; a failed check shows "Lost track of the take" with Check again / Stop waiting, as
   the Location tab already did. `src/client/StillsPage.tsx`, `src/client/UpscaleStill.tsx`.
5. **Fixed: one failed planning batch failed the whole storyboard** (Director). Planned batches are kept; a failed
   batch's images go at the end of the board as rendered, with a warning. The job fails only if nothing was planned.
6. **Fixed: storyboard batches couldn't see each other** (Director). Batches now run one after another, and each
   later batch is told the earlier plan (positions, beats, light). With 7–12 images, planning takes about twice
   as long. `src/storyboard-api.ts` (`plan`, `advance`), `src/client/DirectorPage.tsx`.

### Stress test, 2026-10-29
The real server code was run in Node against a fake Runway and an in-memory store that forces conflicting writes
(24 tests, all passing; the Edit ones fail on the original code, as they should):
- **Lifestyle:** all 12 moments on all 12 image models, every light, the longest inputs, cast sheet plus matched
  light, 25 takes at once, and the people check. Every prompt fits its model's cap. 18,726 Stills prompt
  combinations without a moment are byte-identical to the original code.
- **Director:** 1–12 images, every batch failing in turn, a refused second batch, a crashed claim, old two-batch
  jobs, and a 30-storyboard soak with concurrent polls: exactly one planner call per batch.
- **Edit:** refused stitch → Check again, old wedged exports, stale claims, double-clicked export, and an AI-editor
  turn under a burst of polls.

Found and fixed:
- **Claims could double-bill.** A poll claimed work with a timestamp and checked it had won; two polls in the same
  millisecond both won. It hit the new Director batch claim, and the original Edit stitch claim and AI-editor turn
  claim (a second film export, or every Aleph grade twice). Each claim now carries a random id (`submitting.by`,
  `stitchBy`, `agent.by`).
- **`/api/mcp/oauth/start` would fail `pnpm typecheck`:** a bare `ctx.throw` doesn't narrow `owner`; it now `return`s.
- `mcp.ts` and `seevio.ts` used TypeScript parameter properties, which nothing else here does; now plain fields.

Not covered: the React pages themselves (no React on this machine), real Runway calls, and image quality.

### Medium
- **Built-in looks describe one specific project** (**verified**): "the water wall", a stone wall, falling water,
  street lamps (`src/looks.ts:92, 94, 335, 427, 436, 455, 501`). Other projects get them in their prompts, against
  the "only what's in the image" rule.
- **The people check fails on stills older than ~2 days** (**verified**): it sends the expiring upload URL
  (`src/api.ts:899`) even when a stored render copy exists.
- **Marked edits come back at ≤2560 px,** even on 4K, because the composite is sized to the client's JPEG.
- **Director planning has no timeout or cancel;** a task that never finishes locks the tab.
- **The AI editor drops or clamps cuts of clips older than the newest 60,** and its memory changes can overwrite
  ones made in the Memory panel at the same time.
- **Any small slip in the AI editor's JSON discards the whole plan;** one turn can also start up to 40 paid
  Aleph grades and 10 edits with no confirmation.
- **Paid work is started before it is saved** in Close-ups `find` and in AI-editor grades and edits, so a crash
  leaves billed tasks the app never sees.
- **Close-ups' "Look for" text is added to every shot's image prompt** (**verified**,
  `src/closeups-api.ts:232`), which can pull in subjects the reference doesn't show.
- **Very large upscales defeat thumbnails;** grids then load the full file (up to 60 MB). Image jobs run one at a
  time per pod, so a fresh grid can stall status polls.
- **Deleting in Library doesn't update the Video tab's take strip or picked still.**
- **Stored width/height are often not the real output shape** ("Match render", Gen-4 Image), so compare sliders and
  video frame shapes can disagree with the image.
- **Expensive defaults:** Location uses the model's highest resolution plus an automatic 2× Creative upscale.

### Low / tidy-ups
- Dead code: in-between frames (Gen-4.5), the "can't take a cast sheet" branch, `restoreOriginal`, ~10 unused
  imports in `api.ts`, `buildSurroundingsPrompt`.
- Duplicates: `stillCaption` / `stillTitle`, `FINAL_CODES`, upload-error handling, the streaming body reader (×3),
  identical Kling branches.
- Several `query` procedures write data (`library`, `closeups.job`, `storyboard.job`, `edit.project`), and all task
  progress only happens while a page is polling.
- UI copy still says Claude plans the "camera move" on the Director tab; it no longer does.
- Blue hour counts as night in the Video filter but as day in the automatic tags.
