# Cinematic Director skill (vendored)

- Source: https://github.com/wuwangzhang1216/DirectorSKILL
- Version: 2.1.0, commit `c65ae0d14457053efb1e354c7e7f7e120d97fad1`
- License: MIT, Copyright (c) 2026 wangzhang-wu (see `LICENSE`)

These files are kept here for attribution and so the app can follow later
versions of the skill. **The app does not read them at runtime.** The Director
and Lifestyle planners use a distilled digest written in our own words,
`src/direction.ts`:

- `DIRECTION_DOCTRINE`, appended to both planners' system prompts
  (`src/storyboard-api.ts`, `src/lifestyle-api.ts`), adapted to this app's job
  (stills re-photographed from renders that later become clips; nothing is
  invented that the render does not contain, which wins wherever the skill
  disagrees).
- `DIRECTOR_LENSES` and `lensBlock()`, one paragraph per director lens,
  distilled from each module's `风格参数 / Style parameters` block.

Only the parts the digest draws on are vendored:

| File | Used for |
|---|---|
| `SKILL.md` | Hard rules, pipeline, lens precedence, self-check |
| `references/cinematic-language.md` | The nine shot functions, the size ladder, the 30-degree rule |
| `references/blocking-and-staging.md` | Blocking as start, action, end state; what clips render reliably |
| `references/continuity-bible.md` | Invariants repeated verbatim; identity drift by paraphrase |
| `references/genre-playbooks.md` | Precedence (lens over genre over tone); the commercial structure: hook, demonstration, claim, end card |
| `references/lighting-and-color.md` | Name the source, not the mood; world-anchored light across a scene |
| `references/director_styles/*.md` | The 20 director lenses, their index and comparisons |

Left out: the CI workflows, evals, `assets/` templates and the other
references (tool and image-model adapters, failure modes, prompt lexicon,
sound, editing, production workflow, product and macro).

The style modules teach methods only; as the skill says, nothing copies a
specific shot, line, character or plot from a real film, and the planners are
told never to name a director or film in any field.

To update: copy the same files from a newer commit, update the version and
commit above, then revise `src/direction.ts` by hand and run
`node node_modules/tsx/dist/cli.mjs .router/direction.ts`.
