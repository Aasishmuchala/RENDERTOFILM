import { ETHNICITIES, type EthnicityId } from './looks.ts';
import { clampPrompt, type ImageModelId } from './models.ts';

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
 * frames keep the filmic recipe. Plain text only: nothing here does I/O, and
 * the reference films are never named in a prompt.
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
 * The film's four chapters, in story order: each one's light in crew
 * language, outside (`light`) and in a room (`interior`). An x-ray plate
 * takes only the facts of that light, with no look words: where the sun
 * is, which faces it lights and where the shadows fall (`direction`,
 * `directionInterior`).
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
  },
] as const;

export type ChapterId = (typeof CHAPTERS)[number]['id'];

export const CHAPTER_IDS = CHAPTERS.map((c) => c.id) as [ChapterId, ...ChapterId[]];

export type Chapter = (typeof CHAPTERS)[number];

export function chapterById(id: string | undefined): Chapter {
  return CHAPTERS.find((c) => c.id === id) ?? CHAPTERS[0];
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
 * physics fully sharp, and a deep-focus camera.
 */
export function buildLifestylePrompt(frame: LifestyleFrameInput, opts: LifestylePromptOptions): string {
  const chapter = chapterById(frame.chapter);
  const grammar = grammarById(frame.grammar);
  const interior = frame.setting === 'interior';
  const ref = opts.lightReference;
  const plate = opts.plate === true;
  const keep = frame.keep.trim() || KEEP_ALL;
  const head = grammar.reframe
    ? `Edit the first attached image into a real photograph of the same place, from the same camera position looking along the same line of sight, moving in on ${frame.crop.trim() || 'the nearest part of the scene'} as a longer lens would, so everything in frame is already in the image. Keep ${keep} exactly as designed: the same shape, layout, material and colour.`
    : `Edit the first attached image into a real photograph of the same place. Keep its camera position, height, angle, framing and line of sight exactly as they are, and keep ${keep} exactly as designed: the same shape, size, layout, material and colour.`;
  // The plate's seven items: the same slots as the filmic recipe, with the
  // look taken out of every one.
  const plateItems = (short: (step: number) => boolean, who: string) => [
    `LIGHT: light the scene only from ${ref ? 'the sun of the reference photograph, from its direction and at its time of day' : 'this sun'}: ${interior ? chapter.directionInterior : chapter.direction}; every surface lit or in shadow exactly as that sun dictates, with the shadows' true direction, length and edge; nothing else about the light is styled.`,
    `TONE: ${short(2) ? PLATE_TONE_COMPACT : PLATE_TONE}.`,
    `PLANTING: ${interior ? FILM_PLANTING_INTERIOR : short(0) ? FILM_PLANTING_COMPACT : FILM_PLANTING(ref)}; ${PLATE_PLANTING_TAIL}.`,
    `MATERIALS: ${short(0) ? FILM_MATERIALS : FILM_MATERIALS_FULL}; every material clearly legible as what it is.`,
    grammar.people
      ? `PEOPLE: ${[sentence(who), grammar.plateScale].filter(Boolean).join(' ')} The residents are ${heritagePrompt(opts.heritage)}; any friends or staff are a natural mix of heritages.`
      : `SUBJECT: ${sentence(who) || 'No people.'}`,
    grammar.people ? `PEOPLE REALISM: ${short(1) ? PLATE_PEOPLE_COMPACT : PLATE_PEOPLE}.` : NO_PEOPLE,
    `CAMERA: ${PLATE_CAMERA(grammar.lens)}.`,
  ];
  // `level` is how many of the long texts are in their short form, taken in
  // the order that loses least first: planting (with the close-range
  // materials), people, colour, falloff; on a plate planting, people, tone,
  // then the plate statement.
  const assemble = (level: number, note: string, fixes: string, who = frame.people) => {
    const short = (step: number) => level > step;
    const items = (plate ? plateItems(short, who) : [
      `LIGHT: relight the scene to ${ref ? 'exactly the light and colour of the reference photograph' : 'this light'}: ${interior ? chapter.interior : chapter.light}; ${interior ? FILM_FALLOFF_INTERIOR : short(3) ? FILM_FALLOFF_COMPACT : FILM_FALLOFF}.`,
      `COLOUR AND FILM: ${short(2) ? FILM_COLOUR_COMPACT : FILM_COLOUR}.`,
      `PLANTING: ${interior ? FILM_PLANTING_INTERIOR : short(0) ? FILM_PLANTING_COMPACT : FILM_PLANTING(ref)}.`,
      `MATERIALS: ${short(0) ? FILM_MATERIALS : FILM_MATERIALS_FULL}.`,
      grammar.people
        ? `PEOPLE: ${[sentence(who), grammar.scale].filter(Boolean).join(' ')} The residents are ${heritagePrompt(opts.heritage)}; any friends or staff are a natural mix of heritages.`
        : `SUBJECT: ${sentence(who) || 'No people.'}`,
      grammar.people ? `PEOPLE REALISM: ${short(1) ? FILM_PEOPLE_COMPACT : FILM_PEOPLE}.` : NO_PEOPLE,
      `CAMERA: ${FILM_CAMERA(grammar.lens, grammar.people)}.`,
    ])
      .filter(Boolean)
      .map((item, i) => `${i + 1}. ${item}`);
    return [
      head,
      opts.castSheet && grammar.people ? castSheetSentence(frame.castRoles) : '',
      plate && ref ? PLATE_REFERENCE_SENTENCE : ref ? LIGHT_REFERENCE_SENTENCE : '',
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
  // whose own keep text overflows has its tail trimmed.
  for (let level = 1; level <= COMPACT_STEPS; level++) {
    const shorter = assemble(level, note, fixes);
    if (shorter.length <= max) return shorter;
  }
  let n = cutAtWord(note, 200);
  let f = cutAtWord(fixes, 400);
  let over = assemble(COMPACT_STEPS, n, f).length - max;
  if (over > 0 && f) {
    f = cutAtWord(f, Math.max(0, f.length - over - 2));
    over = assemble(COMPACT_STEPS, n, f).length - max;
  }
  if (over > 0 && n) {
    n = cutAtWord(n, Math.max(0, n.length - over - 2));
    over = assemble(COMPACT_STEPS, n, f).length - max;
  }
  let who = frame.people;
  if (over > 0 && who.trim()) who = cutAtWord(who, Math.max(0, who.trim().length - over - 2));
  return clampPrompt(assemble(COMPACT_STEPS, n, f, who), max);
}

/**
 * What pass 2 does to the planting: the render's CG foliage becomes living
 * plants, at the detail a 4K finish can hold, without moving or adding any.
 */
const VEGETATION_TEXTURE =
  'VEGETATION: every plant reads as a living plant photographed outdoors, never CG foliage, keeping its species, size, shape and position: leaves of varied size, age and angle overlapping in depth, some curled, nicked or yellowing at the tips, with visible veins, a soft sheen only where the sun catches them and translucent glowing green where backlit; tree crowns with broken, irregular edges and gaps where sky and branches show through, never smooth solid domes or repeated clumps; twigs and branches visible inside the crowns; bark with real furrows and texture; blossom as loose clusters of individual flowers at different stages, with buds among them; lawn and groundcover as individual blades and leaves of varied length, spilling slightly over edges, with soil or mulch showing between bedding plants; no two plants identical, nothing plastic, painted or airbrushed.';

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
 * planting and surfaces into real close-range texture. No cap: it stays
 * under 4000, the lowest cap of any model that takes two images.
 */
export function buildPass2Prompt({ people, resolutionName }: { people: boolean; resolutionName: string }): string {
  const items = [
    `FOCUS: crisp, sharp photographic detail only in the plane that is in focus, ${people ? 'the people and everything standing at their distance' : 'the subject and everything at its distance'}: individual leaves and petals, bark, timber grain, woven rattan, stone and paving texture, real water with clear reflections${people ? ', real fabric weave and creases' : ''}; nothing smeared, melted or painterly there. The out-of-focus foreground and background stay exactly as soft as they are now; do not sharpen them, but out-of-focus foliage still reads as real leaves softened by the lens, never smeared paint.`,
    people
      ? "PEOPLE: real skin texture with pores and small imperfections, natural asymmetric faces, correct hands with five fingers; no AI smoothing, no waxy or glossy skin; the same people, not new ones; keep every person's height, footing, contact shadows and depth-of-field softness exactly as they are."
      : '',
    VEGETATION_TEXTURE,
    MATERIAL_TEXTURE,
    "COLOUR: keep the light's warmth but take out the orange cast, so whites read cream-white, greens stay soft sage and olive and skin stays natural; nothing oversaturated.",
    'FILM: keep the gentle bloom on the brightest highlights and the fine film grain; real lens micro-contrast, no over-sharpened halos.',
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
};

/**
 * A plate's second pass: image 1 the x-ray plate, image 2 the render, image 3
 * the light reference when the plan has one. Every decision in the plate is
 * kept; the develop adds the whole look (the chapter's light and falloff,
 * film colour, grain and halation, the lens's depth of field) and the
 * close-range texture of planting, surfaces and skin. Over the cap, colour,
 * falloff, vegetation and materials give way to their short forms in that
 * order (the textures stay whole longest: they are what the 4K pass is for).
 */
export function buildDevelopPrompt(input: DevelopPromptInput): string {
  const chapter = chapterById(input.chapter);
  const grammar = grammarById(input.grammar);
  const interior = input.setting === 'interior';
  const ref = input.lightReference;
  const assemble = (level: number) => {
    const short = (step: number) => level > step;
    const items = [
      `LIGHT: relight the plate to ${ref ? 'exactly the light and colour of the reference photograph' : 'this light'}: ${interior ? chapter.interior : chapter.light}; ${interior ? FILM_FALLOFF_INTERIOR : short(1) ? FILM_FALLOFF_COMPACT : FILM_FALLOFF}; the sun stays exactly where the plate has it and every shadow keeps its direction and length.`,
      `COLOUR AND FILM: ${short(0) ? FILM_COLOUR_COMPACT : FILM_COLOUR}.`,
      `CAMERA: ${FILM_CAMERA(grammar.lens, grammar.people)}; the plate is sharp front to back, so soften the foreground and the far background exactly as that lens would, keeping ${grammar.people ? 'the people and everything at their distance' : 'the subject and everything at its distance'} crisp; soften only what the plate already has nearest, and add no new foreground layer of plants or anything else.`,
      short(2) ? VEGETATION_TEXTURE_COMPACT : VEGETATION_TEXTURE,
      short(3) ? `MATERIALS: ${FILM_MATERIALS}.` : MATERIAL_TEXTURE,
      grammar.people
        ? "PEOPLE: real skin texture with pores and small imperfections, natural asymmetric faces, correct hands with five fingers; no AI smoothing, no waxy or glossy skin; the same people, not new ones; keep every person's height, footing, contact shadows and position exactly as the plate has them, lit by the chapter's light like everything around them, with the depth-of-field softness of their distance."
        : '',
    ]
      .filter(Boolean)
      .map((item, i) => `${i + 1}. ${item}`);
    return [
      `The first attached image is a flat, deep-focus technical plate of this scene in which every decision is already final: develop it into the final hyper-realistic photograph at full ${input.resolutionName} detail.`,
      'Keep exactly its composition, camera position, framing and architecture, its people (the same faces, expressions, poses, clothing, positions, height and footing), its plant species and positions, and its sun direction and shadow layout.',
      "The second attached image is the architect's render of the same place: wherever the plate drifted, match the architecture, roofs, columns, furniture, pool edges and paving to the render exactly in shape, pattern and material, without changing the camera or framing.",
      ref ? LIGHT_REFERENCE_SENTENCE : '',
      'Develop it with only these changes:',
      ...items,
      'Nothing is added, removed or moved. No text, no logos, no watermark.',
    ]
      .filter(Boolean)
      .join(' ');
  };
  const max = input.maxLength;
  let prompt = assemble(0);
  for (let level = 1; max !== undefined && prompt.length > max && level <= COMPACT_STEPS; level++) prompt = assemble(level);
  return max === undefined ? prompt : clampPrompt(prompt, max);
}

/** The plate and develop texts, for the budgets and phrase lists in `.router/lifestyle-plate.ts`. */
export const PLATE_TEXTS = {
  PLATE_STATEMENT,
  PLATE_STATEMENT_COMPACT,
  PLATE_REFERENCE_SENTENCE,
  PLATE_TONE,
  PLATE_TONE_COMPACT,
  PLATE_PLANTING_TAIL,
  PLATE_PEOPLE,
  PLATE_PEOPLE_COMPACT,
  VEGETATION_TEXTURE_COMPACT,
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
