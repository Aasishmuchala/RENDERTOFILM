# Render to Film: design system (Phase 8, Apple-glass redesign)

Read this before touching anything under `src/client/`. It replaces `design.md`
(deleted in G14). Where this file and the code disagree, fix one of them in the
same change. The plan that builds it is `.router/PLAN.md`, "Phase 8".

## 0. Brief

- Subject: an internal studio tool. Architects drop CG renders in and get film
  stills, lifestyle photographs, storyboards, close-ups, video and a cut film out.
- Audience: the studio's own people, on Macs, mostly at 1440 to 1920 wide; a
  phone is for checking on a render, not for setting one up.
- Job of the UI: make nine workflows obvious and finishable without a manual.
  Functional first: no behaviour changes, no API changes. The redesign is the
  skin, the shell and the information architecture.
- Direction (decided by the user): Apple's current glass language for the
  chrome; dark appearance; the system font (San Francisco on a Mac).
- Stack: the project's own. React 19 + Vite, CSS Modules, react-aria-components,
  lucide-react. No Next, no GSAP, no Lenis, no WebGL. CSS transitions and the
  Web Animations API only.

## 1. Concept card

```
Idea:        A screening room. The frame on screen lights the room around it.
Metaphor:    A darkened grading suite: one bright projected frame, matte black
             walls, and glass fixtures (the console, the door, the monitor
             bezel) that pick up the frame's colour.
Signature:   The ambient backdrop. A heavily blurred, dimmed copy of the current
             frame (source render or finished take) sits under the whole page.
             The glass sidebar, action bar and toolbars refract it, so when a
             take finishes the room's light changes with it (one 1.2 s
             cross-fade). Glass is justified because there is always imagery
             behind it.
Emotion:     Calm, expensive, in control. The images are the only loud thing.
Motion verb: "Settle like glass": quick ease-out, a 2% spring on panels and the
             nav indicator, never a bounce. Big things move slower than small.
Screenshot:  1440 wide, Stills tab: glass sidebar on the left catching a warm
             golden-hour glow, the numbered inspector, and the film still on a
             black stage with its glass toolbar under it.
At rest:     Still. Nothing drifts while the pointer is idle. The life is in the
             ambient reacting to results, and in hover, press and focus feedback.
             (A deliberate decision: an image tool must not compete with images.)
```

Genericness test: "glassmorphism everywhere" and "dark + one accent" are listed
AI defaults. What makes this not that: glass is restricted to chrome (section
2.4 says exactly which elements) and is earned by the ambient backdrop; content
sits on solid surfaces; the accent is the app's existing burnt-sienna identity
re-tuned for dark (tungsten, not neon); the type is the system face with
Apple's own scale rather than a downloaded grotesk; the IA is grouped by the
film pipeline (Shoot, Animate, Finish) which is this app's story.

## 2. Foundations

Every colour, radius, duration and font comes from a token in
`src/client/styles/tokens.css`. The `--bay-*` names stay (fifty CSS modules read
them); Phase 8 re-points their values and adds `--glass-*`, `--text-*`,
`--track-*`, `--r-*`, `--ease-*`, `--dur-*`. Never hard-code a colour in a
module: `grep -E "#[0-9a-fA-F]{3,8}\b|rgba?\([0-9]" src/client/**/*.module.css`
must print nothing (`rgba(var(--bay-accent-rgb), x)` is allowed).

### 2.1 Appearance: dark only

`index.html` pins `<html lang="en" data-theme="dark">` and
`<meta name="theme-color" content="#0c0c0e">`; `:root { color-scheme: dark }`.
There is no light block and no OS-following. Reasons: images read best on dark;
glass needs imagery behind it to be glass (on a flat light page it is a grey
rectangle); one appearance halves the QA surface so the budget goes to
usability. The `[data-stage]` attribute stays on the stage column (pages set
it) and remaps only the surface tokens to the deeper stage values below.

### 2.2 Palette

| Role | Token | Value | Notes |
|---|---|---|---|
| ground (the room) | `--bay-bg-canvas` | `#0c0c0e` | Under the ambient. Solid when transparency is reduced |
| surface (inspector, cards) | `--bay-bg-surface` | `#16161a` | Inspector uses it at 94% (`color-mix`), no blur |
| subtle (hover, step marker) | `--bay-bg-subtle` | `#1e1e24` | |
| sunken (inputs, tracks) | `--bay-bg-sunken` | `#0f0f12` | |
| stage scrim | `--bay-stage-bg` | `rgba(0, 0, 0, 0.5)` | The screening room over the ambient |
| stage frame | `--bay-stage-frame` | `#000000` | Behind every image on the stage |
| stage raised / line | `--bay-stage-raised` / `--bay-stage-line` | `#101014` / `rgba(255,255,255,0.08)` | |
| ink | `--bay-text` | `#f5f5f7` | 15.6:1 on surface |
| ink 2 | `--bay-text-2` | `#b9b9c1` | 9.1:1 |
| ink 3 (muted, captions) | `--bay-text-3` | `#8f8f98` | 5.7:1, the floor for 12 to 13 px text |
| ink 4 (decorative only) | `--bay-text-4` | `#6c6c75` | Never for text that must be read |
| ink 5 | `--bay-text-5` | `#3a3a42` | Disabled glyphs |
| hairline | `--bay-border-hair` | `rgba(255,255,255,0.06)` | |
| line | `--bay-border` | `rgba(255,255,255,0.10)` | |
| line strong | `--bay-border-strong` | `rgba(255,255,255,0.18)` | |
| accent (tungsten) | `--bay-accent` | `#e07b4a` | Action and selection only |
| accent hover | `--bay-accent-hover` | `#ea8f62` | |
| accent soft | `--bay-accent-soft` | `rgba(224,123,74,0.16)` | Selected rows, chips |
| accent as text | `--bay-accent-fg` | `#f0a070` | Links, selected nav icon; 9:1 on surface |
| accent rgb | `--bay-accent-rgb` | `224, 123, 74` | For rings and sweeps |
| on accent | `--bay-text-on-accent` | `#140c07` | Dark text on the amber fill: 6.6:1. White would fail AA (2.9:1) |
| focus | `--bay-border-focus` | `#f0a070` | 2 px ring, 2 px offset |
| ok | `--bay-ok-bg` / `--bay-ok-fg` | `#14271e` / `#5fd39c` | |
| warn | `--bay-warn-bg` / `--bay-warn-fg` | `#2a2410` / `#e6b34a` | |
| err | `--bay-err-bg` / `--bay-err-fg` | `#2a1716` / `#ef7a72` | |
| info | `--bay-info-bg` / `--bay-info-fg` | `#2b1f17` / `#f0a070` | Info is the accent family, not blue |
| brand mark | `--bay-brand` / `--bay-brand-fg` | `rgba(255,255,255,0.10)` / `#f0a070` | A glass tile with the aperture glyph in accent. The garden green is retired |

Selection: `::selection { background: rgba(224, 123, 74, 0.35); }`.
Scrollbars: `scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.18) transparent`.

### 2.3 Glass material

Glass is for chrome that sits over imagery: it is translucent, blurred,
saturated, with a specular top edge and a soft shadow. Three thicknesses, one
recipe, global classes in `src/client/styles/glass.css` (the one sanctioned
exception to "CSS Modules only": a material is shared by design).

```
--glass-fill:        rgba(22, 22, 27, 0.62)   .glass        sidebar, action bar, top bar, tab bar
--glass-fill-thick:  rgba(22, 22, 27, 0.84)   .glass-thick  sheets, dialogs, popovers, menus (text-heavy)
--glass-fill-thin:   rgba(22, 22, 27, 0.42)   .glass-thin   the stage toolbar pill (icon buttons and short labels)
--glass-blur:        24px  (thin: 16px)
--glass-saturate:    1.6
--glass-edge:        inset 0 1px 0 rgba(255,255,255,0.14), inset 0 0 0 1px rgba(255,255,255,0.06)
--glass-shadow:      0 12px 40px rgba(0, 0, 0, 0.45)
--glass-solid:       #16161a   (the fallback fill)
--glass-btn:         rgba(255,255,255,0.08)  hover 0.12  pressed 0.16  selected 0.14
```

Rules:
- `backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate))`
  with the `-webkit-` twin. `@supports not ((backdrop-filter: blur(1px)) or
  (-webkit-backdrop-filter: blur(1px)))` → `background: var(--glass-solid)`.
- `@media (prefers-reduced-transparency: reduce)` → no backdrop filter,
  `background: var(--glass-solid)`, and the ambient backdrop is not rendered.
  The shooter asserts zero elements with a computed `backdrop-filter` under it.
- Text on glass is always `--bay-text` or `--bay-text-2`. With fill alpha ≥ 0.62
  and the ambient at brightness 0.3, the worst-case backdrop luminance under
  `.glass` is about 0.11, so `#f5f5f7` stays above 6:1. Never put `--bay-text-3`
  on `.glass-thin`.
- Never glass on glass. A dialog over the sidebar is fine (the overlay scrim
  separates them); a glass card inside a glass panel is not.
- Never glass under scrolling content lists, form fields or images. The
  inspector, cards, inputs and the stage are solid or scrimmed, not blurred.
- At most six glass surfaces on screen at once. Blur radius never animates.
- Continuous corners: `@supports (corner-shape: squircle) { corner-shape: squircle }`
  on every glass surface and card. Radii: `--r-control 10px`, `--r-card 14px`,
  `--r-panel 20px`, `--r-bar 28px`, `--r-pill 999px`. Aliases: `--bay-r-xs 6`,
  `--bay-r-sm 8`, `--bay-r-md 10`, `--bay-r-lg 14`, `--bay-r-xl 20`.

### 2.4 Where glass goes (and nowhere else)

Phase 9 assigns the three thicknesses by role:

- `.glass` (62%): the top bar.
- `.glass-thick` (84%, text-heavy surfaces): the dock, the inspector, the phone
  tab bar, the phone bottom sheet, the Shoot sheet, dialogs (`ConfirmDialog`,
  `ChooserDialog`, the `FullscreenDialog` aside), popovers (`Select`,
  `UserMenu`).
- `.glass-thin` (42%, icon buttons and short labels): the strip (the filmstrip
  of takes, frames or clips), the canvas toolbar, the actions pill under the
  caption, the hidden-inspector pill, the `Lightbox` bar.

Never glass: cards (library, takes, frames), form fields, alerts, the picture
and its frame, images, text blocks. The activity pill is a `--glass-btn`
control fill sitting on the top bar, not a glass surface of its own.

The inspector is the one place 2.3's "never glass under form fields" relaxes
(decision 3 in section 8). Its fields keep their own solid sunken fill and
border; text on it is ink 1 or 2; the scroller is a child of the glass element,
so the blur never scrolls; a card inside the inspector is a solid surface (no
glass on glass). At rest a desktop page asks for six glass surfaces: top bar,
dock, inspector, strip, canvas toolbar and actions pill.

### 2.5 Ambient backdrop (the signature)

`src/client/lib/ambient.tsx`: `AmbientProvider`, `useAmbient(url, active)`.
The shell renders `<div class="ambient" aria-hidden>` fixed at z-index 0 with
two stacked `<img>` layers. Setting a new url loads it in the hidden layer,
then cross-fades (`opacity` 1200 ms `--ease-out`). Image CSS:
`object-fit: cover; transform: scale(1.2); filter: blur(48px) saturate(1.5)
brightness(0.3)`. Pages pass a thumbnail url (`stillThumbUrl`), never a
full-size image. Under reduced motion the swap is instant. Under reduced
transparency, or without backdrop-filter support, the layer is not rendered
and the ground is solid `#0c0c0e`. Default when a page sets nothing: a static
radial gradient `radial-gradient(60% 50% at 30% 20%, #1a1512, #0c0c0e)`.

Who sets it: Stills = result, else the source render; Video = the selected
take's still, else the picked still; Lifestyle = the take on the big screen,
else the first project render; Director = the viewed frame, else the first
image; Close-ups = the current shot, else the source; Location = result, else
the screenshot; Edit = the preview clip's thumb, else the first timeline clip;
Library and Settings = none (default gradient). Only the active page's call
wins (the hook ignores inactive pages).

### 2.6 Type

Family: `--font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text",
"SF Pro Display", system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`
(aliased as `--bay-font-sans`); `--font-mono: ui-monospace, "SF Mono", Menlo,
Consolas, monospace`. No web fonts: the ABC Normal `@font-face` and the Google
Fonts `<link>`s are removed (two fewer origins, zero font CLS).
`-webkit-font-smoothing: antialiased` on body. Numbers in tables, timers and
step markers use `font-variant-numeric: tabular-nums`.

Scale (shorthand `font:` token plus a tracking token; use both together):

| Role | `--text-*` | weight size/line | `--track-*` | Used for |
|---|---|---|---|---|
| large-title | `--text-large-title` | 700 34/40 | -0.012em | Library and Settings page titles (desktop) |
| title-1 | `--text-title-1` | 700 26/32 | -0.012em | Inspector page titles (a 400 px column), phone page titles |
| title-2 | `--text-title-2` | 600 22/28 | -0.008em | Dialog titles, lightbox title |
| title-3 | `--text-title-3` | 600 19/24 | -0.006em | Group titles on the stage (chapters, storyboard) |
| headline | `--text-headline` | 600 15/20 | -0.012em | Step titles, card titles, nav items (500) |
| body | `--text-body` | 400 15/22 | -0.012em | Body copy, textarea content |
| callout | `--text-callout` | 400 14/20 | -0.006em | Descriptions, hints under steps, button labels (500) |
| subhead | `--text-subhead` | 400 13/18 | -0.003em | Control labels (500), metadata, alert text |
| footnote | `--text-footnote` | 400 12/16 | 0 | Captions, timers, select hints |
| caption | `--text-caption` | 500 11/14 | +0.004em | Tab-bar labels, badges; group headers uppercase at +0.06em |

Measure: descriptions `max-width: 62ch`; Settings column 760 px. Page titles
use `text-wrap: balance`. Body text never under 12 px; 11 px only for the
caption role, always `--bay-text-2` or stronger.

### 2.7 Motion

```
--ease-out:    cubic-bezier(0.22, 1, 0.36, 1)
--ease-spring: linear(0, 0.131 5%, 0.38 10%, 0.618 15%, 0.798 20%, 0.915 25%,
               0.98 30%, 1.01 35%, 1.019 40%, 1.019 45%, 1.014 50%, 1.009 55%,
               1.005 60%, 1.002 65%, 1.001 70%, 1)      (zeta 0.78: 2% overshoot)
--dur-1: 120ms  colour and opacity on controls
--dur-2: 200ms  hover transforms, chips, switches
--dur-3: 320ms  panels, nav indicator, segmented control, popovers (spring)
--dur-4: 480ms  sheets (spring in, 160 ms ease-out out)
ambient cross-fade: 1200 ms ease-out
aliases: --bay-dur-fast = --dur-1, --bay-dur = --dur-2, --bay-dur-slow = --dur-3, --bay-ease = --ease-out
```

Only `transform`, `opacity`, `background-color`, `border-color`, `box-shadow`
(small surfaces) and `translate` animate. Never layout properties, never
`filter` or `backdrop-filter`. `will-change` only on the rendering sweep.
`global.css` keeps its reduced-motion rule (every duration to 0.01 ms); each
treatment below also names its reduced-motion state so no state is lost.

One treatment per role:

| Role | Pointer | Press | Reduced motion |
|---|---|---|---|
| Nav item (sidebar, rail, tab bar) | the shared glass indicator slides to the item (translate, `--dur-3` spring); label to `--bay-text`; item fill `--glass-btn` | indicator fill 0.16 | indicator jumps; current item keeps the fill |
| Primary button | fill to `--bay-accent-hover`, `translateY(-1px)`, edge brightens, `0 6px 16px rgba(224,123,74,0.25)` | `scale(0.98)`, no lift | colour change only |
| Default and ghost buttons | glass-btn fill 0.08 to 0.12 | 0.16 and `scale(0.98)` | fill change |
| Cards, thumbnails, takes | image `scale(1.03)` inside its clipped frame, card `translateY(-2px)` | selected: 2 px accent ring (`box-shadow: 0 0 0 2px var(--bay-accent)`) | ring and border only |
| Inline links | underline at rest (1 px, `--bay-accent-fg`), 2 px on hover | | same |
| Segmented control | hovered segment fill 0.06 | selected segment slides (shared indicator) | jumps |
| Switch, slider knob | knob shadow deepens | knob `scale(1.05)` | colour only |
| Dialog, popover, sheet | enter `opacity 0→1`, `translateY(8px)→0`, `scale(0.98)→1`, `--dur-3` spring (sheet: from `translateY(24px)`, `--dur-4`); exit 160 ms | | opacity only |
| Page switch | the newly active panel runs `panelIn`: `opacity 0→1`, `translateY(6px)→0`, 200 ms ease-out | | opacity only |
| Rendering | the existing `RenderingStatus` sweep (2.4 s loop); the activity pill reuses a 3 px version | | the sweep stops; the label and timer remain |

Every hover state is also the `[data-focus-visible]` / `:focus-visible` state,
plus the ring. Hover rules live under `@media (hover: hover)` or react-aria's
`[data-hovered]` (which already ignores touch).

### 2.8 Focus, targets, keyboard

- Ring: `outline: 2px solid var(--bay-border-focus); outline-offset: 2px;
  border-radius: inherit` on `:focus-visible` and react-aria `[data-focus-visible]`.
  Inputs show the ring as `border-color: var(--bay-accent)` plus
  `box-shadow: 0 0 0 3px rgba(var(--bay-accent-rgb), 0.25)`.
- Targets: 24 px minimum everywhere, 36 px for toolbar buttons, 44 px for the
  primary action and every phone tab. Icon-only buttons carry `aria-label`.
- A skip link ("Skip to content") is the first element in the DOM; it focuses
  `<main id="main" tabindex="-1">` with `preventDefault` (a `#main` hash would
  be read as a page id by the router).
- After a navigation, focus moves to `main` (`focus({ preventScroll: true })`).
- Hidden pages use the `hidden` attribute, so nothing inside them is focusable.
- Document title per page: `<Page label> · Render to Film`.

## 3. Layout

### 3.1 Shell

Phase 9: the picture fills the window and everything else floats over it. The
top bar is 48 px and `.glass` at every width. From 900 the dock floats at the
bottom and the inspector floats at the right (from 900 to 1199 it overlays the
canvas); under 900 the dock gives way to the tab bar and the inspector becomes a
bottom sheet.

```
≥ 1200 (desktop)
┌──────────────────────────────────────────────────────────────────────────────┐
│ (o) Render to Film            Stills                [rendering] [gear] (me)  │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ╭───────────╮                                    ╭────────────────────────╮ │
│  │ toolbar   │                                    │ head            [hide] │ │
│  ╰───────────╯                                    ├────────────────────────┤ │
│                                                   │ h1 and description     │ │
│      ┌────────────────────────────────────┐       │ 1  step                │ │
│      │                                    │       │ 2  step                │ │
│      │   picture, contain-fit in          │       │ 3  step                │ │
│      │   the area left free               │       │ ... (the body scrolls) │ │
│      └────────────────────────────────────┘       │                        │ │
│                     caption                       │                        │ │
│           ╭──────────────────────────╮            │                        │ │
│           │ Download   Make a video  │            │                        │ │
│           ╰──────────────────────────╯            │                        │ │
│  ╭────────────────────────────────────────────╮   ├────────────────────────┤ │
│  │ [ ] [ ] [ ] [ ] [ ]   takes strip          │   │ [      Shoot      ]    │ │
│  ╰────────────────────────────────────────────╯   │ cost line              │ │
│                                                   ╰────────────────────────╯ │
│  ╭───────────────────────────────────────────────────────────────────────╮   │
│  │ Stills Lifestyle Director Close-ups Location │ Video │ Edit │ Library │   │
│  ╰───────────────────────────────────────────────────────────────────────╯   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

```
900 to 1199 (tablet)                         < 900 (phone)
┌────────────────────────────────────────┐   ┌──────────────────────┐
│ (o) Render to Film   Stills   [gear]   │   │ top bar 48  [gear]   │
├────────────────────────────────────────┤   ├──────────────────────┤
│                                        │   │ ┌──────────────────┐ │
│  ╭─────────╮          ╭─────────────╮  │   │ │ canvas           │ │
│  │ toolbar │          │ inspector   │  │   │ │ (contain-fit)    │ │
│  ╰─────────╯          │ 360         │  │   │ │                  │ │
│                       │             │  │   │ └──────────────────┘ │
│  ┌─────────────────┐  │             │  │   │ ╭──────────────────╮ │
│  │                 │  │             │  │   │ │ [ ] [ ] [ ] [ ]  │ │
│  │ picture         │  │             │  │   │ ╰──────────────────╯ │
│  │ (the inspector  │  │             │  │   ├──────── grabber ─────┤
│  │ overlays it)    │  │             │  │   │ sheet (peek)         │
│  │                 │  ├─────────────┤  │   │ [     Primary     ]  │
│  └─────────────────┘  │ [ Shoot ]   │  │   │                      │
│                       ╰─────────────╯  │   ├──────────────────────┤
│                                        │   │ tab bar 64           │
│  ╭──────────────────────────────────╮  │   └──────────────────────┘
│  │ [ ] [ ] [ ] [ ] [ ]  strip       │  │
│  ╰──────────────────────────────────╯  │
│       ╭───────────────────────╮        │
│       │ o o o o o │ o │ o │ o │        │
│       ╰───────────────────────╯        │
└────────────────────────────────────────┘
```

- `AppShell` owns: the skip link, the ambient layer, `TopBar`, `Dock`, `TabBar`
  and `<main id="main" tabIndex={-1}>` (inside the `ErrorBoundary`). `Nav.tsx`
  exports `TopBar`, `Dock`, `TabBar`, `ShootSheet` and `ActivityPill`; the
  sidebar and icon rail are gone. `main` has no margin: `padding-top:
  var(--app-header)`, and on phones `padding-bottom: var(--app-bottom)`.
- Shell variables, set on the shell root: `--app-header: 48px` at every width;
  `--app-dock: 72px` from 900 (the 56 px dock plus its 16 px float; the
  Workspace keeps clear of it); `--app-bottom` under 900 only (the tab bar's
  footprint, `calc(10px + 64px + env(safe-area-inset-bottom))`; 0 elsewhere).
  `Workspace.module.css` reads all three.
- `TopBar`: `<header>` fixed to the top, full width, above the Workspace. Left:
  the mark and "Render to Film" (headline 600; the words hide under 480 px).
  Centre: the current page's label (subhead, `--bay-text-2`, a `<span>`, never
  a heading). Right: the activity pill when something renders, the Settings
  link (`<a href="#settings">`, 36 px ghost icon button, `aria-label="Settings"`,
  `title="Accounts, models and connections"`, `aria-current` when current), then
  the user menu (avatar only under 600 px).
- `Dock`: `<nav aria-label="Studio">` fixed at `bottom: calc(16px +
  env(safe-area-inset-bottom))`, centred, 56 px tall, padding 6, `.glass-thick`,
  radius `--r-bar`, one `<ul>` holding the eight non-Settings pages in order.
  Each item is a 44 px tall `<a href="#id">` (padding 0 14px, gap 8, radius
  `--r-control`) with an 18 px icon and a footnote 500 label; `--bay-text-2` at
  rest, `--bay-text` when current or hovered, the current icon in
  `--bay-accent-fg`, the hover fill `--glass-btn-hover`, the ring from 2.8. A
  1 x 24 px `--bay-border` hairline (`role="separator"`) sits between groups,
  after Location, Video and Edit. One gliding `[data-indicator]` (`--dur-3`
  spring; it jumps under reduced motion). From 900 to 1199 the labels are
  visually hidden (the accessible name stays) and items are 44 x 44. Under 900
  the dock is not rendered.
- Only the top bar, dock and tab bar are `position: fixed`. A page's
  Workspace root is `position: relative; height: calc(100dvh -
  var(--app-header))` and its panels are `absolute` inside it: every page panel
  animates with `transform`, and a transformed ancestor re-parents fixed
  descendants (decision 2 in section 8). The `panelIn` animation is opacity
  only.
- Library is a Workspace with a `free` canvas (a contact sheet) and an
  inspector for the selected item. Settings is not a Workspace: a centred
  `.glass-thick` sheet (760 px, radius `--r-panel`, solid cards inside) over the
  ambient; on a phone it is full width with 16 px margins and clears
  `--app-bottom`.

### 3.2 Information architecture

Dock, in order (ids are the existing hash ids; deep links do not change):

```
SHOOT      Stills #stills · Lifestyle #lifestyle · Director #director · Close-ups #closeups · Location #location
ANIMATE    Video #video
FINISH     Edit #edit
LIBRARY    Library #library
(top bar)  current page label · [activity pill when something renders] · Settings #settings · user menu
```

The dock shows no group headers: the groups are the hairline separators (after
Location, Video and Edit), and the group names above are for this document. From 1200
each item shows its icon and label; from 900 to 1199 the label is visually
hidden and the item is an icon. Settings lives in the top bar at every width,
not in the dock. The phone tab bar has five items: Shoot, Video, Edit, Library,
Settings. Shoot opens a glass sheet listing the five Shoot pages with their
one-line purpose; while a Shoot page is active, the Shoot tab is selected and
its label reads that page's name. Alias `#surroundings` still maps to
`location`. Nav items are real `<a href="#id">` links with `aria-current="page"`
on the current one (so the back button steps between pages).

Rejected: Create / Plan / Finish (Director, Close-ups and Location all render
images; "Plan" misdescribes them), and nine items in one row (the problem).

Short purposes (new copy, used in the sheet, as `title` attributes on dock
items and on the Settings button): Stills "One render into a film still";
Lifestyle "A whole project, with the people who live there"; Director "A
storyboard shot from your project images"; Close-ups "Close-ups found inside
your frames"; Location "A map screenshot as a photograph"; Video "Bring a still
to life, or recreate a clip in 4K"; Edit "Cut, grade and export the film";
Library "Everything you have made"; Settings "Accounts, models and
connections".

### 3.3 Page anatomy (Workspace anatomy)

A page is one `<Workspace page=… />` (`src/client/layouts/Workspace.tsx`). The
page passes ReactNodes into slots; it owns no layout classes. Props are in
section 8.

**Inspector.** `<aside aria-label="Controls">`, `.glass-thick`, radius
`--r-panel`, a three-row grid: head, scrolling body, footer.

1. Head: a 44 px row. The `inspectorHead` slot fills it (Video's segmented
   control); the Hide button sits at its end (28 px ghost icon button,
   `PanelRightClose`, `aria-label="Hide controls"`, `aria-keyshortcuts="i"`).
2. Body: the only part that scrolls (`overflow-y: auto; overscroll-behavior:
   contain`; padding 0 24px). It starts with the page header: `h1` title-1,
   description callout `--bay-text-3`, 62ch; one `h1` per page. Then numbered
   steps (`Section step={n}`): a 22 px round marker filled `--bay-bg-subtle`,
   numeral footnote 600 tabular `--bay-text-2`; title headline; description
   callout; 24 px air above and below; hairline between steps. Unnumbered
   sections (results) have no marker.
3. Footer: the page's one primary action, a 44 px full-width `Button size="lg"`,
   with a `CostLine` under it (one footnote summary line; model-by-model costs
   sit behind a "What this costs" disclosure). A solid
   `color-mix(in srgb, var(--bay-bg-surface) 70%, transparent)` foot over the
   glass with a hairline on top, padding 14px 24px plus the safe-area inset.
   Secondary actions never sit in the footer.

The inspector slides in from 24 px to the right with opacity over `--dur-3`
spring (opacity only under reduced motion). When it hides, a `.glass-thin`
pill ("Controls" with `PanelRightOpen`, `aria-label="Show controls"`,
`aria-keyshortcuts="i"`) takes its place at the canvas area's top right, and
the canvas and strip widen to the window edge. Open or hidden is remembered per
page. Focus moves to the Show button when the inspector hides and to the Hide
button when it shows. The shortcut `i` toggles it on the active page.

**Canvas.** The canvas area is `--bay-stage-bg` over the ambient (the room). It
is never empty. Four states:

| State | The area holds | Used when |
|---|---|---|
| `empty` | A drop target the size of the frame: dashed `--bay-border-strong` inner border, `ImageUp` icon, a headline title and a callout hint (`--bay-text-2`, 44ch), an action button that opens the file picker | No source yet |
| `preview` | The source image dimmed to 55% inside the frame guides, with one line over it (a `--scrim-chip` chip) saying what will appear | A source is chosen, no result yet |
| `live` | The result, a running status or an error, inside the frame: `CompareSlider`, an image with `object-fit: contain`, a video, `RenderingStatus`, an `Alert` | A take exists or is being made |
| `free` | A grid or a player that fills the area and scrolls; no frame | Contact sheets (Library, Lifestyle and Director grids), the Edit player |

An empty canvas is a drop target and never an `EmptyState` in a black box.
When a page accepts dropped images and the state is not `empty`, the whole
canvas area is also a drop zone (a 2 px `--bay-accent` inset ring with
`--bay-accent-soft` fill while dragging over; it never captures clicks).

**Picture, caption and guides.** The frame (`.picture`) is sized by the page's
`aspectRatio`, contain-fit into the area left free by the inspector, strip and
dock: black `--bay-stage-frame`, radius `--r-card`, the one deep shadow
`--bay-shadow-stage`. The frame guides are a 1 px `--bay-stage-line` outline 8 px
outside the picture plus four 12 px corner ticks. Under the picture, centred,
10 px below: the caption (footnote, `--bay-text-2`: look, model, resolution).
Under the caption, 8 px below: the actions pill.

**Toolbar and actions pills.** The canvas toolbar is a `.glass-thin` pill at the
canvas area's top left (12 px from the edges, 36 px ghost buttons, padding 4,
radius `--r-bar`): view toggles, previous and next, filters. The actions pill
is a `.glass-thin` pill under the caption (padding 6, gap 4, radius `--r-bar`):
ghost buttons for the current picture (Download, Make a video, Open full
size). It is not rendered when it has no buttons.

**Strip.** A `.glass-thin` filmstrip (`role="region"`, named by the page:
Takes, Frames, Timeline) above the dock, left of the inspector: radius
`--r-panel`, padding 8. Its content scrolls sideways (`scroll-snap-type: x
proximity`, 8 px gaps). Height is 112 px, or 164 px for a timeline (96 and 148
on a phone). A page with no strip gives the picture that room.

**Tablet (900 to 1199).** The inspector is 360 px and overlays the canvas and
strip, which keep the window edge; its bottom stops above the strip so the
strip stays visible under it.

**Small landscape (480 to 899, landscape).** A landscape window under 900
px (a small window, a phone on its side) gets the desktop arrangement with the
icons-only dock: the inspector is `clamp(256px, 42vw, 340px)`, full height
beside the canvas and the strip.

**Short window (under 640 tall, any layout but the phone).** The picture keeps
the height: gaps are 8 px, `--fit-pad` 12 px, the strip 84 px (128 for a
timeline), the dock floats 8 px up (`--app-dock` 64 px), the caption is
hidden and the picture's actions move into the toolbar band at its right
(left of the Show pill when the inspector is hidden), so nothing sits under
the picture. Edit does the same for its player: its buttons at the canvas's
top left, only an out-of-date export's warning under the transport.

**Phone (under 480, or portrait under 900).** One query, `PHONE_QUERY` in
`layouts/Workspace.tsx`, and the same media list in every stylesheet:
`(width < 480px), (width < 900px) and (orientation: portrait)`. The Workspace
is a column: the canvas (contain-fit,
12 px padding), the strip (static, 12 px side margins), and the inspector as a
bottom sheet over the foot of the column, above the tab bar. The sheet has top
radius `--r-panel` and three detents:

| Detent | Height | Shows |
|---|---|---|
| `peek` | 120 px (`--sheet-peek`) | Grabber and footer only; the body is `inert` and `aria-hidden` |
| `half` | 50% of the Workspace root | Head, a scrolling body, footer |
| `full` | 100% of the Workspace root, up to the top bar | Head, a scrolling body, footer |

A grabber button at the top of the sheet (44 x 28 hit area drawing a 36 x 5
`--bay-text-3` pill; `aria-label` "Expand controls" or "Collapse controls",
`aria-expanded`) cycles peek, half, full, peek. There is no drag gesture. The
sheet opens on `peek` and the state is not remembered; the footer is always
visible at its foot; the head sits under the grabber; there is no Hide button
and no `i` shortcut under 900 px. Height changes over `--dur-3 --ease-out`
(none under reduced motion).

### 3.4 Spacing and grid

4 px base. `--gap` is 12 px: between the floating panels and the window edge,
and around the canvas on a phone. Inspector 380 px wide (420 from 1680, 360 from
900 to 1199); inspector body padding 24 px; step padding 24/0; control stacks
12 px; inline groups 8 px. Strip padding 8 px with 8 px between cards. Dock
56 px tall floating 16 px above the bottom; top bar 48 px. Cards in a free
canvas grid: `repeat(auto-fill, minmax(240px, 1fr))` with 16 px gaps (Library's
contact sheet is tighter: `minmax(200px, 1fr)`, 8 px gaps, two columns on a
phone); content measure 1680 px centred.

## 4. Components (`src/client/ui/`)

Built on react-aria-components; states through data attributes; one
`.module.css` per component. Sizes and states that every control must have:

| Component | Size | Rest | Hover | Pressed / selected | Disabled | Focus |
|---|---|---|---|---|---|---|
| `Button` primary | sm 28 / md 36 / lg 44 px; radius `--r-control`; callout 500 | accent fill, dark text | hover fill, lift 1 px, glow | scale 0.98 | opacity 0.45, no lift | ring |
| `Button` default | same | glass-btn 0.08 + edge | 0.12 | 0.16 + scale 0.98 | opacity 0.45 | ring |
| `Button` ghost | same | transparent, `--bay-text-2` | 0.08, `--bay-text` | 0.12 | | ring |
| `Button` danger | same | `--bay-err-fg` fill, dark text | brightness 1.08 | scale 0.98 | | ring |
| `TextInput`, `TextArea`, `NumberInput`, `Select` trigger | 40 px (textarea auto); radius `--r-control`; sunken fill; 1 px `--bay-border` | border strong | | opacity 0.55 | accent border + 3 px ring |
| `Select` popover, `UserMenu` popover | glass-thick, radius `--r-card`, 6 px padding; items 32 px radius 8, subhead | item fill 0.08 | selected: `--bay-accent-fg` text + check | | ring on item |
| `Switch` | track 36×22, knob 18 white | knob shadow | on: accent track | 0.45 | ring on track |
| `Slider` | track 4 px sunken, fill accent, knob 20 white | | knob scale 1.05 | | ring on knob |
| `Tabs` (segmented, Video modes) | track glass-btn 0.06 radius 10, segments 32 px radius 8, callout 500 | 0.06 | selected 0.14 + edge, slides | | ring on segment |
| `FilterChips`, `TagEditor`, `ToggleButton` | pill 28 px, glass-btn, subhead | 0.12 | selected: accent soft fill + accent-fg text | 0.45 | ring |
| `ImagePicker`, `TakeStrip`, library card | radius `--r-card`, surface fill, hairline | image scale 1.03, lift 2 px | selected: 2 px accent ring | | ring |
| `ImageDropZone` | radius `--r-card`, dashed `--bay-border-strong` when empty | fill subtle | drag-over: accent border + accent soft fill | | ring |
| `Alert` | radius 12, subhead; tone fills from tokens; icon 16 | | | | |
| `EmptyState` | title headline `--bay-text-2`, hint callout `--bay-text-3`, 56 px padding | | | | |
| `Skeleton` | subtle fill, 1.6 s shimmer (none under reduced motion) | | | | |
| `RenderingStatus` | the sweep (accent at 0.28), label subhead, timer footnote tabular | | | | |
| `ConfirmDialog`, `ChooserDialog` | glass-thick, radius `--r-panel`, 24 px padding, title title-2; overlay `rgba(0,0,0,0.6)` | | | | focus starts on Cancel |
| `Lightbox` | overlay `rgba(0,0,0,0.92)`, image crisp, bar = glass-thin pill | | | | Escape closes |
| `FullscreenDialog` | stage black, aside = glass-thick 360 px | | | | arrows step |
| `UserMenu` chip | avatar 28 + name headline 500; in the sidebar footer | glass-btn 0.08 | | | ring |

Add a control: `.tsx` + `.module.css`, props `foo?: T | undefined`, a row here.
Icons: lucide only, `size` always set (18 in nav, 16 in md buttons, 14 in sm).
Never emoji.

## 5. Copy

Sentence case. No em or en dashes in visible text (use a colon, a comma or a
new sentence). No filler verbs. Device-neutral ("choose", not "click" or
"tap"). Existing page copy stays unless it is wrong; group headers and the
nine purposes above are the only new strings the shell introduces.

## 6. QA (the bar every task meets)

Tooling: `.router/ui/shoot.cjs` (built in G1) against the spare simulator
(`…/scratchpad/spare/dev.mjs`: Vite :5193, API :3021). Never :5173 or :3001.
Per touched page it writes `d-*` (1440), `m-*` (390), `r-*` (reduced motion),
`t-*` (reduced transparency), `k-*` (keyboard) and `h-*` (hover pairs) plus
`report.json`, and `summary.json` over all pages. Since Phase 9 the phone also
writes `m2-*`: 390 wide with the Workspace's bottom sheet half open (`m-*` shows
it at `peek`, so the inspector's fields are otherwise out of sight).

A builder runs its own simulator pair and points the shooter at it:

```
node .router/ui/shoot.cjs --no-start --base http://localhost:<VITE_PORT> --tabs <tabs> --out <dir>
```

`--base` is the pair's Vite url; `--no-start` stops the shooter from starting
the spare pair itself (a base other than the spare is never auto-started, the
shooter waits for it). The stress scripts take the same pair from the
environment: `STRESS_BASE`, `STRESS_API`, `STRESS_STORAGE`, `STRESS_UPLOADS`.
The shooter refuses :5173 and :3001. Gates (exit 1 on any):

- zero console errors and page errors; zero failed requests (4xx/5xx)
- no horizontal overflow at 1440 or 390
- axe (wcag2a + wcag2aa): zero serious or critical
- the skip link is the first Tab stop; every Tab stop has a visible focus style
- reduced motion: nothing still animating longer than 50 ms
- reduced transparency: zero elements with a computed `backdrop-filter`
- no primary target in `noHoverChange`
- no interactive target under 24 px

Then the human checks: look at every screenshot; the picture is the best
frame; the canvas is never empty on first view (a picture, a drop target or a
grid); the phone layout is composed, not squished; glass reads as glass over
the ambient and as solid under reduced transparency; no glass sits on glass;
copy has no dashes.

Final passes: a full stress pass of every flow (G15), then a fresh critic
scoring from screenshots only (G16), fixes (G17), and a second critic (G18).
Phase 9 repeats the sequence on the canvas layout: the consistency, stress and
shooter pass (C8), a fresh critic from screenshots only (C9), then fixes (C10)
and a second critic until every category scores 8 or above.

## 7. Phase 8 as built

Where the build differs from the sections above, and why. Recorded in G14
from the builders' reports (`.router/PLAN.md`, "Phase 8 progress"). Where an
item and an earlier section disagree, the item wins.

1. **Sidebar group headers are ink 2, not ink 3 (3.2).** Measured behind the
   "SHOOT" header: ink 3 is 5.70:1 over the default gradient but 4.40:1 over
   a bright (white) frame, under AA for an 11 px caption; ink 2 is 9.38:1 and
   7.24:1. 2.3 and 2.6 already say text on glass and the caption role are
   ink 2 or stronger. No ink 3 text sits on any glass surface (checked on
   all nine pages at 1440 and 390, the Select popover, the user menu, the
   Shoot sheet and the lightbox).
2. **Phone bottom spacing (3.1).** `--app-bottom` is exactly the tab bar's
   footprint, `calc(10px + 64px + env(safe-area-inset-bottom))` (was 64 + 20):
   the sticky action bar and Edit's composer rest on the tab bar with no
   strip of page between them. The shell's `main` keeps that clearance; every
   page adds its own 40 px of air (Library and Settings phone padding
   28/16/40). On stage pages `.result` reaches down through the clearance
   (negative margin, matching padding), so the stage scrim runs to the end of
   the document under the tab bar instead of leaving a lighter band.
3. **Stage toolbar (3.3, 4).** The caption (`.resultNote`) is under the pill
   on every page, never inside it; empty captions collapse. On a phone the
   pill stays one row as wide as the stage and slides sideways with snap
   when its buttons need more room (wrapping stacked one button per row).
   Inside an alert the buttons are a plain wrapping row, no glass.
4. **Video's modes.** `VideoPage.module.css` (accepted in G10) turns the Tabs
   root into the workspace grid from 900 px: the segmented control heads the
   inspector column and the stage keeps the full window height. Studio's
   `.modes`/`.modeBar` only paint the bar; the old full-width-band rules
   (`.modes .layout`, `--mode-bar` in the frame formulas) are gone.
5. **Segmented controls (2.7).** `ui/Tabs` slides react-aria's
   `SelectionIndicator` (`data-indicator`). The selected segment brightens to
   `--glass-btn-pressed` on hover and keyboard focus, so it answers the
   pointer too. Lifestyle's pass-count control keeps its own copy of the
   segmented style (a shared `ui/` control was declined: the two shapes
   differ) with the same rule; Final/Plate stays two `ToggleButton`s.
6. **Scrims.** Tokens, not hand-mixed colours: `--scrim` (0.6: behind
   dialogs and sheets, re-rendering stripes, the brush halo, an upload's
   veil), `--scrim-deep` (0.92: the lightbox), `--scrim-chip` with `-hover`
   and `-pressed` (0.72 / 0.82 / 0.9: labels and buttons set on a picture).
   Shadows stay `color-mix` of the stage frame.
7. **Skeleton (4).** A white veil, `--bay-skeleton` (0.07; 0.12 under
   `[data-stage]`), instead of `--bay-bg-subtle`, which barely showed on the
   stage scrim (the People check while it loads).
8. **Select values.** On a narrow trigger the group text ("Time", "Google")
   gives way first and the name keeps its width ("Golden hour" no longer
   shows as "Gold…").
9. **Ambient (2.5).** An unsent upload has no thumbnail, so a local `blob:`
   or `data:` url is lit through a 192 px copy made once per url (the last
   16 kept); the room keeps its light while the copy is made, and falls back
   to the original if it can't be made.
10. **Favicon.** `public/favicon.ico` (the sidebar mark: the aperture in
    `#f0a070` on the `#16161a` tile, 16/32/48 px) answers the dev server's
    `/favicon.ico`. `index.html` declares no icon on purpose:
    `applyAppIdentity` (`src/routes.ts`) adds the deployed app's icon only
    when the page has none.
11. **Default landing page is Lifestyle** (orchestrator decision; overrides
    the plan's Director and the recommended Stills). Deep links unchanged.
12. **Settings cards.** Each Section on Settings is made a card from the page
    (`.page > section`); a `variant="card"` on `layouts/Section` was
    declined as churn for one page. Switch rows inside cards keep the field
    look (a lighter variant is left to the critic passes).
13. **Edit, Fade length.** The field steps by 0.05 s, not 0.25 s: react-aria
    shows a value snapped to `min + n × step`, and from the 0.1 minimum a
    0.25 step showed the stored 0.5 as 0.6. 0.05 lands on every value the
    app stores (the 0.5 default, 0.75, and every value the old step saved);
    the server takes 0.1 to 4.9.
14. **Lifestyle cards.** `.passToggle` lost its backdrop blur (a card is not a
    glass surface, and it broke the reduced-transparency gate); chips on
    pictures use `--scrim-chip`.
15. **Behaviour added in G0** (bug fixes, not design): a Video first frame can
    be an upload (no still needed); clips keep a poster (`posterKey`,
    `GET /api/library/clip/:id?poster`, `clipPosterUrl`), so a deleted
    still's clips keep their pictures. Older clips with neither a poster nor
    their still show a plain tile (Edit's timeline in the simulator).
16. **QA shooter (6).** `.router/ui/shoot.cjs` mutes every websocket (Vite
    HMR cannot reload a page mid-run), scrolls the window and every inner
    scroller before a capture (lazy images load), grows the phone viewport
    to the page height for `m-*`, capped at 8000 CSS px (sticky bars sit in
    place; taller captures wrapped past Chrome's 16384 device-px limit and
    repeated their top), and always exits.
17. **`design.md`.** On this Mac's case-insensitive volume `design.md` and
    `DESIGN.md` are one file, so "delete design.md" is a case rename on disk;
    git (`core.ignorecase`) still tracks it as `design.md` until
    `git mv design.md DESIGN.md` at commit time. The old system is in
    `HEAD:design.md`.

## 8. Phase 9 canvas layout (2026-10-30)

After Phase 8 the user saw that the layout was still two columns (a form on the
left, an empty black stage on the right; the nav had only moved from the top to
a sidebar) and asked for the entire layout to change. Chosen direction: a
full-screen canvas in dark glass, like Apple Photos editing or Higgsfield
Cinema Studio. The picture fills the window; the settings float on it in one
glass inspector you can hide; the tabs are a floating glass dock at the bottom;
takes sit in a filmstrip above the dock. Sections 2.1 to 2.3 and 2.5 to 2.8
(appearance, palette, glass recipes, ambient, type, motion, focus) stay as
written; only the layout changed, so 2.4 and 3 describe it. Where an earlier
section still names the sidebar, the rail or the stage column (1, 2.7, 7), this
section wins. The plan is `.router/PLAN.md`, "Phase 9".

### 8.1 Decisions

1. **One `Workspace` layout component, slots not classes.**
   `src/client/layouts/Workspace.tsx` owns the canvas, the floating toolbar, the
   inspector (head, scrolling body, sticky footer), the strip and the phone
   bottom sheet; pages pass ReactNodes into slots. Rejected: keeping
   `Studio.module.css`'s `.layout/.controls/.result` grid and restyling it (the
   user saw that and rejected it), and a CSS-only reflow (hiding and showing the
   inspector, the detents and the persistence need state).
2. **Absolute inside a viewport-tall root, not `position: fixed`.** Every page
   stays mounted in a `<div hidden>` panel whose `panelIn` animation transforms
   it, and a transformed ancestor re-parents `fixed` descendants. So the
   Workspace root is `position: relative; height: calc(100dvh -
   var(--app-header))` and its panels are `absolute`. Only the shell's top bar,
   dock and tab bar are fixed. `panelIn` loses its translate (opacity only) as a
   second guard.
3. **The inspector is `.glass-thick`.** The user asked for a glass panel, so 2.3's
   "never glass under fields" relaxes: fields keep their own solid fills on it,
   text on it is ink 1 or 2, and the scroller is a child of the glass element
   (the blur never scrolls). Cards inside the inspector are solid surface (no
   glass on glass).
4. **Dock = Shoot, Animate, Finish, Library; Settings in the top bar.** Eight
   items with icons and labels from 1200, icons only (label visually hidden,
   accessible name kept) from 900 to 1199; the phone keeps the Phase 8 `TabBar`
   and `ShootSheet` unchanged. Items are real `<a href="#id">` links with one
   gliding `[data-indicator]`.
5. **The canvas is never empty.** Four canvas states: `empty` (a drop target
   that is the frame), `preview` (the source dimmed inside the guides with one
   line saying what will appear), `live` (a result, a running status or an error
   inside the frame), `free` (a grid or a player; no frame). Rejected:
   `EmptyState` in a black box.
6. **Video keeps react-aria `Tabs`; Recreate becomes a hook that returns
   slots.** The segmented control is the inspector head (`inspectorHead`); the
   two `TabPanel`s (`shouldForceMount`) hold only each mode's inspector content;
   the canvas, strip and footer switch on `mode`. `RecreatePanel` becomes
   `useRecreateWorkspace(props)` returning `{ inspector, canvas, canvasState,
   aspectRatio, caption, canvasActions, strip, footer }`, called unconditionally
   at `VideoPage` level (the panel was always mounted before, so its queries,
   polls and guards run exactly as today). The stress script keeps
   `getByRole('tab', …)`.
7. **Lifestyle and Director: selection drives the inspector.** The selection is
   `'job'` or a frame key. The strip lists frames grouped by chapter (Lifestyle)
   or in story order (Director). The inspector shows the job setup (plus the cast
   panel) for `'job'` and the frame's own fields for a frame. A Grid toggle in
   the canvas toolbar shows every frame as a contact sheet (a `free` canvas). The
   per-frame field markup moves as a block, so the Phase 7 greps still count one
   each.
8. **The phone inspector is a bottom sheet with three detents** (`peek`: footer
   only; `half`: 50% of the root; `full`: up to the top bar). A grabber button
   cycles them; there is no drag gesture (a later nicety). The default is
   `peek`, not persisted. The desktop and tablet open-or-hidden state is
   persisted per page in `localStorage` under `render-to-film:inspector:<page>`.
9. **Keyboard shortcut `i` toggles the inspector** on the active page only. It
   is ignored while typing (`input, textarea, select, [contenteditable]`,
   `isComposing`) and inside a `[role="dialog"]`. `aria-keyshortcuts="i"` is on
   the Hide button and the Show pill.
10. **Stress scripts are updated only where the layout moved an element;
    assertions stay.** `lib.js` reads its simulator pair from the environment
    (`STRESS_BASE`, `STRESS_API`, `STRESS_STORAGE`, `STRESS_UPLOADS`, defaults as
    before) so several builders can run several pairs at once.
11. **No server change, prompts byte-identical, behaviour unchanged.** Every
    call, mutation, query option, in-flight guard and stored state stays; the
    page props in `App.tsx` stay; pages stay mounted and `inert` when inactive;
    deep links stay. The default landing page stays `lifestyle`.

### 8.2 `Workspace` props

`src/client/layouts/Workspace.tsx` and `Workspace.module.css`. Optional props
are `T | undefined`.

| Prop | Type | Meaning |
|---|---|---|
| `page` | `PageId` | Persistence key (`render-to-film:inspector:<page>`) and the active-page check for the shortcut |
| `canvasState` | `'empty' \| 'preview' \| 'live' \| 'free'` | Which of the four canvas states to draw |
| `canvas` | `ReactNode` | The picture (image, `CompareSlider`, video, `RenderingStatus`, `Alert`) or, for `free`, the grid or player. Ignored when `empty` |
| `aspectRatio` | `string` | `'16 / 9'`, `'2560 / 1440'`; the frame fits it. Required unless `free` |
| `caption` | `ReactNode` | One line under the picture: look, model, resolution |
| `canvasNote` | `ReactNode` | `preview` only: the one line over the dimmed source ("Your film still will appear here") |
| `canvasToolbar` | `ReactNode` | The floating `.glass-thin` pill at the canvas area's top left (view toggles, previous and next, filters) |
| `canvasActions` | `ReactNode` | Ghost buttons for the current picture (Download, Make a video, Open full size); the pill under the caption |
| `onDropFiles` | `(files: File[]) => void` | Images dropped anywhere on the canvas; also the `empty` zone's file picker |
| `empty` | `{ title, hint, action, label }` | The `empty` copy; `label` is the drop zone's accessible name |
| `inspectorHead` | `ReactNode` | Sticky above the body (Video's segmented control) |
| `inspector` | `ReactNode` | The page header (the page's one `h1`) and its sections; scrolls |
| `footer` | `ReactNode` | The one primary action (`Button size="lg"`, 44 px, full width) and a `CostLine` |
| `strip` | `ReactNode` | The filmstrip content: cards in a row, the page's own radio group or list. Not rendered when undefined |
| `stripSize` | `'strip' \| 'timeline'` | 112 or 164 px on desktop, 96 or 148 on a phone; default `'strip'` |
| `stripLabel` | `string` | The strip region's name: "Takes", "Frames", "Timeline" |

Geometry in one place: the root carries `--inspector-w` (380 px; 420 from 1680;
360 from 900 to 1199), `--strip-h` (0, 112 or 164 px) and `--gap` (12 px). The
canvas area is inset by `--gap` on the left and top, by the inspector's width
plus two gaps on the right while it is open (`--gap` while hidden or on a
tablet), and by `--app-dock`, the strip and a gap at the bottom. The inspector
sits `--gap` from the top and right and `--app-dock` plus a gap from the
bottom.

### 8.3 Companions

- `CostLine` (`src/client/ui/CostLine.tsx`): `summary` is one footnote line;
  `details`, when given, sits behind a "What this costs" disclosure (collapsed by
  default, not persisted). Model-by-model breakdowns go in `details`.
- `ImageDropZone` takes a `label` for its accessible name (default "Drop an image
  here"); callers pass task names: "Drop or choose the source render" (Stills),
  "Drop or choose project renders" (Lifestyle), "Drop or choose project images"
  (Director), "Drop or choose the map screenshot" (Location), "Drop or choose an
  image" (Close-ups), "Drop or choose a frame" (Video frames), "Drop or choose a
  cast sheet", "Drop or choose a lighting reference".
- Clip cards (Video, Edit, Library) show a poster (`clipPosterUrl`, else the
  still thumb, else a plain tile) with one centred 44 px play button
  (`aria-label` "Play <title>"). The `<video>` has `controls` and loads only
  after that press (`preload="none"` before). The Edit player and the lightbox
  keep native controls.
- `ShotDirector` (`src/client/ShotDirector.tsx`): the "Direct the shot" switch
  (on by default, remembered per browser) and the editable plan (camera, what
  moves, people, beats, focus, ends on) that sits at the top of a video
  inspector's Camera section; its primary-button rule is two presses: "Direct
  the shot" (a text call), then "Make the video".

### 8.4 Stress and shooter

Behaviour is checked as before: the nine stress scripts (one per page) exit 0
against a task's own simulator pair, and `.router/ui/shoot.cjs` writes its
captures. The Workspace adds one capture: `m2-*`, the phone at 390 with the
bottom sheet half open (`m-*` shows it at `peek`), so the inspector's fields are
seen on a phone. Run both against a pair as in section 6.

