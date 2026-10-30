# AI visual realism prompts (vendored)

- Source: https://github.com/keng1304/awesome-ai-visual-realism-prompts
- Commit: `b850b0ef1d774cdeed85f906397f93f5f918ac41`
- License: MIT, Copyright (c) 2026 keng_1304 / tzukao.com (see `LICENSE`)

These files are kept here for attribution and so the app can follow later
versions of the cookbook. **The app does not read them at runtime.** The
image prompts use a distilled digest written in our own words,
`src/realism.ts`: small clause builders (people, water, glass, contact,
light physics and an anti-slop line), each switched on only by what a frame
actually has, and worded so a clause never asks for something the render
does not contain (that rule wins wherever the cookbook disagrees).

The digest rides on:

- the Lifestyle x-ray plate (`buildLifestylePrompt` with `plate: true`):
  posture and contact only, so the plate stays flat and neutral;
- the Lifestyle develop (`buildDevelopPrompt`) and the older takes' second
  pass (`buildPass2Prompt`), in `src/lifestyle.ts`;
- the Director's frames, through an opt-in `realism` option on
  `buildCinematicPrompt` (`src/looks.ts`); Stills never passes it.

Only the parts the digest draws on are vendored:

| File | Used for |
|---|---|
| `docs/01-physical-realism.md` | Skin subsurface scattering, Fresnel water and glass with caustics, cloth weave, contact physics, posture and weight, eyes and hands, lighting physics, the anti-slop table |
| `docs/02-cinematic-lighting.md` | Key, fill, bounce and practicals; motivated light; the warm/cool split |
| `prompts/photorealism-templates.md` | Template 3 (lifestyle / candid) and Template 5 (architecture / interior) |

Not used: the cookbook's director-of-photography style names, composition,
camera motion, action grammar and the Higgsfield / Seedance rules (the
Director skill in `vendor/director-skill/` covers direction).
