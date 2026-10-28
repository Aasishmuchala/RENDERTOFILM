/**
 * The Director tab's story presets: the narrative an archviz film is cut to.
 * Shared by the server (the planner's brief in src/storyboard-api.ts) and the
 * client picker (src/client/DirectorPage.tsx). Each `narrative` tells the
 * planner how the story moves and which light and life suit each part of it;
 * it never describes the project itself, which comes only from the images.
 */
export const STORYLINES = [
  {
    id: 'day-in-the-life',
    name: 'A day in the life',
    hint: 'Morning to night, one day on the project',
    group: 'Time',
    narrative:
      'One day in the life of the place, from first light to night. Open on the quietest, widest views in early morning or soft light, move through a lively, sunlit middle of the day where people use the spaces, warm into golden hour and evening, and close on blue hour and night with the lights on. Interiors follow the same clock: morning light through the windows early, lamps and warm interior light late.',
  },
  {
    id: 'arrival',
    name: 'Arrival sequence',
    hint: 'Approach, entrance, then inside',
    group: 'Journey',
    narrative:
      'The visitor’s arrival. Start far out on the approach and the widest exterior views, move to the entrance and threshold, then step inside: the main spaces, then the most private ones, ending on the view back out. Keep one continuous time of day across the sequence so it reads as a single visit, usually late afternoon into golden hour. People are few: the visitor and the odd person greeting them.',
  },
  {
    id: 'golden-reveal',
    name: 'Golden hour reveal',
    hint: 'Warm, low sun across every view',
    group: 'Mood',
    narrative:
      'A warm, emotional reveal shot through one golden hour. Open on a wide establishing view, build through the strongest architectural views, and land on the most intimate frame. Favour golden hour and evening for exteriors and warm interior light for interiors, with god rays where trees or openings would catch them. People are calm and few.',
  },
  {
    id: 'luxury-resort',
    name: 'Luxury resort film',
    hint: 'Hospitality, calm, aspirational',
    group: 'Mood',
    narrative:
      'A luxury hospitality film: slow, calm and aspirational. Open on the setting and the arrival, move to pools, terraces and gardens with guests relaxing in small numbers, then to the finest interiors in a layered, hotel-suite light, and close at dusk and night with every lamp glowing. Luxury interior light for interiors, golden hour, evening and blue hour outside.',
  },
  {
    id: 'architectural-purity',
    name: 'Architectural purity',
    hint: 'Quiet, minimal, form and material',
    group: 'Mood',
    narrative:
      'A quiet, minimal film about form, material and light. No crowds: no people, or a single figure for scale where a view needs one. Prefer soft overcast and early morning for calm, even light, and midday sun where hard shadows draw the geometry. Order the frames from the whole to the detail: the full building, then its facades, then its spaces, then the closest views.',
  },
  {
    id: 'family-home',
    name: 'Family home story',
    hint: 'Warm, lived-in, everyday life',
    group: 'Life',
    narrative:
      'A warm story of a family living in the home. Start outside in fresh morning light, move through everyday moments in the living spaces, garden and terraces during the day, and end in the evening with the lights on inside. People are families and couples doing ordinary things, never posing. Interior lighting for interiors in the evening frames.',
  },
  {
    id: 'urban-life',
    name: 'Lively community',
    hint: 'Streets, plazas, people using it',
    group: 'Life',
    narrative:
      'The project as a living part of the city or community: people arriving, meeting, walking and sitting together. Open wide on the project in its context, then the public spaces at their liveliest in bright day and golden hour, ending on the evening with lights on and people still out. Small groups to lively crowds outdoors, fewer indoors.',
  },
  {
    id: 'night-glow',
    name: 'After dark',
    hint: 'Blue hour into a lit night',
    group: 'Time',
    narrative:
      'The project after dark. Open at evening as the sun goes, move into blue hour as the lamps come on, and end in the full night with uplit stone, glowing windows and water, and moonlight on the quietest views. Interiors glow with warm interior light. People are few and calm.',
  },
  {
    id: 'monsoon-mood',
    name: 'Monsoon mood',
    hint: 'Overcast, rain-washed, misty',
    group: 'Mood',
    narrative:
      'A moody, rain-washed film. Soft overcast light for the opening, after-rain light with wet stone, reflections and mist through the middle, and god rays breaking through as the weather clears. Interiors feel sheltered and warm with interior lighting against the grey outside. People are few.',
  },
  {
    id: 'showcase',
    name: 'Property showcase',
    hint: 'Clear, bright, sales-ready',
    group: 'Journey',
    narrative:
      'A clear, bright showcase for buyers. Put the strongest hero exterior first, then the key spaces in a logical walkthrough from outside in, ending on the best view or amenity. Favour bright midday or golden-hour light outside and interior lighting inside, so every space reads clearly. People are a few, for scale and warmth, never crowding the architecture.',
  },
] as const;

export type StorylineId = (typeof STORYLINES)[number]['id'];
export const STORYLINE_IDS = STORYLINES.map((s) => s.id) as [StorylineId, ...StorylineId[]];

export function storylineName(id: string): string {
  return STORYLINES.find((s) => s.id === id)?.name ?? id;
}

/** How many images one storyboard takes. */
export const MAX_STORYBOARD_IMAGES = 12;
