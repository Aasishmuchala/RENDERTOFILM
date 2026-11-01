# Render to Film: design system (black and white glass, chat first)

Read this before touching anything under `src/client/`. It replaces `design.md`
(deleted in G14). Where this file and the code disagree, fix one of them in the
same change. Phase 8 (`.router/PLAN.md`) built the glass system, Phase 9 the
canvas layout, and Phase 13 (`.router/PLAN-13.md`) made it black and white and put
the chat first. Sections 2 and 3 describe the system as it now stands; section 7
keeps the Phase 8 decisions that colour and the shell no longer touch, and
section 8 holds the layout and chat decisions.

## 0. Brief

- Subject: an internal studio tool. Architects drop CG renders in and get film
  stills, lifestyle photographs, storyboards, close-ups, video and a cut, mastered
  film out.
- Audience: the studio's own people, on Macs, mostly at 1440 to 1920 wide; a
  phone is for checking on a render, not for setting one up.
- Job of the UI: make the workflows obvious and finishable without a manual. The
  chat is the way in: drop renders, say what you need, read the quote, say yes.
  Every page behind the menu button is still a full tool for doing one step by
  hand, and every chat result opens in the page that made it.
- Direction (decided by the user): Apple's current glass language for the chrome,
  in black and white only, so the pictures are the only colour on screen; dark
  appearance; the system font (San Francisco on a Mac). Chat first: research,
  then plan, then execute.
- Stack: the project's own. React 19 + Vite, CSS Modules, react-aria-components,
  lucide-react. No Next, no GSAP, no Lenis, no WebGL. CSS transitions and the
  Web Animations API only.

## 1. Concept card

```
Idea:        A screening room in black and white. The frame on screen is the
             only colour in it.
Metaphor:    A darkened grading suite with the house lights down: matte black
             walls, grey glass fixtures (the console, the door, the monitor
             bezel), and one projected frame. The glass is film stock, not a
             coloured filter.
Signature:   The ambient backdrop, in greyscale. A heavily blurred, dimmed,
             desaturated copy of the current frame (source render or finished
             take) sits under the page. The glass top bar and toolbars refract
             it as light and shade, never as hue, so when a take finishes the
             room's brightness changes with it (one 1.2 s cross-fade) and the
             picture stays the only colour. Glass is justified because there is
             always imagery behind it. On the chat page the room is quieter: a
             solid canvas, one reading column, a glass composer.
Emotion:     Calm, expensive, in control. The images are the only loud thing.
Motion verb: "Settle like glass": quick ease-out, a 2% spring on panels and the
             nav indicator, never a bounce. Big things move slower than small.
Screenshot:  1440 wide, Chat: a solid black canvas with one reading column, a
             quote card with a white "Run for 390 credits" button, a run card
             counting through its steps by glyph, the glass composer at the foot
             and the glass top bar with its one menu button above. Or the Still
             page: the film still on a black stage, the glass inspector beside it.
At rest:     Still. Nothing drifts while the pointer is idle. The life is in the
             ambient reacting to results, and in hover, press and focus feedback.
             (A deliberate decision: an image tool must not compete with images.)
```

Genericness test: "glassmorphism everywhere" and "dark + one accent" are listed
AI defaults. What makes this not that: glass is restricted to chrome (section
2.4 says exactly which elements) and is earned by the ambient backdrop; content
sits on solid surfaces; there is no accent hue at all (the primary action and
the selected state are solid white with black text, status is a glyph plus a
word, and the pictures supply every colour); the type is the system face with
Apple's own scale rather than a downloaded grotesk; the IA is a conversation
first, with the pages behind one menu button, which is this app's story: ask,
read the quote, approve, and open the result where it was made.

## 2. Foundations

Every colour, radius, duration and font comes from a token in
`src/client/styles/tokens.css`. The `--bay-*` names stay (fifty CSS modules read
them); Phase 8 re-pointed their values and added `--glass-*`, `--text-*`,
`--track-*`, `--r-*`, `--ease-*`, `--dur-*`, and Phase 13 made every one of them
neutral. Never hard-code a colour in a module: `grep -E "#[0-9a-fA-F]{3,8}\b|rgba?\([0-9]"
src/client/**/*.module.css` must print nothing (`rgba(var(--bay-accent-rgb), x)`
is allowed, and since the accent is white it means white at alpha x). Chrome has
no hue: every token is a grey with equal channels (R=G=B), the only colour on
screen is a picture, and `.router/monochrome-tokens.mjs` and the shooter's
monochrome gate (section 6) check it.

### 2.1 Appearance: dark only

`index.html` pins `<html lang="en" data-theme="dark">` and
`<meta name="theme-color" content="#0b0b0b">`; `:root { color-scheme: dark }`.
There is no light block and no OS-following. Reasons: images read best on dark;
glass needs imagery behind it to be glass (on a flat light page it is a grey
rectangle); one appearance halves the QA surface so the budget goes to
usability. The `[data-stage]` attribute stays on the stage column (pages set
it) and remaps only the surface tokens to the deeper stage values below.
Black and white is the same reasoning taken to the end: a picture cannot be
judged against a tinted frame, and with no hue in the chrome nothing competes
with its colour.

### 2.2 Palette

Every value has equal channels. Contrast is against `--bay-bg-surface` unless
stated (computed, WCAG relative luminance).

| Role | Token | Value | Notes |
|---|---|---|---|
| ground (the room) | `--bay-bg-canvas` | `#0b0b0b` | Under the ambient, and the chat page's own canvas. Solid when transparency is reduced |
| surface (inspector, cards) | `--bay-bg-surface` | `#161616` | Inspector uses it at 94% (`color-mix`), no blur |
| subtle (hover, step marker) | `--bay-bg-subtle` | `#1f1f1f` | |
| sunken (inputs, tracks) | `--bay-bg-sunken` | `#0f0f0f` | |
| stage scrim | `--bay-stage-bg` | `rgba(0, 0, 0, 0.5)` | The screening room over the ambient |
| stage frame | `--bay-stage-frame` | `#000000` | Behind every image on the stage |
| stage raised / line | `--bay-stage-raised` / `--bay-stage-line` | `#101010` / `rgba(255,255,255,0.08)` | |
| ink | `--bay-text` | `#f5f5f5` | 16.6:1 |
| ink 2 | `--bay-text-2` | `#c2c2c2` | 10.2:1 |
| ink 3 (muted, captions) | `--bay-text-3` | `#9a9a9a` | 6.4:1, the floor for 12 to 13 px text on a solid surface; never on glass |
| ink 4 (decorative only) | `--bay-text-4` | `#747474` | 3.9:1. Never for text that must be read |
| ink 5 | `--bay-text-5` | `#3d3d3d` | Disabled glyphs, always with a reason in words |
| hairline | `--bay-border-hair` | `rgba(255,255,255,0.08)` | |
| line | `--bay-border` | `rgba(255,255,255,0.14)` | |
| line strong | `--bay-border-strong` | `rgba(255,255,255,0.36)` | 3.35:1, which passes WCAG 1.4.11 (3:1) |
| accent (solid white) | `--bay-accent` | `#f5f5f5` | Not a hue: the fill of the one primary action and of the selected state, always with `--bay-text-on-accent` on it |
| accent hover | `--bay-accent-hover` | `#ffffff` | |
| accent soft | `--bay-accent-soft` | `rgba(255,255,255,0.14)` | A wash, 1.5:1 against surface: never the only cue for selection |
| accent as text | `--bay-accent-fg` | `#f5f5f5` | Ink. Colour cannot say "current", so a glyph, a fill or a weight does |
| accent rgb | `--bay-accent-rgb` | `245, 245, 245` | For rings, sweeps and veils: `rgba(var(--bay-accent-rgb), a)` |
| on accent | `--bay-text-on-accent` | `#0b0b0b` | Black on the white fill: 18.1:1 |
| focus | `--bay-border-focus` | `#f5f5f5` | A two-tone ring, section 2.8 |
| ok, warn, err, info | `--bay-ok-bg` / `--bay-ok-fg` (and `warn`, `err`, `info`) | `#1f1f1f` / `#f5f5f5`, all four the same | Status has no hue. The glyph and the word say which; section 2.9 |
| brand mark | `--bay-brand` / `--bay-brand-fg` | `rgba(255,255,255,0.10)` / `#f5f5f5` | A glass tile with the aperture glyph in white |
| avatars | `--bay-app-<name>-bg` / `-fg` | `#1f1f1f` or `#2a2a2a` / `#f5f5f5` | The nine pairs from `@runway/bay-react/tokens.css`, re-declared as greys |

Selection: `::selection { background: rgba(var(--bay-accent-rgb), 0.28); color:
var(--bay-text-on-accent) }`. Scrollbars: `scrollbar-width: thin; scrollbar-color:
var(--bay-border-strong) transparent`. Links are ink with an underline, always
(`a { color: var(--bay-text); text-decoration: underline; text-underline-offset:
2px }`); with no hue, the line says "link".

White fills are reserved for primary and selected, so an error never takes one.

### 2.3 Glass material

Glass is for chrome that sits over imagery: it is translucent, blurred, dimmed
and grayscaled, with a specular top edge and a soft shadow. Three thicknesses,
one recipe, global classes in `src/client/styles/glass.css` (the one sanctioned
exception to "CSS Modules only": a material is shared by design).

```
--glass-fill:        rgba(22, 22, 22, 0.72)   .glass        top bar, the Still modes row
--glass-fill-thick:  rgba(22, 22, 22, 0.84)   .glass-thick  composer, inspector, sheets, dialogs, popovers, menus (text-heavy)
--glass-fill-thin:   rgba(22, 22, 22, 0.60)   .glass-thin   the stage toolbar pill (icon buttons and short labels)
--glass-blur:        24px  (thin: 16px)
--glass-saturate:    0
--glass-dim:         0.55
--glass-edge:        inset 0 1px 0 rgba(255,255,255,0.14), inset 0 0 0 1px rgba(255,255,255,0.06)
--glass-shadow:      0 12px 40px rgba(0, 0, 0, 0.45)
--glass-solid:       #161616   (the fallback fill)
--glass-btn:         rgba(255,255,255,0.08)  hover 0.12  pressed 0.16  selected 0.14
```

Rules:
- `backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate))
  brightness(var(--glass-dim)) grayscale(1)` with the `-webkit-` twin. Saturate 0
  and `grayscale(1)` mean a coloured render behind the glass shows as light and
  shade only, so it can never tint the chrome. `brightness(var(--glass-dim))`
  keeps a white render from washing the text out. `@supports not
  ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))` →
  `background: var(--glass-solid)`.
- `@media (prefers-reduced-transparency: reduce)` and `@media (prefers-contrast:
  more)` → no backdrop filter, `background: var(--glass-solid)` and a 1 px
  `--bay-border-strong` border to hold the edge; the ambient backdrop is not
  rendered. `@media (forced-colors: active)` adds a transparent 1 px border,
  because forced colours drop `box-shadow`. The shooter asserts zero elements with
  a computed `backdrop-filter` under reduced transparency.
- Text on glass is always `--bay-text` or `--bay-text-2`. Worst case is a white
  picture behind it, with the dim at .55 (`brightness()` multiplies the sRGB
  values; WCAG does not define sampling over live imagery, so this is the
  lightest backdrop, computed):

  | Glass | Ink 1 | Ink 2 | Ink 3 |
  |---|---|---|---|
  | regular .72 | 10.9:1 | 6.7:1 | 4.2:1 |
  | thick .84 | 13.3:1 | 8.2:1 | 5.2:1 |
  | thin .60 | 8.8:1 | 5.4:1 | 3.4:1 |

  Without the dim, thin glass gave ink 1 only 2.5:1 over white. Never put
  `--bay-text-3` on `.glass-thin`, and a selected fill of .14 is 1.5:1, so
  selection always has a second cue (a check, a ring or a solid white fill).
- Never glass on glass. A dialog over the top bar is fine (the overlay scrim
  separates them); a glass card inside a glass panel is not.
- Never glass under scrolling content lists, form fields or images. The
  inspector, cards, inputs, the stage and the chat transcript are solid or
  scrimmed, not blurred.
- At most six glass surfaces on screen at once. Blur radius never animates.
- Continuous corners: `@supports (corner-shape: squircle) { corner-shape: squircle }`
  on every glass surface and card. Radii: `--r-control 10px`, `--r-card 14px`,
  `--r-panel 20px`, `--r-bar 28px`, `--r-pill 999px`. Aliases: `--bay-r-xs 6`,
  `--bay-r-sm 8`, `--bay-r-md 10`, `--bay-r-lg 14`, `--bay-r-xl 20`.

### 2.4 Where glass goes (and nowhere else)

Phase 9 assigned the three thicknesses by role, and Phase 13 took the dock away:

- `.glass` (72%): the top bar, and the Still page's row of modes under it.
- `.glass-thick` (84%, text-heavy surfaces): the inspector, the chat composer,
  the page menu's popover and the phone's bottom sheet, the chat page's phone
  "Chats" sheet, dialogs (`ConfirmDialog`, `ChooserDialog`, the
  `FullscreenDialog` aside), popovers (`Select`, `UserMenu`, the activity
  popover), and Settings' centred sheet.
- `.glass-thin` (60%, icon buttons and short labels): the strip (the filmstrip
  of takes, frames or clips), the canvas toolbar, the actions pill under the
  caption, the hidden-inspector pill, the `Lightbox` bar.

Never glass: the chat transcript and its cards (quote, run, result: solid
surfaces on the solid canvas), library, take and frame cards, form fields,
alerts, the picture and its frame, images, text blocks. The activity pill is a
`--glass-btn` control fill sitting on the top bar, not a glass surface of its
own.

The inspector is the one place 2.3's "never glass under form fields" relaxes
(decision 3 in section 8). Its fields keep their own solid sunken fill and
border; text on it is ink 1 or 2; the scroller is a child of the glass element,
so the blur never scrolls; a card inside the inspector is a solid surface (no
glass on glass). At rest a desktop Workspace page asks for six glass surfaces:
top bar, inspector, strip, canvas toolbar, actions pill and (on Still) the modes
row. The chat page asks for two: the top bar and the composer.

### 2.5 Ambient backdrop (the signature)

`src/client/lib/ambient.tsx`: `AmbientProvider`, `useAmbient(url, active)`.
The shell renders `<div class="ambient" aria-hidden>` fixed at z-index 0 with
two stacked `<img>` layers. Setting a new url loads it in the hidden layer,
then cross-fades (`opacity` 1200 ms `--ease-out`). Image CSS:
`object-fit: cover; transform: scale(1.2); filter: blur(48px) saturate(0)
brightness(0.3)`, so the room takes the frame's light and none of its colour. Pages pass a thumbnail url (`stillThumbUrl`), never a
full-size image. Under reduced motion the swap is instant. Under reduced
transparency, or without backdrop-filter support, the layer is not rendered
and the ground is solid `#0b0b0b`. Default when a page sets nothing: a static
radial gradient `radial-gradient(60% 50% at 30% 20%, #171717, #0b0b0b)`.

Who sets it: Stills = result, else the source render; Video = the selected
take's still, else the picked still; Lifestyle = the take on the big screen,
else the first project render; Director = the viewed frame, else the first
image; Close-ups (a Still mode) = the current shot, else the source; Location
(a Still mode) = result, else the screenshot; Editing = the preview clip's
thumb, else the first timeline clip; Chat, Library and Settings = none (the
default gradient; the chat page paints its own solid canvas over it). Only the
active page's call wins (the hook ignores inactive pages).

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
| Menu item (the page list) | item fill to `--glass-btn-hover`; the current page wears a check and a 2 px border | fill 0.16 | the same; no motion to remove |
| Still modes (a segmented row) | hovered mode fill 0.06; the selected mode is solid white, and its indicator slides to the next (translate, `--dur-3` spring) | indicator fill to `--bay-accent-hover` | indicator jumps |
| Primary button | solid white to full `--bay-accent-hover` with a dark inset line (`color-mix` of the stage frame at 40%) and `translateY(-1px)`; no glow, since white on white shows none | `scale(0.98)`, no lift | colour change only |
| Default and ghost buttons | glass-btn fill 0.08 to 0.12 | 0.16 and `scale(0.98)` | fill change |
| Cards, thumbnails, takes | image `scale(1.03)` inside its clipped frame, card `translateY(-2px)` | selected: a 2 px white ring and a check glyph in the corner (a ring alone reads as hover) | ring, check and border only |
| Inline links | underline at rest (1 px, ink), 2 px on hover | | same |
| Segmented control | hovered segment fill 0.06 | selected segment slides (shared indicator) | jumps |
| Switch, slider knob | knob shadow deepens | knob `scale(1.05)` | colour only |
| Dialog, popover, sheet | enter `opacity 0→1`, `translateY(8px)→0`, `scale(0.98)→1`, `--dur-3` spring (sheet: from `translateY(24px)`, `--dur-4`); exit 160 ms | | opacity only |
| Page switch | the newly active panel runs `panelIn`: `opacity 0→1`, `translateY(6px)→0`, 200 ms ease-out | | opacity only |
| Rendering | the existing `RenderingStatus` sweep (2.4 s loop, a white band at 0.18); the activity pill reuses a 3 px version | | the sweep stops; the label and timer remain |

Every hover state is also the `[data-focus-visible]` / `:focus-visible` state,
plus the ring. Hover rules live under `@media (hover: hover)` or react-aria's
`[data-hovered]` (which already ignores touch).

### 2.8 Focus, targets, keyboard

- Ring: two tones, so it reads over a white render and over a black one. A 2 px
  `--bay-border-focus` (white) outline hugs the box and a black halo shows from 2
  to 4 px outside it: `outline: 2px solid var(--bay-border-focus); outline-offset:
  0; box-shadow: 0 0 0 4px #0b0b0b` on `:focus-visible` and react-aria
  `[data-focus-visible]` (global.css; any offset would slide the outline over the
  halo). Inputs show the ring as a white `border-color: var(--bay-accent)` with
  the same halo. Primary buttons and controls that already carry an inset line
  keep it and add the halo's outer band.
- Targets: 24 px minimum everywhere, 36 px for toolbar buttons, 44 px for the
  primary action and every finger target on a phone. Icon-only buttons carry
  `aria-label`.
- A skip link ("Skip to content") is the first element in the DOM; it focuses
  `<main id="main" tabindex="-1">` with `preventDefault` (a `#main` hash would
  be read as a page id by the router).
- After a navigation, focus moves to `main` (`focus({ preventScroll: true })`).
- Hidden pages use the `hidden` attribute, so nothing inside them is focusable.
- Document title per page: `<Page label> · Render to Film`.
- Live regions: the chat transcript is a `role="log"` (polite, appended at the
  end); a Run's status line is its own `role="status"`; `role="alert"` is for
  blocking errors only and is never inserted already populated.

### 2.9 States without colour

Hue carries no meaning, so every state is a shape, a word and a border, never a
colour (Apple: "UI should not convey information using color alone"; Carbon:
status relies on at least two of colour, shape, symbol, with an icon and a
label). From research Q5:

| State | Treatment |
|---|---|
| Primary | Solid white, black text, one per view |
| Selected | Solid white, or a check glyph plus a 2 px border |
| Focus | 2 px white plus 2 px black outer ring |
| Disabled | Ink 5 plus "not available" reason text |
| Running | Label and elapsed time; static under reduced motion; a pause control if it moves for more than 5 s |
| Success | Check glyph plus label |
| Warning | Triangle glyph, dashed strong border, label |
| Error | Octagon glyph, 2 px white border, "Failed:" text, `role=alert` for blocking ones only |

Rules: white fills are reserved for primary and selected, so an error never uses
one. Where a component has not yet reached a row (`Alert` draws all four tones as
one grey tile with an icon and words; the dashed warning and 2 px error borders
are the target the monochrome sweep, PLAN-13 T34, applies), the glyph and the
label already carry the state. Run cards show each Step by glyph (`StateGlyph`:
pending dashed circle, running spinner, done check, failed octagon, waiting
pause, "not sure it was sent" question mark) with the word beside it.
Streaming text stays outside the live region or under `aria-busy`, and a
finished message is announced once.

## 3. Layout

### 3.1 Shell

Phase 9: the picture fills the window and everything else floats over it.
Phase 13: the chat is the home page and there is no dock. The top bar is 48 px and
`.glass` at every width, and it holds the only navigation: one menu button. The
Still page adds a 44 px row of modes under it. From 900 the inspector floats at the
right (from 900 to 1199 it overlays the canvas); under 900 it becomes a bottom
sheet.

```
>= 1200 (desktop), a Workspace page (Still shown)
┌──────────────────────────────────────────────────────────────────────────────┐
│ (o) Render to Film                 Still             [rendering] [menu] (me) │
├──────────────────────────────────────────────────────────────────────────────┤
│           [ Still | Close-ups | Location ]      (Still only: --app-subnav)   │
│                                                                              │
│  ╭───────────╮                                   ╭────────────────────────╮  │
│  │ toolbar   │                                   │ head            [hide] │  │
│  ╰───────────╯                                   ├────────────────────────┤  │
│                                                  │ h1 and description     │  │
│      ┌────────────────────────────────────┐      │ 1  step                │  │
│      │                                    │      │ 2  step                │  │
│      │   picture, contain-fit in          │      │ 3  step                │  │
│      │   the area left free               │      │ ... (the body scrolls) │  │
│      │                                    │      │                        │  │
│      └────────────────────────────────────┘      │                        │  │
│                     caption                      │                        │  │
│           ╭──────────────────────────╮           │                        │  │
│           │ Download   Make a video  │           │                        │  │
│           ╰──────────────────────────╯           │                        │  │
│  ╭────────────────────────────────────────────╮  │                        │  │
│  │ [ ] [ ] [ ] [ ] [ ]   takes strip          │  ├────────────────────────┤  │
│  ╰────────────────────────────────────────────╯  │ [      Shoot      ]    │  │
│                                                  │ cost line              │  │
│                                                  ╰────────────────────────╯  │
└──────────────────────────────────────────────────────────────────────────────┘
```

```
900 to 1199 (tablet)                                             < 900 (phone)
┌────────────────────────────────────────────────────────────┐   ┌────────────────────────┐
│ (o) Render to Film        Still    [rendering] [menu] (me) │   │ top bar 48 [menu] (me) │
├────────────────────────────────────────────────────────────┤   ├────────────────────────┤
│             [ Still | Close-ups | Location ]               │   │ ┌────────────────────┐ │
│                                                            │   │ │ canvas             │ │
│  ╭─────────╮                      ╭─────────────────╮      │   │ └────────────────────┘ │
│  │ toolbar │                      │ inspector 360   │      │   │ ╭────────────────────╮ │
│  ╰─────────╯                      │                 │      │   │ │ [ ] [ ] [ ] [ ]    │ │
│                                   │                 │      │   │ ╰────────────────────╯ │
│                                   │                 │      │   ├───── grabber ──────────┤
│  ┌─────────────────────┐          │                 │      │   │ sheet (peek)           │
│  │ picture             │          │                 │      │   │ [     Primary     ]    │
│  │ (the inspector      │          ├─────────────────┤      │   └────────────────────────┘
│  │ overlays it)        │          │ [ Shoot ]       │      │
│  └─────────────────────┘          ╰─────────────────╯      │
│                                                            │
│  ╭──────────────────────────────────╮                      │
│  │ [ ] [ ] [ ] [ ] [ ]  strip       │                      │
│  ╰──────────────────────────────────╯                      │
└────────────────────────────────────────────────────────────┘
```

```
Chat, from 900 (the home page: solid canvas, one column, a glass composer)
┌──────────────────────────────────────────────────────────────────────────────┐
│ (o) Render to Film                  Chat             [rendering] [menu] (me) │
├─────────────────┬────────────────────────────────────────────────────────────┤
│ Chats           │            one reading column, 792 px                      │
│ [ New chat ]    │  you        six renders, "Make a one-minute lifestyle film"│
│ > Lake house    │  assistant  words, then a quiet line of what it did        │
│   Tower 2       │  ┌ Quote ───────────────────────────────────────────┐      │
│                 │  │ Lifestyle film   60 s   Total 390 credits        │      │
│                 │  │ [ Run for 390 credits ]   Change   29:41         │      │
│                 │  └──────────────────────────────────────────────────┘      │
│                 │  ┌ Run ─────────────────────────────────────────────┐      │
│                 │  │ Making clips   ━━━━━━━━──────   58%              │      │
│                 │  │ v plan  v cast  v stills  o direct  - clips      │      │
│                 │  └──────────────────────────────────────────────────┘      │
│                 │ ╭────────────────────────────────────────────────────╮     │
│                 │ │ [pic][pic]                                         │     │
│                 │ │ Say what you need                         [^]      │     │
│                 │ ╰────────────────────────────────────────────────────╯     │
└─────────────────┴────────────────────────────────────────────────────────────┘
```

- `AppShell` owns: the skip link, the ambient layer, `TopBar`, the `RunWaitNotice`
  and `<main id="main" tabIndex={-1}>` (inside the `ErrorBoundary`). `Nav.tsx`
  exports `TopBar`, `ActivityPill` and `ActivityPanel`; the sidebar, icon rail,
  dock, phone tab bar and Shoot sheet are gone. `main` has no margin:
  `padding-top: calc(var(--app-header) + var(--app-subnav))`.
- Shell variables, set on the shell root: `--app-header: 48px` at every width;
  `--app-subnav: 44px` on the Still page (its row of modes) and 0 elsewhere;
  `--app-dock` and `--app-bottom` stay defined, at 0, so the Workspace's
  formulas hold. `Workspace.module.css` reads all of them.
- `TopBar`: `<header>` fixed to the top, full width, above the Workspace, in three
  columns so the page's name stays centred. Left: the brand, a real link home
  (`<a href="#chat" aria-label="Render to Film, go to Chat">`: the mark and
  "Render to Film", headline 600; the words hide under 480 px). Centre: the
  current page's label (subhead, `--bay-text-2`, a `<span>`, never a heading).
  Right: the activity pill when something renders (a button that opens a popover
  of every Run at a glance, `RunTray`, above a link to the library), `#tray-slot`
  (the chat page portals its newest live Run into it from 1100 px), the menu
  button, then the user menu (avatar only under 600 px).
- The menu button: a 36 px ghost icon button (`Menu`, `aria-label="Pages"`,
  `aria-haspopup="menu"`). It opens the page list in a `.glass-thick` popover, and
  under `PHONE_QUERY` in a bottom sheet titled "Pages" with a Close button. Each
  item is a real `<a href="#id">`, 56 px tall: a 20 px icon, the label, and the
  page's one-line purpose in ink 2; the current page wears a check and a 2 px
  border (and ", current page" for a screen reader), the hover fill is
  `--glass-btn-hover`. Settings is in the list, and Chat is not: the brand links
  there.
- Only the top bar, the Still modes row and the chat page are `position: fixed`
  (the chat page is `fixed; inset: 0` on its own canvas so a long conversation
  scrolls inside it and the window stays put). Every other page's Workspace root
  is `position: relative; height: calc(100dvh - var(--app-header) -
  var(--app-subnav) - var(--app-bottom))` and its panels are `absolute` inside
  it: every page panel animates with `transform`, and a transformed ancestor
  re-parents fixed descendants (decision 2 in section 8). The `panelIn`
  animation is opacity only.
- Library is a Workspace with a `free` canvas (a contact sheet) and an
  inspector for the selected item. Settings is not a Workspace: a centred
  `.glass-thick` sheet (760 px, radius `--r-panel`, solid cards inside) over the
  ambient; on a phone it is full width with 16 px margins.

### 3.2 Information architecture

The chat is the home page: `DEFAULT_PAGE = 'chat'` in `src/client/nav.ts`, so a bare
address, or a hash naming no page, opens it. Every other page is behind the menu
button, in this order (ids are the existing hash ids; deep links do not change):

```
HOME       Chat #chat                    (the brand links here; not in the menu)
MENU       Director #director · Lifestyle #lifestyle · Still #stills · Video #video
           · Editing #edit · Library #library · Settings #settings
(top bar)  brand · current page label · [activity pill when something renders]
           · menu button · user menu
```

Director, Lifestyle, Still, Video, Editing, Library, Settings: that is the order
the menu lists them in. Page ids never change, labels do: Still is `stills` and
Editing is `edit`. Nav items are real `<a href="#id">` links, so the back button
steps between pages.

**Still has modes.** Close-ups and Location are modes of Still, a row of three
under the top bar (`src/client/StillModes.tsx`, a segmented control, `--app-subnav`):
Still, Close-ups, Location. The mode rides in the address: `#stills?mode=closeups`
and `#stills?mode=location`; no mode, or one that is not a mode, is Still. The old
addresses alias to them (`#closeups` → `#stills?mode=closeups`, `#location` and
`#surroundings` → `#stills?mode=location`) and are rewritten in place, so a bookmark
keeps working and a reload lands in the same place. All three modes stay mounted;
one that is not showing counts as a hidden page for `useAmbient` and the
Workspace's keys.

**Handoffs.** The address is the payload: `#<page>?k=v`, so a chat result or
another page can send the user anywhere with a selection loaded
(`src/client/handoff.ts`, which `nav.ts` and `App.tsx` read).

- `parseHash('#lifestyle?job=abc&frame=3')` is `{ page: 'lifestyle', params: { job:
  'abc', frame: '3' } }`.
- `formatHash(page, params)` is `#page`, or `#page?k=v` with the keys sorted, so one
  handoff is one address. Values are URI-encoded.
- Keys that may ride: `job, frame, still, clip, export, mode, preset, q, gallery`.
  Anything else is dropped on the way in. No hash, or a hash naming no page, is
  `chat` with no params. `closeups|location|surroundings` alias to `stills?mode=…`.
- `GoTo = (page, params?) => void` is what `App` hands to a page that links out;
  the chat page and the top bar write the hash directly, so Back returns to them.
- Who reads what: Lifestyle `job` and `frame`; Director `job`; Still modes `mode`,
  and Close-ups `job`, `clip`, `still`, Location `still`; Video `still`, `clip`
  (a reference clip) and `preset` (a whole Video preset as JSON, accepted by
  `parseVideoPreset` whole or not at all); Editing `clip` and `export`; Library
  `q`, `still`, `clip`; Chat `gallery=1` (the chat's cards on their own, for the
  shooter). A chat result's "Open in Editing" is `#edit?export=<id>`.

Short purposes (copy in the menu, from `nav.ts`): Chat "Drop renders and say what
you need"; Director "A storyboard shot from your project images"; Lifestyle "A
whole project, with the people who live there"; Still "One render into a film
still, close-ups and locations"; Video "Bring a still to life, or recreate a clip
in 4K"; Editing "Cut, grade and export the film"; Library "Everything you have
made"; Settings "Accounts, models and connections".

Rejected in Phase 8: Create / Plan / Finish (Director, Close-ups and Location all
render images; "Plan" misdescribes them), and nine items in one row (the
problem). Retired in Phase 13: the floating dock, the phone tab bar and the Shoot
sheet. With the chat as home, one menu button reaches every page and the picture
keeps the whole window.

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
canvas area is also a drop zone (a solid 2 px white inset ring with a
white wash while dragging over; it never captures clicks).

**Picture, caption and guides.** The frame (`.picture`) is sized by the page's
`aspectRatio`, contain-fit into the area left free by the inspector and strip: black `--bay-stage-frame`, radius `--r-card`, the one deep shadow
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
Takes, Frames, Timeline) at the foot of the canvas, left of the inspector: radius
`--r-panel`, padding 8. Its content scrolls sideways (`scroll-snap-type: x
proximity`, 8 px gaps). Height is 112 px, or 164 px for a timeline (96 and 148
on a phone). A page with no strip gives the picture that room.

**Tablet (900 to 1199).** The inspector is 360 px and overlays the canvas and
strip, which keep the window edge; its bottom stops above the strip so the
strip stays visible under it.

**Small landscape (480 to 899, landscape).** A landscape window under 900
px (a small window, a phone on its side) gets the desktop arrangement: the inspector is `clamp(256px, 42vw, 340px)`, full height
beside the canvas and the strip.

**Short window (under 640 tall, any layout but the phone).** The picture keeps
the height: gaps are 8 px, `--fit-pad` 12 px, the strip 84 px (128 for a
timeline), the caption is
hidden and the picture's actions move into the toolbar band at its right
(left of the Show pill when the inspector is hidden), so nothing sits under
the picture. Editing does the same for its player: its buttons at the canvas's
top left, only an out-of-date export's warning under the transport.

**Phone (under 480, or portrait under 900).** One query, `PHONE_QUERY` in
`layouts/Workspace.tsx`, and the same media list in every stylesheet:
`(width < 480px), (width < 900px) and (orientation: portrait)`. The Workspace
is a column: the canvas (contain-fit,
12 px padding), the strip (static, 12 px side margins), and the inspector as a
bottom sheet over the foot of the column. The sheet has top
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
12 px; inline groups 8 px. Strip padding 8 px with 8 px between cards. Top bar
48 px; the Still modes row 44 px. Cards in a free
canvas grid: `repeat(auto-fill, minmax(240px, 1fr))` with 16 px gaps (Library's
contact sheet is tighter: `minmax(200px, 1fr)`, 8 px gaps, two columns on a
phone); content measure 1680 px centred.

## 4. Components (`src/client/ui/`)

Built on react-aria-components; states through data attributes; one
`.module.css` per component. Sizes and states that every control must have:

| Component | Size | Rest | Hover | Pressed / selected | Disabled | Focus |
|---|---|---|---|---|---|---|
| `Button` primary | sm 28 / md 36 / lg 44 px; radius `--r-control`; callout 500 | solid white, black text | full white, dark inset line, lift 1 px | scale 0.98 | no fill, ink 2 and a strong line (waiting, not broken) | ring |
| `Button` default | same | glass-btn 0.08 + edge | 0.12 | 0.16 + scale 0.98 | opacity 0.45 | ring |
| `Button` ghost | same | transparent, `--bay-text-2` | 0.08, `--bay-text` | 0.12 | | ring |
| `Button` danger | same | transparent, ink, a 2 px white line (white fills are for primary and selected) | | scale 0.98 | | ring |
| `TextInput`, `TextArea`, `NumberInput`, `Select` trigger | 40 px (textarea auto); radius `--r-control`; sunken fill; 1 px `--bay-border` | border strong | | opacity 0.55 | white border + the two-tone ring |
| `Select` popover, `UserMenu` popover | glass-thick, radius `--r-card`, 6 px padding; items 32 px radius 8, subhead | item fill 0.08 | selected: a 2 px inset white ring, weight 600 and a check | | ring on item |
| `Switch` | track 36×22, knob 18 ink | knob shadow | on: white track, black knob | 0.45 | ring on track |
| `Slider` | track 4 px sunken, fill white, knob 20 ink with a 2 px canvas ring | | knob scale 1.05 | | ring on knob |
| `Tabs` (segmented, Video modes) | track glass-btn 0.06 radius 10, segments 32 px radius 8, callout 500 | 0.06 | selected 0.14 + edge, slides | | ring on segment |
| `FilterChips`, `TagEditor`, `ToggleButton` | pill 28 px, glass-btn, subhead | 0.12 | selected: solid white, black text and a check | 0.45 | ring |
| `ImagePicker`, `TakeStrip`, library card | radius `--r-card`, surface fill, hairline | image scale 1.03, lift 2 px | selected: a 2 px white ring and a check | | ring |
| `ImageDropZone` | radius `--r-card`, dashed `--bay-border-strong` when empty | fill subtle | drag-over: a solid white ring and a white wash | | ring |
| `Alert` | radius 12, subhead; tone fills from tokens; icon 16 | | | | |
| `EmptyState` | title headline `--bay-text-2`, hint callout `--bay-text-3`, 56 px padding | | | | |
| `Skeleton` | subtle fill, 1.6 s shimmer (none under reduced motion) | | | | |
| `RenderingStatus` | the sweep (white at 0.18), label subhead, timer footnote tabular | | | | |
| `ConfirmDialog`, `ChooserDialog` | glass-thick, radius `--r-panel`, 24 px padding, title title-2; overlay `rgba(0,0,0,0.6)` | | | | focus starts on Cancel |
| `Lightbox` | overlay `rgba(0,0,0,0.92)`, image crisp, bar = glass-thin pill | | | | Escape closes |
| `FullscreenDialog` | stage black, aside = glass-thick 360 px | | | | arrows step |
| `UserMenu` chip | avatar 28 (a grey tile, white initials) + name headline 500; at the right of the top bar | glass-btn 0.08 | | | ring |
| `Composer` | glass-thick bar at the foot of the chat page; field grows to six lines; one round button sends, or stops a live Turn | | | | send needs text or a file | ring |
| `QuoteCard`, `RunCard`, `ResultCard` | solid surface, hairline, radius `--r-card`, on the chat canvas; one primary per card; section 8.6 | | | | | ring |

Add a control: `.tsx` + `.module.css`, props `foo?: T | undefined`, a row here.
Icons: lucide only, `size` always set (18 in nav, 16 in md buttons, 14 in sm).
Never emoji.

## 5. Copy

Sentence case. No em or en dashes in visible text (use a colon, a comma or a
new sentence). No filler verbs. Device-neutral ("choose", not "click" or
"tap"). Existing page copy stays unless it is wrong; the page purposes above are the
only new strings the shell introduces.

## 6. QA (the bar every task meets)

Tooling: `.router/ui/shoot.cjs` (built in G1) against the spare simulator
(`…/scratchpad/spare/dev.mjs`: Vite :5193, API :3021). Never :5173 or :3001.
A tab is a page id (`chat`, `stills`, `settings`, ...) or a Still mode
(`stills:closeups`, `stills:location`); `--tabs all` is the ten of `ALL_TABS`, chat
first, and `#chat?gallery=1` shows the chat's cards on their own for it. Per touched
tab it writes `d-*` (1440), `m-*` (390), `r-*` (reduced motion),
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
- monochrome (unless `--no-mono`): every element in the page and the shell that
  is not an `img`, `video`, `canvas` or `svg` or inside `[data-picture]`, and is
  on screen, has `color`, `background-color`, `border-color` and `outline-color`
  with `max(r,g,b) - min(r,g,b) <= 2` wherever the colour is opaque (alpha >
  .05); up to ten offenders are listed with selector, property and value, so the
  pictures are the only colour on screen. `node .router/monochrome-tokens.mjs`
  covers the style files as text with no browser: every token has equal
  channels, the T6a values are pinned, glass carries `grayscale(1)` and the
  dim, and `prefers-reduced-transparency`, `prefers-contrast` and
  `forced-colors` are handled

Then the human checks: look at every screenshot; the chrome has no hue and the
picture is the only colour; the picture is the best frame; the canvas is never
empty on first view (a picture, a drop target or a grid); the phone layout is
composed, not squished; glass reads as glass over the ambient and as solid under
reduced transparency; no glass sits on glass; copy has no dashes.

Final passes: a full stress pass of every flow (G15), then a fresh critic
scoring from screenshots only (G16), fixes (G17), and a second critic (G18).
Phase 9 repeats the sequence on the canvas layout: the consistency, stress and
shooter pass (C8), a fresh critic from screenshots only (C9), then fixes (C10)
and a second critic until every category scores 8 or above.

## 7. Phase 8 as built

Where the build differs from the sections above, and why. Recorded in G14
from the builders' reports (`.router/PLAN.md`, "Phase 8 progress"). Where an
item and an earlier section disagree, the item wins, except that the sections
above now describe Phase 13: items about the sidebar, the dock, the tab bar and
the Shoot sheet (1, 2, 8 to 11), the colours and the default landing page are
historical, and sections 2, 3 and 8.5 win.

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
10. **Favicon.** Phase 13: `public/favicon.svg` (the aperture in white on a
    `#161616` tile) is the icon `index.html` declares, and `public/favicon.ico`
    (the same mark, 16/32/48 px, grey and white only) answers the dev server's
    `/favicon.ico`. Phase 8 declared no icon on purpose, so that
    `applyAppIdentity` (`src/routes.ts`) could add the deployed app's icon; it
    adds one only when the page has none, so the page's own mark now wins.
11. **Default landing page** was Lifestyle (orchestrator decision; overrode the
    plan's Director and the recommended Stills). Phase 13: it is Chat. Deep
    links unchanged.
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

## 8. Canvas layout (Phase 9) and the chat-first shell (Phase 13)

After Phase 8 the user saw that the layout was still two columns (a form on the
left, an empty black stage on the right; the nav had only moved from the top to
a sidebar) and asked for the entire layout to change. Chosen direction: a
full-screen canvas in dark glass, like Apple Photos editing or Higgsfield
Cinema Studio. The picture fills the window; the settings float on it in one
glass inspector you can hide; the pages were a floating glass dock at the
bottom (Phase 13 replaced it with one menu button, 8.5); takes sit in a
filmstrip at the foot of the canvas. Sections 2.1 to 2.3 and 2.5 to 2.9
(appearance, palette, glass recipes, ambient, type, motion, focus, states) hold
the Phase 13 black and white values; 2.4 and 3 describe the layout. Where an
earlier section still names the sidebar, the rail or the stage column (1, 2.7,
7), this section wins. The plans are `.router/PLAN.md`, "Phase 9", and
`.router/PLAN-13.md`.

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
   var(--app-header))` and its panels are `absolute`. Only the shell's top bar
   was fixed (with the dock and tab bar, until Phase 13; the Still modes row and
   the chat page are fixed now). `panelIn` loses its translate (opacity only) as a
   second guard.
3. **The inspector is `.glass-thick`.** The user asked for a glass panel, so 2.3's
   "never glass under fields" relaxes: fields keep their own solid fills on it,
   text on it is ink 1 or 2, and the scroller is a child of the glass element
   (the blur never scrolls). Cards inside the inspector are solid surface (no
   glass on glass).
4. **A floating dock** (Shoot, Animate, Finish, Library; Settings in the top
   bar) with a phone tab bar and Shoot sheet. Retired in Phase 13: one menu
   button replaced all three (8.5).
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
    deep links stay. The default landing page stayed `lifestyle` (Phase 13: `chat`).

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
tablet), and by `--app-dock` (0 since Phase 13), the strip and a gap at the
bottom. The inspector sits `--gap` from the top and right and `--app-dock` plus a
gap from the bottom.

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


### 8.5 Chat first (Phase 13, 2026-10-31)

The studio's way in becomes a conversation: drop renders, say what you need, read
the quote, say yes, and the film is made in the background. The plan is
`.router/PLAN-13.md`; this is what it decided for the screen.

1. **Chat is the home page.** `DEFAULT_PAGE = 'chat'` (`src/client/nav.ts`); the
   brand in the top bar links to `#chat`.
2. **One menu button, no dock.** The top bar's menu lists the other pages (3.1);
   the dock, the phone tab bar, the Shoot modes row and the Shoot sheet are gone.
   Order: Director, Lifestyle, Still, Video, Editing, Library, Settings. Labels
   change (Still, Editing), page ids do not.
3. **Close-ups and Location are modes of Still** (`#stills?mode=closeups`); the old
   addresses alias to them.
4. **The address is the payload** (3.2): a chat result opens the page that made
   it with the selection loaded, and a reload lands in the same place.
5. **Solid transcript, glass composer.** The conversation is solid canvas, with
   glass only on the composer, the top bar and the sheets (Apple: no glass in the
   content layer; research Q5).
6. **Black and white** (section 2). Status in the chat is a glyph plus a word,
   never colour; the one primary per card is solid white.
7. **Pages stay mounted.** The chat page keeps its thread, its polls and its
   drafts while another page shows.

### 8.6 The chat page (`src/client/ChatPage.tsx`, `src/client/chat/*`)

```
page         fixed, inset 0, on --bay-bg-canvas; grid 260 px rail | column from 900
rail         ThreadList: "New chat", then the conversations, newest first (under 900
             a "Chats" button in the column opens the same list in a glass-thick sheet)
column       one centred reading column, width min(100%, 792px), 16 px gutters
  title      (no thread yet) "Drop renders here and say what you need." title-3, ink 2
  Transcript the thread on the solid canvas (below)
  setup card (no Anthropic key) "Chat needs an Anthropic key", an Open Settings button
  foot       sticky at the bottom: the reconnecting line, then the Composer
drop ring    a file over the page: a 2 px focus-colour ring round all of it, "Drop to add"
```

- **Transcript.** Finished entries sit in a `role="log"` (polite, named
  "Conversation"), each read out once as it arrives; the streaming draft stays
  outside it under `aria-busy`, so a screen reader hears the finished message and
  never the words as they come. Replies take paragraphs and lists as markdown and
  no HTML; a URL stays text. A quiet line says what the assistant did (one short
  phrase per tool it used), a `details` that opens to each step with its time. A
  card ticks and moves, so it opts out of the log (`aria-live="off"`) and one
  plain sentence takes its place.
- **Composer.** A `.glass-thick` bar: thumbnails of the files going with the
  message (a failed one offers Retry and Remove), a field that grows to six lines
  (Enter sends, Shift+Enter starts a line, 4000 characters), an attach button for
  renders and music beds, and one round button that sends, or stops a live Turn.
  Paste an image and it joins the message. Escape while a Turn is live asks "Stop
  this answer?" first.
- **QuoteCard.** The priced proposal: the exact inputs (a thumbnail strip of the
  renders it works from), a line per item with its count, a Total, "Uses only what
  is in these renders.", a countdown to expiry, and one primary button, "Run for
  390 credits" (just "Run" at zero), beside a ghost "Change" that says what should
  change. Once decided the card shows how it ended by glyph and word: Approved,
  Declined, Replaced by a newer quote, Expired. The amount comes from the server's
  Quote and never from model text. On Bay, where rates are not known, the amount
  line reads "Billed to your Runway credits".
- **RunCard.** One Run as it moves: a headline and the line of what is happening
  now (`role="status"`), a thin progress bar (`role="progressbar"`), every Step by
  glyph with its word beside it, and, once it is done, the ways on as buttons: "Open
  in Editing" (the master, or the cut) first and primary, then "Open in Lifestyle".
  "Stop following" stops the card following the Run and says that a task already
  sent carries on.
- **ResultCard.** What a Run made, pictures first, each with the pages it can go
  on to: a still opens in Video or the Library, a clip in Editing or the Library,
  an export in Editing. Each is a handoff (3.2).
- **RunTray** (`#tray-slot` in the top bar, and the activity popover). Every live
  Run as a row: glyph, kind, line, percent; a row leads to what the Run made, else
  to the chat following it. From 1100 px the newest live Run shows in the top bar;
  below that the activity pill beside it opens the same list.
- **Reconnecting.** An always-present `role="status"` line over the composer reads
  "Reconnecting…" while the thread's poll keeps failing or the stream was lost; it
  takes no room while empty.
- **Gallery.** `#chat?gallery=1` renders the cards on their own, from fixed data,
  for the screenshot gate (`src/client/chat/cards.stories.tsx`).

## 9. Desktop (Phase 12, 2026-10-31)

The desktop app is this same client in an Electron window, so sections 2 to 8
apply as written. `desktop/README.md` covers the app; the plans are
`.router/PLAN.md`, "Phase 12", and `.router/PLAN-13.md`. Only these differ:

- On macOS the window has no title bar, so the glass top bar is the drag region
  and clears the traffic lights. The preload sets `html[data-desktop]`, and
  `src/client/layouts/AppShell.module.css` holds the rule.
- The selects show only what the chosen provider offers (`useCapabilities`). A
  saved model it does not offer shows `ui/ModelUnavailable` and holds the primary
  button.
- Settings has a Generation section in place of Runway
  (`src/client/settings/GenerationSection.tsx`).
- Settings also has Power tools (`src/client/settings/PowerTools.tsx`: FilmCraft
  and LightCraft, optional, each a glyph, a state word and a Download button that
  asks first) and, under Chat, the Allowance.
- The Editing page's primary button is Master. Each finished file has a row with a
  Download button and one QC line: loudness, true peak, BT.709 and the frame count,
  or "QC:" and what was found.
- While a Run is active, closing the last window keeps the app running behind a
  tray icon; the activity pill and the run tray in the top bar say what is going on.
- The window's minimum is 1024 by 640, so the phone layout appears only when
  someone makes it narrow and tall, which is the layout's intent.

The stress scripts and `.router/ui/shoot.cjs` (`--token`) also run against
`desktop/scripts/serve.mjs`, so a CSP refusal counts as a console error there.
