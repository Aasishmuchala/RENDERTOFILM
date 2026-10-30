# 02 — Cinematic Lighting

"Cinematic" is the most overused word in AI prompts. It's also the laziest. This doc replaces it with **5 master cinematographer signature lighting setups** — pick the one that matches your scene, paste the recipe, get specific results.

---

## How light is described in cinematography

| Term | What it means |
|---|---|
| **Key light** | Main light source, defines exposure |
| **Fill light** | Secondary, fills the shadow side |
| **Rim / backlight** | Behind the subject, separates from background |
| **Practical** | A light source visible in the frame (lamp, candle, neon sign) |
| **Bounce** | Light reflected off a wall, ceiling, or card |
| **Motivated lighting** | The light has a "source story" — a window, sunset, streetlamp |
| **Hard / soft** | Hard = small or distant source = sharp shadows. Soft = large or close source = diffuse shadows |
| **High-key / Low-key** | High-key = bright, low contrast (sitcom). Low-key = dark, high contrast (noir) |
| **Color temperature** | Kelvin scale. 3200K = warm tungsten. 5600K = daylight. 10000K = blue sky shade |

Master cinematographers each have a signature combination. Below are 5.

---

## 1 — Roger Deakins (Blade Runner 2049, 1917, Skyfall)

### Signature
Single-source, motivated key light. Heavy negative fill (shadow side stays dark). Atmospheric haze. Cool overall palette with warm practicals.

### Prompt formula

```
cinematography in the style of Roger Deakins:
single hard key light from one side, deep shadow on opposite side,
atmospheric haze in the air, motivated light from [window/lamp/sunset],
cool color palette with warm practical light source,
shallow depth of field, anamorphic widescreen feel
```

### Works best for
Dramatic interiors, dystopian exteriors, noir-adjacent scenes, isolated portraits.

### Example

> "A man standing in an empty industrial warehouse. **Lighting in the style of Roger Deakins:** single shaft of warm tungsten light from a high window camera-left, casting one long shadow. Negative fill on camera-right — shadow side stays in deep blue-grey. Atmospheric haze catches the light beam. Cool 7000K ambient with warm 3200K key. Shallow depth of field, slight anamorphic distortion."

---

## 2 — Emmanuel Lubezki (The Revenant, Birdman, Tree of Life)

### Signature
Natural light only. Golden hour or magic hour. Long, fluid handheld camera. Backlight against subjects to create silhouettes and rim glow.

### Prompt formula

```
cinematography in the style of Emmanuel Lubezki:
natural light only, golden hour or magic hour,
strong backlight creating subject silhouette and hair rim,
hand-held camera feel, organic floating movement,
warm orange-amber palette, lens flares from the sun
```

### Works best for
Outdoor portraits, nature, spiritual scenes, anything where you want light to feel like it's discovering the subject.

### Example

> "A woman walking across a grassland at sunset. **Lighting in the style of Emmanuel Lubezki:** sun low on the horizon behind her, strong backlight rimming her hair and shoulders, light particles visible in the air, gentle lens flare. Hand-held camera following her, organic floating feel. Warm amber-orange palette. No artificial fill light — let her face fall into soft shadow."

---

## 3 — Christopher Doyle (In the Mood for Love, Chungking Express)

### Signature
Practical-lit. Neon, fluorescent, street lamps as primary sources. Color contrast (one side magenta, other side green). Tight, intimate framing. Smoke and reflection.

### Prompt formula

```
cinematography in the style of Christopher Doyle:
practical lighting only — neon signs, fluorescent tubes, street lamps,
strong color contrast between key and fill (e.g., magenta key + cyan fill),
tight intimate framing, reflections in windows or rain-wet surfaces,
slight smoke in the air, slow motion feel
```

### Works best for
Urban night, romance, melancholy, Asian city aesthetics.

### Example

> "A woman leaning in a hotel hallway smoking, late night. **Lighting in the style of Christopher Doyle:** key light from a red neon hotel sign camera-right, cool blue fluorescent spillover from a corridor lamp camera-left. Smoke from her cigarette catches both. Tight intimate framing. Slight reflection in the polished hallway floor. Slow motion stillness."

---

## 4 — Darius Khondji (Seven, Uncut Gems, Amour)

### Signature
Sodium-vapor orange. Heavy use of practical signs and street light. Greasy, lived-in textures. Lots of contrast, often bordering on grungy.

### Prompt formula

```
cinematography in the style of Darius Khondji:
sodium-vapor orange dominant palette,
heavy practical light sources (signs, street lamps, fluorescent),
high contrast, deep blacks, greasy reflective surfaces,
slight grain, lived-in atmosphere, no glamour lighting
```

### Works best for
Urban grit, anxiety scenes, anything that needs to feel sweaty and real.

---

## 5 — Hoyte van Hoytema (Dunkirk, Tenet, Oppenheimer, Interstellar)

### Signature
IMAX 70mm look. Natural light prioritized. Practical effects over CGI. Cold blue + warm orange split. Lots of negative space. Subjects feel small against vast spaces.

### Prompt formula

```
cinematography in the style of Hoyte van Hoytema:
IMAX 70mm film look, large format wide aspect,
natural light only, no studio gloss,
cold blue ambient + warm orange practical contrast,
deep negative space around small subject,
photochemical grain texture, no digital sheen
```

### Works best for
Epic scale, war, sci-fi, anything that needs weight and gravitas.

### Example

> "A lone figure walking across a vast snowy plain. **Cinematography in the style of Hoyte van Hoytema:** IMAX 70mm format, cold blue 8000K ambient sky, single warm 3200K practical light from a distant cabin. Figure is tiny in the lower third, vast negative space above. Photochemical grain texture. No digital gloss."

---

## Lighting cheat sheet

| Want this mood | Use this DP style |
|---|---|
| Dramatic, isolated | Deakins |
| Spiritual, warm, hopeful | Lubezki |
| Urban, intimate, melancholy | Doyle |
| Gritty, anxious, sweaty | Khondji |
| Epic, vast, weighty | van Hoytema |

---

## Common mistakes

- **"Cinematic lighting"** alone = nothing. Always anchor to a DP or specific setup.
- **"Soft and dramatic"** = contradiction. Soft light is rarely dramatic. Pick one.
- **"3-point lighting"** = generic. Define key, fill, rim individually with direction and color.
- **Skipping motivation** = unrealistic. Every light should have a source story (window / lamp / sunset / sign).

---

## Next

→ [03 — Composition](03-composition.md) for signature framing.
