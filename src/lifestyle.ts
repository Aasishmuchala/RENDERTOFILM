import type { AgeId, CrowdId, LookId, WardrobeId } from './looks.ts';

/**
 * The Lifestyle tab: a render re-shot as one quiet moment of the people who
 * live there, the way a premium residential brand film shows a home — a
 * resident enjoying the place natively, never posing for it. Each moment is a
 * Stills take (`createShot` with `moment`), so it shares the Stills tab's
 * models, light, people options, cast sheet, people check and upscale.
 *
 * `scene` says who is there and what they are doing; its headline is cut at
 * the first " — " when a model's prompt cap needs a short version. `props`
 * are the small personal things the people carry or use, which "Only what's
 * in the image" lets in with them (and nothing else).
 */
export const MOMENTS = [
  {
    id: 'tea-for-two',
    name: 'Tea for two',
    hint: 'Sharing tea at a table, one pouring',
    space: 'Interiors, conservatories, terraces',
    crowd: 'few',
    age: 'adults',
    wardrobe: 'smart-casual',
    look: 'lodha-light',
    scene:
      'two residents sharing a pot of tea at the table in this space — one gently pouring from a porcelain teapot, the other holding a cup in both hands, mid-conversation and smiling, completely at ease',
    props: 'a porcelain teapot, two cups and saucers on a small tray',
  },
  {
    id: 'garden-walk',
    name: 'A walk in the garden',
    hint: 'One resident strolling the paths',
    space: 'Gardens, drives, landscaped paths',
    crowd: 'one',
    age: 'adults',
    wardrobe: 'smart-casual',
    look: 'lodha-light',
    scene:
      'one resident on an unhurried walk along the path — mid-stride in a soft knit coat or scarf, glancing at the planting with a quiet smile, as if on a daily morning walk',
    props: '',
  },
  {
    id: 'family-lawn',
    name: 'Family on the lawn',
    hint: 'Parent and child playing, laughing',
    space: 'Lawns, gardens, open greens',
    crowd: 'few',
    age: 'families',
    wardrobe: 'smart-casual',
    look: 'golden-hour',
    scene:
      'a parent and a young child playing together on the grass — the parent lying on the lawn laughing while the child leans on their back, both caught in a genuine, unposed moment of play',
    props: 'a small camera in their hands',
  },
  {
    id: 'poolside',
    name: 'By the pool',
    hint: 'Trailing a hand in the water',
    space: 'Pools, water features',
    crowd: 'one',
    age: 'adults',
    wardrobe: 'summer',
    look: 'lodha-light',
    scene:
      'one resident relaxing at the pool edge — sitting on the coping with their feet in the water, trailing one hand through the surface so it ripples softly, eyes half-closed in the warm light',
    props: 'a folded towel beside them',
  },
  {
    id: 'morning-yoga',
    name: 'Morning yoga',
    hint: 'A quiet practice on a deck or lawn',
    space: 'Decks, lawns, terraces',
    crowd: 'one',
    age: 'young-adults',
    wardrobe: 'athleisure',
    look: 'early-morning',
    scene:
      'one resident practising yoga — seated cross-legged on a mat with their back half-turned to the camera, arms raised overhead with palms together, calm and absorbed',
    props: 'a yoga mat',
  },
  {
    id: 'bench-for-two',
    name: 'A quiet moment for two',
    hint: 'A couple on a garden seat',
    space: 'Gardens, courtyards, seating areas',
    crowd: 'few',
    age: 'adults',
    wardrobe: 'summer',
    look: 'lodha-light',
    scene:
      'a couple sitting together on an existing bench or seat — turned slightly toward each other, talking softly, one in a wide straw hat and sunglasses with a light scarf, simply enjoying the afternoon',
    props: '',
  },
  {
    id: 'garden-harvest',
    name: 'Garden harvest',
    hint: 'Picking herbs or flowers',
    space: 'Kitchen gardens, planters, flower beds',
    crowd: 'one',
    age: 'young-adults',
    wardrobe: 'summer',
    look: 'golden-hour',
    scene:
      'one resident picking fresh herbs from the existing planting — leaning in to cut a sprig, a woven wicker basket on one arm, in a linen dress and a straw hat',
    props: 'a woven wicker basket of cut herbs',
  },
  {
    id: 'served-at-home',
    name: 'Served at home',
    hint: 'A family at the table, staff serving',
    space: 'Dining rooms, private lounges',
    crowd: 'few',
    age: 'families',
    wardrobe: 'smart-casual',
    look: 'interior-luxury',
    scene:
      'a family seated at the dining table while a uniformed butler in a dark suit sets a plated dessert in front of a delighted child — the parent watching warmly, the service discreet and unhurried',
    props: 'plates, cutlery and a plated dessert on the table',
  },
  {
    id: 'sundowner',
    name: 'Sundowner',
    hint: 'Friends with drinks at dusk',
    space: 'Terraces, balconies, rooftops',
    crowd: 'few',
    age: 'adults',
    wardrobe: 'evening',
    look: 'evening',
    scene:
      'friends gathered on the terrace as the light fades — standing and leaning on the railing with drinks in hand, laughing at a shared story, relaxed and close',
    props: 'drinks glasses in their hands',
  },
  {
    id: 'reading-nook',
    name: 'A quiet afternoon',
    hint: 'Reading by the window',
    space: 'Living rooms, libraries, bedrooms',
    crowd: 'one',
    age: 'older-adults',
    wardrobe: 'smart-casual',
    look: 'lodha-light',
    scene:
      'one resident curled into a chair by the window with a book — reading, a cup of tea within reach, feet tucked up, lost in the page',
    props: 'a book and a cup of tea',
  },
  {
    id: 'kids-at-play',
    name: 'Children at play',
    hint: 'Kids playing, a parent nearby',
    space: 'Play lawns, courtyards, gardens',
    crowd: 'few',
    age: 'families',
    wardrobe: 'smart-casual',
    look: 'golden-hour',
    scene:
      'two young children running and playing on the open ground — one chasing the other mid-laugh, a parent close by watching and smiling, everyone safe and unhurried',
    props: '',
  },
  {
    id: 'coming-home',
    name: 'Coming home',
    hint: 'Arriving, greeted at the door',
    space: 'Entrances, lobbies, drop-offs',
    crowd: 'few',
    age: 'adults',
    wardrobe: 'business',
    look: 'evening',
    scene:
      'a resident arriving home through the entrance — a doorman or concierge in uniform holding the door and greeting them with a nod, the resident smiling back as they step in',
    props: 'a leather bag over the resident’s shoulder',
  },
] as const satisfies readonly {
  id: string;
  name: string;
  hint: string;
  space: string;
  crowd: Exclude<CrowdId, 'none'>;
  age: AgeId;
  wardrobe: WardrobeId;
  look: LookId;
  scene: string;
  props: string;
}[];

export type MomentId = (typeof MOMENTS)[number]['id'];

export const MOMENT_IDS = MOMENTS.map((m) => m.id) as [MomentId, ...MomentId[]];

export type Moment = (typeof MOMENTS)[number];

export function momentById(id: string | undefined): Moment | undefined {
  return MOMENTS.find((m) => m.id === id);
}

/**
 * How a brand film shows people living in a home: residents, not models,
 * caught in an ordinary moment by a discreet camera. Added after the people
 * brief whenever a take is a lifestyle moment.
 */
export const LIFESTYLE_FEEL =
  'This is a frame from a premium residential lifestyle film: the people are the residents of this home, enjoying it natively and privately, never presenting it. Catch them in an unhurried, intimate everyday moment, observed from a discreet distance as if the camera were not there — no one looks into the lens, no one poses, gestures are small and real, and the mood is calm, warm and quietly luxurious. Let the moment and the place share the frame: the people read clearly, and the architecture around them stays exactly as designed.';
