# 01 — Physical Realism

The single biggest reason "AI looks AI" is missing **physical realism vocabulary**. Most generic prompts give the model nothing to anchor to. This doc gives you the layers.

## Why physical realism matters

Photorealism is a perceptual problem. Our visual cortex picks up on specific light/material cues. When those cues are missing, the brain flags the image as "off" — even when it can't articulate why.

The 8 layers below are what separate "AI photo" from "actual photo."

---

## Layer 1 — Skin (Subsurface Scattering)

Skin is not flat color. Light enters the skin, scatters under the surface, and exits — that's why ears glow red against backlight and why the bridge of the nose has a slight pinkish bloom.

### Prompt vocabulary

```
subsurface scattering on skin, faint translucency at ears and nostrils,
soft warm bloom under direct light, visible pores and fine vellus hair,
realistic skin texture with subtle imperfections,
no plastic shine, no airbrushed look
```

### Anti-slop checklist

- ❌ "smooth skin" → too smooth = uncanny
- ❌ "perfect skin" → no pores = doll
- ❌ "beautiful complexion" → vague
- ✅ "natural skin texture, fine pores visible at 1:1 crop, subsurface scattering"

---

## Layer 2 — Liquids (Fresnel + Caustics)

Water, oil, glass, and any clear liquid follow the **Fresnel equation**: reflectivity increases as your viewing angle approaches grazing. A still pool seen from above is mostly transparent (you see the bottom). Seen from the side, it becomes a mirror.

Liquids also bend light. Inside a glass of water, light refracts, creating **caustics** — those moving bright patterns on a pool floor.

### Prompt vocabulary

```
fresnel reflection on water surface, caustic light patterns on the pool floor,
realistic refraction through glass, surface tension visible at the meniscus,
droplets with proper specular highlights, no flat painted water
```

### Anti-slop checklist

- ❌ "water splashing" with no surface tension = looks like paint
- ❌ Glass that's fully transparent from all angles = forgot Fresnel
- ✅ "water droplets with specular highlights, surface caustics in motion"

---

## Layer 3 — Cloth (Anisotropic Weave)

Fabric has direction. Silk reflects differently along the warp vs. the weft. Denim has a visible twill. Cotton has a slight fuzz. Leather has subtle creases that follow stress lines.

### Prompt vocabulary

```
visible fabric weave structure, anisotropic specular highlights on silk,
natural wrinkle patterns following gravity and body movement,
realistic cloth physics, no flat-shaded fabric, no painted-on clothing
```

### Material cheat sheet

| Material | Key terms |
|---|---|
| Silk | anisotropic highlight, soft drape, fine sheen, visible warp/weft |
| Denim | twill weave pattern, faded edges, indigo dye, stiff drape |
| Cotton | matte finish, subtle fuzz, soft folds, breathable look |
| Leather | natural grain, slight specular, stress creases, patina |
| Wool | nubby texture, fiber tips visible, soft halo at edges |

---

## Layer 4 — Contact Physics

When two objects touch, the contact point shows specific cues:

- **Ambient occlusion shadow** — darkening at the contact point
- **Micro-bounce light** — light reflecting from one surface onto the other (color bleed)
- **Deformation** — soft objects flatten where they touch
- **Adhesion** — wet or sticky surfaces show stretchy filament

### Prompt vocabulary

```
realistic contact shadows at the base, subtle color bounce from
the red surface onto the white object, soft deformation where the
hand grips, no floating objects, no missing contact shadows
```

### Anti-slop checklist

- ❌ Object sitting on table with no shadow underneath = floating
- ❌ Hand holding cup with no skin compression = AI pose
- ✅ "soft contact shadow under the base, finger compression visible at grip"

---

## Layer 5 — Anatomy & Posture

The most common giveaway: hands, eyes, and posture.

### Hands
- 5 fingers, correct length ratio, visible knuckles, natural curl
- Negative prompt: `extra fingers, fused fingers, deformed hands, mannequin hands`

### Eyes
- Catchlight reflection, visible iris pattern, slight asymmetry between left/right
- Negative prompt: `glassy eyes, doll eyes, dead stare, missing catchlight`

### Posture
- Weight distribution (which leg is bearing weight)
- Shoulder lean, hip tilt — humans rarely stand perfectly symmetric
- Negative prompt: `t-pose, stiff posture, perfectly symmetric stance`

### Prompt vocabulary

```
natural relaxed posture, weight on left leg, slight shoulder lean,
hands in natural rest position with visible knuckle structure,
catchlights in both eyes, subtle facial asymmetry
```

---

## Layer 6 — Performance (Micro-expressions)

A character with no micro-expression looks dead. Real faces have:

- Subtle asymmetry in smile (one side slightly higher)
- Eye narrowing when smiling genuinely (Duchenne marker)
- Slight nostril flare on inhale
- Lip tension variation across the upper lip

### Prompt vocabulary

```
genuine Duchenne smile with eye narrowing, subtle asymmetric mouth,
natural micro-expression, slight nostril breath, alive facial muscle tone,
no frozen expression, no rubber-mask smile
```

---

## Layer 7 — Lighting Physics

Real light follows the inverse-square law. A subject lit from one source has:

- Sharp falloff (close to source = much brighter than slightly further)
- Color temperature variation (key light warm, fill cool, or vice versa)
- Ambient bounce filling the shadow side at a lower intensity and color-shifted

See [02-cinematic-lighting.md](02-cinematic-lighting.md) for master-DP-style lighting recipes.

---

## Layer 8 — Anti-AI-Slop Checklist

Run this checklist on every generated image *before* approving it.

| Failure mode | Symptom | Fix |
|---|---|---|
| **Plastic skin** | Too smooth, doll-like | Add SSS + pore terms |
| **Floating objects** | No contact shadow | Add "contact shadow at base" |
| **Painted water** | No reflections / no surface tension | Add Fresnel + caustics |
| **T-pose stance** | Symmetric, stiff | Add weight distribution |
| **Dead eyes** | No catchlight | Add catchlight + iris texture |
| **Hand horror** | 6 fingers, fused | Negative prompt + hands close-up control |
| **Painted clothes** | No weave, no folds | Add fabric type + weave term |
| **Frozen face** | No micro-expression | Add Duchenne / asymmetry terms |
| **Color bleed wrong** | Surfaces don't reflect onto each other | Add "color bounce from X to Y" |
| **Flat lighting** | No directionality | Add "key light from camera-right at 45°" |

---

## Worked example

### Bad prompt

> "A young woman holding a glass of water by a pool, cinematic, 4k, photorealistic"

What's missing: SSS, contact, posture, lighting direction, fabric, eye anchor.

### Good prompt

> "A young woman in a soft cotton sundress holding a clear glass of water by an outdoor pool. **Skin:** natural subsurface scattering, visible pores, golden-hour warm bloom on her cheek. **Glass:** Fresnel reflection on the water surface, caustic light patterns visible on the pool floor behind her, refracted light through the glass. **Fabric:** cotton dress with visible weave, soft drape, slight wrinkle at the hip. **Contact:** soft shadow under her grip on the glass, finger compression visible. **Posture:** weight on her left leg, slight shoulder lean. **Eyes:** catchlight from the sky, natural iris detail. **Lighting:** golden hour, low sun camera-right at ~30°, warm key light, soft cool bounce from the pool. Shot on 50mm, f/2.0, shallow depth of field."

The difference is not "more words." It's **layered physical anchors**.

---

## Next

→ [02 — Cinematic Lighting](02-cinematic-lighting.md) for master DP recipes
