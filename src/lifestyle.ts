import { ETHNICITIES, type EthnicityId } from './looks.ts';
import { clampPrompt, type ImageModelId } from './models.ts';
import { peopleRealism, realismCues, type RealismLayer, realismLayers, realismText } from './realism.ts';

/**
 * The Lifestyle page: every render of a project re-photographed as a frame of
 * a premium residential lifestyle film, in the grammar of the brand films it
 * is modelled on. The camera, geometry and materials are locked; people are
 * the household, small and far in wides, a quarter of the frame in mids,
 * faces only in close-ups, and details carry the intimacy with no one in them.
 *
 * The frames are filmic, not clean archviz: the chapter's light falls off
 * from a backlit, sunlit middle ground into a shaded foreground and a softer
 * distance; a long lens throws the foreground and background out of focus;
 * colour is muted film colour with grain and halation; people are candid,
 * backlit, never posed, at true height with their feet on the ground and the
 * focus, haze and shadows of their distance. Every frame prompt is the proven numbered recipe
 * ("Edit the first attached image… Make only these changes: 1. LIGHT…"), so
 * the structure, not just the words, is what the model follows. A two-pass
 * take then re-photographs that first pass at full detail with its own
 * prompt (`buildPass2Prompt`); cast sheets stay one clean, front-lit pass.
 * A two-pass take's first pass is now an x-ray plate (flat, deep focus,
 * neutral, every decision legible), and `buildDevelopPrompt` develops it
 * with the look; `buildPass2Prompt` stays for older takes. Single-pass
 * frames keep the filmic recipe. A frame may carry its own lighting design
 * (`sun`, `light`), which replaces the chapter's fixed sun in every builder
 * with one shadow family, numbered ratios and pools of light; frames without
 * it are unchanged. A frame may also be lit with one of `LIGHTING_PRESETS` (a
 * named setup with its own time, ratios and Kelvin, replacing the chapter's
 * light and numbers; the frame's sun gives its side) and shot with a
 * `FrameCamera` (depth of field and focus plane, filmic and develop only; the
 * plate stays deep focus); frames without them are unchanged. The plate, the
 * develop and the older takes' second pass also carry the physical realism of
 * `src/realism.ts` (the plate only its people's posture and contact); the
 * filmic frame does not. Plain text only: nothing here does I/O, and the
 * reference films are never named in a prompt.
 */

/** The household heritage a new plan starts with: a natural mix. */
export const DEFAULT_HERITAGE: EthnicityId = 'mixed';

/** Soft, clean, neutral light: cast sheets only, so faces read sharp and true. */
const CLEAN_FINISH =
  'the sun itself is soft and gentle, never harsh: low, softened by the trees or thin cloud; neutral, natural colour balance, whites stay white and greens stay fresh green, no yellow, golden or orange cast over the picture; nothing burns out to pure white; soft highlights, gentle contrast with open shadows, pastel blossom colour, natural skin; no lens flare and no sun disc in the frame; crisp fine detail and clean air, no fog';

/** How the chapter's light falls off across the frame, outside. */
const FILM_FALLOFF =
  'the sun behind the subject and a little to one side, so leaves, petals, hair and the edges of things glow with rims of light; the foreground planting sits in soft shade, about one and a half stops darker than the sunlit middle ground where the people are; the far background is brighter and softer with gentle aerial perspective in the distance only, never a fog over the whole frame; a soft bloom around the brightest backlit leaves; deep, rich shadows inside the foliage masses that keep a little detail, with true dark tones in the deepest leaves, never a flat grey lift; light and shade fall in pools, not evenly across the frame; the sky, where it shows, keeps soft colour and never burns to white';

const FILM_FALLOFF_COMPACT =
  'the sun behind the subject, rims of light on leaves, petals and hair; the foreground in soft shade, one and a half stops darker than the sunlit middle ground; aerial perspective in the distance only, no fog; deep shadows with detail; light in pools; the sky never burns to white';

const FILM_FALLOFF_INTERIOR =
  'the window light behind or beside the subject so edges glow with soft rims; the nearest furniture and objects sit in soft shade, about a stop darker than the subject; the far room or the view through the glass brighter and softer; deep shadows inside the room that keep a little detail, never a flat grey lift; light and shade fall in pools, not evenly across the room';

const FILM_COLOUR =
  'a muted, natural, filmic palette: greens leaning sage and olive rather than bright green, flowers soft and pastel rather than saturated, warm cream highlights, slightly cool shade, whites cream-white with no orange or yellow cast over the picture; nothing oversaturated, nothing glossy; highlights roll off softly as on film; fine 35 mm film grain and a subtle halation around bright edges; it looks like a frame from a high-end residential brand film shot on an ARRI Alexa with vintage cine primes on Kodak 250D, not a render and not an advertising photo';

const FILM_COLOUR_COMPACT =
  'a muted filmic palette: greens sage and olive, flowers soft and pastel, cream highlights rolling off as on film, cool shade, whites cream-white with no orange or yellow cast; nothing oversaturated; fine film grain and subtle halation';

/** Exterior planting; with a reference photograph, its plants are the bar. */
const FILM_PLANTING = (withRef: boolean) =>
  `the planting is ${withRef ? 'as lush, mature and real as the planting in the last attached image' : 'lush, mature and abundant'}, layered from the foreground to the background: every leaf individual and different, leaves translucent where the sun is behind them, flowers as real clusters with individual petals, a few fallen petals on the ground, shrubs with soft irregular outlines, tree crowns with broken edges, branches inside them and gaps where the sky shows through, bark with real furrows, lawn as individual blades; no repeated clumps, nothing CG-smooth; the same plants, colours and positions as in the image, only fuller and more mature, as a well-loved garden ten years after planting`;

const FILM_PLANTING_COMPACT =
  'lush, mature, layered planting: every leaf individual, leaves translucent where the sun is behind them, flowers as real clusters with individual petals, soft irregular shrubs; the same plants, colours and positions, only fuller';

const FILM_PLANTING_INTERIOR =
  'any plants or flowers in the room are real, living plants with individual leaves and petals, kept exactly where they are';

const FILM_MATERIALS =
  'every surface photographed, not rendered: real stone, brick, paving and timber with natural grain and slight wear, real water with true reflections; new and well kept';

/** FILM_MATERIALS at close range, while the full planting text still fits; it gives way with the planting. */
const FILM_MATERIALS_FULL =
  'every surface photographed, not rendered: brick with neat mortar joints and slight colour variation from brick to brick, stone and concrete with fine pores, paving with real joints and setts very slightly uneven, timber with open grain and soft wear on handled edges, metal with soft imperfect reflections, glass and water with true reflections of the trees and sky; new and well kept, no CG-perfect flat surfaces, no repeating texture tiles';

const FILM_PEOPLE =
  "the people are real residents caught candidly by a documentary photographer: mid-movement, faces partly turned away or in three-quarter profile, never looking at the camera, never posed; backlit, so faces fall into soft shade with a rim of light on hair and shoulders; natural skin with real texture and small imperfections; real, slightly creased linen and cotton clothing; true real-world height measured against what stands right beside them (a door, railing, bench seat, table edge or tree trunk; an adult about 1.6 to 1.85 m, a child of six about 1.15 m); feet planted on the same ground plane as the paving around them, weight balanced, with soft contact shadows; the render's own camera, never re-framed around them, so they shrink with distance exactly as the paving, benches and trees do and the horizon crosses every standing adult at the same height on the body; shadows in the same direction, length and softness as the trees' beside them; exactly the depth-of-field softness and distance haze of whatever stands at their distance, partly overlapped by nearer planting or furniture where that is natural, never pasted on top of the scene. No stock-photo smiles, no catalogue poses, no glossy or waxy skin, no cut-out edges";

const FILM_PEOPLE_COMPACT =
  "real residents caught candidly, mid-movement, faces turned away, never posed or looking at the camera; backlit, a rim of light on hair and shoulders; real skin texture; creased linen; true height against the objects beside them (adults ~1.7 m, a six-year-old ~1.15 m), feet on the ground with contact shadows, the horizon at one body height on every adult, the trees' shadow direction, and the same focus blur and haze as anything at their distance; no stock-photo smiles, no waxy skin";

/** The cast sheet's realism line (a front-lit identity photograph, not a frame). */
/** Real-world heights for the household, so a sheet sets each person's true scale. */
const CAST_HEIGHTS: Record<CastRoleId, string> = {
  mother: 'the mother about 1.63 m',
  father: 'the father about 1.78 m',
  daughter: 'the girl of six about 1.15 m',
  son: 'the boy of eight about 1.28 m',
  grandmother: 'the grandmother about 1.56 m',
  grandfather: 'the grandfather about 1.70 m',
};

/** "a, b and c" */
function listOf(items: readonly string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const NO_PEOPLE = 'NO PEOPLE are added anywhere in the frame.';

const FILM_CAMERA = (lens: string, people: boolean) =>
  `${lens}: shallow depth of field, the foreground layer melting into soft bokeh, the background softly out of focus, focus on ${people ? 'the people' : 'the subject'}; natural lens falloff; no HDR look, no sharpening halos`;

const TAIL = 'Everything else stays exactly the same. No text, no logos, no watermark.';

/** When a frame has no keep-list yet, the head still locks the design. */
const KEEP_ALL = 'the buildings, objects and planting';

const CAST_SHEET_SENTENCE =
  'The second attached image is a cast sheet of the residents: reproduce these people faithfully — faces, skin tone, hair and build — and only them; take nothing else from it, not its background, light or layout.';

const LIGHT_REFERENCE_SENTENCE =
  'The last attached image is a reference photograph for light, colour and plant realism only: take nothing from its place, buildings, objects or people.';

/**
 * The x-ray plate: a two-pass take's first pass, a flat, deep-focus, neutral
 * technical frame that carries every decision and none of the look, so the
 * develop (`buildDevelopPrompt`) has the most legible detail to finish from.
 */
const PLATE_STATEMENT =
  "This is a technical plate for a later finishing pass, not the final look: it carries every decision (camera, sun direction, people, planting, materials) with maximum legible detail and none of a finished photograph's atmosphere or grade.";

const PLATE_STATEMENT_COMPACT =
  'This is a technical plate for a later finishing pass, not the final look: every decision legible, no atmosphere or grade.';

/** The plate takes only the reference's sun; its colour belongs to the develop. */
const PLATE_REFERENCE_SENTENCE =
  'The last attached image is a reference photograph for sun direction, time of day and plant realism only: take none of its colour, grade or atmosphere, and nothing from its place, buildings, objects or people.';

const PLATE_TONE =
  'a flat, neutral camera plate, low contrast like a LOG capture, with every highlight and every shadow holding full detail, nothing burned to white or crushed to black; neutral white balance, whites white, greens true green and skin natural; no colour grade, no glow, no flare; the air perfectly clear from the nearest object to the farthest tree';

const PLATE_TONE_COMPACT =
  'a flat, neutral camera plate, low contrast, full detail in every highlight and shadow; neutral white balance, whites white and greens true green; no colour grade, no glow; the air clear';

const PLATE_PLANTING_TAIL =
  'each plant legible as its real species, its leaf shape, flower structure and bark readable in the flat light';

/**
 * The plate adds nothing. Its develop keeps whatever the plate draws, so a
 * branch the plate invents at an edge, or a tree it adds to the vista, ends
 * up in the final frame; this sentence follows the keep-list on every plate.
 */
const PLATE_ADD_NOTHING =
  'Add nothing: no new tree, branch, leaves, plant or object, none entering at the edges; every edge and the far distance show only what the first image shows.';

/**
 * PLATE_ADD_NOTHING once a plate is over its cap: it goes short before any
 * other text, so the sun's height and the shadows' length keep their room.
 */
const PLATE_ADD_NOTHING_COMPACT = 'Add no plant or object anywhere, edges and distance included.';

/**
 * The plate's planting: as real and mature as the filmic text asks, but the
 * render's own plants at their own sizes. The filmic "layered from the
 * foreground" and "only fuller" read to an edit model as leave to add a near
 * layer or grow a tree, so the plate says the opposite.
 */
const PLATE_PLANTING = (withRef: boolean) =>
  FILM_PLANTING(withRef)
    .replace('layered from the foreground to the background', 'from the nearest bed to the farthest tree')
    .replace(
      'the same plants, colours and positions as in the image, only fuller and more mature, as a well-loved garden ten years after planting',
      'the same plants at the same size, colour and position as in the image: none added, enlarged or removed'
    );

const PLATE_PLANTING_COMPACT = FILM_PLANTING_COMPACT.replace('lush, mature, layered planting', 'lush, mature planting').replace(
  'the same plants, colours and positions, only fuller',
  'the same plants, colours, sizes and places; none added or enlarged'
);

/**
 * A grammar's plate scale with its framing devices taken out: "seen past
 * something … in the foreground" and "a layer … crosses one edge" are met by
 * adding one, so on a plate the people stand among what is already there.
 * `GRAMMARS` keeps the text, which a deep-focus filmic frame still uses.
 */
export function plateScaleText(scale: string): string {
  return scale
    .replace(
      ', seen past something already in the scene (planting, a railing, a lounger) in the foreground.',
      ', among what is already there, nothing added in front of them.'
    )
    .replace("; a layer of the scene's own planting or furniture crosses one edge;", ';');
}

/**
 * A plate is deep focus, so a lighting brief's depth-of-field clauses (a
 * planner's "the near planting falls softly out of focus") only invite a near
 * layer: they go, the rest of the brief stays as written.
 */
export function plateBrief(brief: string): string {
  return brief
    .split(/(?<=[.;])\s+/)
    .filter((part) => !/out of focus|bokeh|defocus|soft focus|shallow depth/i.test(part))
    .join(' ')
    .replace(/;$/, '.')
    .trim();
}

const PLATE_PEOPLE =
  "the people are real residents caught candidly: mid-movement, faces partly turned away or in three-quarter profile, never looking at the camera, never posed; natural skin with real texture and small imperfections; real, slightly creased linen and cotton clothing; true real-world height measured against what stands right beside them (a door, railing, bench seat, table edge or tree trunk; an adult about 1.6 to 1.85 m, a child of six about 1.15 m); feet planted on the same ground plane as the paving around them, weight balanced, with soft contact shadows; the render's own camera, never re-framed around them, so they shrink with distance exactly as the paving, benches and trees do and the horizon crosses every standing adult at the same height on the body; lit by the same sun as everything around them, with shadows in the same direction, length and softness as the trees' beside them; partly overlapped by nearer planting or furniture where that is natural, never pasted on top of the scene; every face and body fully sharp and legible. No stock-photo smiles, no catalogue poses, no glossy or waxy skin, no cut-out edges";

const PLATE_PEOPLE_COMPACT =
  "real residents caught candidly, mid-movement, faces turned away, never posed or looking at the camera; real skin texture; creased linen; true height against the objects beside them (adults ~1.7 m, a six-year-old ~1.15 m), feet on the ground with contact shadows, the horizon at one body height on every adult, lit by the same sun with the trees' shadow direction; every face and body sharp and legible; no stock-photo smiles, no waxy skin";

/** The grammar's lens without its aperture: a plate keeps the framing, never the focus. */
export function plateLens(lens: string): string {
  return lens.replace(/ at f\/[\d.]+$/, '');
}

const PLATE_CAMERA = (lens: string) =>
  `${plateLens(lens)}: its framing and field of view only, stopped down to deep focus, everything sharp front to back from the nearest object to the farthest tree; no motion blur, no vignette, no flare, no sun disc in frame, no HDR look, no sharpening halos`;

/**
 * A frame's own lighting design: where the sun stands relative to the camera
 * (the side the main window is on, inside), chosen by the planner to agree
 * with the render's own shadows and editable on the board.
 */
export const SUN_POSITIONS = [
  { id: 'behind-left', name: 'Behind, left', hint: 'Backlight from the left; shadows come toward the camera' },
  { id: 'behind-right', name: 'Behind, right', hint: 'Backlight from the right; shadows come toward the camera' },
  { id: 'left', name: 'Left', hint: 'Side light from the left; shadows fall right' },
  { id: 'right', name: 'Right', hint: 'Side light from the right; shadows fall left' },
  { id: 'front-left', name: 'Front, left', hint: "Over the camera's left shoulder; shadows fall away" },
  { id: 'front-right', name: 'Front, right', hint: "Over the camera's right shoulder; shadows fall away" },
  { id: 'overhead', name: 'Overhead', hint: 'High sun; short shadows under things' },
] as const;

export type SunPositionId = (typeof SUN_POSITIONS)[number]['id'];

export const SUN_POSITION_IDS = SUN_POSITIONS.map((s) => s.id) as [SunPositionId, ...SunPositionId[]];

/** Pinned text, not prose: the bug a lit frame fixes is shadow direction, so no builder words it. */
const SUN_PHRASES: Record<SunPositionId, { exterior: string; exteriorCompact: string; interior: string; interiorCompact: string }> = {
  'behind-left': {
    exterior:
      'the sun behind the scene and to the left of the camera, so people and planting are lit from behind-left and every shadow falls forward and to the right, toward the camera',
    exteriorCompact: 'the sun behind the scene, to the left of the camera',
    interior:
      'the windows behind the scene and to the left, so daylight comes from behind-left and every shadow reaches forward and to the right into the room',
    interiorCompact: 'the windows behind the scene, to the left',
  },
  'behind-right': {
    exterior:
      'the sun behind the scene and to the right of the camera, so people and planting are lit from behind-right and every shadow falls forward and to the left, toward the camera',
    exteriorCompact: 'the sun behind the scene, to the right of the camera',
    interior:
      'the windows behind the scene and to the right, so daylight comes from behind-right and every shadow reaches forward and to the left into the room',
    interiorCompact: 'the windows behind the scene, to the right',
  },
  left: {
    exterior: 'the sun off to the left of the frame, so everything is side-lit from the left and every shadow falls to the right',
    exteriorCompact: 'the sun off to the left of the frame',
    interior: 'the windows on the left, so daylight comes in from the left and every shadow falls to the right across the room',
    interiorCompact: 'the windows on the left',
  },
  right: {
    exterior: 'the sun off to the right of the frame, so everything is side-lit from the right and every shadow falls to the left',
    exteriorCompact: 'the sun off to the right of the frame',
    interior: 'the windows on the right, so daylight comes in from the right and every shadow falls to the left across the room',
    interiorCompact: 'the windows on the right',
  },
  'front-left': {
    exterior:
      'the sun behind the camera and to its left, so the scene is lit from the front-left and every shadow falls back and to the right, away from the camera',
    exteriorCompact: 'the sun behind the camera, to its left',
    interior:
      'the windows behind the camera and to its left, so the room is lit from the front-left and every shadow falls back and to the right, away from the camera',
    interiorCompact: 'the windows behind the camera, to its left',
  },
  'front-right': {
    exterior:
      'the sun behind the camera and to its right, so the scene is lit from the front-right and every shadow falls back and to the left, away from the camera',
    exteriorCompact: 'the sun behind the camera, to its right',
    interior:
      'the windows behind the camera and to its right, so the room is lit from the front-right and every shadow falls back and to the left, away from the camera',
    interiorCompact: 'the windows behind the camera, to its right',
  },
  overhead: {
    exterior:
      'the sun high overhead, so the tops of things are lit and every shadow falls short, almost straight down beneath whatever casts it',
    exteriorCompact: 'the sun high overhead',
    interior:
      'daylight from above, through a skylight or high glazing the room already has, so every shadow falls short beneath whatever casts it',
    interiorCompact: 'daylight from above, through glazing the room already has',
  },
};

/** Where the sun (outside) or the windows (inside) are, and which way every shadow falls. */
export function sunPhrase(sun: SunPositionId, interior: boolean, compact?: boolean): string {
  const p = SUN_PHRASES[sun];
  return interior ? (compact ? p.interiorCompact : p.interior) : compact ? p.exteriorCompact : p.exterior;
}

/**
 * A lit frame's sun and its brief (trimmed; '' when it has a sun and no
 * brief), and its lighting preset when it has one (the sun is then the
 * preset's resolution of the frame's sun).
 */
export type FrameLighting = { sun: SunPositionId; light: string; preset?: LightingPresetId | undefined };

/** Every shadow from the frame's one sun: two shadow families are the signature of a composite. */
const ONE_SHADOW_FAMILY =
  "one shadow family: every shadow in the frame, whether cast by a person, a tree or a building, falls away from that one sun with the same length and edge softness, and the render's own existing shadows keep their direction";

const ONE_SHADOW_FAMILY_COMPACT =
  "one shadow family: every shadow, the people's included, falls away from that one sun; the render's own shadows keep their direction";

/** The three ways light parts a subject from its background: a value either side of it, or a rim. */
const LIGHT_SEPARATION = (people: boolean) =>
  people
    ? 'the people never merge with what is behind them: each stands in a pool of sun against shade, in shade against a sunlit background, or with a rim of light along hair and shoulders, so a lighter value, a darker one or a different colour temperature always parts them from the background'
    : 'the subject never merges with what is behind it: it sits in a pool of sun against shade, in shade against a sunlit background, or with a rim of light along its edges, so a lighter value, a darker one or a different colour temperature always parts it from the background';

const LIGHT_SEPARATION_COMPACT = (people: boolean) =>
  people
    ? 'the people never merge with what is behind them: sun against shade, shade against sun, or a rim'
    : 'the subject never merges with what is behind it: sun against shade, shade against sun, or a rim';

/** Carved out of darkness, not washed in: some of the frame is allowed to fall away. */
const LIGHT_POOLS =
  'pools, not washes: the sunlit patches small and bright, the shade between them deep, and at least one corner or pocket of the frame allowed to fall to near-darkness with only a trace of detail';

const LIGHT_POOLS_COMPACT = 'pools, not washes, one corner of the frame falling to near-darkness';

/**
 * A soft preset's shadows (overcast, north light, blue hour, lamps): one
 * shadow family would ask for a sun, and the model would invent one.
 */
const SOFT_SHADOWS =
  "no hard-edged shadow anywhere: the render's own cast shadows soften into open shade, wide and gradual, darkest where things meet the ground, under overhangs and inside openings";

const SOFT_SHADOWS_COMPACT =
  'no hard-edged shadows: cast shadows soften into open shade, darkest under overhangs and where things meet the ground';

/** A sky preset's develop closing: there is no sun to keep in place. */
const DEVELOP_LIGHT_STAYS_SKY = 'the light stays exactly as the plate has it and every shadow keeps its place and softness';

/**
 * One shadow family on a preset's plate, which relights everything: the
 * render's own shadows are not kept, so its clause keeping them is dropped.
 */
const ONE_SHADOW_FAMILY_RELIT = ONE_SHADOW_FAMILY.replace(", and the render's own existing shadows keep their direction", '');

const ONE_SHADOW_FAMILY_RELIT_COMPACT = ONE_SHADOW_FAMILY_COMPACT.replace("; the render's own shadows keep their direction", '');

/**
 * The backlit falloff and people texts with their fixed "sun behind the
 * subject" taken out (with a front or side sun it would be a second sun);
 * one replace each, so the proven text otherwise stays byte for byte.
 */
const FILM_FALLOFF_LIT = FILM_FALLOFF.replace(
  'the sun behind the subject and a little to one side, so leaves, petals, hair and the edges of things glow with rims of light; the foreground planting sits in soft shade, about one and a half stops darker than the sunlit middle ground where the people are',
  'where the sun is behind them, leaves, petals, hair and the edges of things glow with rims of light; the nearest planting sits in soft shade, about one and a half stops darker than the sunlit pools beyond it'
);

const FILM_FALLOFF_LIT_COMPACT = FILM_FALLOFF_COMPACT.replace(
  'the sun behind the subject, rims of light on leaves, petals and hair; the foreground in soft shade, one and a half stops darker than the sunlit middle ground',
  'rims of light on leaves, petals and hair where the sun is behind them; the nearest planting in soft shade, one and a half stops darker than the sunlit pools'
);

const FILM_FALLOFF_INTERIOR_LIT = FILM_FALLOFF_INTERIOR.replace(
  'the window light behind or beside the subject so edges glow with soft rims',
  'where the window is behind or beside someone, their edges glow with soft rims'
);

/** The falloff at a lit frame's last ladder level. */
const FILM_FALLOFF_LIT_BARE =
  'light in pools; deep shadows that keep a little detail, never a flat grey lift; the sky, where it shows, never burns to white';

const FILM_PEOPLE_LIT = FILM_PEOPLE.replace(
  'backlit, so faces fall into soft shade with a rim of light on hair and shoulders',
  "lit by the frame's one sun like everything around them, faces in the sun or the shade the lighting puts them in, with a rim of light on hair and shoulders wherever the sun is behind them"
);

const FILM_PEOPLE_LIT_COMPACT = FILM_PEOPLE_COMPACT.replace(
  'backlit, a rim of light on hair and shoulders',
  'lit by the one sun, a rim of light on hair and shoulders where it is behind them'
);

/** A lit plate's reference: the frame's sun beats the reference's, which could not agree with the render's shadows. */
const PLATE_REFERENCE_SENTENCE_PLANTS =
  'The last attached image is a reference photograph for plant realism only: take none of its light, colour, grade or atmosphere, and nothing from its place, buildings, objects or people.';

/** A lit frame keeps its own sun and takes only the reference's colour and quality of light. */
const LIT_REFERENCE_CLAUSE = ', in the colour and quality of the reference photograph';

/**
 * The film's four chapters, in story order: each one's light in crew
 * language, outside (`light`) and in a room (`interior`). An x-ray plate
 * takes only the facts of that light, with no look words: where the sun
 * is, which faces it lights and where the shadows fall (`direction`,
 * `directionInterior`). A frame with its own lighting design takes its sun
 * from the frame (the chapter's `sun` only when it has a brief and no sun)
 * and its time of day and numbers from the chapter: `elevation` (how high the
 * sun is, how long and soft the shadows), and `ratios` / `ratiosInterior`
 * (key to fill, subject to background, the Kelvin split), each with a
 * compact form for the ladder.
 */
export const CHAPTERS = [
  {
    id: 'morning',
    name: 'Morning',
    hint: 'First light, quiet, wide',
    light:
      'soft morning sun from behind and to the left, about 30 degrees high, long soft shadows toward camera-right across lawns and paving, trees and blossom gently backlit and glowing at their edges, warm cream bounce from pale stone, gentle atmospheric depth on the farthest trees only',
    interior:
      'soft window daylight from one side, the room high-key and airy, a gentle 2:1 on faces, pale surfaces as fill, no lamps on',
    direction:
      'early morning, the sun behind the scene and to the left, about 30 degrees above the horizon; long shadows fall toward camera-right across lawns and paving; the camera-facing sides of trees, walls and people are in open shadow, with their left and far edges lit by the sun',
    directionInterior:
      'early morning daylight, the sun low through the windows on one side; the window side of every face and object lit, the far side in shadow; no lamps on',
    sun: 'behind-left',
    elevation: 'early morning, the sun about 30 degrees above the horizon: long, soft-edged shadows',
    ratios:
      'key to fill about 4:1; the people, or the subject, one stop brighter or darker than what is directly behind them; the low sun warm, about 3500K, against cool skylight in the shade, about 6500K',
    ratiosCompact: 'key to fill 4:1, the subject a stop off its background; sun 3500K, shade 6500K',
    ratiosInterior:
      "about 3:1 across the room, brightest at the glass and darker away from it; window daylight cool, about 6500K, the fill warmer, about 4500K, bounced off the room's own timber and pale walls; no lamps on",
    ratiosInteriorCompact: '3:1 from the glass into the room; window 6500K, fill 4500K; no lamps on',
  },
  {
    id: 'play',
    name: 'Play',
    hint: 'Mid-morning, gardens alive',
    light:
      'sun high behind and to the right, long soft shadows thrown forward-left onto the lawn, trees backlit and glowing, the people in a pocket of sun with darker pockets under the trees, glitter on any water',
    interior:
      'big soft window light from behind the scene, glass and porcelain glowing, warm gold speculars, soft cream fill',
    direction:
      'mid-morning, the sun high, behind the scene and to the right; shorter shadows thrown forward-left onto the lawn; the people in a pocket of direct sun, with darker pockets of shade under the trees',
    directionInterior:
      'mid-morning daylight through windows behind the scene; the edges of things facing the windows lit, their sides toward the camera in shadow; no lamps on',
    sun: 'behind-right',
    elevation: 'mid-morning, the sun about 50 degrees up: shorter, crisp-edged shadows',
    ratios:
      'key to fill about 3:1; the people, or the subject, one stop brighter or darker than what is directly behind them; the mid-morning sun near neutral, about 5000K, against cool skylight in the shade, about 6500K',
    ratiosCompact: 'key to fill 3:1, the subject a stop off its background; sun 5000K, shade 6500K',
    ratiosInterior:
      "about 2:1 across the room, brightest at the glass and darker away from it; window daylight cool, about 6500K, the fill warmer, about 4500K, bounced off the room's own timber and pale walls; no lamps on",
    ratiosInteriorCompact: '2:1 from the glass into the room; window 6500K, fill 4500K; no lamps on',
  },
  {
    id: 'together',
    name: 'Together',
    hint: 'Soft afternoon, wrap-around light',
    light:
      'soft light from above and from the open garden behind, wrap-around light with soft shadowless gradients under canopies and pavilions, flowers popping in colour, faces filled by light bounced off decks and pale paving',
    interior:
      'soft window light from the upper right, a white table or pale wall as fill, a gentle 2:1 on the face, high-key and airy',
    direction:
      'early afternoon, the sun high above and behind the scene, over the open garden; short, soft shadows nearly under things; even light under canopies and pavilions; faces lit from above and filled by light off decks and pale paving',
    directionInterior:
      'early-afternoon daylight through windows at the upper right; surfaces facing up and to the right lit, shadows falling down and to the left; no lamps on',
    sun: 'overhead',
    elevation: 'early afternoon, the sun high, about 60 degrees up: short shadows, softened under canopies',
    ratios:
      'a gentle 2:1, the shade an open shade lifted by light bounced off pale paving and decks; the people, or the subject, one stop brighter or darker than what is directly behind them; the sun about 5500K, the open shade cool, about 6500K',
    ratiosCompact: 'a gentle 2:1 in open shade, the subject a stop off its background; sun 5500K, shade 6500K',
    ratiosInterior:
      "a gentle 2:1 across the room, brightest at the glass and darker away from it; window daylight cool, about 6500K, the fill warmer, about 4500K, bounced off the room's own timber and pale walls; no lamps on",
    ratiosInteriorCompact: 'a gentle 2:1 from the glass into the room; window 6500K, fill 4500K; no lamps on',
  },
  {
    id: 'golden',
    name: 'Golden evening',
    hint: 'Low soft sun, long rims',
    light:
      'soft evening sun low behind and to the right, just out of frame and softened by the trees, long soft shadows toward camera-left, gentle rims on hair, shoulders and leaf edges, faces filled by grass and sky bounce, catchlights in the eyes, about 2:1',
    interior:
      'low warm evening daylight through the windows from one side, no lamps on, a soft rim on edges, cream fill, nothing orange',
    direction:
      'evening, the sun low behind the scene and to the right, just out of frame, a few degrees above the horizon; long shadows toward camera-left; hair, shoulders and leaf edges lit from behind, the sides facing the camera in open shadow',
    directionInterior:
      'low evening daylight through the windows on one side; long shadows reaching across the floor away from the windows; no lamps on',
    sun: 'behind-right',
    elevation: 'evening, the sun a few degrees above the horizon and just out of frame: very long, soft-edged shadows',
    ratios:
      'key to fill 6:1, the low sun an edge light; the people a stop under a sunlit background as near-silhouettes with rims, or a stop over a shaded one; sun about 2800K against 6500K skylight; only a lamp already lit in the render glows, 2700K',
    ratiosCompact: '6:1, the sun an edge light; sun 2800K, shade 6500K; only a lamp already lit glows, 2700K',
    ratiosInterior:
      "about 4:1; the low sun through the glass about 2800K against cool 6500K skylight in the room's shade; a lamp already lit in the render glows 2700K without clipping, and none is switched on",
    ratiosInteriorCompact: '4:1; sun through the glass 2800K, shade 6500K; only a lamp already lit glows, 2700K',
  },
] as const;

export type ChapterId = (typeof CHAPTERS)[number]['id'];

export const CHAPTER_IDS = CHAPTERS.map((c) => c.id) as [ChapterId, ...ChapterId[]];

export type Chapter = (typeof CHAPTERS)[number];

export function chapterById(id: string | undefined): Chapter {
  return CHAPTERS.find((c) => c.id === id) ?? CHAPTERS[0];
}

/**
 * Named, tested lighting setups a frame can be lit with (Phase 7), each with
 * its own time of day, ratios and Kelvin split, replacing the chapter's light
 * and numbers (the chapter stays the story grouping). `relation` is how the
 * sun stands to the camera: the frame's `sun` gives only its side
 * (`presetSun`), and a `none` preset has no sun at all and names its `source`
 * instead. `edge: 'hard'` presets keep one shadow family from the sun;
 * `soft` ones soften every shadow into open shade. A soft preset is a sky
 * preset (`isSkyPreset`): no direct sun reaches the scene, so it names its own
 * light for the plate, `lightFrom` (what the plate lights the scene only from)
 * and `litBy` (what its people are lit by). `source`, `sourceCompact`,
 * `lightFrom`, `litBy` and `time` reach the x-ray plate, so they carry no look
 * words; `look`, `lookCompact` and `dark` reach the develop, so they never
 * invite a new layer in front.
 */
export const LIGHTING_PRESETS = [
  {
    id: 'golden-backlight',
    name: 'Golden backlight',
    hint: 'Low evening sun behind the scene: long rims, long shadows to camera',
    setting: 'exterior',
    relation: 'back',
    defaultSun: 'behind-right',
    edge: 'hard',
    time: 'evening, the sun a few degrees above the horizon, just out of frame: very long, soft-edged shadows stretch toward the camera across lawn and paving',
    numbers:
      'key to fill 6:1, the sun an edge light, grass and sky the only fill; the people one stop under a sunlit background as near-silhouettes with rims, or one stop over a shaded one; sun 2800K, skylight 6500K; only a lamp already lit in the render glows, 2700K',
    numbersCompact: '6:1, the sun an edge light, the people a stop off their background; sun 2800K, shade 6500K, lit lamps 2700K',
    atmosphere: "a thin haze in the far distance only, where the low sun's beams cross the trees; the near air clear",
    dark: 'the shaded side of the nearest mass of planting or building falls to near-darkness',
    look: 'rims of light along hair, shoulders and every leaf edge; tree crowns lit from behind, their outer leaves translucent amber-green over deep inner shade; light lies in pools, long bars of sun between long shadows; faces in open shade, unclipped, filled softly by grass and sky bounce, a catchlight in any eye that shows; the sky near the sun keeps its colour',
    lookCompact: 'rims of light on hair and leaf edges, sunlit crowns translucent over deep inner shade; light in pools; faces unclipped in open shade, filled by grass and sky bounce',
  },
  {
    id: 'morning-backlight-trees',
    name: 'Morning backlight through trees',
    hint: 'Low sun behind the trees: leaves lit from behind, long shadows to camera',
    setting: 'exterior',
    relation: 'back',
    defaultSun: 'behind-left',
    edge: 'hard',
    time: 'early morning, the sun about 20 degrees above the horizon and coming through the trees: long, soft-edged shadows toward the camera, broken by trunks and crowns',
    numbers:
      'key to fill 4:1; the people, or the subject, one stop brighter in a pool of sun or one stop darker against sunlit leaves; the low sun 3500K on every lit edge, against 6500K skylight filling the shade; no lamps on',
    numbersCompact: '4:1, the subject a stop off its background; sun through the leaves 3500K, open shade 6500K',
    atmosphere: 'a thin morning haze in the far distance only, where beams of sun slant through the trees; the near air clear',
    dark: 'the shade under the nearest trees falls to near-darkness, trunks and leaves only just readable',
    look: 'leaves translucent and lit from within wherever the sun is behind them, each crown a bright edge over darker inner leaves; rims of light on hair, shoulders, petals and grass blades; sun lands in pools on paving and lawn, broken by the leaves, with cool open shade between them; faces unclipped, filled by light off pale paving',
    lookCompact: 'leaves translucent where the sun is behind them, bright crown edges over darker inner leaves; rims of light; sun in pools on paving and lawn, cool open shade between',
  },
  {
    id: 'morning-side',
    name: 'Morning side light',
    hint: 'Low sun from one side: raking light that shows every texture',
    setting: 'exterior',
    relation: 'side',
    defaultSun: 'left',
    edge: 'hard',
    time: 'early morning, the sun about 25 degrees above the horizon: long, crisp-edged shadows laid across the frame',
    numbers:
      'key to fill 4:1 between the sunlit and the shaded side of every face, trunk and wall; the people, or the subject, one stop off what is behind them; sun 3800K, skylight in the shade 6500K; no lamps on',
    numbersCompact: '4:1 lit side to shaded side, the subject a stop off its background; sun 3800K, shade 6500K',
    atmosphere: 'clean air, no haze: the farthest trees as crisp as the nearest',
    dark: 'the side of every mass turned away from the sun falls toward near-darkness',
    look: 'raking light that skims every surface, so each texture stands in relief: bark furrows, leaf veins and serrated edges, brick joints, setts and timber; one side of each tree crown sunlit leaf by leaf, the other side deep green shade; light in pools across lawn and paving; the shaded sides cool, faces unclipped on their lit side',
    lookCompact: 'raking light, every texture in relief, bark, leaves, brick and setts; each crown sunlit on one side, deep shade on the other; light in pools; the shaded sides cool',
  },
  {
    id: 'dappled-canopy',
    name: 'Dappled canopy',
    hint: 'High sun broken by the trees into pools on paving and people',
    setting: 'exterior',
    relation: 'top',
    defaultSun: 'overhead',
    edge: 'hard',
    time: 'late morning, the sun about 55 degrees up and broken by the tree canopy into crisp-edged patches of sun; short shadows under everything',
    numbers:
      'key to fill 5:1 between the patches of sun and the shade around them; the people, or the subject, one stop brighter in a patch or one stop darker against one; sun 5200K, the canopy shade 6500K; no lamps on',
    numbersCompact: '5:1 patch to shade, the subject a stop off its background; sun 5200K, canopy shade 6500K',
    atmosphere: 'clean air, no haze, so every patch of sun keeps its edge',
    dark: 'the deepest shade under the canopy falls to near-darkness',
    look: "patches of sun on paving, shoulders and hair, each the shape of the gaps in the leaves above; light in pools, never an even wash; the shade between them cool and deep; the canopy's underside dark, with specks of sky and sun breaking through, the leaves at its sunlit edge translucent; faces unclipped where a patch lands",
    lookCompact: 'patches of sun the shape of the gaps in the leaves, on paving, shoulders and hair; light in pools, the shade cool and deep; the canopy dark with bright specks',
  },
  {
    id: 'soft-overcast',
    name: 'Soft overcast',
    hint: 'Sourceless sky, gentle 2:1 wrap, no hard shadows; dark pockets kept',
    setting: 'exterior',
    relation: 'none',
    defaultSun: 'overhead',
    edge: 'soft',
    source: 'a bright, even overcast, the whole sky one soft source with no sun and no direction to the light, more of it from above than from the sides',
    sourceCompact: 'a sourceless overcast sky',
    lightFrom: 'this overcast sky',
    litBy: 'overcast sky',
    time: 'midday under thick cloud: no cast shadows, only open shade under trees, eaves and furniture',
    numbers:
      'a gentle 2:1 between the sky-facing tops of things and their undersides; the people, or the subject, half a stop to a stop off their background; daylight 6500K, the deep shade 7000K; no lamps on',
    numbersCompact: '2:1, the subject half a stop off its background; daylight 6500K, deep shade 7000K',
    atmosphere: 'clean air, no haze; the far distance only slightly paler',
    dark: 'the pockets under eaves, inside openings and under the densest canopy fall to near-darkness',
    look: 'soft wrap around every form, wide gradients from light tops to dark undersides, darkest where things meet the ground and each other; no pools: colour and value carry the separation; tree crowns modelled by the sky alone, bright on top and dark beneath, every leaf with clear shape and rich, varied green; nothing flat or grey',
    lookCompact: 'soft wrap, wide gradients, darkest where things meet; no pools, colour carries the separation, crowns bright on top and dark beneath; nothing flat or grey',
  },
  {
    id: 'blue-hour',
    name: 'Blue hour',
    hint: 'Sun down, cool blue sky; warm lamps only where the render shows them',
    setting: 'exterior',
    relation: 'none',
    defaultSun: 'overhead',
    edge: 'soft',
    source:
      'the sun just below the horizon, the sky the one daylight source, brightest toward where the sun set, and the lamps and lit windows the render already shows the only other light',
    sourceCompact: 'the sun below the horizon, the sky the only daylight',
    lightFrom: 'this dusk sky and the lamps the render already shows',
    litBy: 'dusk sky and lamplight',
    time: 'twenty minutes after sunset: no cast shadows from the sky, only soft shade under eaves and canopies',
    numbers:
      'the sky 9000K, deep blue; the fittings the render already shows switched on at 2700K, their pools two stops over the sky-lit surfaces beside them, every lamp without clipping; none is added',
    numbersCompact: 'sky 9000K; lamps 2700K, two stops over the sky-lit surfaces, unclipped',
    atmosphere: 'clean air, no haze, the far trees dark shapes against the last light',
    dark: 'the farthest pockets of deep blue shade fall to near-darkness',
    look: 'a few small pools of warm light where the lamps fall, deep blue everywhere else; lamps and windows glow without clipping; tree crowns dark against the brighter sky, the leaves nearest a lamp lit warm; the people parted from the dark by a pool of lamplight or a lighter value behind them',
    lookCompact: 'a few small pools of warm light, deep blue everywhere else; lamps unclipped; crowns dark against the sky, leaves by a lamp lit warm',
  },
  {
    id: 'morning-window',
    name: 'Morning window light',
    hint: 'Low sun through the windows on one side, crisp shafts across the room',
    setting: 'interior',
    relation: 'side',
    defaultSun: 'left',
    edge: 'hard',
    time: 'early morning, the sun low through the glass: long, crisp-edged shafts of sun and shadows laid across the floor',
    numbers:
      'key to fill 4:1 between the shafts and the room; the people, or the subject, one stop off what is behind them; sun 3500K, skylight at the glass 6500K, the bounce off timber and pale walls 4500K; no lamps on',
    numbersCompact: '4:1 shaft to room, the subject a stop off its background; sun 3500K, sky 6500K, bounce 4500K; no lamps on',
    atmosphere: 'a trace of haze only inside the shafts, showing their edges; the rest of the air clear',
    dark: 'the corner farthest from the glass falls to near-darkness',
    look: 'shafts of sun across floor and furniture, light in pools where they land, the rest of the room in soft shade; a warm bounce off timber and pale walls lifts faces without flattening them; any plant by the window lit through its leaves; the far side of the room cool; nothing in a shaft clips',
    lookCompact: 'shafts of sun on floor and furniture, light in pools, warm bounce off timber; plants by the glass lit through their leaves; the far room cool',
  },
  {
    id: 'north-light',
    name: 'Soft north light',
    hint: 'Sky light only from one side, soft, even, shadowless; no lamps',
    setting: 'interior',
    relation: 'side',
    defaultSun: 'left',
    edge: 'soft',
    lightFrom: 'this soft window light',
    litBy: 'window light',
    time: 'any hour: the windows face away from the sun, so no direct sun enters, only sky light, brightest at the glass',
    numbers:
      'a gentle 2:1 from the window side of every face and object to its far side; the people, or the subject, half a stop off what is behind them; sky light 6500K, the bounce off the room 4500K; no lamps on',
    numbersCompact: '2:1 from the window side, the subject half a stop off its background; sky 6500K, bounce 4500K; no lamps on',
    atmosphere: 'clean air, no haze, every edge and texture crisp',
    dark: 'the corner farthest from the glass and the space under furniture fall to near-darkness',
    look: 'soft wrap from the window side, one smooth gradient from the glass into the room, darkest away from the glass; no pools and no shafts; faces modelled by the side light, never flat; plants by the window keep clear leaf shape and colour; linen, timber and stone show their texture in the soft side light',
    lookCompact: 'soft wrap, one smooth gradient from the glass, darkest away from it; no pools; faces modelled by the side light, nothing flat',
  },
  {
    id: 'golden-window',
    name: 'Golden window glow',
    hint: 'Low evening sun through the glass behind the scene, long warm shafts',
    setting: 'interior',
    relation: 'back',
    defaultSun: 'behind-right',
    edge: 'hard',
    time: 'evening, the sun a few degrees above the horizon and low through the glass: long shafts across the room, long shadows reaching toward the camera',
    numbers:
      'key to fill 6:1, the sun an edge light from the glass; the people one stop under the bright window as near-silhouettes with rims, or one stop over the shaded room; sun 2800K, skylight 6500K; only a lamp already lit in the render glows, 2700K',
    numbersCompact: '6:1, the sun an edge light from the glass; sun 2800K, skylight 6500K; only a lamp already lit glows, 2700K',
    atmosphere: 'the faintest haze only where the shafts cross the room, showing their edges; the rest of the air clear',
    dark: 'everything out of the shafts, except where the bounce reaches, falls toward near-darkness',
    look: 'rims on hair, shoulders and the edges of furniture and leaves; light in pools where the shafts land on floor and table; a near-silhouette against the glass allowed, the face still unclipped and lifted by a warm bounce; plants against the window lit through their leaves; the view through the glass keeps its colour',
    lookCompact: 'rims on hair, edges and leaves; light in pools where the shafts land; near-silhouettes against the glass, faces unclipped',
  },
  {
    id: 'evening-lamps',
    name: 'Evening lamps',
    hint: 'Night outside; the room lit only by the lamps the render shows, 2700K',
    setting: 'interior',
    relation: 'none',
    defaultSun: 'overhead',
    edge: 'soft',
    source: 'night outside, the glass dark, and the lamps and fittings the render already shows switched on as the only light in the room',
    sourceCompact: 'night outside, the room lit only by its own lamps',
    lightFrom: 'the lamps the render already shows',
    litBy: 'lamplight',
    time: 'well into the night: the lamps throw small pools of light and the room falls away between them',
    numbers: 'key to fill 8:1; the pools two stops over the room around them; every lamp 2700K, its shade or bulb without clipping; none is added',
    numbersCompact: '8:1, the pools two stops over the room; lamps 2700K, unclipped, none added',
    atmosphere: 'clean air, no haze around the lamps',
    dark: 'the far corners and the ceiling above the lamps fall to near-darkness',
    look: "warm pools on table, book and face, each person lit by the lamp beside them; the room falls into darkness between the pools; the glass a deep blue or black mirror holding the lamps' reflections; any plant near a lamp lit warm on its nearest leaves; nothing clipped",
    lookCompact: 'warm pools on table, book and face; the room falls into darkness between them; the glass a deep blue or black mirror; nothing clipped',
  },
] as const satisfies readonly {
  id: string;
  name: string;
  hint: string;
  setting: 'exterior' | 'interior';
  relation: 'back' | 'side' | 'top' | 'none';
  defaultSun: SunPositionId;
  edge: 'hard' | 'soft';
  source?: string;
  sourceCompact?: string;
  lightFrom?: string;
  litBy?: string;
  time: string;
  numbers: string;
  numbersCompact: string;
  atmosphere: string;
  dark: string;
  look: string;
  lookCompact: string;
}[];

export type LightingPresetId = (typeof LIGHTING_PRESETS)[number]['id'];

export const LIGHTING_PRESET_IDS = LIGHTING_PRESETS.map((p) => p.id) as [LightingPresetId, ...LightingPresetId[]];

export type LightingPreset = (typeof LIGHTING_PRESETS)[number];

/** `undefined` for an unknown or missing id: a stale id is as good as none. */
export function lightingPresetById(id: string | undefined): LightingPreset | undefined {
  return LIGHTING_PRESETS.find((p) => p.id === id);
}

/**
 * A sky preset has no direct sun: the open sky, a window's sky light or the
 * lamps the render shows light it (overcast, north light, blue hour, evening
 * lamps), so its texts never name a sun, a pool of sun or a sunlit highlight.
 * In this library that is exactly a soft edge. It may still have a side: north
 * light comes from the window's.
 */
export function isSkyPreset(preset: LightingPreset): preset is SkyPreset {
  return preset.edge === 'soft';
}

/** A preset with no direct sun (`isSkyPreset`): it carries `lightFrom` and `litBy`. */
export type SkyPreset = Extract<LightingPreset, { edge: 'soft' }>;

/** The side a sun position is on, if it has one. */
function sunSide(sun: SunPositionId | undefined): 'left' | 'right' | undefined {
  return sun?.endsWith('left') ? 'left' : sun?.endsWith('right') ? 'right' : undefined;
}

/** The one sun position the preset's relation allows, from the frame's sun (its side) or the preset's default. */
export function presetSun(preset: LightingPreset, sun: SunPositionId | undefined): SunPositionId {
  const side = sunSide(sun) ?? sunSide(preset.defaultSun) ?? 'right';
  if (preset.relation === 'back') return `behind-${side}`;
  if (preset.relation === 'side') return side;
  if (preset.relation === 'top') return 'overhead';
  return preset.defaultSun;
}

/** The positions the Sun select offers under this preset: back → ['behind-left','behind-right']; side → ['left','right']; top → ['overhead']; none → []. */
export function presetSunIds(preset: LightingPreset): readonly SunPositionId[] {
  if (preset.relation === 'back') return ['behind-left', 'behind-right'];
  if (preset.relation === 'side') return ['left', 'right'];
  if (preset.relation === 'top') return ['overhead'];
  return [];
}

/**
 * The lit rule, shared by every builder: `undefined` when the frame has
 * neither a sun nor a brief nor a lighting preset (the chapter's fixed light,
 * today's output); else the sun (with a preset, its resolution of the
 * frame's sun; without, the chapter's default when only a brief was given),
 * the trimmed brief ('' allowed) and the preset's id when there is one.
 */
export function frameLighting(frame: {
  chapter: ChapterId;
  sun?: SunPositionId | undefined;
  light?: string | undefined;
  lighting?: LightingPresetId | undefined;
}): FrameLighting | undefined {
  const light = frame.light?.trim() ?? '';
  const preset = lightingPresetById(frame.lighting);
  if (frame.sun === undefined && !light && !preset) return undefined;
  return { sun: preset ? presetSun(preset, frame.sun) : (frame.sun ?? chapterById(frame.chapter).sun), light, ...(preset ? { preset: preset.id } : {}) };
}

/** A lit frame's numbers from its chapter, then separation and pools, each closed with "; ". */
function litNumbers(chapter: Chapter, interior: boolean, people: boolean, compact: boolean): string {
  const ratios = interior
    ? compact
      ? chapter.ratiosInteriorCompact
      : chapter.ratiosInterior
    : compact
      ? chapter.ratiosCompact
      : chapter.ratios;
  return `${ratios}; ${compact ? LIGHT_SEPARATION_COMPACT(people) : LIGHT_SEPARATION(people)}; ${compact ? LIGHT_POOLS_COMPACT : LIGHT_POOLS}; `;
}

/**
 * How a lit develop lights its people: the frame's one sun, with the face
 * and eye rules lightcraft never lets go (nothing clipped, eyes alive).
 */
const LIT_PEOPLE_LIGHT =
  'lit by that one sun like everything around them, faces and white linen holding their detail and never clipped, any eye that shows keeping a small catchlight from the open sky';

/** LIT_PEOPLE_LIGHT under a sky preset, which has no sun. */
const LIT_PEOPLE_LIGHT_SKY = LIT_PEOPLE_LIGHT.replace('lit by that one sun', 'lit by that same light').replace(
  'from the open sky',
  'from the nearest bright source'
);

/**
 * The lit texts as a develop reads them: the plate has already staged the
 * frame, so separation and shade come from light where things stand, never
 * from moving people or bringing new planting in front (the walkway test,
 * 2026-10-29, moved the family closer and grew a foreground bush).
 */
function inPlace(text: string): string {
  return text
    .replace('each stands in a pool of sun', 'lit where they already stand, by a pool of sun')
    .replace('it sits in a pool of sun', 'lit where it already sits, by a pool of sun')
    .replace(': sun against shade, shade against sun, or a rim', ', lit where they stand: sun against shade, shade against sun, or a rim')
    .replace('the nearest planting sits in soft shade', 'whatever planting the plate already has nearest sits in soft shade')
    .replace('the nearest planting in soft shade', 'whatever planting the plate already has nearest in soft shade')
    .replace('the foreground in soft shade', 'whatever is already in front in soft shade')
    .replace('the foreground planting sits in soft shade', 'whatever planting the plate already has in front sits in soft shade')
    .replace('the far background is brighter and softer with gentle aerial perspective in the distance only', 'the far background only slightly lighter, with a touch of aerial perspective in the far distance only');
}

/** A lit frame's brief, closing its LIGHT item ('' when it has none). */
function litBrief(brief: string): string {
  return brief ? ` In this frame: ${sentence(brief)}` : '';
}

/** The separation texts under a sky preset: light against shade, never sun. */
function skyify(text: string): string {
  return text
    .replace(
      'a pool of sun against shade, in shade against a sunlit background, or with a rim of light',
      'a pool of light against shade, in shade against a brighter background, or with a rim of light'
    )
    .replace('sun against shade, shade against sun', 'light against shade, shade against light');
}

/**
 * The develop's tone, vegetation and texture under a sky preset: highlights,
 * sheen and glints come from the bright sky or a lit lamp, never a sun, and
 * the sky keeps its own colour (an overcast or night sky is not clear blue).
 */
function skyDevelop(text: string): string {
  return text
    .replace('exposure set for the sunlit highlights', 'exposure set for the brightest sky-lit or lamp-lit highlights')
    .replace('blossom saturated where the sun strikes it', 'blossom saturated where the light falls on it')
    .replace('blossom saturated in the sun', 'blossom saturated in the light')
    .replace('a clear blue sky deepening toward the top', 'the sky, where it shows, keeping its own colour and detail')
    .replace('the sky clear blue', 'the sky keeping its own colour')
    .replace('a soft sheen only where the sun catches them', 'a soft sheen only where the sky or a lit lamp catches them')
    .replace('sunlit outer leaves bright and translucent', 'outer leaves bright where the light reaches them')
    .replace('sunlit outer leaves over deep inner shade', 'outer leaves lit over deep inner shade')
    .replace('glints flash where the sun catches glossy leaves, glass and metal', 'glints flash only where the sky or a lit lamp reflects in glossy leaves, glass and metal')
    .replace('glints where the sun catches glossy leaves and metal', 'glints only where the sky or a lit lamp reflects in glossy leaves and metal');
}

/** The plate's people under a sky preset: lit by the preset's own light, their shadows as soft as everything's. */
function platePeopleSky(text: string, P: SkyPreset): string {
  return text
    .replace(
      "lit by the same sun as everything around them, with shadows in the same direction, length and softness as the trees' beside them",
      `lit by the same ${P.litBy} as everything around them, with the same soft shadows as everything beside them`
    )
    .replace("lit by the same sun with the trees' shadow direction", `lit by the same ${P.litBy}, with soft shadows`);
}

/** A preset's separation text (`place` is the develop's `inPlace`, run before `skyify`). */
function separationFor(P: LightingPreset, people: boolean, compact: boolean, place: (text: string) => string = (text) => text): string {
  const base = place(compact ? LIGHT_SEPARATION_COMPACT(people) : LIGHT_SEPARATION(people));
  return isSkyPreset(P) ? skyify(base) : base;
}

/**
 * A preset's sun phrase (inside, the windows' side; a preset with no direction,
 * `relation: 'none'`, names its source instead), then its time of day; bare
 * drops the time.
 */
function presetHead(P: LightingPreset, sun: SunPositionId, interior: boolean, bare: boolean): string {
  const where = P.relation === 'none' ? ((bare ? P.sourceCompact : P.source) ?? '') : sunPhrase(sun, interior, bare);
  return bare ? where : `${where}; ${P.time}`;
}

/**
 * One shadow family from a sun preset's sun (on a plate, without keeping the
 * render's own shadows: it relights everything); a sky preset softens every
 * shadow.
 */
function presetShadows(P: LightingPreset, compact: boolean, plate: boolean): string {
  if (isSkyPreset(P)) return compact ? SOFT_SHADOWS_COMPACT : SOFT_SHADOWS;
  if (plate) return compact ? ONE_SHADOW_FAMILY_RELIT_COMPACT : ONE_SHADOW_FAMILY_RELIT;
  return compact ? ONE_SHADOW_FAMILY_COMPACT : ONE_SHADOW_FAMILY;
}

/** A preset's numbers, separation, haze decision (full only) and dark pocket, each closed with "; " ('' when bare). */
function presetMiddle(P: LightingPreset, separation: string, compact: boolean, bare: boolean): string {
  return bare ? '' : `${compact ? P.numbersCompact : P.numbers}; ${separation}; ${compact ? '' : `${P.atmosphere}; `}${P.dark}; `;
}

/**
 * How a frame is shot. The lens is fixed by the grammar, long and fast for
 * every one so the foreground and the distance fall out of focus; `reframe`
 * grammars push in along the render's own line of sight (never a new angle);
 * `scale` is how big the people are, appended to every people brief, and
 * `plateScale` the same for an x-ray plate, with nothing out of focus.
 */
export const GRAMMARS = [
  {
    id: 'wide',
    name: 'Wide',
    hint: 'People small and far',
    lens: '85 mm cine lens at f/2.8',
    people: true,
    reframe: false,
    scale:
      'They are small and far, about one eighth to one tenth of the frame height, faces unreadable, seen past something already in the scene (planting, a railing, a lounger) softly out of focus in the foreground.',
    plateScale:
      'They are small and far, about one eighth to one tenth of the frame height, faces unreadable, seen past something already in the scene (planting, a railing, a lounger) in the foreground.',
  },
  {
    id: 'mid',
    name: 'Mid',
    hint: 'People a quarter of the frame',
    lens: '85 mm cine lens at f/2',
    people: true,
    reframe: false,
    scale:
      'They are mid-distance, about one quarter to one fifth of the frame height, mostly turned away or in three-quarter profile, no one looking into the lens.',
    plateScale:
      'They are mid-distance, about one quarter to one fifth of the frame height, mostly turned away or in three-quarter profile, no one looking into the lens.',
  },
  {
    id: 'close',
    name: 'Close-up',
    hint: 'One person, long lens',
    lens: '85 mm cine lens at f/2',
    people: true,
    reframe: true,
    scale:
      "One person fills about a third of the frame height; a soft out-of-focus layer of the scene's own planting or furniture crosses one edge; the face may be clear, in soft open shade, never looking into the lens.",
    plateScale:
      "One person fills about a third of the frame height; a layer of the scene's own planting or furniture crosses one edge; the face may be clear, never looking into the lens.",
  },
  {
    id: 'detail',
    name: 'Detail insert',
    hint: 'No people, macro',
    lens: '100 mm macro at f/2.8',
    people: false,
    reframe: true,
    scale: '',
    plateScale: '',
  },
  {
    id: 'empty',
    name: 'Empty',
    hint: 'Re-photographed, no people',
    lens: '85 mm cine lens at f/2.8',
    people: false,
    reframe: false,
    scale: '',
    plateScale: '',
  },
] as const satisfies readonly {
  id: string;
  name: string;
  hint: string;
  lens: string;
  people: boolean;
  reframe: boolean;
  scale: string;
  plateScale: string;
}[];

export type GrammarId = (typeof GRAMMARS)[number]['id'];

export const GRAMMAR_IDS = GRAMMARS.map((g) => g.id) as [GrammarId, ...GrammarId[]];

export type Grammar = (typeof GRAMMARS)[number];

export function grammarById(id: string | undefined): Grammar {
  return GRAMMARS.find((g) => g.id === id) ?? GRAMMARS[0];
}

/**
 * A frame's depth of field (Phase 7), its own design beside the light: the
 * grammar's lens at one of four apertures. The filmic frame and the develop
 * use it; the x-ray plate always stays deep focus.
 */
export const DEPTH_PRESETS = [
  { id: 'deep', name: 'Deep focus', hint: 'f/8: everything sharp, front to back', aperture: 'f/8' },
  { id: 'natural', name: 'Natural', hint: 'f/4: the subject sharp, the far background a little soft', aperture: 'f/4' },
  { id: 'portrait', name: 'Portrait', hint: 'f/2: the subject sharp, foreground and background clearly soft', aperture: 'f/2' },
  { id: 'dreamy', name: 'Dreamy', hint: 'f/1.4: only the focus plane sharp', aperture: 'f/1.4' },
] as const;

export type DepthId = (typeof DEPTH_PRESETS)[number]['id'];

export const DEPTH_IDS = DEPTH_PRESETS.map((d) => d.id) as [DepthId, ...DepthId[]];

export function depthById(id: string | undefined): (typeof DEPTH_PRESETS)[number] | undefined {
  return DEPTH_PRESETS.find((d) => d.id === id);
}

/** Where the focus plane sits. */
export const FOCUS_TARGETS = [
  { id: 'subject', name: 'The people', hint: 'Focus on the people; on a frame without people, on its subject' },
  { id: 'planting', name: 'The nearest planting', hint: 'Focus on the nearest plants; everything behind them softens' },
  { id: 'middle', name: 'The middle ground', hint: 'Focus on the middle distance: the building or the pool edge' },
  { id: 'far', name: 'The far garden', hint: 'Focus on the far distance; the nearest things soften' },
] as const;

export type FocusId = (typeof FOCUS_TARGETS)[number]['id'];

export const FOCUS_IDS = FOCUS_TARGETS.map((t) => t.id) as [FocusId, ...FocusId[]];

export type FrameCamera = { depth: DepthId; focus: FocusId };

/** The shot's own depth when only a focus is chosen. */
export const GRAMMAR_DEPTH: Record<GrammarId, DepthId> = { wide: 'natural', mid: 'natural', close: 'portrait', detail: 'portrait', empty: 'natural' };

/** undefined when the frame has neither (today's camera texts); else the depth (the grammar's when unset) and the focus ('subject' when unset). */
export function frameCamera(frame: { grammar: GrammarId; depth?: DepthId | undefined; focus?: FocusId | undefined }): FrameCamera | undefined {
  // A stale id is as good as none, as for a lighting preset.
  const depth = depthById(frame.depth)?.id;
  const focus = FOCUS_TARGETS.find((t) => t.id === frame.focus)?.id;
  if (depth === undefined && focus === undefined) return undefined;
  return { depth: depth ?? GRAMMAR_DEPTH[grammarById(frame.grammar).id], focus: focus ?? 'subject' };
}

/** What the focus plane is set on, in the frame's own terms. */
export function focusPhrase(focus: FocusId, people: boolean, interior: boolean): string {
  if (focus === 'planting') return interior ? 'the nearest furniture and objects' : 'the nearest planting';
  if (focus === 'middle') return interior ? 'the middle of the room' : 'the middle ground';
  if (focus === 'far') return interior ? 'the far side of the room and the view through the glass' : 'the far garden';
  return people ? 'the people' : 'the subject';
}

/** What each aperture keeps sharp and how it softens the rest, focused on `focus`; out-of-focus planting stays real leaves. */
const DEPTH_TEXT: Record<DepthId, (focus: string) => string> = {
  deep: (focus) =>
    `deep focus, everything sharp front to back, focus set on ${focus}: the nearest leaves, the paving joints and the farthest tree crowns all crisp and legible, as a stopped-down lens holds them`,
  natural: (focus) =>
    `focus on ${focus}, crisp with everything at that distance; the nearest things and the far distance only slightly soft, every leaf, crown and façade still readable`,
  portrait: (focus) =>
    `focus on ${focus}, crisp to the last leaf and thread at that distance; everything nearer and farther clearly soft, real leaves softened by the lens into shapes of light and shade, never smeared paint`,
  dreamy: (focus) =>
    `only the plane of ${focus} crisp; everything nearer and farther melting into smooth bokeh, the brightest points in the leaves turning to soft round discs, crowns to soft masses that still read as foliage`,
};

/** The develop's plate is deep focus: it softens only what the chosen lens would. */
const DEVELOP_DEPTH_TAIL = (depth: DepthId, focus: string) =>
  depth === 'deep'
    ? '; the plate is sharp front to back: keep it so'
    : `; the plate is sharp front to back, so soften only what that lens would and only what the plate already has there, nearer and farther than ${focus}`;

/** A frame's CAMERA text from its depth and focus (the develop also says what the deep-focus plate keeps). */
export function depthCamera(grammar: Grammar, camera: FrameCamera, interior: boolean, develop: boolean): string {
  const focus = focusPhrase(camera.focus, grammar.people, interior);
  const aperture = depthById(camera.depth)?.aperture ?? DEPTH_PRESETS[1].aperture;
  return `${plateLens(grammar.lens)} at ${aperture}: ${DEPTH_TEXT[camera.depth](focus)}${develop ? DEVELOP_DEPTH_TAIL(camera.depth, focus) : ''}; no HDR look, no sharpening halos`;
}

/**
 * The household, the same people in every frame. Wardrobe is
 * heritage-neutral; heritage comes from the plan. Friends and staff may
 * appear in a frame but are never on a cast sheet.
 */
export const CAST_ROLES = [
  { id: 'mother', name: 'Mother', description: 'a woman in her mid-thirties, long dark hair tied back, an ivory linen dress' },
  { id: 'father', name: 'Father', description: 'a man in his late thirties, a short beard, a sand linen shirt and chinos' },
  { id: 'daughter', name: 'Daughter', description: 'a girl of six, a white cotton dress, hair in two plaits' },
  { id: 'son', name: 'Son', description: 'a boy of eight, a pale blue T-shirt and shorts' },
  {
    id: 'grandmother',
    name: 'Grandmother',
    description: 'a woman in her late sixties, silver hair in a low bun, a pale sage cotton dress and a cream shawl',
  },
  { id: 'grandfather', name: 'Grandfather', description: 'a man in his seventies, white hair, a pale linen shirt' },
] as const;

export type CastRoleId = (typeof CAST_ROLES)[number]['id'];

export const CAST_ROLE_IDS = CAST_ROLES.map((r) => r.id) as [CastRoleId, ...CastRoleId[]];

/**
 * What every generated cast sheet is shot on, whatever the frames use: Nano
 * Banana 2.1 reads the household as real people, and at 4K their faces stay
 * readable when a frame crops into them.
 */
export const CAST_SHEET_MODEL: { imageModel: ImageModelId; resolution: string } = {
  imageModel: 'nano-banana-2-1',
  resolution: '4k',
};

/**
 * Signature moments the planner may pick for a frame: who is there and what
 * they are doing, by cast role (or "friends"), in a chapter and grammar that
 * suit it. `people` never says how big they are (the grammar's `scale` is
 * added at prompt time); `props` are the small personal things they bring,
 * the only additions besides themselves. Old stills keep their ids.
 */
export const MOMENTS = [
  // Morning
  {
    id: 'garden-walk',
    name: 'A walk in the garden',
    hint: 'One resident strolling the paths',
    grammar: 'wide',
    chapter: 'morning',
    people:
      'The grandmother walks slowly along the path in the morning quiet, her cream shawl around her shoulders, glancing at the planting as she goes, her back half-turned to the camera.',
    props: '',
  },
  {
    id: 'poolside',
    name: 'By the pool',
    hint: 'Resting at the far pool edge',
    grammar: 'wide',
    chapter: 'morning',
    people:
      'Far away in the pool the mother, in a white swimsuit, rests her folded arms on the edge, her face turned toward the garden; on the nearest lounger lie a wide straw hat, an open book and a glass of iced lemonade.',
    props: 'a wide straw hat, an open book and a glass of iced lemonade on the nearest lounger',
  },
  {
    id: 'morning-yoga',
    name: 'Morning yoga',
    hint: 'A quiet practice on a deck or lawn',
    grammar: 'mid',
    chapter: 'morning',
    people:
      'The mother and father practise yoga side by side on mats in cream and sage yoga sets, seated cross-legged with arms raised and palms together, eyes closed, calm and absorbed.',
    props: 'two yoga mats',
  },
  {
    id: 'hand-in-water',
    name: 'A hand in the water',
    hint: 'Fingertips trailing through the water',
    grammar: 'close',
    chapter: 'morning',
    people:
      "The mother sits at the water's edge trailing one hand through the surface, her fingertips skimming it so small rings of ripples spread, her eyes lowered to the water, a thin gold bangle at her wrist.",
    props: 'a thin gold bangle',
  },
  // Play
  {
    id: 'kids-at-play',
    name: 'Children at play',
    hint: 'Kids playing, a parent nearby',
    grammar: 'mid',
    chapter: 'play',
    people:
      'The son and daughter run and play on the open ground, one chasing the other mid-laugh, while the mother watches from close by, smiling, everyone unhurried.',
    props: '',
  },
  {
    id: 'grandparent-child',
    name: 'With a grandparent',
    hint: 'A grandparent and a grandchild',
    grammar: 'mid',
    chapter: 'play',
    people:
      'The grandfather walks the path hand in hand with the daughter, who reaches up toward a butterfly with her free hand, laughing, while he smiles down at her.',
    props: '',
  },
  {
    id: 'garden-harvest',
    name: 'Garden harvest',
    hint: 'Picking fruit, herbs or flowers',
    grammar: 'mid',
    chapter: 'play',
    people:
      'The grandmother reaches into the planting to pick a few sprigs while the daughter holds a wicker basket half full beside her, looking up at her, both smiling.',
    props: 'a wicker basket',
  },
  {
    id: 'painter-easel',
    name: 'Painting in the garden',
    hint: 'Watercolour at an easel',
    grammar: 'mid',
    chapter: 'play',
    people:
      'The grandmother sits at a wooden easel at the edge of the path painting the garden in watercolour, a wide straw hat on, seen from behind and to the side, her face hidden by the brim.',
    props: 'a wooden easel, a watercolour pad and brushes',
  },
  // Together
  {
    id: 'tea-for-two',
    name: 'Tea for two',
    hint: 'Sharing tea, one pouring',
    grammar: 'close',
    chapter: 'together',
    people:
      'The mother sits at the table holding a cup of tea in both hands, smiling across at the father, whose hand and linen sleeve show at the frame edge as he pours from a porcelain teapot.',
    props: 'a porcelain teapot, two cups and saucers on a small tray',
  },
  {
    id: 'tea-pour',
    name: 'Tea being poured',
    hint: 'A hand pouring tea, steam rising',
    grammar: 'close',
    chapter: 'together',
    people:
      'The grandmother pours tea from a porcelain teapot in a thin stream into two cups on the table, steam curling up, her face in soft profile above, a plate of biscuits beside the cups.',
    props: 'a porcelain teapot, two cups and a plate of biscuits',
  },
  {
    id: 'child-dessert',
    name: 'A treat at the table',
    hint: 'A child delighted by a dessert',
    grammar: 'close',
    chapter: 'together',
    people:
      'The daughter sits at the nearest table, eyes wide with delight, as a hand in a dark suit sleeve sets a white plate with a small strawberry tart in front of her.',
    props: 'a white plate with a small strawberry tart',
  },
  {
    id: 'reading-nook',
    name: 'A quiet afternoon',
    hint: 'Reading by the window',
    grammar: 'close',
    chapter: 'together',
    people:
      'The grandfather sits in the chair by the window reading a book, a cup of tea within reach, absorbed in the page, his face in three-quarter profile.',
    props: 'a book and a cup of tea',
  },
  {
    id: 'served-at-home',
    name: 'Served at home',
    hint: 'A family at the table, staff serving',
    grammar: 'mid',
    chapter: 'together',
    people:
      'The mother, father and daughter sit at the dining table while a member of staff in a dark suit sets a plated dessert in front of the girl, her parents watching warmly; the service is discreet and unhurried.',
    props: 'plates, cutlery and a plated dessert on the table',
  },
  {
    id: 'bench-for-two',
    name: 'A quiet moment for two',
    hint: 'A couple on a garden seat',
    grammar: 'mid',
    chapter: 'together',
    people:
      'The mother and father sit together on the seat already there, turned slightly toward each other and talking softly, her wide straw hat in her lap, simply enjoying the afternoon.',
    props: 'a wide straw hat',
  },
  // Golden evening
  {
    id: 'family-lawn',
    name: 'Family on the lawn',
    hint: 'Parent and child playing, laughing',
    grammar: 'mid',
    chapter: 'golden',
    people:
      'The father lies on his front on the lawn laughing while the daughter sits on his back blowing soap bubbles that glow in the backlight; the mother kneels beside them, watching.',
    props: 'a small bottle of bubble mixture',
  },
  {
    id: 'sundowner',
    name: 'Sundowner',
    hint: 'Friends with drinks in the evening sun',
    grammar: 'mid',
    chapter: 'golden',
    people:
      'Friends gather at the railing with the mother and father, drinks in hand, leaning on the rail and laughing at a shared story, relaxed and close.',
    props: 'glasses in their hands',
  },
  {
    id: 'friends-fire',
    name: 'Round the fire',
    hint: 'Friends round a firepit, a guitar',
    grammar: 'mid',
    chapter: 'golden',
    people:
      'Friends sit round the firepit already there with the mother and father, one playing an acoustic guitar, the others singing along and laughing, the low flames warm on their faces.',
    props: 'an acoustic guitar',
  },
  {
    id: 'couple-bridge',
    name: 'On the bridge',
    hint: 'A couple walking away, hand in hand',
    grammar: 'wide',
    chapter: 'golden',
    people:
      'The mother and father walk away along the bridge or walkway hand in hand, her head leaning toward his shoulder, unhurried.',
    props: '',
  },
  {
    id: 'dog-walk',
    name: 'Evening dog walk',
    hint: 'Walking the dog on the paths',
    grammar: 'wide',
    chapter: 'golden',
    people:
      'The father and son walk a golden retriever along the path, the boy holding the lead and the dog trotting just ahead, the two of them talking as they go.',
    props: 'a dog lead',
  },
  {
    id: 'coming-home',
    name: 'Coming home',
    hint: 'Arriving, greeted at the door',
    grammar: 'wide',
    chapter: 'golden',
    people:
      'The father walks up to the entrance with a leather bag over his shoulder as the daughter runs out to meet him, a doorman in uniform holding the door with a nod.',
    props: 'a leather bag over his shoulder',
  },
] as const satisfies readonly {
  id: string;
  name: string;
  hint: string;
  grammar: Exclude<GrammarId, 'detail' | 'empty'>;
  chapter: ChapterId;
  people: string;
  props: string;
}[];

export type MomentId = (typeof MOMENTS)[number]['id'];

export const MOMENT_IDS = MOMENTS.map((m) => m.id) as [MomentId, ...MomentId[]];

export type Moment = (typeof MOMENTS)[number];

export function momentById(id: string | undefined): Moment | undefined {
  return MOMENTS.find((m) => m.id === id);
}

/** One planned frame, as far as its prompt needs. */
export type LifestyleFrameInput = {
  setting: 'exterior' | 'interior';
  chapter: ChapterId;
  grammar: GrammarId;
  /** The largest things actually visible, named with their colour or material. */
  keep: string;
  /** What a close-up or detail moves in on; unused by the whole-frame grammars. */
  crop: string;
  /** Who is there and what they do; for detail and empty, "No people." and the subject. */
  people: string;
  /** The household roles in the frame; with a cast sheet attached they are the only people taken from it. */
  castRoles?: readonly CastRoleId[];
  note?: string;
  /** The people check's corrections for a re-take. */
  fixes?: string;
  /** Where the sun stands (inside, the main window's side): the frame's lighting design, Phase 5; absent on frames planned before it. */
  sun?: SunPositionId | undefined;
  /** The rest of that design, the lighting brief: pools and shade, who stands where in them, what falls dark. */
  light?: string | undefined;
  /** Phase 7: a lighting preset and the frame's depth of field and focus plane; absent on frames planned before it. */
  lighting?: LightingPresetId | undefined;
  depth?: DepthId | undefined;
  focus?: FocusId | undefined;
};

export type LifestylePromptOptions = {
  /** The household's heritage (looks.ts ETHNICITIES). */
  heritage: EthnicityId;
  /** The second image is a cast sheet; only used when the grammar has people. */
  castSheet: boolean;
  /** The last image is a reference photograph for light, colour and plants. */
  lightReference: boolean;
  /** The model's prompt cap (`imageModelPromptLimit`). */
  maxLength?: number | undefined;
  /** Shoot an x-ray plate (a two-pass take's first pass, developed by `buildDevelopPrompt`), not the filmic frame. */
  plate?: boolean | undefined;
};

function heritagePrompt(id: EthnicityId): string {
  return (ETHNICITIES.find((e) => e.id === id) ?? ETHNICITIES[0]).prompt;
}

/** Trimmed, with a full stop when it has no closing punctuation. */
function sentence(s: string): string {
  const t = s.trim();
  return !t || /[.!?]$/.test(t) ? t : `${t}.`;
}

/** The long texts with a short form: planting, people, colour, falloff (a plate: planting, people, tone, statement). */
const COMPACT_STEPS = 4;

/** Trimmed and cut to `max` characters at a word boundary. */
function cutAtWord(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.—-]+$/, '');
}

/**
 * The cast sheet's sentence. With the frame's roles it names who appears
 * (the sheet is a line-up of the whole household, and a model handed one
 * puts all of them in the frame unless told who is absent); without roles it
 * is the general form. Fixed text, never compacted.
 */
function castSheetSentence(roles: readonly CastRoleId[] | undefined): string {
  const names = [...new Set(roles ?? [])].map((id) => `the ${(CAST_ROLES.find((r) => r.id === id)?.name ?? id).toLowerCase()}`);
  // With the whole household in frame nobody is absent, so the short sentence says it all.
  if (names.length === 0 || names.length >= CAST_ROLES.length) return CAST_SHEET_SENTENCE;
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `The second attached image is a cast sheet of the household. Only these people from it appear in this frame: ${who}, with the same faces, skin tone, hair, build and clothing as on the sheet. Everyone else on the sheet is absent: no other family members, and nobody standing together as a group. Take nothing else from the sheet, not its place, light, poses or framing.`;
}

/**
 * A frame's prompt: the filmic numbered recipe, image 1 the render, then
 * the cast sheet and the light reference when they ride along (the order
 * `submitStill` sends them in). With `plate` it is a two-pass take's first
 * pass, an x-ray plate in the same seven slots: the chapter's sun as facts,
 * flat neutral tone, legible planting and materials, the same people
 * physics fully sharp, and a deep-focus camera. A frame with its own
 * lighting design (`frameLighting`) is lit from its sun in both modes, with
 * one shadow family and its brief; the filmic frame adds the chapter's
 * numbers, separation and pools of light. A lighting preset replaces the
 * chapter's time and numbers with its own in both modes (the plate takes only
 * its sun or source, time and shadows), and a `FrameCamera` sets the filmic
 * lens's depth and focus.
 */
export function buildLifestylePrompt(frame: LifestyleFrameInput, opts: LifestylePromptOptions): string {
  const chapter = chapterById(frame.chapter);
  const grammar = grammarById(frame.grammar);
  const interior = frame.setting === 'interior';
  const ref = opts.lightReference;
  const plate = opts.plate === true;
  // A lit frame's ladder has two more levels: the lighting texts go compact
  // first (level 1), and the last level is bare (the short sun phrase, one
  // shadow family, the falloff and the brief). Unlit, `O` is 0 and every
  // index is as it was.
  const lit = frameLighting(frame);
  const O = lit ? 1 : 0;
  const steps = COMPACT_STEPS + 2 * O;
  // A plate with people makes their posture and every touch legible
  // (src/realism.ts), short with the people text; over the cap it is dropped
  // before the note and fixes are cut, and the ladder starts again without it.
  const posed = plate && grammar.people;
  // A sky preset's plate lights its people by the preset's own light, not a sun.
  const preset = lightingPresetById(lit?.preset);
  const platePeople = (text: string) => (preset && isSkyPreset(preset) ? platePeopleSky(text, preset) : text);
  // The frame's depth and focus: the filmic frame's lens; a plate stays deep focus.
  const camera = plate ? undefined : frameCamera(frame);
  const keep = frame.keep.trim() || KEEP_ALL;
  const head = grammar.reframe
    ? `Edit the first attached image into a real photograph of the same place, from the same camera position looking along the same line of sight, moving in on ${frame.crop.trim() || 'the nearest part of the scene'} as a longer lens would, so everything in frame is already in the image. Keep ${keep} exactly as designed: the same shape, layout, material and colour.`
    : `Edit the first attached image into a real photograph of the same place. Keep its camera position, height, angle, framing and line of sight exactly as they are, and keep ${keep} exactly as designed: the same shape, size, layout, material and colour.`;
  // The plate's seven items: the same slots as the filmic recipe, with the
  // look taken out of every one.
  const plateItems = (short: (step: number) => boolean, who: string, litLight: string | undefined, posture: string) => [
    litLight ??
      `LIGHT: light the scene only from ${ref ? 'the sun of the reference photograph, from its direction and at its time of day' : 'this sun'}: ${interior ? chapter.directionInterior : chapter.direction}; every surface lit or in shadow exactly as that sun dictates, with the shadows' true direction, length and edge; nothing else about the light is styled.`,
    `TONE: ${short(2) ? PLATE_TONE_COMPACT : PLATE_TONE}.`,
    `PLANTING: ${interior ? FILM_PLANTING_INTERIOR : short(0) ? PLATE_PLANTING_COMPACT : PLATE_PLANTING(ref)}; ${PLATE_PLANTING_TAIL}.`,
    `MATERIALS: ${short(0) ? FILM_MATERIALS : FILM_MATERIALS_FULL}; every material clearly legible as what it is.`,
    grammar.people
      ? `PEOPLE: ${[sentence(who), plateScaleText(grammar.plateScale)].filter(Boolean).join(' ')} The residents are ${heritagePrompt(opts.heritage)}; any friends or staff are a natural mix of heritages.`
      : `SUBJECT: ${sentence(who) || 'No people.'}`,
    grammar.people ? `PEOPLE REALISM: ${platePeople(short(1) ? PLATE_PEOPLE_COMPACT : PLATE_PEOPLE)}.${posture}` : NO_PEOPLE,
    `CAMERA: ${PLATE_CAMERA(grammar.lens)}.`,
  ];
  // A lit frame's LIGHT item: its sun, the chapter's time of day, one shadow
  // family and (filmic only) the chapter's numbers, separation and pools,
  // then the falloff and the brief.
  const litItem = (L: FrameLighting, level: number, short: (step: number) => boolean, brief: string) => {
    const P = lightingPresetById(L.preset);
    if (P) return presetItem(P, L, level, brief);
    const compact = level > 0;
    const bare = level >= steps;
    const sunAndShadows = `${sunPhrase(L.sun, interior, bare)}; ${bare ? '' : `${chapter.elevation}; `}${compact ? ONE_SHADOW_FAMILY_COMPACT : ONE_SHADOW_FAMILY}`;
    if (plate) {
      return `LIGHT: light the scene only from this sun: ${sunAndShadows}; every surface lit or in shadow exactly as that sun dictates, with the shadows' true direction, length and edge; nothing else about the light is styled.${litBrief(plateBrief(brief))}`;
    }
    const falloff = bare ? FILM_FALLOFF_LIT_BARE : interior ? FILM_FALLOFF_INTERIOR_LIT : short(3) ? FILM_FALLOFF_LIT_COMPACT : FILM_FALLOFF_LIT;
    return `LIGHT: relight the scene to this light${ref ? LIT_REFERENCE_CLAUSE : ''}: ${sunAndShadows}; ${bare ? '' : litNumbers(chapter, interior, grammar.people, compact)}${falloff}.${litBrief(brief)}`;
  };
  // A preset's LIGHT item: its sun (or a sky preset's source) and time of day,
  // its shadows and (filmic only) its numbers, separation, haze decision, dark
  // pocket and look, then the brief. It has no falloff step: its look goes
  // compact with the rest at level 1. A sky preset's plate names its own light
  // (the sky, the window, the lamps), never a sun.
  const presetItem = (P: LightingPreset, L: FrameLighting, level: number, brief: string) => {
    const compact = level > 0;
    const bare = level >= steps;
    const lead = `${presetHead(P, L.sun, interior, bare)}; ${presetShadows(P, compact, plate)}`;
    if (plate) {
      return `LIGHT: light the scene only from ${isSkyPreset(P) ? P.lightFrom : 'this sun'}: ${lead}; every surface lit or in shadow exactly as that ${isSkyPreset(P) ? 'light' : 'sun'} dictates, with the shadows' true direction, length and edge; nothing else about the light is styled.${litBrief(plateBrief(brief))}`;
    }
    return `LIGHT: relight the scene to this light${ref ? LIT_REFERENCE_CLAUSE : ''}, ${P.name.toLowerCase()}: ${lead}; ${presetMiddle(P, separationFor(P, grammar.people, compact), compact, bare)}${compact ? P.lookCompact : P.look}.${litBrief(brief)}`;
  };
  // `level` is how many of the long texts are in their short form, taken in
  // the order that loses least first: planting (with the close-range
  // materials), people, colour, falloff; on a plate planting, people, tone,
  // then the plate statement. A lit frame puts its lighting texts first and
  // its bare level last.
  const assemble = (level: number, note: string, fixes: string, who = frame.people, brief = lit?.light ?? '', withPosture = true) => {
    const short = (step: number) => level > step + O;
    const litLight = lit ? litItem(lit, level, short, brief) : undefined;
    const posture = posed && withPosture ? ` Posture and contact: ${peopleRealism('plate', short(1))}.` : '';
    const items = (plate ? plateItems(short, who, litLight, posture) : [
      litLight ??
        `LIGHT: relight the scene to ${ref ? 'exactly the light and colour of the reference photograph' : 'this light'}: ${interior ? chapter.interior : chapter.light}; ${interior ? FILM_FALLOFF_INTERIOR : short(3) ? FILM_FALLOFF_COMPACT : FILM_FALLOFF}.`,
      `COLOUR AND FILM: ${short(2) ? FILM_COLOUR_COMPACT : FILM_COLOUR}.`,
      `PLANTING: ${interior ? FILM_PLANTING_INTERIOR : short(0) ? FILM_PLANTING_COMPACT : FILM_PLANTING(ref)}.`,
      `MATERIALS: ${short(0) ? FILM_MATERIALS : FILM_MATERIALS_FULL}.`,
      grammar.people
        ? `PEOPLE: ${[sentence(who), camera?.depth === 'deep' ? grammar.plateScale : grammar.scale].filter(Boolean).join(' ')} The residents are ${heritagePrompt(opts.heritage)}; any friends or staff are a natural mix of heritages.`
        : `SUBJECT: ${sentence(who) || 'No people.'}`,
      grammar.people
        ? `PEOPLE REALISM: ${short(1) ? (lit ? FILM_PEOPLE_LIT_COMPACT : FILM_PEOPLE_COMPACT) : lit ? FILM_PEOPLE_LIT : FILM_PEOPLE}.`
        : NO_PEOPLE,
      `CAMERA: ${camera ? depthCamera(grammar, camera, interior, false) : FILM_CAMERA(grammar.lens, grammar.people)}.`,
    ])
      .filter(Boolean)
      .map((item, i) => `${i + 1}. ${item}`);
    return [
      head,
      plate ? (level > 0 ? PLATE_ADD_NOTHING_COMPACT : PLATE_ADD_NOTHING) : '',
      opts.castSheet && grammar.people ? castSheetSentence(frame.castRoles) : '',
      plate && ref ? (lit ? PLATE_REFERENCE_SENTENCE_PLANTS : PLATE_REFERENCE_SENTENCE) : ref ? LIGHT_REFERENCE_SENTENCE : '',
      plate ? (short(3) ? PLATE_STATEMENT_COMPACT : PLATE_STATEMENT) : '',
      'Make only these changes:',
      ...items,
      note ? `Also: ${sentence(note)}` : '',
      fixes
        ? `A check of an earlier take found these problems; make sure this take gets each of them right: ${sentence(fixes)}`
        : '',
      TAIL,
    ]
      .filter(Boolean)
      .join(' ');
  };
  const note = frame.note?.trim() ?? '';
  const fixes = frame.fixes?.trim() ?? '';
  const full = assemble(0, note, fixes);
  const max = opts.maxLength;
  if (max === undefined || full.length <= max) return full;
  // Over the model's cap: the long planting, people, colour and falloff
  // texts give way to their short forms (which still carry the film look)
  // one at a time, stopping as soon as the prompt fits, so a frame just over
  // keeps most of the proven text; then the user's note and the check's
  // fixes are cut, then whatever is still over comes out of the fixes and
  // then the note, then the people text (a frame typed to the limits on every
  // field, with a cast sheet and a reference, overflows a 4000 cap even in
  // its short forms), so the closing instruction arrives whole. Only a frame
  // whose own keep text overflows has its tail trimmed. A lit frame's brief
  // gives way after the note and before the people: like the note it is a
  // design decision, and the subject comes first. A plate's posture and
  // contact ride through the short forms; when they still do not fit, the
  // ladder runs again without them, so dropping them never costs more.
  for (let level = 1; level <= steps; level++) {
    const shorter = assemble(level, note, fixes);
    if (shorter.length <= max) return shorter;
  }
  // The same frame without the plate's posture and contact.
  const plain = (level: number, n: string, f: string, who = frame.people, brief = lit?.light ?? '') => assemble(level, n, f, who, brief, false);
  for (let level = 0; posed && level <= steps; level++) {
    const shorter = plain(level, note, fixes);
    if (shorter.length <= max) return shorter;
  }
  let n = cutAtWord(note, 200);
  let f = cutAtWord(fixes, 400);
  let over = plain(steps, n, f).length - max;
  if (over > 0 && f) {
    f = cutAtWord(f, Math.max(0, f.length - over - 2));
    over = plain(steps, n, f).length - max;
  }
  if (over > 0 && n) {
    n = cutAtWord(n, Math.max(0, n.length - over - 2));
    over = plain(steps, n, f).length - max;
  }
  let brief = lit?.light ?? '';
  if (over > 0 && brief) {
    brief = cutAtWord(brief, Math.max(0, brief.length - over - 2));
    over = plain(steps, n, f, frame.people, brief).length - max;
  }
  let who = frame.people;
  if (over > 0 && who.trim()) who = cutAtWord(who, Math.max(0, who.trim().length - over - 2));
  return clampPrompt(plain(steps, n, f, who, brief), max);
}

/**
 * What pass 2 does to the planting: the render's CG foliage becomes living
 * plants, at the detail a 4K finish can hold, without moving or adding any.
 */
const VEGETATION_TEXTURE =
  'VEGETATION: every plant reads as a living plant photographed outdoors, never CG foliage, keeping its species, size, shape and position: leaves of varied size, age and angle overlapping in depth, some curled, nicked or yellowing at the tips, with visible veins, a soft sheen only where the sun catches them and translucent glowing green where backlit; tree crowns with broken, irregular edges and gaps where sky and branches show through, never smooth solid domes or repeated clumps; twigs and branches visible inside the crowns; bark with real furrows and texture; blossom as loose clusters of individual flowers at different stages, with buds among them; lawn and groundcover as individual blades and leaves of varied length, spilling slightly over edges, with soil or mulch showing between bedding plants; no two plants identical, nothing plastic, painted or airbrushed.';

/**
 * The develop's skin: what a high-resolution photograph shows at full size.
 * "Real skin texture with pores" alone still came back airbrushed on Nano
 * Banana 2.1 (the 2026-10-30 Whispers of Trees stills), so it names what the
 * eye reads as real and the retouch it must not do.
 */
const DEVELOP_SKIN = 'skin as a full-size photo shows it: pores, fine lines, uneven tone; not retouched or smoothed';

/** VEGETATION_TEXTURE when a develop runs over its cap: the same living plants, fewer of the details. */
const VEGETATION_TEXTURE_COMPACT =
  'VEGETATION: every plant a living plant photographed outdoors, never CG foliage, keeping its species, size, shape and position: individual leaves of varied size and angle, translucent where backlit; tree crowns with broken, irregular edges and gaps of sky; bark with real furrows; blossom as loose clusters of individual flowers; lawn as individual blades; no two plants identical, nothing plastic.';

/** What pass 2 does to built surfaces: real close-range texture, still new and well kept. */
const MATERIAL_TEXTURE =
  'MATERIALS: every built surface photographed at close range, new and well kept but real: brick with crisp mortar joints and slight colour variation from brick to brick, stone and concrete with fine pores and aggregate, paving with real joints and setts very slightly uneven, timber with open grain and soft wear on edges people touch, metal with fine brushed texture and soft imperfect reflections, glass reflecting the real trees and sky, water with ripples and caustic light; no CG-perfect flat surfaces, no repeating texture tiles.';

/**
 * A two-pass take's second pass: image 1 the first pass, image 2 the render.
 * It keeps the first pass's composition, light, people and mood, matches any
 * drifted architecture back to the render, and sharpens only the plane in
 * focus, so the out-of-focus layers keep their softness, and turns CG
 * planting and surfaces into real close-range texture, and its last item is
 * the physical realism of `src/realism.ts` in its short forms (people's skin,
 * eyes and every touch; where things meet the ground), with no scene words:
 * an older take records none. No cap: it stays under 4000, the lowest cap of
 * any model that takes two images.
 */
export function buildPass2Prompt({ people, resolutionName }: { people: boolean; resolutionName: string }): string {
  const realism = realismText(realismLayers({ ...realismCues({ people, interior: false }), contact: true }, 'develop'), true, false);
  const items = [
    `FOCUS: crisp, sharp photographic detail only in the plane that is in focus, ${people ? 'the people and everything standing at their distance' : 'the subject and everything at its distance'}: individual leaves and petals, bark, timber grain, woven rattan, stone and paving texture, real water with clear reflections${people ? ', real fabric weave and creases' : ''}; nothing smeared, melted or painterly there. The out-of-focus foreground and background stay exactly as soft as they are now; do not sharpen them, but out-of-focus foliage still reads as real leaves softened by the lens, never smeared paint.`,
    people
      ? "PEOPLE: real skin texture with pores and small imperfections, natural asymmetric faces, correct hands with five fingers; no AI smoothing, no waxy or glossy skin; the same people, not new ones; keep every person's height, footing, contact shadows and depth-of-field softness exactly as they are."
      : '',
    VEGETATION_TEXTURE,
    MATERIAL_TEXTURE,
    "COLOUR: keep the light's warmth but take out the orange cast, so whites read cream-white, greens stay soft sage and olive and skin stays natural; nothing oversaturated.",
    'FILM: keep the gentle bloom on the brightest highlights and the fine film grain; real lens micro-contrast, no over-sharpened halos.',
    `PHYSICAL REALISM: ${realism}`,
  ]
    .filter(Boolean)
    .map((item, i) => `${i + 1}. ${item}`);
  return [
    `Recreate the first attached image as the final photograph at full ${resolutionName} detail.`,
    'Keep its composition, camera position, framing, lens and depth of field, its light direction, shadows, backlit glow and mood, and its people exactly as they are: the same faces, expressions, poses, clothing and positions.',
    "The second attached image is the architect's render of the same place: wherever the first image drifted, match the architecture, roofs, columns, furniture, pool edges and paving to the render exactly in shape, pattern and material, without changing the camera or framing.",
    'Make only these improvements:',
    ...items,
    'Nothing is added, removed or moved. No text, no logos, no watermark.',
  ].join(' ');
}

/** One frame's develop, as far as its prompt needs. */
export type DevelopPromptInput = {
  setting: 'exterior' | 'interior';
  chapter: ChapterId;
  grammar: GrammarId;
  /** Image 3 is the plan's light reference (image 1 the plate, image 2 the render). */
  lightReference: boolean;
  resolutionName: string;
  /** The pass-2 model's prompt cap (`imageModelPromptLimit`); the pass-2 model is the person's choice. */
  maxLength?: number | undefined;
  /** Where the sun stands (inside, the main window's side): the frame's lighting design, Phase 5; absent on frames planned before it. */
  sun?: SunPositionId | undefined;
  /** The rest of that design, the lighting brief: pools and shade, who stands where in them, what falls dark. */
  light?: string | undefined;
  /** Phase 7: a lighting preset and the frame's depth of field and focus plane; absent on frames planned before it. */
  lighting?: LightingPresetId | undefined;
  depth?: DepthId | undefined;
  focus?: FocusId | undefined;
  /**
   * The frame's own words (keep-list, place, title, people brief), read only
   * to switch on the realism clauses it needs (src/realism.ts), never quoted;
   * absent or blank, only the people and the setting are known.
   */
  scene?: string | undefined;
};

/**
 * A develop with no documented cap (Nano Banana 2) stays within this, the
 * develop budget `.router/lifestyle-presets.ts` holds: only its realism gives
 * way to it, the proven texts stay whole.
 */
const DEVELOP_BUDGET = 6900;

/**
 * A develop's tone and colour. The plate is deliberately flat, and the film
 * palette alone left the walkway test pale and pastel (2026-10-29): the
 * develop builds the full tonal range from it, with exposure set for the
 * sunlit highlights and true blacks in the deepest shade.
 */
const DEVELOP_TONE =
  'a full tonal range, never pale, washed out or pastel: exposure set for the sunlit highlights, which keep their detail; rich, dense midtones; deep shade under trees and inside foliage reaching true black in its deepest pockets; strong local contrast; rich natural colour, not muted: greens olive to emerald, blossom saturated where the sun strikes it, warm deep brick and timber, a clear blue sky deepening toward the top; a Kodak 2383 print look, dense blacks, a gentle roll-off only at the very top; fine 35 mm film grain and subtle halation on the brightest edges';

const DEVELOP_TONE_COMPACT =
  'full tonal range, never pale, washed out or pastel: exposure set for the sunlit highlights, dense midtones, deep shadows reaching true black in the deepest pockets, strong local contrast; rich natural colour, greens olive to emerald, blossom saturated in the sun, the sky clear blue; a Kodak 2383 print look; fine film grain and subtle halation';

/**
 * How many texts a develop shortens, in the order that loses least first:
 * materials, texture depth, tone, then the vegetation, which defines the
 * whole picture and is the last to go. Its falloff is always the short form:
 * the tone and the vegetation carry the depth.
 */
const DEVELOP_STEPS = 4;

/**
 * A develop's planting: the texture brief plus the volume that makes a
 * crown read as a tree, not a green mass (the user: vegetation "defines the
 * whole picture", 2026-10-29).
 */
const DEVELOP_VEGETATION = VEGETATION_TEXTURE.replace(
  /\.$/,
  '. Each tree crown and shrub is a three-dimensional mass with depth: sunlit outer leaves bright and translucent, inner leaves stepping back into deep shade, light breaking through in specks; even the farthest trees keep readable leaf texture, never a green blur or a painted mass; the planting makes the picture.'
);

const DEVELOP_VEGETATION_COMPACT = VEGETATION_TEXTURE_COMPACT.replace(
  /\.$/,
  '; every crown a three-dimensional mass, sunlit outer leaves over deep inner shade; distant trees keep leaf texture, never a green blur.'
);

/** The relief the light finds in every surface: micro-contrast the 4K develop must keep. */
const TEXTURE_DEPTH =
  'TEXTURE DEPTH: the light finds the relief in every surface: each brick, sett, bark ridge and leaf casts its own tiny shadow, every joint, furrow and leaf overlap holds dark contact shadow, and glints flash where the sun catches glossy leaves, glass and metal; full micro-contrast, never flat, smoothed or airbrushed.';

const TEXTURE_DEPTH_COMPACT =
  'TEXTURE DEPTH: tiny shadows in every joint, furrow and leaf overlap, glints where the sun catches glossy leaves and metal; full micro-contrast, never flat or smoothed.';

/**
 * A develop's focus. Whole-frame shots keep deep focus so paving, planting
 * and façades hold their texture across the frame (a shallow wide flattened
 * the walkway test); a mid softens its background, a close-up or detail
 * keeps its shallow lens.
 */
function developCamera(grammar: Grammar): string {
  if (grammar.id === 'wide' || grammar.id === 'empty') {
    return `${plateLens(grammar.lens)} at f/5.6: deep enough focus that the paving, planting, façades${grammar.people ? ' and people' : ''} all hold their texture across the frame; only the farthest background softens slightly; no HDR look, no sharpening halos`;
  }
  if (grammar.id === 'mid') {
    return `${plateLens(grammar.lens)} at f/2.8: focus on the people, crisp with everything at their distance; the background softened but still legible, its textures and shapes readable; no HDR look, no sharpening halos`;
  }
  return `${FILM_CAMERA(grammar.lens, grammar.people).replace('the foreground layer melting', 'whatever is already in the foreground melting')}; ${grammar.people ? 'the people and everything at their distance' : 'the subject and everything at its distance'} stay crisp`;
}

/**
 * A plate's second pass: image 1 the x-ray plate, image 2 the render, image 3
 * the light reference when the plan has one. Every decision in the plate is
 * kept; the develop adds the whole look (the chapter's light and falloff,
 * film colour, grain and halation, the lens's depth of field) and the
 * close-range texture of planting, surfaces and skin. Over the cap, colour,
 * falloff, vegetation and materials give way to their short forms in that
 * order (the textures stay whole longest: they are what the 4K pass is for).
 * A lit frame (`frameLighting`) relights to its own sun and the chapter's
 * numbers, with its brief always whole: its lighting texts and the falloff
 * go compact first, and its last level is bare. A lighting preset relights to
 * its own time, numbers and look instead (a sky preset's tone, vegetation and
 * texture lit by the sky or the lamps, never a sun), and a `FrameCamera`
 * softens the deep-focus plate only as far as its lens would. Its last item
 * is the physical realism the frame's people and own words switch on
 * (`src/realism.ts`: people, water, contact, glass, lamps), which takes over
 * the materials' own water and glass phrase while it is there. It goes short
 * first, then its layers go from the least important, the lighting texts,
 * materials and texture depth going short for it at most, never the tone or
 * the vegetation; once it is gone the ladder is exactly as before.
 */
export function buildDevelopPrompt(input: DevelopPromptInput): string {
  const chapter = chapterById(input.chapter);
  const grammar = grammarById(input.grammar);
  const interior = input.setting === 'interior';
  const ref = input.lightReference;
  const lit = frameLighting(input);
  const O = lit ? 1 : 0;
  const preset = lightingPresetById(lit?.preset);
  // A sky preset's develop: its tone, vegetation and texture lit by the sky or the lamps, never a sun.
  const sky = preset !== undefined && isSkyPreset(preset);
  const skyText = (text: string) => (sky ? skyDevelop(text) : text);
  const camera = frameCamera(input);
  // The realism the frame's people and words switch on. The plate fixed the
  // poses and the shadows, so the develop takes surface physics and, only
  // where lamps are named, their falloff (the warm/cool split too when no
  // lighting design gives it numbers), never a shadow family.
  const cues = realismCues({ people: grammar.people, interior, scene: input.scene });
  const layers = realismLayers(cues, 'develop', cues.practicals ? { practicals: true, split: !lit, oneShadow: false } : undefined);
  // The materials' own water and glass phrase: with no scene words, as ever;
  // with them, never water the frame lacks, and never twice what a realism
  // layer in the prompt already says.
  const materials = (short: boolean, kept: number) => {
    const on = (id: RealismLayer['id']) => layers.slice(0, kept).some((l) => l.id === id);
    let text = short ? `MATERIALS: ${FILM_MATERIALS}.` : MATERIAL_TEXTURE;
    if (cues.known && (!cues.water || on('water'))) {
      text = text.replace(', water with ripples and caustic light', '').replace(', real water with true reflections', '');
    }
    if (on('glass')) text = text.replace(', glass reflecting the real trees and sky', '');
    return text;
  };
  // No shadow-family text here: the plate already fixed the shadows.
  const litItem = (L: FrameLighting, level: number) => {
    const compact = level > 0;
    const bare = level > DEVELOP_STEPS + O;
    const falloff = bare ? FILM_FALLOFF_LIT_BARE : interior ? FILM_FALLOFF_INTERIOR_LIT : FILM_FALLOFF_LIT_COMPACT;
    const lighting = `${bare ? '' : `${chapter.elevation}; ${litNumbers(chapter, interior, grammar.people, compact)}`}${falloff}`;
    return `LIGHT: relight the plate to this light${ref ? LIT_REFERENCE_CLAUSE : ''}: ${sunPhrase(L.sun, interior, bare)}; ${inPlace(lighting)}; the sun stays exactly where the plate has it and every shadow keeps its direction and length.${L.light ? ` Relight it where everything already stands, moving nothing: ${sentence(L.light)}` : ''}`;
  };
  // A preset's develop: its own time, numbers, haze decision, dark pocket and
  // look, written in place (only the shared separation text needs `inPlace`);
  // a sky preset keeps the plate's light rather than a sun.
  const presetItem = (P: LightingPreset, L: FrameLighting, level: number) => {
    const compact = level > 0;
    const bare = level > DEVELOP_STEPS + O;
    const middle = presetMiddle(P, separationFor(P, grammar.people, compact, inPlace), compact, bare);
    const stays = isSkyPreset(P) ? DEVELOP_LIGHT_STAYS_SKY : 'the sun stays exactly where the plate has it and every shadow keeps its direction and length';
    return `LIGHT: relight the plate to this light${ref ? LIT_REFERENCE_CLAUSE : ''}, ${P.name.toLowerCase()}: ${presetHead(P, L.sun, interior, bare)}; ${middle}${compact ? P.lookCompact : P.look}; ${stays}.${L.light ? ` Relight it where everything already stands, moving nothing: ${sentence(L.light)}` : ''}`;
  };
  // `kept`: how many realism layers ride along, `terse`: in their short forms.
  const assemble = (level: number, kept = 0, terse = false) => {
    const short = (step: number) => level > step + O;
    const realism = realismText(layers.slice(0, kept), terse, false);
    const items = [
      lit
        ? preset
          ? presetItem(preset, lit, level)
          : litItem(lit, level)
        : `LIGHT: relight the plate to ${ref ? 'exactly the light and colour of the reference photograph' : 'this light'}: ${interior ? chapter.interior : chapter.light}; ${inPlace(interior ? FILM_FALLOFF_INTERIOR : FILM_FALLOFF_COMPACT)}; the sun stays exactly where the plate has it and every shadow keeps its direction and length.`,
      `TONE AND COLOUR: ${skyText(short(2) ? DEVELOP_TONE_COMPACT : DEVELOP_TONE)}.`,
      `CAMERA: ${camera ? depthCamera(grammar, camera, interior, true) : developCamera(grammar)}; add no new foreground layer: the frame's edges show only what the plate shows there, no leaves or plants entering from outside.`,
      skyText(short(3) ? DEVELOP_VEGETATION_COMPACT : DEVELOP_VEGETATION),
      materials(short(0), kept),
      // Only the very last level, past every short form, drops it, so the closing line arrives whole.
      level > DEVELOP_STEPS + 2 * O ? '' : skyText(short(1) ? TEXTURE_DEPTH_COMPACT : TEXTURE_DEPTH),
      grammar.people
        ? `PEOPLE: ${DEVELOP_SKIN}, natural asymmetric faces, correct hands with five fingers; the same people, not new ones, with their footing and contact shadows, ${lit ? (sky ? LIT_PEOPLE_LIGHT_SKY : LIT_PEOPLE_LIGHT) : "lit by the chapter's light like everything around them"}, with the depth-of-field softness of their distance.`
        : '',
      realism ? `PHYSICAL REALISM: ${realism}` : '',
    ]
      .filter(Boolean)
      .map((item, i) => `${i + 1}. ${item}`);
    return [
      `The first attached image is a flat, deep-focus technical plate of this scene in which every decision is already final: develop it into the final hyper-realistic photograph at full ${input.resolutionName} detail.`,
      'Its flat, pale tone is only a working state: give the photograph full depth, contrast and colour.',
      // A develop once drew the children twice their plate size (2026-10-29): the layout is locked in frame terms.
      grammar.people
        ? "An edit, not a new picture: every person, plant and object keeps its size and place in the frame, each person's head and feet where the plate has them."
        : 'An edit, not a new picture: every plant and object keeps its size and place in the frame.',
      'Keep exactly its composition, camera position, framing and architecture, its people (the same faces, expressions, poses, clothing, positions, height and footing; nobody moved, enlarged or brought closer), its plant species and positions, and its sun direction and shadow layout.',
      "The second attached image is the architect's render: wherever the plate drifted, match the architecture, furniture, pool edges and paving to it exactly in shape, pattern and material.",
      ref ? LIGHT_REFERENCE_SENTENCE : '',
      'Develop it with only these changes:',
      ...items,
      'Nothing is added, removed or moved. No text, no logos, no watermark.',
    ]
      .filter(Boolean)
      .join(' ');
  };
  const max = input.maxLength;
  const K = layers.length;
  if (max === undefined) {
    // No cap: every proven text whole, the realism full, short, then one layer fewer at a time within the budget.
    for (let kept = K; kept > 0; kept--) {
      for (const terse of kept === K ? [false, true] : [true]) {
        const prompt = assemble(0, kept, terse);
        if (prompt.length <= DEVELOP_BUDGET) return prompt;
      }
    }
    return assemble(0);
  }
  // The ladder as [level, layers kept, short]: the realism full, then short
  // with as many layers as fit, the lighting texts, materials and texture
  // depth going short for them at most (the most layers first, then the
  // fewest short texts); with none left, the levels exactly as before, so a
  // develop that drops its realism is never shorter for it.
  const textureShort = O + 2;
  const ladder: (readonly [number, number, boolean])[] = K > 0 ? [[0, K, false]] : [];
  for (let kept = K; kept > 0; kept--) for (let level = 0; level <= textureShort; level++) ladder.push([level, kept, true]);
  for (let level = 0; level <= DEVELOP_STEPS + 1 + 2 * O; level++) ladder.push([level, 0, false]);
  let prompt = '';
  for (const [level, kept, terse] of ladder) {
    prompt = assemble(level, kept, terse);
    if (prompt.length <= max) break;
  }
  return clampPrompt(prompt, max);
}

/**
 * The lighting-design texts, the backlit texts they derive from and the
 * reference sentences, for the derivations, budgets and phrase lists in
 * `.router/lifestyle-light.ts`.
 */
export const LIGHT_TEXTS = {
  ONE_SHADOW_FAMILY,
  ONE_SHADOW_FAMILY_COMPACT,
  LIGHT_SEPARATION,
  LIGHT_SEPARATION_COMPACT,
  LIGHT_POOLS,
  LIGHT_POOLS_COMPACT,
  FILM_FALLOFF,
  FILM_FALLOFF_COMPACT,
  FILM_FALLOFF_INTERIOR,
  FILM_FALLOFF_LIT,
  FILM_FALLOFF_LIT_COMPACT,
  FILM_FALLOFF_INTERIOR_LIT,
  FILM_FALLOFF_LIT_BARE,
  FILM_PEOPLE,
  FILM_PEOPLE_COMPACT,
  FILM_PEOPLE_LIT,
  FILM_PEOPLE_LIT_COMPACT,
  PLATE_REFERENCE_SENTENCE_PLANTS,
  LIGHT_REFERENCE_SENTENCE,
} as const;

/** The plate and develop texts, for the budgets and phrase lists in `.router/lifestyle-plate.ts`. */
export const PLATE_TEXTS = {
  PLATE_STATEMENT,
  PLATE_STATEMENT_COMPACT,
  PLATE_REFERENCE_SENTENCE,
  PLATE_TONE,
  PLATE_TONE_COMPACT,
  PLATE_PLANTING_TAIL,
  PLATE_ADD_NOTHING,
  PLATE_ADD_NOTHING_COMPACT,
  PLATE_PEOPLE,
  PLATE_PEOPLE_COMPACT,
  VEGETATION_TEXTURE_COMPACT,
} as const;

/**
 * The preset and depth texts, and the develop texts a sky preset rewrites, for
 * the pinned strings, derivations and budgets in `.router/lifestyle-presets.ts`.
 */
export const PRESET_TEXTS = {
  SOFT_SHADOWS,
  SOFT_SHADOWS_COMPACT,
  DEVELOP_LIGHT_STAYS_SKY,
  LIT_PEOPLE_LIGHT,
  LIT_PEOPLE_LIGHT_SKY,
  skyify,
  DEPTH_TEXT,
  DEVELOP_DEPTH_TAIL,
  ONE_SHADOW_FAMILY_RELIT,
  ONE_SHADOW_FAMILY_RELIT_COMPACT,
  skyDevelop,
  platePeopleSky,
  DEVELOP_TONE,
  DEVELOP_TONE_COMPACT,
  DEVELOP_VEGETATION,
  DEVELOP_VEGETATION_COMPACT,
  TEXTURE_DEPTH,
  TEXTURE_DEPTH_COMPACT,
} as const;

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];

/**
 * A cast sheet of the household, shot on one of the chapter's own renders so
 * the residents are lit in that chapter's light. Roles read left to right in
 * the order given. One pass, clean finish: the sheet is an identity document
 * the frames copy faces from, so it gets no grain, halation or backlight.
 */
/**
 * A cast sheet as a short portrait-photography brief (modelled on a Nano Banana Pro
 * hyper-realistic portrait: plain prose, specific ages, one warm light and what it
 * does to skin), with each person's true height and footing. The place keeps its
 * own camera and the people stand beside the nearest thing of known size in it,
 * sized against it and the horizon: asked for a portrait lens, the model drew a
 * resident at twice the scale of the bench beside her, and "a few steps from" a
 * bench with "the nearer part" still let her grow by half (2026-10-29).
 */
export function buildCastSheetPrompt(
  roles: readonly CastRoleId[],
  chapter: ChapterId,
  setting: LifestyleFrameInput['setting'],
  heritage: EthnicityId,
  lightReference: boolean
): string {
  const cast = [...new Set(roles)].filter((id) => CAST_ROLES.some((r) => r.id === id));
  const people = cast.map((id) => CAST_ROLES.find((r) => r.id === id)!.description);
  const one = people.length === 1;
  const ch = chapterById(chapter);
  const who = one
    ? `one resident standing naturally on its open ground, full length and facing the camera: ${people[0]}`
    : `${COUNT_WORDS[people.length] ?? String(people.length)} members of one household standing together naturally on its open ground in a loose row, full length and facing the camera, each fully visible and not overlapping, from left to right: ${people.join('; ')}`;
  const light = lightReference ? 'exactly the light and colour of the last attached image' : setting === 'interior' ? ch.interior : ch.light;
  return [
    `Using the first attached image as the place, create a hyper-realistic photograph of ${who}.`,
    "Keep the place's own camera exactly: the same viewpoint, height, lens and framing, with nothing in it moved or resized.",
    `They are ${heritagePrompt(heritage)}.`,
    `${one ? 'They have an easygoing, relaxed look' : 'They have easygoing, relaxed looks'}, as if a friend were taking the picture: real faces, not models, never posing stiffly.`,
    lightReference ? LIGHT_REFERENCE_SENTENCE : '',
    `The light is ${light}, warm and soft, casting a healthy glow on their skin, with natural skin texture, pores and fine lines, loose strands of hair, relaxed natural hands and real fabric with soft creases; whites stay white, nothing glossy or waxy.`,
    `They stand right beside something of known size in the place, at the same distance from the camera as it, such as a bench or chair, a tree, a planter, a lamp post or a doorway, and are sized against it: a seat (about 45 cm) comes just below an adult's knee and a backrest top (about 80 cm) to the hip, a doorway (about 2.1 m) clears every head, a lamp post is about twice an adult's height and a grown tree towers over everyone.`,
    `${one ? 'They stand' : 'Each stands'} at true height (${listOf(cast.map((r) => CAST_HEIGHTS[r]))}) with weight on both feet on the same ground, shrinking with distance exactly as the paving, furniture and trees around them do; the horizon, where the paving's lines meet in the distance, crosses every standing adult at the camera's own height above the ground, near or far, so from a camera at standing eye height or higher no head rises above it; soft contact shadows under ${one ? 'them' : 'everyone'} fall the same way as the trees' shadows.`,
    `Faces need not be large: at this resolution a face at true scale reads clearly, so no one is drawn bigger than the seat, doorway or tree beside them allows; what lies far behind them falls softly out of focus.`,
    'No text, no logos, no watermark.',
  ]
    .filter(Boolean)
    .join(' ');
}
