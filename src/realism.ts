/**
 * Physical realism for the generated frames: small clause builders, each
 * switched on only by what a frame has (people, open water, glazing, things
 * standing on the ground, lamps), so no clause ever asks for something the
 * render lacks, and each one worded about what is "already in the frame".
 * Every clause names a cue a real photograph shows and a CG frame misses:
 * light entering skin, water and glass reflecting more at grazing angles, the
 * shadow and the give where two things touch, light dying off with distance.
 *
 * Distilled in our own words from "awesome-ai-visual-realism-prompts" by
 * keng_1304 / tzukao.com (MIT, commit b850b0e; vendored with its licence at
 * vendor/visual-realism/), adapted to re-photographing archviz renders. The
 * stages differ: a one-pass frame (`frame`) takes everything; an x-ray plate
 * (`plate`) only the physical layout (weight, posture, contact), so it stays
 * flat and neutral; a develop (`develop`) the surface physics of a layout the
 * plate already fixed. Pure: no imports, no I/O.
 */

/** Which pass a clause is written for. */
export type RealismStage = 'frame' | 'plate' | 'develop';

/** What a frame has, as far as the clauses need to know. */
export type RealismCues = {
  people: boolean;
  /** Inside a room: floors and the view out, rather than ground and the view in. */
  interior: boolean;
  /** Open water is named: a pool, pond, fountain or water feature. */
  water: boolean;
  /** Glazing is named: glass, glazing, windows, a curtain wall. */
  glass: boolean;
  /** Things standing on the ground are named: furniture, planters, seats. */
  contact: boolean;
  /** A lamp, lantern or fire is named (the clause speaks only of one already lit). */
  practicals: boolean;
  /** Whether any scene words were given; with none, only `people` and `interior` are known. */
  known: boolean;
};

/** Words that name no water or glazing although they contain one: a drink, sunglasses, a pool of light. */
const NOT_SCENE = [
  /\b(?:glass|glasses|jug|carafe|pitcher|bottle|cup|tumbler)\s+of\s+(?:[\w-]+\s+){0,3}?(?:water|lemonade|juice|wine|tea|milk|coffee|champagne|cocktails?)\b/gi,
  /\b(?:wine|water|drinking)\s+glass(?:es)?\b/gi,
  /\bsun\s*glasses\b/gi,
  /\bpools?\s+of\s+(?:\w+\s+)?(?:light|lamplight|sun|sunlight|shade|shadow|warmth)\b/gi,
];

const WATER = /\b(?:pools?|poolside|swimming|water|fountains?|ponds?|lakes?|lagoon|streams?|river|canal|sea|ocean|jacuzzi|hot tub|rill|cascade|waterfall)\b/i;
const GLASS = /\b(?:glass|glazing|glazed|windows?|curtain wall|skylights?|conservatory)\b/i;
const CONTACT =
  /\b(?:loungers?|daybeds?|bench(?:es)?|chairs?|armchairs?|sofas?|couch|tables?|stools?|planters?|pots?|urns?|beds?|seats?|seating|swing|hammock|parasols?|umbrellas?|furniture|sculptures?)\b/i;
const PRACTICALS =
  /\b(?:lamps?|lamplight|lanterns?|pendants?|sconces?|chandeliers?|candles?|candlelight|fire|firepit|fire pit|fireplace|uplights?|downlights?|string lights|fairy lights|festoon)\b/i;

/**
 * A frame's cues from what its builder already has: whether people are in
 * it, inside or out, and its own words (keep-list, place, title, people
 * brief, note). Without words only `people` and `interior` are known, and no
 * scene clause is switched on.
 */
export function realismCues(frame: { people: boolean; interior: boolean; scene?: string | undefined }): RealismCues {
  const raw = frame.scene?.trim() ?? '';
  const text = NOT_SCENE.reduce((t, re) => t.replace(re, ' '), raw);
  return {
    people: frame.people,
    interior: frame.interior,
    water: WATER.test(text),
    glass: GLASS.test(text),
    contact: CONTACT.test(text),
    practicals: PRACTICALS.test(text),
    known: raw !== '',
  };
}

const PEOPLE_TEXT: Record<RealismStage, { full: string; compact: string }> = {
  frame: {
    full: 'skin with subsurface scattering, warm and faintly translucent at the ears and fingers against the light, pores visible, never plastic or airbrushed; a small catchlight in every eye that shows; hands at rest with five fingers and visible knuckles; weight on one leg with a slight lean, never a stiff symmetric stance; clothing with visible weave and folds that hang with gravity; wherever someone sits, leans or rests a hand on a seat, rail or tree trunk, the cushion or fabric gives under the weight and a dark contact shadow sits at every touch, nobody floating above it',
    compact:
      'skin with subsurface scattering and pores, never plastic; a catchlight in each visible eye; five-finger hands at rest; weight on one leg, never symmetric; fabric weave and folds hanging with gravity; a seat giving and a contact shadow wherever a body touches a seat, rail or tree, nobody floating',
  },
  // The plate fixes the layout: weight, hands and every touch, legible and true to scale.
  plate: {
    full: "weight on one leg with a slight lean through the hips and shoulders, never a stiff symmetric stance; hands at rest with five fingers, relaxed or on what they already hold or touch; wherever someone sits, leans or rests a hand on a seat, rail, table or tree trunk, the body visibly meets it, seated weight pressing into the seat, a palm flat on the rail, a back against the bark, with a contact shadow at every touch and no gap; each person sized against what they touch, a seat just below an adult's knee, a rail at the waist",
    compact:
      'weight on one leg, never a symmetric stance; five-finger hands at rest; a seated or leaning body pressing on the seat, rail or trunk it touches, with a contact shadow and no gap',
  },
  // The develop keeps the plate's poses, so it gets the surface physics only.
  develop: {
    full: 'skin with subsurface scattering, warm translucency at the ears; a catchlight in each visible eye; fabric weave with folds hanging with gravity; a seat giving under anyone sitting, a contact shadow at every touch',
    compact: 'subsurface scattering in the skin, catchlights, fabric weave and gravity folds, a contact shadow at every touch',
  },
};

/** Skin, eyes, hands, weight, cloth and every touch: what a pass of `stage` can still decide about people. */
export function peopleRealism(stage: RealismStage = 'frame', compact = false): string {
  const t = PEOPLE_TEXT[stage];
  return compact ? t.compact : t.full;
}

/** Water that is already there: Fresnel, caustics where direct light reaches a pool floor, ripples with the wind. */
export function waterRealism(compact = false): string {
  return compact
    ? 'water clear from above and mirror-like at grazing angles (Fresnel), caustics on a pool floor where direct light reaches, ripples with the wind'
    : 'water already in the frame follows Fresnel: clear enough to show its floor where the camera looks down into it, turning to a mirror of the sky and planting toward grazing angles; caustics, a bright moving net of light, on the floor and walls of a pool wherever direct light reaches them; small ripples running with the wind';
}

/** Glazing that is already there: reflections that change with the angle, and a faint view through it. */
export function glassRealism(interior = false, compact = false): string {
  if (compact) {
    return `glazing with Fresnel reflections changing with the angle, ${interior ? 'a faint view out and a faint reflection of the room' : 'a faint view of the room behind'}`;
  }
  return `glazing already in the frame reflects by Fresnel: more see-through face-on, nearly a mirror at glancing angles, ${interior ? 'with the view outside faintly visible through it and a faint reflection of the room on it' : 'so its reflections of sky and trees change from pane to pane, with a faint view of the room behind it'} where the light allows`;
}

/** Where things meet the ground: ambient occlusion at every base and colour carried between neighbouring surfaces. */
export function contactRealism(interior = false, compact = false): string {
  const ground = interior ? 'floor' : 'ground';
  if (compact) return `ambient occlusion where furniture, planters and walls meet the ${ground}, colour bounce between neighbouring surfaces`;
  return interior
    ? "ambient occlusion where furniture legs, planters and walls meet the floor, a soft dark line at every base; colour bouncing between neighbouring surfaces, the floor's warmth on the undersides of furniture, the walls tinting the corners"
    : 'ambient occlusion where furniture legs, planters, steps and walls meet the ground, a soft dark line at every base; colour bouncing between neighbouring surfaces, warm off paving and timber, green from lawn and leaves onto pale undersides';
}

export type LightPhysicsOptions = {
  /** Lamps already lit in the render: inverse-square falloff. */
  practicals?: boolean | undefined;
  /** The key warmer than its shadows. */
  split?: boolean | undefined;
  /** One shadow family: only under one direct source (a sun), never under a sky or lamps. */
  oneShadow?: boolean | undefined;
  compact?: boolean | undefined;
};

/** How real light behaves: falloff from lamps already lit, a warm/cool split, one shadow family; '' when nothing is asked. */
export function lightPhysics({ practicals = true, split = true, oneShadow = true, compact = false }: LightPhysicsOptions = {}): string {
  return [
    practicals
      ? compact
        ? 'lamp light falling off fast with distance'
        : 'light from any lamp already lit in the frame falls off with the square of the distance, bright at the fitting and fading within a few metres, never an even wash'
      : '',
    split ? (compact ? 'key warmer than shade' : 'the key light warmer and its shadows cooler with skylight') : '',
    oneShadow ? (compact ? 'one shadow family' : 'one shadow family, every shadow cast from the same source in the same direction') : '',
  ]
    .filter(Boolean)
    .join('; ');
}

/** The giveaways a frame with these cues must not show, each named; '' when no cue is on. */
export function antiSlop({
  people = true,
  water = true,
  glass = true,
  contact = true,
}: { people?: boolean | undefined; water?: boolean | undefined; glass?: boolean | undefined; contact?: boolean | undefined } = {}): string {
  const parts = [
    people ? 'no doll eyes without a catchlight, no extra or fused fingers, no T-pose or mannequin stance, no painted-on clothes' : '',
    contact ? 'no furniture or planter hovering without a contact shadow' : '',
    water ? 'no flat painted water' : '',
    glass ? 'no glass drawn as one flat, uniform sheet' : '',
  ].filter(Boolean);
  if (parts.length === 0) return '';
  const text = parts.join(', ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** One switched-on clause, in its full and short forms. */
export type RealismLayer = { id: 'people' | 'water' | 'contact' | 'glass' | 'light'; full: string; compact: string };

/**
 * The clauses a frame's cues switch on, most important first (people, water,
 * contact, glass, light), so a prompt over its cap can let them go from the
 * end. The plate takes the people's layout only. `light` is the caller's
 * light physics (it knows the look or the lighting design); none when absent.
 */
export function realismLayers(cues: RealismCues, stage: RealismStage, light?: LightPhysicsOptions | undefined): RealismLayer[] {
  const layers: RealismLayer[] = [];
  if (cues.people) layers.push({ id: 'people', full: peopleRealism(stage), compact: peopleRealism(stage, true) });
  if (stage === 'plate') return layers;
  if (cues.water) layers.push({ id: 'water', full: waterRealism(), compact: waterRealism(true) });
  if (cues.contact) layers.push({ id: 'contact', full: contactRealism(cues.interior), compact: contactRealism(cues.interior, true) });
  if (cues.glass) layers.push({ id: 'glass', full: glassRealism(cues.interior), compact: glassRealism(cues.interior, true) });
  const lit = light ? lightPhysics({ ...light, compact: false }) : '';
  if (lit) layers.push({ id: 'light', full: lit, compact: lightPhysics({ ...light, compact: true }) });
  return layers;
}

/**
 * The layers as one passage: each clause full or short, then the anti-slop
 * line for exactly those layers ('' with none). A develop's people already
 * carry their own negatives in its PEOPLE item, so `peopleNegatives: false`
 * leaves them out.
 */
export function realismText(layers: readonly RealismLayer[], compact: boolean, peopleNegatives = true): string {
  if (layers.length === 0) return '';
  const on = (id: RealismLayer['id']) => layers.some((l) => l.id === id);
  const avoid = antiSlop({ people: peopleNegatives && on('people'), water: on('water'), glass: on('glass'), contact: on('contact') });
  return `${layers.map((l) => (compact ? l.compact : l.full)).join('; ')}.${avoid ? ` ${avoid}` : ''}`;
}
