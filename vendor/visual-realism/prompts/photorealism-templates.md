# Photorealism Templates

Drop-in templates by use case. Each has the full 5-layer stack, ready to adapt.

---

## Template 1 — Portrait (single subject)

```
A [age, gender, description] standing in [environment], [single specific
action — looking, reading, holding something].

Skin: subsurface scattering with visible pores at 1:1, soft [warm/cool]
bloom under the key light, fine vellus hair catching backlight.
Eyes: catchlight from [light source], realistic iris pattern, subtle
asymmetry between left and right.
Posture: weight on [left/right] leg, slight shoulder lean, hands in
natural rest position.
Performance: subtle Duchenne smile / contemplative micro-expression /
soft breath visible at nostrils.

Lighting in the style of [Deakins / Lubezki / Doyle]:
single hard / soft key light from [direction, angle], [warm/cool]
color temperature, [negative fill / soft bounce] on shadow side,
motivated by [window / sunset / lamp].

Framing: medium close-up, subject occupies center 60% vertical of
frame, eye line at upper third, strong negative space [camera-left /
camera-right].

Shot on 85mm at f/2.0, shallow depth of field, background blurred
to atmospheric color. Slow push-in over 4 seconds, locked smooth gimbal.

NEGATIVE: plastic skin, doll eyes, t-pose, deformed hands, frozen face,
painted background, harsh studio fluorescent
```

---

## Template 2 — Product / commercial close-up

```
[Product type] on [surface], [single product-only or product + hand].

Product: [material — glass/metal/plastic], realistic specular highlight
showing [light source reflection], [fingerprint/scratch detail if hero],
subtle ambient occlusion shadow under base.
Liquid (if applicable): Fresnel reflection on surface, [caustic light
pattern visible on background if pool/glass], surface tension at meniscus,
droplets with proper specular highlights.
Surface: [marble/wood/concrete texture detail], soft contact shadow
matching object weight, subtle color bounce from [object color] onto
[surface color].

Lighting: clean studio setup, key light from camera-[left/right] at
[angle]°, softbox feel, gentle fill from opposite side, subtle rim
from behind for separation.

Framing: tight close-up, product occupies center, slight low angle
(5-10° below eye level) for hero feel, clean negative space around.

Shot on [85mm / 100mm macro] at f/[4-5.6], crisp focus on product
hero detail, shallow depth on background. Camera: smooth orbit around
the product 180° over 5 seconds.

NEGATIVE: floating product, missing shadow, painted texture, plastic
sheen on metal, blurry hero detail, washed-out highlights
```

---

## Template 3 — Lifestyle / candid scene

```
A [number] [people description] [doing single action] in [environment],
[time of day], [season].

Subjects: natural posture and weight distribution, realistic skin with
SSS and pores, eyes with catchlights, hands with proper anatomy.
Clothing: [fabric types with weave detail], natural drape following
movement, wrinkles where stress points are.
Environment: [3-5 environmental details — tree leaves catching wind,
water reflection, dust motes in light beam].
Interaction: realistic contact between subjects/objects, ambient
occlusion shadows, color bounce between adjacent surfaces.

Lighting in the style of Lubezki:
natural [golden hour / overcast / open shade] light only, no
artificial fill, [backlight / soft toplight] dominant, warm amber
palette, lens flares from the sun camera-[direction].

Framing: wide environmental shot, subjects occupy lower third center,
strong negative space above with sky / treeline, foreground element
[grass / water / leaves] adding depth.

Shot on 35mm at f/2.8, deep enough focus for environment, shallow
enough to separate subjects. Hand-held organic feel, gentle following
movement, 6-second duration.

NEGATIVE: studio lighting, t-pose, fake-looking outdoor, deformed
hands, plastic skin, flat ambient, missing shadows
```

---

## Template 4 — Food / drink hero

```
A [dish/drink description] on [serving surface], freshly prepared,
steam/condensation/freshness visible.

Material realism: [for hot food: visible steam wisps catching light;
for cold drink: condensation droplets with Fresnel; for sauce:
viscosity and slow drip with surface tension; for greens: subtle
moisture and color saturation].
Surface details: [ceramic glaze reflection / wood grain / linen weave],
soft contact shadow under the dish, color bounce from food onto plate.
Texture cues: [grilled marks, crispy edges, soft interior, glossy
glaze] depending on dish.

Lighting: warm directional from camera-[direction] at 45°, motivated
by window or overhead practical, soft bounce fill from opposite side
keeping shadows readable. Steam catches light beam.

Framing: overhead 90° or 45° down angle. Dish at center or rule-of-thirds.
Negative space on [linen / wood] surface around for breathing room.
Optional second small element (cutlery, garnish) at 1/3 distance.

Shot on 50mm at f/4. Slow tilt down from oblique to overhead over
4 seconds, or static with subtle steam motion.

NEGATIVE: plastic-looking food, dry steam, missing condensation,
painted glaze, frozen sauce, t-pose composition, harsh shadows
```

---

## Template 5 — Architecture / interior

```
[Room type] in [style — minimalist Scandinavian / brutalist concrete /
warm mid-century], [time of day determining lighting].

Materials: realistic [wood grain / concrete texture / linen / stone],
subtle wear and patina, dust motes in light beams, ambient occlusion
in corners and under furniture, soft contact shadows.
Light interaction: window light spilling onto floor with realistic
falloff, secondary bounce illuminating opposite wall, slight color
shift between key and bounce.

Lighting in the style of Tarkovsky / Kubrick (interior signature):
single dominant light source from [window position], deep depth of
shadow, atmospheric haze in the light beam, motivated and natural.

Framing: one-point perspective or rule of thirds. Foreground furniture
element guides eye to background. Strong vertical lines from walls
and windows.

Shot on 24mm wide at f/5.6, deep DoF, full environment in focus.
Slow crane up or push-in revealing the full space over 6 seconds.

NEGATIVE: CGI look, fake light, plastic surfaces, missing dust /
atmospheric particles, harsh CGI shadows, oversaturated
```

---

## Tips for adapting

- Always replace ALL bracketed `[placeholders]`. Empty brackets confuse models.
- Cut anything that doesn't apply (no liquid in your scene? delete that line).
- The order matters less than completeness. Keep the 5 layers, in any order.
- If output fails on one layer, iterate that layer only.

---

## See also

- [Anatomy Template](anatomy-template.md) — explains the 5 layers
- [Cinematic Templates](cinematic-templates.md) — for video shots
