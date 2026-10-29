/**
 * The cinematic looks a render can be re-shot in, shared by the server
 * (prompt building in src/api.ts) and the client picker (src/client/App.tsx).
 */
export const LOOKS = [
  {
    id: 'none',
    name: 'No light change',
    hint: 'Keep the render’s own light',
    light:
      'exactly the light already in the reference image, unchanged: the same time of day, sun direction and height, shadow direction, length and softness, the same sky and weather, the same exposure, colour temperature, contrast and colour balance; only the surfaces become real, nothing is relit or regraded',
    onPeople:
      "the reference image's own light falling on skin and clothing from the same direction, with the same colour, softness and contrast as it falls on everything around them, and shadows matching the trees' in direction and length",
  },
  {
    id: 'golden-hour',
    name: 'Golden hour',
    hint: 'Low warm sun, long shadows',
    light:
      'late golden-hour sunlight raking low from the side, warm amber highlights on the stone, long soft shadows, gentle backlit glow through the leaves, a touch of atmospheric haze',
    onPeople:
      "the low sun rim-lighting hair and shoulders in warm amber from the same side it hits the stone, faces on the shadow side filled softly by warm bounce off the paving, long shadows stretching away in exactly the same direction and length as the trees' shadows",
  },
  {
    // The clean, neutral, backlit light of a premium residential brand film
    // ("Life in full bloom"): soft sun, true whites and greens, no haze or glow.
    id: 'lodha-light',
    name: 'Lodha light',
    hint: 'Soft sun, clean air, neutral colour',
    light:
      'the soft, clean light of a premium residential brand film: a low, gentle sun softened by the trees or thin cloud, coming from behind and to one side so leaves, blossom and the edges of things glow at their rims, neutral natural colour balance with whites white and greens fresh green, no golden, yellow or orange cast, soft highlights that never burn out, gentle contrast with open shadows, crisp fine detail and clean air with no haze, fog, flare or sun disc, the sky pale blue fading to cream and never blown out, pastel blossom colour and natural skin, a calm, graceful, quietly luxurious mood',
    onPeople:
      "the same soft sun rimming hair and shoulders from behind, faces filled evenly by light bounced off grass, paving and pale walls with no harsh shadows, natural skin with no golden cast, catchlights in the eyes, and soft shadows on the ground in exactly the same direction and length as the trees'",
  },
  {
    id: 'early-morning',
    name: 'Early morning',
    hint: 'Fresh low sun, morning mist',
    light:
      'early morning just after sunrise, fresh pale-gold sunlight coming in low and clean from the side, cool blue shade in the shadows, a thin morning mist lying low over the water and between the trees, dew glistening on the leaves and paving, crisp clear air and a calm, quiet, freshly-washed feel',
    onPeople:
      "the low, pale-gold morning sun catching one side of faces and shoulders from the same direction it hits the stone, the shadow side cool and soft from the blue morning sky, long fresh shadows matching the trees' in direction and length, with a slight haze softening people further back in the mist",
  },
  {
    id: 'midday',
    name: 'Midday sun',
    hint: 'High bright sun, crisp shadows',
    light:
      'clear bright midday sun high overhead, crisp short shadows tucked directly under trees, eaves and furniture, a clean deep-blue sky, true-to-material colour on stone, timber and render, sparkling highlights on water and glass, vivid fresh foliage greens, high clarity and a confident, sunlit luxury-resort feel',
    onPeople:
      "bright overhead sun on the tops of heads and shoulders, faces softly shaded under brows and hat brims with warm bounce from the paving filling them in, short dark shadows pooled right beneath each person exactly like the trees' shadows, a few in sunglasses",
  },
  {
    id: 'evening',
    name: 'Evening',
    hint: 'Sun just set, warm afterglow',
    light:
      'early evening as the sun has just dipped below the horizon, a soft warm peach-and-rose afterglow in the sky, gentle shadowless light wrapping the architecture, the first warm interior and garden lights coming on, calm reflections on the water, a relaxed, elegant end-of-day mood',
    onPeople:
      "soft warm afterglow from the sky lighting faces evenly with no hard shadows, a touch of warm glow from the nearest lamp or window on one side, relaxed evening wear, faint soft shadows only near the lights",
  },
  {
    id: 'god-rays',
    name: 'God rays',
    hint: 'Sunbeams through haze and leaves',
    light:
      'strong low sunlight streaming through the existing trees and openings in the scene into a light atmospheric haze, distinct volumetric shafts of light (god rays) cutting diagonally through the air, dappled sun patches on the stone and paving where the beams land, glowing backlit leaves, deep cool shadows between the beams, a luminous, cinematic, awe-filled grade; the beams come only from the real sun direction and real gaps between the trees and structures, nothing new is added to make them',
    onPeople:
      "people stepping in and out of the sun shafts, brightly rim-lit and glowing where a beam falls on them and in soft cool shade where it does not, haze scattering light around anyone standing in a beam, and their shadows falling in the same direction as the beams and the trees' shadows",
  },
  {
    id: 'overcast',
    name: 'Soft overcast',
    hint: 'Diffuse light, rich greens',
    light:
      'soft overcast daylight under a bright cloud cover, wrapping diffuse light with no harsh shadows, deep saturated foliage greens, subtle sheen on the wet stone',
    onPeople:
      "soft, even skylight wrapping around faces from above with gentle shadows under brows and chins, muted natural skin tones under the cool-neutral cloud light, and only faint, diffuse contact shadows on the ground just like the trees'",
  },
  {
    id: 'blue-hour',
    name: 'Blue hour',
    hint: 'Dusk sky, lamps glowing',
    light:
      'blue hour just after sunset, a deep cobalt sky fading to a warm horizon, the street lamps switched on and glowing warm tungsten, practical light reflecting in the water, moody and quiet',
    onPeople:
      "cool cobalt skylight on one side of faces and clothing and warm tungsten from the nearest street lamp on the other, people closer to a lamp lit brighter and warmer than those between lamps, soft shadows falling away from each lamp",
  },
  {
    id: 'after-rain',
    name: 'After rain',
    hint: 'Wet stone, mist, reflections',
    light:
      'just after a rain shower, glistening wet stone and paving, low mist drifting over the water, droplets on the leaves, soft silver light breaking through the clouds, crisp mirror reflections',
    onPeople:
      "soft silver light with a damp sheen on skin, hair and jackets, darker wet patches on shoes and trouser hems, some carrying a folded umbrella, and clear rippled reflections of each person in the wet paving and puddles directly beneath them",
  },
  {
    id: 'night-lit',
    name: 'Night, lights on',
    hint: 'Uplit stone, glowing water',
    light:
      'a deep cinematic night with a dark navy sky, the stone wall grazed by warm uplights from below so every ridge of texture catches the light, the falling water glowing as it is lit from within, the street lamps casting warm tungsten pools, the trees softly lit against the darkness, golden reflections shimmering across the black pool, rich deep shadows and a teal-and-amber night grade',
    onPeople:
      "people lit only by the scene's real light sources — warm uplight and glow from the water wall on the side facing it, warm tungsten pools from the nearest street lamp — fading into shadow and silhouette between lights, with dark low-key skin tones, faint amber reflections in their eyes, and shadows thrown away from each lamp",
  },
  {
    id: 'interior-lit',
    name: 'Interior lighting',
    hint: 'Lights on inside, warm glow',
    light:
      "the building's own interior lighting switched on: warm 2700K architectural light from the real fixtures in the scene (recessed downlights, linear coves, pendants, wall washers and lamps), soft pools of light on floors, grazing washes on walls and timber, glowing glazing seen from outside, balanced against soft cool daylight or dusk ambience through the windows, clean shadows under furniture, gentle highlights on stone, metal and glass, a calm, premium hospitality-interior mood; the light comes only from fixtures and openings that already exist, nothing new is added",
    onPeople:
      "people lit by the nearest real fixture, warm downlight on hair and shoulders with soft falloff on faces, a cooler fill from the windows on the other side, gentle warm reflections in their eyes and soft contact shadows under them on the floor, matching the furniture's shadows",
  },
  {
    id: 'interior-luxury',
    name: 'Luxury interior',
    hint: 'Layered warm light, hotel-suite mood',
    light:
      "a layered luxury-interior lighting scheme from the room's real fixtures: dimmed warm 2400-2700K ambient light, hidden linear coves washing the ceiling, focused accent spots picking out art, stone and joinery, a soft glow from table and floor lamps, backlit shelving and mirrors glowing gently, rich contrast with deep velvety shadows, polished marble, brass and walnut catching warm highlights, a quiet five-star hotel-suite or private-residence mood seen at dusk through the windows; the light comes only from fixtures that already exist, nothing new is added",
    onPeople:
      "people lit softly by the nearest lamp or accent light, warm flattering glow on faces with gentle falloff into shadow, small warm highlights in their eyes and on jewellery, elegant evening wear, soft shadows under them matching the furniture's",
  },
  {
    id: 'moonlit',
    name: 'Moonlit night',
    hint: 'Cool moonlight, quiet mist',
    light:
      'a still, moonlit night with a bright full moon behind thin drifting clouds, cool silver-blue moonlight washing over the stone and leaves, a faint low mist on the water, the street lamps glowing dim and warm as small accents, deep inky shadows, stars faintly visible, a quiet, mysterious, low-key night grade',
    onPeople:
      "people lit mostly by cool, dim silver-blue moonlight from above, faces soft and low in contrast, picked out with a faint warm accent only when standing near a lamp, partly melting into the deep shadows, with long faint moon shadows on the ground",
  },
] as const;

export type LookId = (typeof LOOKS)[number]['id'];

/** How many people to add to the shot. `few` and `lively` predate the wider list; old stills keep them. */
export const CROWDS = [
  { id: 'none', name: 'No people', hint: 'Keep the scene empty' },
  { id: 'one', name: 'One person', hint: 'A single figure for scale' },
  { id: 'few', name: 'A few', hint: 'Two to four, quiet moments' },
  { id: 'groups', name: 'Small groups', hint: 'Pairs and clusters, chatting' },
  { id: 'lively', name: 'Lively', hint: 'A busy garden, still uncrowded' },
] as const;

export type CrowdId = (typeof CROWDS)[number]['id'];

export const CROWD_IDS = CROWDS.map((c) => c.id) as [CrowdId, ...CrowdId[]];

const CROWD_PROMPT: Record<Exclude<CrowdId, 'none'>, string> = {
  one: 'one single person placed naturally in the scene',
  few: 'two to four people placed naturally in the scene',
  groups:
    'three or four small groups of two or three people, each group clearly its own, spaced apart through the scene',
  lively:
    'a lively but uncrowded scatter of people — a few small groups, a couple walking, someone pausing by the water — spread through the space with breathing room between them',
};

/** Who the people are. Phrased as heritage, never as a stereotype. */
export const ETHNICITIES = [
  {
    id: 'mixed',
    name: 'Mixed / diverse',
    hint: 'A natural mix, like a real city',
    prompt: 'a naturally diverse mix of people of different heritages, as in a real city',
  },
  {
    id: 'east-asian',
    name: 'East Asian',
    hint: 'Chinese, Japanese, Korean and more',
    prompt: 'people of East Asian heritage',
  },
  {
    id: 'south-asian',
    name: 'South Asian',
    hint: 'Indian, Pakistani, Bangladeshi, Sri Lankan and more',
    prompt: 'people of South Asian heritage',
  },
  {
    id: 'southeast-asian',
    name: 'Southeast Asian',
    hint: 'Thai, Vietnamese, Filipino, Indonesian and more',
    prompt: 'people of Southeast Asian heritage',
  },
  {
    id: 'black-african',
    name: 'Black / African',
    hint: 'African and Afro-diasporic',
    prompt: 'people of Black and African heritage',
  },
  {
    id: 'mena',
    name: 'Middle Eastern / North African',
    hint: 'Arab, Persian, Turkish, Amazigh and more',
    prompt: 'people of Middle Eastern and North African heritage',
  },
  {
    id: 'hispanic-latino',
    name: 'Hispanic / Latino',
    hint: 'Latin American and Iberian',
    prompt: 'people of Hispanic and Latino heritage',
  },
  {
    id: 'white-european',
    name: 'White / European',
    hint: 'Northern, southern and eastern European',
    prompt: 'people of White and European heritage',
  },
  {
    id: 'pacific-islander',
    name: 'Pacific Islander',
    hint: 'Polynesian, Melanesian, Micronesian',
    prompt: 'people of Pacific Islander heritage',
  },
  {
    id: 'indigenous',
    name: 'Indigenous',
    hint: 'First Peoples and Native communities',
    prompt: 'people of Indigenous heritage',
  },
] as const;

export type EthnicityId = (typeof ETHNICITIES)[number]['id'];

export const ETHNICITY_IDS = ETHNICITIES.map((e) => e.id) as [EthnicityId, ...EthnicityId[]];

export const AGES = [
  {
    id: 'mixed',
    name: 'Mixed ages',
    hint: 'A natural spread of ages',
    prompt: 'of mixed ages, from young adults to people in their sixties',
  },
  {
    id: 'young-adults',
    name: 'Young adults',
    hint: 'Twenties and early thirties',
    prompt: 'young adults in their twenties and early thirties',
  },
  {
    id: 'adults',
    name: 'Adults',
    hint: 'Thirties to fifties',
    prompt: 'adults in their thirties to fifties',
  },
  {
    id: 'older-adults',
    name: 'Older adults',
    hint: 'Sixties and beyond',
    prompt: 'older adults in their sixties and seventies, with natural grey or white hair and lived-in faces',
  },
  {
    id: 'families',
    name: 'Families with children',
    hint: 'Parents with kids as part of the scene',
    prompt:
      'families — parents with children of different ages beside them, the children always close to a parent or guardian and dressed naturally for their age',
  },
] as const;

export type AgeId = (typeof AGES)[number]['id'];

export const AGE_IDS = AGES.map((a) => a.id) as [AgeId, ...AgeId[]];

export const WARDROBES = [
  {
    id: 'smart-casual',
    name: 'Smart casual',
    hint: 'Linen, knitwear, clean shoes',
    prompt:
      'relaxed smart-casual everyday clothes — linen and cotton shirts, light jackets, knitwear, chinos, simple dresses, clean trainers or leather shoes',
  },
  {
    id: 'business',
    name: 'Business',
    hint: 'Suits and work attire',
    prompt:
      'business attire as worn after a working day — tailored jackets, suits with loosened ties, shirtsleeves, blouses, leather shoes, a laptop bag or briefcase',
  },
  {
    id: 'summer',
    name: 'Summer / resort',
    hint: 'Light fabrics, sunglasses',
    prompt:
      'light summer resort clothing — loose linen, cotton dresses, shorts, open shirts, sandals, sunglasses, a straw hat or tote bag',
  },
  {
    id: 'evening',
    name: 'Evening wear',
    hint: 'Dressed up for a night out',
    prompt:
      'evening wear for a night out — tailored dark jackets, dresses, silk and satin, polished shoes, a clutch bag or wristwatch catching the light',
  },
  {
    id: 'streetwear',
    name: 'Streetwear',
    hint: 'Hoodies, sneakers, layers',
    prompt:
      'contemporary streetwear — hoodies, bomber jackets, relaxed denim, layered tees, sneakers, a cap or crossbody bag',
  },
  {
    id: 'athleisure',
    name: 'Outdoor / athleisure',
    hint: 'Technical jackets, trainers',
    prompt:
      'outdoor and athleisure clothing — technical shell jackets, fleece, leggings, joggers, running shoes, a small backpack or water bottle',
  },
] as const;

export type WardrobeId = (typeof WARDROBES)[number]['id'];

export const WARDROBE_IDS = WARDROBES.map((w) => w.id) as [WardrobeId, ...WardrobeId[]];

export const ACTIVITIES = [
  {
    id: 'candid',
    name: 'Candid mix',
    hint: 'A natural blend of moments',
    prompt:
      'caught in a natural mix of candid moments — strolling, pausing, chatting, sitting by the water, looking up at the wall',
  },
  {
    id: 'strolling',
    name: 'Strolling',
    hint: 'Walking through, unhurried',
    prompt: 'strolling unhurriedly along the paving, mid-stride, some pausing to look around',
  },
  {
    id: 'relaxing',
    name: 'Relaxing by the water',
    hint: 'Sitting or leaning at the pool edge',
    prompt:
      'relaxing by the water, sitting on the pool curb or leaning on a planter edge, resting and watching the pool',
  },
  {
    id: 'chatting',
    name: 'Chatting in groups',
    hint: 'Conversation, gestures, laughter',
    prompt:
      'standing and chatting in small groups with relaxed gestures, turned toward each other, mid-conversation or mid-laugh',
  },
  {
    id: 'photographing',
    name: 'Photographing the wall',
    hint: 'Phones up, looking at the water wall',
    prompt:
      'admiring the water wall from a respectful distance, some raising a phone or camera toward it, others gazing up at it',
  },
] as const;

export type ActivityId = (typeof ACTIVITIES)[number]['id'];

export const ACTIVITY_IDS = ACTIVITIES.map((a) => a.id) as [ActivityId, ...ActivityId[]];

/** The people dropdowns together, as a take and a still record them. */
export type PeopleOptions = {
  ethnicity: EthnicityId;
  age: AgeId;
  wardrobe: WardrobeId;
  activity: ActivityId;
};

export const DEFAULT_PEOPLE_OPTIONS: PeopleOptions = {
  ethnicity: 'mixed',
  age: 'mixed',
  wardrobe: 'smart-casual',
  activity: 'candid',
};

/** Fill any option a still or request lacks (older stills have none) with its default. */
export function resolvePeopleOptions(
  options: { [K in keyof PeopleOptions]?: PeopleOptions[K] | undefined } | undefined
): PeopleOptions {
  return {
    ethnicity: options?.ethnicity ?? DEFAULT_PEOPLE_OPTIONS.ethnicity,
    age: options?.age ?? DEFAULT_PEOPLE_OPTIONS.age,
    wardrobe: options?.wardrobe ?? DEFAULT_PEOPLE_OPTIONS.wardrobe,
    activity: options?.activity ?? DEFAULT_PEOPLE_OPTIONS.activity,
  };
}

/** What went into the prompt for people: the options, free text and cast sheet. */
type PeopleBrief = {
  crowd: Exclude<CrowdId, 'none'>;
  who: string;
  onPeople: string;
  castSheet: boolean;
} & PeopleOptions;

/**
 * The cast sheet instruction: it is the one place the second reference image
 * is explained, so the model takes the people and leaves the sheet behind.
 */
const CAST_SHEET_PROMPT =
  'The first reference image is the scene; the second reference image is a cast sheet of the real people to cast. Reproduce the cast sheet’s people faithfully — their faces, skin tone, hair, build and wardrobe — and place them into the scene at true scale, lit by the scene’s own light. Do not reproduce the cast sheet’s own background, lighting, layout or framing; take only the people.';

const CAST_SHEET_SHORT =
  'The first reference is the scene; the second is a cast sheet. Reproduce its people faithfully (faces, skin tone, hair, build, wardrobe) at true scale in the scene’s light, never its background, lighting or layout.';

function pick<T extends { id: string }>(list: readonly T[], id: string): T {
  return list.find((x) => x.id === id) ?? list[0]!;
}

/** Who, how old, wearing what, doing what — one flowing description. */
function castDescription(b: PeopleBrief, compact = false): string {
  const eth = pick(ETHNICITIES, b.ethnicity).prompt;
  const age = pick(AGES, b.age).prompt;
  const wear = pick(WARDROBES, b.wardrobe).prompt;
  const act = pick(ACTIVITIES, b.activity).prompt;
  const free = b.who ? ` Further detail: ${b.who}.` : '';
  // Each fragment cut at its first dash: the headline of the clothes and the moment.
  const head = (t: string) => t.split(' — ')[0]!;
  if (compact) {
    const brief = `${eth}, ${age}, dressed in ${head(wear)}, ${head(act)}`;
    return b.castSheet
      ? `Cast: the people from the cast sheet in their own clothes; anyone else ${brief}.${free}`
      : `Cast: ${brief}.${free}`;
  }
  if (b.castSheet) {
    return `The cast is the people from the cast sheet, each keeping the clothes they wear there; anyone beyond them is ${eth}, ${age}, wearing ${wear}. They are ${act}.${free}`;
  }
  return `They are ${eth}, ${age}, wearing ${wear}, ${act}.${free}`;
}

/**
 * People are where an AI re-shoot most often gives itself away, so this walks
 * the model through scale (measured against the scene's own objects), body
 * physics, then the look's own light on them, then real-photograph realism —
 * each as a positive description of the real thing, with one short avoid
 * clause at the end. It goes after the light and camera sentences so the
 * people are described in light the model already knows.
 */
function peoplePrompt(b: PeopleBrief): string {
  return [
    `Bring the place to life with ${CROWD_PROMPT[b.crowd]}, mostly in the midground and foreground where they read clearly. ${castDescription(b)}`,
    b.castSheet ? CAST_SHEET_PROMPT : '',
    'Set each person to true real-world scale by measuring them against the objects right beside where they stand: an adult is about 1.6 to 1.85 metres tall, a pool curb or low planter edge reaches just below the knee, a bench seat sits at knee height, a street lamp stands roughly two and a half to three times a person’s height, a mature tree trunk is about as thick as a person’s torso with its lowest branches above head height, and the stone wall towers many times taller than anyone near it.',
    'Follow the camera’s true perspective: every foot rests on the same ground plane, people shrink in exact proportion with distance along the paving lines, and standing adults at any distance keep their heads near the same eye-level line as the camera.',
    'Give every body real weight and physics: feet planted on the paving with the weight on the supporting leg, a balanced centre of gravity, a natural mid-stride gait for walkers, seated people resting their full weight on the curb or bench, clothing and hair hanging with gravity and lifting slightly in the breeze, and hands touching real surfaces where they rest.',
    'Place them correctly in depth, passing naturally in front of or behind the trees, planters, lamps and pool edges around them, with true reflections in the water when they stand near it.',
    `Light them as part of the same exposure as everything else, with ${b.onPeople}.`,
    'Make them belong to the environment: dark contact shadows and ambient occlusion where feet meet the ground, cast shadows with exactly the same direction, length, softness and colour as the shadows of the trees and lamps beside them, colour bounced onto skin and clothing from the stone, paving, foliage and water around them, people deeper in the frame softened and lowered in contrast by the same atmospheric haze as the background behind them, and each person matching the focus falloff of whatever stands at the same distance.',
    'Give them exactly the same white balance, exposure, contrast, colour grade, film grain, lens softness and highlight roll-off as the rest of the frame, so skin and clothing sit in the same tonal range as the stone and leaves around them and every person reads as photographed in the same instant, by the same camera, in the same light.',
    'Every person is a real human photographed on location, perfectly blended into the plate, as in a candid frame by a documentary photographer: a distinct individual with their own face, build and height, natural asymmetry and small imperfections — uneven skin tone, visible pores, fine lines, freckles or blemishes, flyaway hair, slightly uneven eyes and teeth — true skin texture with warmth beneath it, clear eyes with catchlights from the scene’s own light, individual strands of hair, real fabric weave, creases and wear, correct anatomy with well-formed hands of five natural fingers, relaxed unposed bodies and genuine, unguarded expressions.',
    'Avoid the over-smoothed AI look: no plastic or waxy skin, no glossy airbrushed faces, no uncanny symmetrical faces, no mannequin or catalogue poses, no duplicated or cloned faces, no cut-out edges or glow around figures.',
    'Show them absorbed in their own moments rather than posing for the camera, every person shown as an individual in ordinary contemporary dress and never as a costume or caricature, and keep them clear of the sculptures and the water wall so the architecture stays the hero, as if they were really there when the frame was shot.',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * The same brief in about a third of the length, for models whose prompt cap
 * leaves no room for the full text. It keeps every idea that matters most:
 * who, scale, grounding, matched light and grade, and real-human realism.
 */
function peoplePromptCompact(b: PeopleBrief): string {
  return [
    `Add ${CROWD_PROMPT[b.crowd].split(' — ')[0]}, mostly in the midground and foreground. ${castDescription(b, true)}`,
    b.castSheet ? CAST_SHEET_SHORT : '',
    'Set each person to true scale against what stands beside them: adults 1.6 to 1.85 metres, a pool curb just below the knee, a street lamp two and a half to three times a person, every foot on the same ground plane.',
    'Give every body real weight: planted feet, balanced stance, natural gait, clothing and hair hanging with gravity, passing correctly in front of or behind trees and lamps, with true water reflections.',
    `Light them in the same exposure, with ${b.onPeople}, with contact and cast shadows matching the trees’ and the same haze, white balance, grade, grain and focus falloff as the plate.`,
    'Each is a real human photographed on location and perfectly blended in, as in a candid documentary frame: a distinct individual with natural asymmetry, true skin texture with pores and fine lines, flyaway hair, real fabric, correct anatomy and hands with five fingers, and unposed, genuine expressions.',
    'Avoid the AI look: no plastic or airbrushed skin, no symmetrical faces, no mannequin poses, no duplicated faces, no cut-out edges. Keep them clear of the sculptures and the water wall.',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Where the camera stands. Every move is a small one around the render's own
 * viewpoint: a new angle can only show what the render already shows, so a
 * big orbit would force the model to invent the unseen sides of the scene.
 */
export const ANGLES = [
  { id: 'as-rendered', name: 'As rendered', hint: 'Same camera as the render', camera: '' },
  {
    id: 'left',
    name: 'From the left',
    hint: 'Small step to the left',
    camera:
      'Move the camera a small step to the left — a gentle orbit of about ten to fifteen degrees around the centre of the scene, keeping the same height, lens and aim point — so the left side of the scene comes slightly forward and the right side slightly recedes in natural parallax.',
  },
  {
    id: 'right',
    name: 'From the right',
    hint: 'Small step to the right',
    camera:
      'Move the camera a small step to the right — a gentle orbit of about ten to fifteen degrees around the centre of the scene, keeping the same height, lens and aim point — so the right side of the scene comes slightly forward and the left side slightly recedes in natural parallax.',
  },
  {
    id: 'low',
    name: 'Low angle',
    hint: 'Eye level, looking up',
    camera:
      'Lower the camera to standing eye level, about 1.6 metres above the ground, from the same position and aim, tilting up slightly so the wall and trees rise taller against the sky and the foreground planting fills the bottom of the frame.',
  },
  {
    id: 'high',
    name: 'High angle',
    hint: 'Raised, looking down',
    camera:
      'Raise the camera a little higher from the same position and aim, tilting down slightly so the pools, paving and planting read more clearly in plan, while the top of the wall and the sky stay in frame.',
  },
  {
    id: 'closer',
    name: 'Closer',
    hint: 'Tighter on the centre',
    camera:
      'Move the camera closer along its own line of sight toward the centre of the scene, framing it tighter on the water wall and the pools in front of it, so everything in frame is already visible in the reference image.',
  },
] as const;

export type AngleId = (typeof ANGLES)[number]['id'];

export const ANGLE_IDS = ANGLES.map((a) => a.id) as [AngleId, ...AngleId[]];

/** Holds the model to the render's contents however the camera moves. */
const FIDELITY =
  'Show only what exists in the reference image: every wall, sculpture, tree, lamp, pool, curb, plant, paving line and the sky stay exactly as designed, in the same number, shape, position and material, with nothing added, removed, moved or redesigned. Treat the reference as the complete truth about the place: anything the new viewpoint brings into frame is a direct continuation of what is already visible — the same paving pattern, the same planting, the same stone, the same sky — and the frame stays within the scene the reference shows.';

export const LOOK_IDS = LOOKS.map((l) => l.id) as [LookId, ...LookId[]];

/** What a still made with a lighting reference is called in place of its look. */
export const REFERENCE_LIGHT_NAME = 'Reference light';

/** Whether a still took its light from a reference photo or another still. */
export function litFromReference(s: {
  lightRefUrl?: string | undefined;
  lightFromStillId?: string | undefined;
}): boolean {
  return s.lightRefUrl !== undefined || s.lightFromStillId !== undefined;
}

/** The look's name, or "Reference light" when a lighting reference set the light. */
export function lookLabel(look: string, lightReference = false): string {
  if (lightReference) return REFERENCE_LIGHT_NAME;
  return LOOKS.find((l) => l.id === look)?.name ?? look;
}

/**
 * The lighting reference rides along as the last reference image. Only its
 * light may cross over: never its place, things, people or framing.
 */
const LIGHT_REFERENCE_PROMPT =
  'The last reference image is a lighting reference only. Take nothing from it but its light: the time of day, the sun’s direction and height, shadow direction, length and softness, the sky and weather, atmospheric haze, the colour and temperature of the light, contrast, exposure and colour grade. Light the scene from the first reference image in exactly that light, as if it had been photographed at the same moment. Never copy anything else from the lighting reference: not its location, architecture, objects, plants, people, composition, camera angle or framing; nothing that appears in it may appear in the frame.';

/**
 * Same light across a project's views: the reference is another finished
 * still of the same place, so its architecture may well appear here too, but
 * the composition and contents still come only from this render.
 */
const SERIES_LIGHT_PROMPT =
  'The last reference image is a finished film still of another view of the same project, used only as the lighting reference for a matching series. Light this scene in exactly the same light, as if both frames were photographed minutes apart on the same day by the same camera: the same time of day, sun direction and height relative to the site, shadow direction, length and softness, the same sky and weather, atmospheric haze, colour temperature, contrast, exposure, colour grade and film grain. Take the composition, camera position, framing, architecture, objects and layout only from the first reference image; never copy the framing, viewpoint or the positions of objects or people from the series still.';

const LIGHT_REFERENCE_ON_PEOPLE =
  'the lighting reference’s light falling on skin and clothing with the same direction, colour, softness and contrast as on everything around them';

/**
 * Nano Banana Pro reads flowing, verb-first prose (subject, action, location,
 * composition, style) and positive framing, so the prompt describes what the
 * shot should be rather than listing what to avoid.
 */
/**
 * A different frame shape crops or extends the render. Extending is the risky
 * half: it may only continue what is already at the frame's edges.
 */
function reframeSentence(ratio: string): string {
  return `Compose the photograph in a ${ratio} frame around the same subject and viewpoint. Where the new frame reaches past the edges of the render, only continue what is already there at those edges (the same paving, wall, water, planting and sky), adding no new buildings, objects or features; where it shows less, crop in. Never squeeze, stretch or distort anything to fit.`;
}

/** The Stills tab's "Only what's in the image" switch, in words. */
function strictStillSentence(withPeople: boolean, moves: boolean): string {
  const allowed = withPeople ? ', apart from the people asked for' : '';
  return [
    `Strict rule: nothing appears that is not already visible in the reference image${allowed}. No new objects, buildings, furniture, plants, vehicles, ${withPeople ? '' : 'people, '}animals, signs, text, sky features or light sources, and nothing is removed.`,
    moves
      ? 'Keep the new framing close enough that it shows only what the reference already contains, continuing its edges and never inventing space beyond them.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function buildCinematicPrompt(
  look: LookId,
  direction: string,
  crowd: CrowdId = 'none',
  people = '',
  angle: AngleId = 'as-rendered',
  fixes = '',
  extras: {
    options?: { [K in keyof PeopleOptions]?: PeopleOptions[K] | undefined } | undefined;
    /** A cast sheet rides along as the second reference image. */
    castSheet?: boolean | undefined;
    /** The model's prompt cap; the people text is shortened to fit under it. */
    maxLength?: number | undefined;
    /** A frame shape other than the render's own, e.g. "9:16". */
    reframe?: string | undefined;
    /**
     * A marked edit: where the mark is, in words (src/composite.ts). Only that
     * area may change, so the camera, frame and light stay as rendered.
     */
    masked?: string | undefined;
    /**
     * A lighting reference rides along as the last reference image: a photo
     * (only its light), or another finished still of the project (`series`).
     */
    lightReference?: boolean | 'series' | undefined;
    /** "Only what's in the image": nothing new may appear but the people asked for. */
    strict?: boolean | undefined;
  } = {}
): string {
  const camera = ANGLES.find((a) => a.id === angle)?.camera ?? '';
  const chosen = LOOKS.find((l) => l.id === look) ?? LOOKS[0];
  const light = chosen.light;
  /** "No light change": the render's own light stays as it is. */
  const keepLight = chosen.id === 'none';
  // A marked edit keeps the render's own light, so a reference never applies.
  const lightRef = extras.lightReference !== undefined && extras.lightReference !== false && !extras.masked;
  const extra = direction.trim();
  const who = people.trim();
  const withPeople = crowd !== 'none';
  const build = (compact: boolean) => {
    if (!withPeople) return '';
    const brief: PeopleBrief = {
      ...resolvePeopleOptions(extras.options),
      crowd,
      who,
      onPeople: lightRef ? LIGHT_REFERENCE_ON_PEOPLE : chosen.onPeople,
      castSheet: extras.castSheet === true,
    };
    return compact ? peoplePromptCompact(brief) : peoplePrompt(brief);
  };
  const masked = extras.masked;
  const assemble = (peopleText: string, tight = false) =>
    [
    masked
      ? `Edit only one area of the reference image: ${masked}. Keep everything outside that area exactly as it is in the reference, with the same composition, camera position, framing, light, colour and grade. Inside the area, make the scene a real, photorealistic photograph${withPeople ? ', with people as the only addition and placed inside that area only' : ''}, blending seamlessly into the untouched image around it in perspective, scale, light direction, colour, sharpness and grain.`
      : camera
      ? `Re-photograph the scene in the reference image as a real, photorealistic film still from a slightly different camera position, keeping the exact same architecture, objects and layout${withPeople ? ', with people as the only addition' : ''}. ${camera}`
      : `Re-photograph the scene in the reference image as a real, photorealistic film still, keeping the exact same composition, camera position, framing, architecture, objects and layout${withPeople ? ', with people as the only addition' : ''}.`,
    extras.reframe && !masked ? reframeSentence(extras.reframe) : '',
    masked
      ? 'Outside the area nothing is added, removed, moved or restyled; inside it, change only what the direction below asks for, and otherwise keep its design.'
      : tight
        ? FIDELITY.split('. ')[0]! + '.'
        : FIDELITY,
    'Turn every computer-generated surface into its real-world material: natural stone with true texture, weathering and moisture; real water with accurate transparency, flow and reflections; living plants and trees with natural leaf variation and depth; true metal patina on any sculptures.',
    masked
      ? keepLight
        ? 'Inside the marked area only, match the light already falling on the scene around it. Do not relight, regrade or re-expose anything outside the marked area.'
        : `Inside the marked area only, match this look’s light and grade as it already falls on the scene: ${light}. Do not relight, regrade or re-expose anything outside the marked area.`
      : lightRef
        ? extras.lightReference === 'series'
          ? SERIES_LIGHT_PROMPT
          : LIGHT_REFERENCE_PROMPT
        : keepLight
          ? `Keep ${light}.`
          : `Light it with ${light}.`,
    masked
      ? ''
      : keepLight && !lightRef
        ? 'Shoot it like a high-end cinema camera with an anamorphic lens: natural depth of field, subtle lens falloff and vignetting, fine organic film grain and true dynamic range, keeping the reference’s own colours and tones rather than adding a grade.'
        : 'Shoot it like a high-end cinema camera with an anamorphic lens: natural depth of field, subtle lens falloff and vignetting, fine organic film grain, true dynamic range with rich shadows and controlled highlights, and a refined cinematic color grade.',
    extras.strict ? strictStillSentence(withPeople, !masked && (!!camera || !!extras.reframe)) : '',
    peopleText,
    extra ? (extras.strict ? `Also, using only what is already in the image: ${extra}.` : `Also: ${extra}.`) : '',
    fixes.trim()
      ? `A check of an earlier take of this shot found these problems; make sure this take gets each of them right: ${fixes.trim()}`
      : '',
    'The result is a single, ultra-realistic, award-winning cinematography frame.',
  ]
    .filter(Boolean)
    .join(' ');
  const full = assemble(build(false));
  const max = extras.maxLength;
  if (max === undefined || full.length <= max) return full;
  // Over the model's cap: shorten the people text first, since it is the
  // longest part; only if that is still too long, keep the design sentence
  // to its first clause. The look and the avoid clause always arrive whole.
  const compact = assemble(build(true));
  return compact.length <= max ? compact : assemble(build(true), true);
}
