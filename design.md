# Render to Film — design system

How this app looks, which building blocks it is made of, and the rules a UI
change has to follow. Read this before adding or restyling anything under
`src/client/`. Where this file and the code disagree, fix one of them in the
same change.

## 1. Principles

Quiet luxury, a screening-room atelier: warm paper, a burnt-sienna action
colour and a deep garden green. The page is a workbench (the panel of
numbered steps) facing a screening room (the dark stage). The images are the
hero; the UI stays quiet around them. Luxury comes from scale, weight
contrast, whitespace and hairlines, never from extra fonts, gradients or
shadows.

1. **One accent colour, for action and selection only.** The primary button,
   links, focus rings and selected states use `--bay-accent`. Everything else
   is neutral. The garden green (`--bay-brand`) is the app mark and calm
   confirmations only.
2. **One bold surface: the stage.** The result column is the only dark
   surface (`--bay-stage-*`, `data-stage`). Nothing else gets a heavy fill or
   shadow (the stage has one deep, soft shadow, `--bay-shadow-stage`); the
   control panel is a quiet hairline-bordered surface. Prefer hairlines and
   spacing to filled cards.
3. **The workflow is numbered because it is a sequence.** Each control step
   is a `Section step={n}` inside one panel, separated by hairlines, ending in
   a sticky action bar with the primary button. Results and lists are not
   numbered.
4. **Calm density.** 14px body, 13px secondary, 36px/400 page title (26px on
   phones). Steps have 24-28px of air above and below; inputs inside a step
   stack at 12px.
5. **Feedback is inline and plain.** Errors and warnings are an `Alert` next
   to the thing that failed, one sentence, with the next step in it. Loading
   is a skeleton shaped like the content it replaces, never a spinner in the
   middle of the page.
6. **Everything works from the keyboard and reads to a screen reader.** Every
   control is a real control (react-aria), icon-only buttons have an
   `aria-label`, focus is always visible.

## 2. Foundations

All colours, radii and motion come from `--bay-*` custom properties. Never
hard-code a colour in a component; change the token.

| Facet    | Where                                         | Tokens                                                                                                                  |
| -------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Text     | `src/client/styles/tokens.css`                | `--bay-text`, `--bay-text-2` (secondary), `--bay-text-3` (muted), `--bay-text-4` (hints), `--bay-text-on-accent`        |
| Surfaces | `src/client/styles/tokens.css`                | `--bay-bg-canvas` (page), `--bay-bg-surface` (controls, overlays), `--bay-bg-subtle`, `--bay-bg-sunken` (hover, tracks) |
| Borders  | `src/client/styles/tokens.css`                | `--bay-border-hair` (separators), `--bay-border` (resting control), `--bay-border-strong` (input), `--bay-border-focus` |
| Accent   | `src/client/styles/tokens.css`                | `--bay-accent`, `--bay-accent-hover`, `--bay-accent-soft`, `--bay-accent-fg`, `--bay-accent-rgb`                        |
| Status   | `src/client/styles/tokens.css`                | `--bay-ok-*`, `--bay-warn-*`, `--bay-err-*`, `--bay-info-*` (`-bg` / `-fg` pairs) — only via `Alert`                    |
| Radii    | `@runway/bay-react/tokens.css`                | `--bay-r-xs` 4, `--bay-r-sm` 6, `--bay-r-md` 8 (controls), `--bay-r-lg` 12 (overlays, panels' inner cards), `--bay-r-xl` 16 (containers), `--bay-r-pill`                   |
| Shadow   | `src/client/styles/tokens.css`                | `--bay-shadow-1` (none), `--bay-shadow-pop` (menus, popovers), `--bay-shadow-stage` (the stage only)                                                        |
| Motion   | `@runway/bay-react/tokens.css`                | `--bay-dur-fast` 120ms, `--bay-dur` 160ms, `--bay-ease`; respects `prefers-reduced-motion`                              |
| Type     | `src/client/styles/tokens.css` + `global.css` | `--bay-font-sans` (`'ABC Normal'`, loaded by `global.css`) for everything; `--bay-font-mono` (Fira Code) for `code`     |

The app ships light-only: there is no theme toggle, and `index.html` pins
`<html data-theme="light">`, so a dark OS never switches the app to dark. The
`:root[data-theme='dark']` blocks apply only after a toggle picks dark
(`bay add agent` brings one). For an always-dark app, set `data-theme="dark"`
in `index.html` and put the whole palette, text included, in the dark block;
never put dark surfaces in the light block. If the user asks for dark mode that
follows the OS, delete `data-theme="light"` from `index.html`, add
`import '@runway/bay-react/theme';` to `main.tsx` (or render its
`<ThemeToggle />`) and give every colour token a dark value; never add a
`prefers-color-scheme` branch.

Palette (light): canvas `#f6f1e9`, surface `#fffcf7`, text `#1e1b18`,
accent burnt sienna `#b5562b` (hover `#9a4723`, soft `#f4e1d5`), garden green
`#2f4b3a` for the app mark (`--bay-brand`) and info/success. The stage is ink
`#1e1b18` (`--bay-stage-bg`) with pure-black frames (`--bay-stage-frame`), so
a film still reads like a projected frame. Any element with `data-stage`
re-maps the text, surface, border and status tokens to their dark stage
values (block in `tokens.css`), so buttons, alerts and panels inside the
stage need no stage-specific CSS.

## 3. Layout

- `AppShell` (`src/client/layouts/AppShell.tsx`): a 60px sticky header
  (`--app-header`) on the surface colour, three columns: `brand` (the
  aperture mark on garden green) and title, `nav` (text tabs with an accent
  underline) centred, `UserMenu` right. Below 680px the tabs drop to their
  own row. App.tsx passes `maxWidth="none"`: every page uses the full window.
- Stills, Video and Edit are one edge-to-edge workspace
  (`Studio.module.css`): a 360–480px control rail on the left (the page's
  `PageHeader` at its top, then the numbered steps between hairlines, the
  sticky `.actionBar` at its foot) and the dark stage (`.result`,
  `data-stage`) filling the rest of the window. Both are exactly one window
  tall below the header and scroll on their own. The frame on the stage
  (`.resultFrame`, `CompareSlider`) sizes so the whole picture fits the
  window; each sets `--ar` inline beside `aspect-ratio` for that. Video's
  "Your clips" shelf sits on the stage under the shot (`.below`). Below
  900px everything stacks and the page scrolls normally.
- Library pads itself (`.screen`, fluid gutters) and its grid fills the
  window width.
- `Section` is the unit everywhere: optional `step` number (a small tabular
  numeral in a hairline ring), `h2` 15px/500, description, error boundary, `loading` skeleton.
- Library is one column: a hairline-ruled toolbar (search, kind chips, tag picker
  under a hairline), a count line, then a grid of cards with uniform 16:10
  thumbnails (portrait takes shown whole, not cropped).

## 4. Building blocks

### 4.1 Controls: `src/client/ui/`

Built on `react-aria-components` and styled with a sibling
`<Component>.module.css`. **This directory is the only place that imports
`react-aria-components`.** There is no component library; add a control here
instead of installing one.

| Component                       | Use it for                                               | Notes                                                                                                                |
| ------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `Button`                        | Every clickable action                                   | `variant` `primary` (one per view) / `default` / `ghost` / `danger` (confirm a delete only); `size` `md` 32px / `sm` 26px (weight 500; the action bar button is 44px via Studio CSS); `icon`, `loading`, `onPress` |
| `TextInput`                     | Single-line text                                         | `value`/`onChange(string)`, `type`, `maxLength`, `onPressEnter`, `label` or `aria-label` (one is required)           |
| `TextArea`                      | Multi-line text                                          | `value`/`onChange(string)`, `rows`, `label` or `aria-label` (one is required), `onSubmit` for Enter-to-send          |
| `NumberInput`                   | Seconds and other small numbers                          | react-aria `NumberField`; `label`, `min`/`max`/`step`, optional `unit` ("s"); arrow keys step it                     |
| `Alert`                         | Inline outcome the user must read                        | `tone` `error` / `warning` / `info` / `success`, `title`, body as children. Error/warning announce as `role="alert"` |
| `SkeletonText`, `SkeletonBlock` | Loading                                                  | Shaped like the content they replace; `rows` / `height`                                                              |
| `Text`, `TextLink`              | Secondary/muted copy and links                           | `tone` `secondary` / `muted`, `size` `sm` 13px / `md` 14px; `TextLink external` opens a new tab                      |
| `Avatar`                        | A person                                                 | Picture, or initials on a deterministic colour                                                                       |
| `ConsentPrompt`                 | Runway call refused for missing visitor consent          | `error`: a tRPC error or raw-route body; nothing for other errors. Opens the consent page                            |
| `UserMenu`                      | The header identity chip                                 | Avatar + name; menu with "Back to home", the email, sign out. Prop-driven — the page resolves identity               |
| `ErrorBoundary`                 | Around every region, not just the root                   | Named fallback ("The generator didn't load") with details and a retry                                                |
| `EmptyState`                    | A region with nothing in it yet                          | One heading, one sentence, optionally one action                                                                     |
| `PageHeader`, `PendingBlock`    | Page title row; a placeholder for a not-yet-built region |                                                                                                                      |
| `ImagePlaceholder`              | Where a generated image will go (§4.3)                   | `label` says what the image will show; `aspectRatio` (CSS, default `16 / 9`) and `maxWidth` match the final asset    |
| `MaskPainter`, `MaskOverlay`   | Marking the part of an image that may change             | Brush / Box / Erase, 3 sizes, undo/redo (Ctrl/Cmd+Z), Clear, Full size modal; strokes are normalised (`lib/mask.ts`). `MaskOverlay` is a read-only tint |
| `Switch`                        | An on/off setting (Video: only what's in the image)      | react-aria `Switch`; label and hint left, toggle right; accent when on                                              |
| `ChoiceGroup`                   | Picking one preset (look, angle, people)                 | A `Select` dropdown with the chosen hint below; `choices` `{ id, name, hint }`                                      |
| `Select`                        | Picking one of many options (models, resolution)         | react-aria `Select`; options `{ id, name, hint, group }` grouped under headers (provider); chosen hint shown below  |
| `ImageDropZone`                 | The source image: drop or pick a file                    | Wraps its children; "Replace render" pill bottom-right; PNG/JPEG/WebP                                              |
| `Slider`                        | A value on a range (grade strength, exposure)            | react-aria `Slider`; value beside the label via `format`; the fill grows from 0, so −1..1 sliders read as bipolar      |
| `CompareSlider`                 | Before/after of render vs result                         | Native range input over the images, so arrow keys move the divider                                                  |
| `Tabs`, `TabList`, `Tab`, `TabPanel` | Page tabs (Stills / Video / Library), text tabs with an accent underline in the header | Panels stay mounted, so a running take survives a tab switch                                                         |
| `ImagePicker`                   | Pick one image from a grid of thumbnails                 | Radio group; arrow keys move; 16:9 thumbs, one-line caption                                                          |
| `FilterChips`                   | Single-choice filter above a list                        | A compact `Select` dropdown, 240px wide                                                                              |
| `TagEditor`, `TagPicker`        | `@tag` chips: edit an item's tags; toggle tags to filter | react-aria `TagGroup`. Editor adds on Enter/comma/space, Backspace drops the last; picker is multi-select with counts |
| `Lightbox`                      | Full-size view of one image                              | Modal on a dark overlay; Escape or click outside closes                                                              |
| `ConfirmDialog`                 | Asking before anything destructive                       | `alertdialog`; focus starts on Cancel; Escape cancels; `loading` keeps it open, `error` shows an `Alert` to retry     |
| `RenderingStatus`               | Fills a dark result frame while something renders        | Warm sweep, status line, elapsed time and progress                                                                   |
| `RunwayErrorNotice`             | The one notice for a failed Runway call                  | Sign in / out of credits / consent / plan-blocked (terminal, names the model) / the error itself                     |
| `FullscreenDialog`              | A full-window big-screen view on the stage (Director viewer) | `title`, an `aside` column, `onPrev`/`onNext` (arrow keys step), Escape or Close backs out                    |
| `ToggleButton`                  | An on/off pick on an item ("Use in film")                | Pill; check-circle and accent fill when `selected`                                                                   |
| `TakeStrip`                     | Renders in flight and just finished (Video takes)        | Horizontal radio group of 16:9 cards: state badge, progress bar or sweep, running clock; first card is "Next shot" |

Adding a control: one `.tsx` + one `.module.css` in `src/client/ui/`, props
declared `foo?: T | undefined`, states styled through react-aria's data
attributes, a row in this table.

One block comes from outside: `SignInPrompt` (`@runway/bay-react/runway-sign-in`),
rendered where a call came back needing a Runway sign-in
(`signInRequiredFrom(error)`). It reads the `--bay-*` tokens, so it already
matches; its copy says the visitor's own account and credits pay — keep that.

### 4.2 Icons: `lucide-react`

- One icon set. Import named icons from `lucide-react`; nothing else draws
  icons. Check the name exists before importing it
  (`grep -w <Name> node_modules/lucide-react/dist/lucide-react.d.ts`).
- **Never emoji** — not as icons, not in copy (headings, buttons, empty
  states, labels, placeholder text). A symbol is a Lucide icon; a picture is
  an image (§4.3).
- Always set `size`: 16 in the header and `md` buttons, 14 in `sm` buttons
  and menu items, 12 for inline markers. Leave `strokeWidth` at its default.
- Icons are decorative (`aria-hidden`) by default; an icon-only control names
  itself with `aria-label`.
- In use: `Send` generate, `LoaderCircle` (spinning) loading, `ArrowLeft`
  back to home, `CircleAlert`/`TriangleAlert`/`Info`/`CircleCheck` alert
  tones.

### 4.3 Images

- Lucide covers symbols, not pictures. A hero, an illustration, a logo or
  brand mark, mood or product imagery is a generated asset under `public/`
  (served at `/hero.png`), rendered with `<img>` and a real `alt`.
- Until the file exists, render `ImagePlaceholder` at the final size and keep
  building — an image is never a reason to stall the rest of the app.
- Collect every image the app needs (path under `public/`, a one-sentence
  prompt in this design's direction, aspect ratio) and request them all at
  once, after the rest of the app is in place. Generation spends the user's
  Runway credits, so it happens only after they approve, once, for the whole
  set. If they skip, the placeholders stay.
- Prompts carry the palette and mood from §1–2 so the result sits on the
  tokens' surfaces without retouching.

## 5. Rules

### 5.1 Styling

- CSS modules only. Every component has a sibling `<Component>.module.css`
  and imports it as `styles`; class names are camelCase. No global class
  names except what `global.css` sets on elements (`body`, `code`,
  `:focus-visible`).
- Colours, radii, shadows and durations are tokens; pixel sizes for layout
  are fine.
- Interactive states use react-aria's data attributes — `[data-hovered]`,
  `[data-pressed]`, `[data-focus-visible]`, `[data-focused]`,
  `[data-disabled]`, `[data-entering]`, `[data-exiting]` — never
  `:hover`/`:active`, so mouse, touch and keyboard behave the same.
- Inline `style` is for genuinely dynamic values only (a `maxWidth` prop, an
  avatar's size and palette). If you are typing a colour into a `style`
  object, stop and add a class.
- Overlays (menus, popovers): `--bay-bg-surface`, `--bay-shadow-pop`, radius
  `--bay-r-lg`, 4px inner padding, a ~120ms fade-in.

### 5.2 Feedback and copy

- One `Alert` per failure, placed where the failure happened. A terminal
  failure (the account's plan can't run this model) disables the action and
  says what would change the outcome; a transient one leaves the action
  armed.
- **Anything that takes longer than a click shows that it is working.** A
  generation, upload, save or fetch always has a visible loader from the
  moment it starts to the moment it ends: the triggering `Button` shows
  `loading` (spinner in place of its icon, disabled), and the region that
  will receive the result shows `SkeletonBlock`/`SkeletonText` or a short
  status line ("Generating…", with the elapsed time or step when the wait is
  long). Never leave the user looking at an unchanged screen wondering
  whether the click registered. Loading states are skeletons in the shape of
  the real content, not a spinner in the middle of the page.
- Sentence case everywhere. Buttons are a verb ("Generate", "Try again").
  Errors are one sentence with the next step in it. No exclamation marks.

## 6. Surfaces

### Shell (`src/client/App.tsx`)

`Tabs` wraps `AppShell`; the `TabList` is the shell's `nav`: **Director** (the default), **Stills**,
**Lifestyle**, **Video**, **Close-ups**, **Location**, **Edit**, **Library** and **Settings**. Every panel stays
mounted, so a running take survives a tab switch.

### Director tab (`src/client/DirectorPage.tsx`)

`PageHeader` ("Direct the film"). Rail: 1 "Project images" (`ImageDropZone`
with `onFiles`, up to 12, a tile grid with remove buttons, each uploading on
add with its own error), 2 "Story" (a "Storyline" `Select` over
`STORYLINES` in `src/storyboard.ts`, plus an optional story `TextArea`),
3 "Model", then "Plan N frames". Claude (`src/storyboard-api.ts`, batches of
six, one after another so each later batch sees the plan so far) orders the frames and picks a light and people per frame (the camera stays the image's own, as on Stills, unless a Camera move is picked).
Stage: frame cards in story order; each card's Lighting, Camera and People
`Select` lists the plan's pick first under "Recommended for this frame" (its
reason as the hint), then every Stills preset. Changes save as they're made
("Saved"). "Shoot this frame" / "Shoot all" re-shoot strictly from the image
(nothing invented, real photographed people) into library stills tagged
@storyboard. A card's image is `director/TakeImage.tsx`: thumb, a
cache-busted retry, then full size, then "This take didn't load." with Try
again (a lost take is re-added server-side by `restoreTakes`, and the page
keeps polling while one is missing). Each done card has a "Use in film"
`ToggleButton` (accent ring when chosen), Shoot again, Compare, Download;
"Choose all shot frames" picks them all.

Clicking a done frame opens `director/FrameViewer.tsx` in a
`FullscreenDialog`: the take big, a "Compare with your image"
`CompareSlider` against the uploaded image, prev/next (arrow keys), and an
aside with Use in film, Download, a Takes `ImagePicker` (pick which take the
film uses, saved as `choices[image].take`), the frame's Lighting/Camera/
People/Direction (`director/FrameControls.tsx`) and "Reshoot this frame".

Below the board, `director/FilmStep.tsx` ("Make the film"): the chosen
frames with a take, in story order, made into clips with the Video tab's
presets (model, resolution, movement style, speed, length, "Architectural
film style" and "Only what's in the image" `Switch`es, direction). Each clip
gets a suggested camera move (first pulls out, last cranes up, interiors push
in, exteriors drift) with its own "Camera move" `Select`. "Make N clips"
runs `createVideo` one frame at a time and records each in `job.clips`;
settings persist in localStorage. "Cut them on the Edit tab" moves on.

### Stills tab (`src/client/StillsPage.tsx`)

`PageHeader` ("Turn a render into a film still"), then:

- **Left column** (steps 1–6):  "Source render" (`ImageDropZone`, preloaded with
  `public/sample-render.jpg`), "Model" (an "Image model" `Select` over
  `IMAGE_MODELS` in `src/models.ts`, grouped by provider, beside a narrow
  "Resolution" `Select` that resets to the model's default on change, and
  under them an "Aspect ratio" `Select`: "Match render" plus that model's
  own ratios from `imageAspectOptions`, wide to tall, kept when the new model
  offers it, with a muted note that a new shape only crops or continues the
  render's edges), "Look" (preset cards from `src/looks.ts`, including "Interior lighting" for lights-on warm fixture glow; an optional lighting reference, `LightReferenceField.tsx`, above the preset cards; while one is in, the presets are disabled and only its light is matched; ignored while an area is marked; or "Match one of your stills", an `ImagePicker` of finished stills, for a matching series, also set from a finished take's "Use this light for other views"), "Camera angle" (small moves
  only), "People" (`CROWDS` plus a who `TextInput`), "Extra direction", then
  the primary "Make it cinematic" `Button`, a muted note naming the model, ratio and
  billing, and a `RunwayErrorNotice`.
- **Right column (the stage):** "Film still". Empty: black frame with `EmptyState`.
  Working: `RenderingStatus`. Done: `CompareSlider`, then Download / Make a
  video / Open full size. Below, **Upscale** (`UpscaleStill.tsx`): upscaler
  and scale `Select`s and an "Upscale" button; the copy renders in its own
  dark frame with Download upscaled / Open full size and is saved to the
  library as its own still. With people on, a **People check** panel
  (`PeopleCheck.tsx`) runs by itself: skeleton while it reviews, then a
  score pill (Looks real / Needs fixes), one line per check in
  `PEOPLE_CHECKS` (`src/checks.ts`) with a pass/issue icon, and "Fix and
  re-take", which re-submits the same settings with the reviewer's fixes.

**Marked edit** (part of the Stills tab). Under the source render, "Mark an area to edit" opens `MaskPainter` over the render. Once there is a mark, the render shows it as an accent tint, with "Edit marked area" and "Remove mark" buttons. While marked, the aspect ratio is locked to "Match render" and the camera angle to "As rendered". Each lock shows a muted note, and the primary button reads "Edit the marked area". The model is told to change only that area. The server then rebuilds the still from the render's own pixels everywhere outside the mark (`src/composite.ts`, with a soft edge that sits inside the mark only). That composite is what every view, download, video and upscale uses; the raw model output is never shown.

**People** (part of the Stills tab). When the crowd isn't "No people" (the choices are none, one person, a few, small groups and lively), the People section opens:

- a two-column grid of four `Select`s: Ethnicity (mixed by default, then nine heritages), Age range, Wardrobe and Activity;
- an "Anything else about them" text field;
- an optional "Cast sheet" drop zone (`CastSheetField.tsx`). It shows a spinner while uploading, an inline error on failure, and Replace / Remove buttons once a sheet is in. The sheet goes to the model as a second reference image. A model that can't take one shows a warning that names models that can.

The grid collapses to one column on phones. The prompt asks for real humans photographed on location and ends with a short "avoid" clause. Each still records these choices, so a re-take and the people check judge against them.

### Lifestyle tab (`src/client/LifestylePage.tsx`)

The Stills layout and logic, aimed at residents enjoying the home. Steps: 1 "Source render", 2 "Moment" (a
`ChoiceGroup` over `MOMENTS` in `src/lifestyle.ts`, with "Works best in…" under it; picking one sets the people
and light below), 3 "Light" (every look, **Lodha light** first), 4 "Residents" (how many, ethnicity, age,
wardrobe, a note, and a cast sheet to keep one family across moments), 5 "Model", 6 "Extra direction". The
"Only what's in the image" switch lets in only the residents and the moment's small props. "Bring it to life"
calls `createShot` with `moment`; the stage shows the compare slider, Download / Make a video / Open full size,
the automatic people check and Upscale, then "Earlier moments" from the library.

### Video tab (`src/client/VideoPage.tsx`)

`PageHeader` ("Bring a still to life"), then:

- **Left column** (steps 1–5): "Film still" — an `ImagePicker` of the visitor's finished
  stills from the `library` query (12 at a time with "Show more",
  `FilterChips` past six, "View full size" opens the `Lightbox`, "Remove" deletes the selected still
  after a `ConfirmDialog` and clears the selection; an
  `EmptyState` with "Go to Stills" when there are none), "Model" (video
  model `Select` over `VIDEO_MODELS` + "Resolution" `Select`), "Camera" (a
  "Camera move" `Select` over `MOTIONS`, grouped Static / Dolly / Pan and tilt /
  Crane / Orbit / Lens, then "Movement style" (`MOVE_STYLES`: steady, linear,
  eased, Steadicam float, handheld) and "Speed" (`SPEEDS`) side by side; speed
  is disabled with a note for locked off and focus pull), "Length" (a `Select` of every length the model accepts, from `videoDurations` in `src/models.ts`, snapped to the nearest when the model changes),
  "Extra direction", the primary "Make the video" button, a note and a
  `RunwayErrorNotice`.
- **Nothing locks while a video renders.** The rail stays live; each press
  starts a take with its own settings (up to 6 rendering at once, 12 kept,
  saved in sessionStorage). The button reads "Make another video" while any
  render, and a polite status line says how many.
- **Right column (the stage):** the focused take — "Video" `RenderingStatus`
  (clock from the take's start) while rendering, then a `<video controls>` with
  Download / Open full size and **Upscale clip** (`UpscaleClip.tsx`) — or, with
  no take focused, "Next shot" (the still being set up). Below it "Takes": a
  `TakeStrip` (first card "Next shot", then every take with its state, progress
  and clock) and "Clear finished". A failed poll shows "Check again", never a
  free slot. "Your clips", full width below both columns: a grid of past clips
  (`preload="none"`, still as poster, a delete icon per finished clip), or an
  `EmptyState`.

**Frames and extra images** (`src/client/VideoFrames.tsx`, `useVideoFrames`, `FramesField`, `RefsField`; chooser modal `ui/ChooserDialog.tsx`). "Frames" is an ordered list of rows: First frame (defaults to the still picked in step 1; "Use a different image" opens a chooser of library stills plus a drop zone for an upload), optional in-between frames ("Add a frame in between", each with a "Reached at" `Select` in seconds, spread evenly by default) and an optional Last frame. Support is a per-model capability in `src/models.ts`, read from `.bay/runway/options.md`: `maxKeyframes` (`videoKeyframeLimit`; 1 = first only, 2 = first and last, 3 or more = timestamped in-between frames), `maxExtraImages` (`videoExtraImageLimit`) and `extraImagesExcludeEnd`. Today: Seedance 2.0, 2.0 Fast, 2.5, MiniMax H3, LTX-2.5 Pro, Veo 3.1 (both) and Kling 3.0 Pro and 4K take a first and a last frame; only Gen-4.5 takes in-between frames (its `k2v` keyframes with timestamps; the app allows two); Kling O3 Pro, Gen-4 Turbo and Wan 2.6 take the first frame only. A model that cannot take a last or in-between frame disables that row and shows a muted note naming the models that can. "Extra images" is a grid of thumbs named `@img1`, `@img2` … in order (the chip inserts the handle into the direction, X removes and renumbers). Only Seedance (2.0, Fast, 2.5) and MiniMax H3 take extra images; they send them as plain `referenceImages` after the first frame, so `@imgN` is rewritten to "image N+1" in the prompt. These models refuse typed first/last frames together with plain references, so a last frame and extra images are either/or (the other control is disabled with a note). Uploads go through `uploadRender` -> `POST /api/upload` and show an "Uploading…" state; library stills travel as ids and are signed by the server (`finishedUrl`). A clip records `frameCount`, `lastFrameStillId` and `refCount`, and its label says "3 frames" / "2 extra images".

Media URLs are `/api/library/<still|clip>/<task id>`, which 302 to a freshly
signed Runway artifact URL.

### Close-ups tab (`src/client/CloseupsPage.tsx`)

`PageHeader` ("Find the close-ups"), then the same two columns:

- **Left column** (steps 1–3): "Source" (a `FilterChips` dropdown: A video / A still / Upload an image; an `ImagePicker` of finished library clips (their still as thumbnail) or stills, or an `ImageDropZone` that uploads through `uploadRender`), "Shots" (how many close-ups, 2–6, and an optional "Look for" `TextInput`), "Model" (image model and resolution `Select`s). The action bar holds "Find close-ups", a billing note and a `RunwayErrorNotice`.
- **Right column (the stage):** "Close-ups". Before a search: the picked source in the black frame, or an `EmptyState`. While it searches: `RenderingStatus` ("Taking frames from the video…", then "Looking for the most cinematic details…"). Then a contact sheet of shots (auto-fill grid, 280px minimum): each frame shows `RenderingStatus` until its still lands, then the image (click for `Lightbox`), the subject, a one-line reason, and Download / Full size / Make a video.

Server: `src/closeups-api.ts` (`closeups.*`), one document per person under `closeups/`. A clip has six frames captured by `media_processing_v2` `capture_frames`, Claude Sonnet 5.5 (`claude_api`) picks the shots as JSON, and each shot is re-shot by `submitStill` from the frame it was found in, with a strict "only what's in the image" close-up prompt. The page drives each paid step once a poll shows the previous one finished (`analyze`, `render`, guarded by a status claim). The close-ups are ordinary library stills with `closeup: { subject, jobId }`, auto-tagged `@close-up`.

### Location tab (`src/client/LocationPage.tsx`)

`PageHeader` ("Render a location"). The app can't reach Google, so the
satellite image is the user's own Google Earth screenshot. Left rail, steps
1-5: "Location" (latitude/longitude and an optional place name), "Satellite
image" (`ImageDropZone` upload), "View and light" (`VIEWS` and `LIGHTS` in
`src/location.ts`), "Model", "Upscale" (Magnific Precision or Creative and a
factor, for fine texture), then the action bar. Stage: "Photoreal location",
the result over the screenshot in a `CompareSlider`, Download / Make a
video. Server: `src/location-api.ts` (`location.create`), library stills with
`location`.

### Edit tab (`src/client/EditPage.tsx`)

`PageHeader` ("Edit the film"), then the same two columns:

- **Left column** (steps 1–3): "Your clips" (a compact list of finished library clips, still as thumbnail, a `+` to add each to the timeline; `EmptyState` with "Go to Video" when there are none), "Timeline" (a strip of numbered blocks as wide as each cut, then one row per cut: number, thumbnail, label, in/out and its grade/edit notes, with move up/down and remove; removing offers Undo. Opening a row shows In/Out `NumberInput`s (`ui/NumberInput.tsx`), a "Colour grade" panel and a "Change something in this cut" field. The grade panel switches (`FilterChips`) between **Built-in, instant** (the default: a "Look" `Select` over the `GRADES` presets, a Strength `Slider` and Exposure / Contrast / Saturation / Warmth sliders, Reset and "Apply to every cut"; stored per cut as `colour` (`src/colour.ts`), free, drawn live over the video and the thumbnail, autosaved) and **Aleph 2.0 re-render** (the old `Select`, which bakes the grade into a new version of the clip). Aleph grades and edits show "Re-rendering" until done and keep playing the old version), "Transitions" (hard cuts or fades, with a fade length). The action bar holds "Export film" and a save note: the timeline autosaves (Saving… / Saved. / Not saved, Try again).
- **Right column (the stage):** "Preview" (plays the picked cut inside its trim; "Play the timeline" plays every cut in order as hard cuts; every player shows its cut's built-in grade live; once an export is done it plays the film with each cut's grade switched in by time (`cutEnds`), with "Download film" (ungraded) and, when any cut has a look, "Download graded film", which plays the export once through the same steps in a WebGL shader (`lib/gradedFilm.ts`) and records it in the browser; `RenderingStatus` while exporting), "AI editor" (a chat with Claude: suggestion buttons on first run, user and editor bubbles, each editor reply lists what it changed; Enter sends, Shift+Enter adds a line; "Clear chat" asks first) and "Memory" (standing preferences the editor follows; add one, or forget one after a `ConfirmDialog`; the editor can also remember and forget them itself).

Server: `src/edit-api.ts` (`edit.*` procedures), one document per person under `edits/` (`src/edits.ts`, types in `src/timeline.ts`). The editor (`src/editor.ts`) answers with a JSON plan that the server applies on the next `project` poll: new timeline, transitions, built-in looks (`look`, the default for colour requests), Aleph grades and edits per cut, memory changes and export. Export runs as `media_processing_v2`: `timeline_export` for hard cuts; `trim` per cut and then `stitch` with a fade for fades. Copies and exports are served at `/api/library/edit/<task id>`.

### Library tab (`src/client/LibraryPage.tsx`)

Everything made in the app, newest first: stills and clips from the `library`
query (failed takes left out). Toolbar: a search box ("Search, or type
@tag" — words match captions and tags, `@word` matches a tag prefix) and
All / Images / Videos `FilterChips` on one surface; under a hairline in it a `TagPicker` of every tag with
counts (own tags first) — picked tags must all match. A count line with
"Clear filters". Grid of cards (min 270px, 16:10 thumbnails): image opens the `Lightbox`;
video plays inline with `preload="none"` and the still as poster; pending
items show a skeleton. Each card: title, model and date, download, delete, its
automatic tags (`src/tags.ts` — kind, look, day/night, people, model,
upscaled; click to filter) and a `TagEditor` for the visitor's own tags,
saved per change with "Saving… / Saved" or the error. 24 per page with
"Show more". Empty library and no-match states are `EmptyState`s.

Deleting (`DeleteItemDialog.tsx`, shared with the Video tab) confirms first,
says what goes with it (a still's upscaled copies) and what stays (videos made
from it, the Runway history), then calls `deleteItem` and refreshes the
library. It removes only the library record, never the Runway task.

## 7. Checklist for a UI change

- [ ] Built from `src/client/ui/` and `src/client/layouts/`; nothing new
      installed.
- [ ] New styles are in a `.module.css`; colours/radii/motion via tokens; no
      `:hover`.
- [ ] Icons from `lucide-react` with an explicit `size`; icon-only controls
      labelled. No emoji anywhere; pictures are generated images or an
      `ImagePlaceholder` until they exist.
- [ ] Loading, empty and error states exist and use `Skeleton*`,
      `EmptyState`, `Alert`. Every action that generates, uploads or waits on
      the server shows a loader for its whole duration.
- [ ] Works from the keyboard (Tab through it).
- [ ] This file still describes the app — §4 for a new control, §6 for a new
      screen, §1–3 if the user changed the direction.
