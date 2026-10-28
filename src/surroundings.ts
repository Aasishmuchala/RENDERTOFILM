/**
 * The Surroundings tab's presets: the landscape a building can be set in,
 * shared by the server (prompt building in src/surroundings-api.ts) and the
 * client picker (src/client/SurroundingsPage.tsx). Each `setting` describes
 * only what lies around the building; the building itself is never described,
 * so the model has nothing to redraw it from but the image.
 */
export const SETTINGS = [
  {
    id: 'western-ghats',
    name: 'Western Ghats hills',
    hint: 'Misty green hills, tea terraces',
    group: 'Hills and mountains',
    setting:
      'the rolling hills of the Western Ghats in India: layered green ridges fading into soft monsoon mist, neat tea-estate terraces contouring the slopes, silver oak shade trees, a few ribbon waterfalls on the far hillsides, low cloud drifting through the valleys and a fresh, rain-washed sky',
    light: 'soft, diffused light under a bright overcast monsoon sky, with gentle haze adding depth to each ridge',
  },
  {
    id: 'himalayan-foothills',
    name: 'Himalayan foothills',
    hint: 'Deodar pines, snow peaks beyond',
    group: 'Hills and mountains',
    setting:
      'the Himalayan foothills: steep slopes of tall deodar cedar and pine, terraced fields and stone walls stepping down the hillside, a deep valley below, and snow-capped Himalayan peaks rising crisp and white on the far horizon',
    light: 'clear, crisp mountain light with a deep blue sky and sharp air, the snow peaks catching bright sun',
  },
  {
    id: 'alpine-snow',
    name: 'Snow mountains',
    hint: 'Alpine slopes under fresh snow',
    group: 'Hills and mountains',
    setting:
      'a high alpine valley under fresh snow: snow-laden spruce forest around the site, a frozen meadow, steep white mountain faces and rocky ridges all around, powder catching on branches and rooftops nearby',
    light: 'bright winter sun on snow, cool blue shadows and a pale clear sky',
  },
  {
    id: 'tropical-forest',
    name: 'Tropical rainforest',
    hint: 'Dense, lush, layered jungle',
    group: 'Forest',
    setting:
      'a dense tropical rainforest: towering buttress-rooted trees, giant ferns, banana and heliconia leaves, hanging vines and moss, a thick layered canopy closing in around the site, and glimpses of misty green depth between the trunks',
    light: 'dappled light filtering through the canopy in soft shafts, with humid haze between the trees',
  },
  {
    id: 'pine-forest',
    name: 'Pine forest',
    hint: 'Tall conifers, forest floor',
    group: 'Forest',
    setting:
      'a tall temperate pine forest: straight conifer trunks rising all around, a soft forest floor of needles, ferns and moss, rocks and fallen logs, the trees thinning into blue-green depth behind',
    light: 'calm late-afternoon light slanting between the trunks, with a light forest haze',
  },
  {
    id: 'kerala-backwaters',
    name: 'Kerala backwaters',
    hint: 'Coconut palms, still water',
    group: 'Water and coast',
    setting:
      'the Kerala backwaters: still, mirror-like canals and lagoons, dense groves of leaning coconut palms along the banks, paddy fields, a traditional wooden houseboat moored in the distance, and lush tropical green everywhere',
    light: 'warm, humid tropical light with soft reflections of the palms on the water',
  },
  {
    id: 'goa-coast',
    name: 'Goan coast',
    hint: 'Palm-fringed beach, sea horizon',
    group: 'Water and coast',
    setting:
      'the Goan coastline: a wide golden-sand beach and gentle Arabian Sea waves, swaying coconut palms, laterite rocks, scattered fishing boats on the shore and an open sea horizon',
    light: 'warm, clear coastal sunlight with a soft sea breeze haze over the horizon',
  },
  {
    id: 'lakefront',
    name: 'Lakeside',
    hint: 'Calm lake ringed by hills',
    group: 'Water and coast',
    setting:
      'the shore of a calm lake: clear still water with reflections, reeds and smooth stones along the edge, low wooded hills ringing the far shore, and a few distant boats',
    light: 'calm, even light with soft reflections across the water',
  },
  {
    id: 'mumbai-skyline',
    name: 'Mumbai skyline',
    hint: 'Dense high-rises by the sea',
    group: 'Indian cities',
    setting:
      'Mumbai: a dense skyline of modern residential and commercial high-rises around the site, the curve of the Arabian Sea shoreline and Marine Drive in the distance, palm-lined streets, everyday city traffic and life at street level, and the slightly hazy coastal city air',
    light: 'warm, hazy coastal city light',
  },
  {
    id: 'bengaluru-garden-city',
    name: 'Bengaluru suburb',
    hint: 'Leafy avenues, rain trees',
    group: 'Indian cities',
    setting:
      'a leafy Bengaluru neighbourhood: wide avenues shaded by huge rain trees, gulmohar and jacaranda in bloom, neighbouring low-rise villas and apartment blocks behind compound walls, and a calm, green, garden-city feel',
    light: 'soft, pleasant light filtering through the tree canopy',
  },
  {
    id: 'delhi-avenue',
    name: 'Delhi avenue',
    hint: 'Wide tree-lined boulevards',
    group: 'Indian cities',
    setting:
      'a New Delhi neighbourhood in the Lutyens style: broad boulevards lined with old neem and jamun trees, manicured hedges and roundabouts, neighbouring whitewashed bungalows behind walls, and a calm, stately, green city feel',
    light: 'warm, slightly dusty north-Indian daylight',
  },
  {
    id: 'jaipur-old-city',
    name: 'Jaipur old city',
    hint: 'Pink sandstone, Aravalli hills',
    group: 'Indian cities',
    setting:
      "Jaipur: the pink and terracotta sandstone buildings of the old city around the site, jharokha balconies and domed chhatris, busy lanes with everyday street life, and the rugged Aravalli hills with a hilltop fort on the horizon",
    light: 'warm, golden Rajasthani sunlight',
  },
  {
    id: 'rajasthan-desert',
    name: 'Thar desert',
    hint: 'Golden dunes, khejri trees',
    group: 'Open country',
    setting:
      'the Thar desert in Rajasthan: rippled golden sand dunes rolling to the horizon, scattered khejri trees and dry scrub, a low sandstone wall at the site edge, and a vast open sky',
    light: 'warm, low desert sun with long soft dune shadows and a faint heat haze',
  },
  {
    id: 'countryside',
    name: 'Green countryside',
    hint: 'Fields, groves, open sky',
    group: 'Open country',
    setting:
      'open green countryside: fields and meadows stretching away from the site, mango and neem groves, a winding country lane, distant low hills and a wide open sky',
    light: 'fresh, open daylight with soft clouds',
  },
] as const;

export type SettingId = (typeof SETTINGS)[number]['id'];
export const SETTING_IDS = SETTINGS.map((s) => s.id) as [SettingId, ...SettingId[]];

/** How far the change reaches: just the backdrop, or the grounds as well. */
export const SCOPES = [
  {
    id: 'beyond',
    name: 'Only beyond the site',
    hint: 'Keeps the garden, paving and pool',
  },
  {
    id: 'site',
    name: 'The site and beyond',
    hint: 'Also re-landscapes the grounds',
  },
] as const;

export type ScopeId = (typeof SCOPES)[number]['id'];
export const SCOPE_IDS = SCOPES.map((s) => s.id) as [ScopeId, ...ScopeId[]];

export function settingName(id: string): string {
  return SETTINGS.find((s) => s.id === id)?.name ?? id;
}

/** The prompt that sets the building in `setting`, unchanged. */
export function buildSurroundingsPrompt(
  id: SettingId,
  opts: { scope: ScopeId; keepLight: boolean; direction: string; maxLength?: number | undefined }
): string {
  const s = SETTINGS.find((x) => x.id === id) ?? SETTINGS[0];
  const keep =
    opts.scope === 'beyond'
      ? "the building and everything on its own site: the architecture, its terraces, paving, pool, garden, planting, furniture and any people, exactly as they are in the reference image"
      : 'the building itself exactly as it is in the reference image: its architecture, terraces and decks, and any people on them';
  const change =
    opts.scope === 'beyond'
      ? 'Replace only what lies beyond the site boundary: the backdrop, the horizon, the distant landscape, the neighbouring land and the sky.'
      : 'Replace the grounds around the building and everything beyond: the landscaping, ground cover, trees and planting, the backdrop, the horizon and the sky, so the site belongs naturally in the new setting. Keep paths and driveways that lead to the building where they are, and re-surface them to suit the setting.';
  const parts = [
    'Re-imagine the surroundings of this architectural image as a real photograph.',
    `Keep ${keep}. The building must stay identical: the same massing, rooflines, facade, materials, colours, windows, openings, proportions and details, in the same place in the frame, at the same size. Do not add, remove, move, stretch or redesign any part of it.`,
    'Keep the exact camera: the same viewpoint, height, lens, perspective, framing and crop. The image has the same shape as the reference.',
    change,
    `The new setting: ${s.setting}.`,
    'The building sits in this setting believably: the ground meets its base naturally, with correct contact shadows, its scale is right against the trees, hills and neighbouring buildings, and the landscape recedes with true depth and atmospheric perspective behind it.',
    opts.keepLight
      ? "Light the new surroundings to match the reference image's own light exactly: the same time of day, sun direction, shadow direction and softness, the same exposure and colour temperature, so the building and its new setting read as one photograph. Do not relight the building."
      : `Light the whole image as ${s.light}, falling on the building and its new surroundings alike, with the building's shadows, reflections and highlights redrawn to match.`,
    'Glass and water reflect the new surroundings. Photoreal, shot on a full-frame cinema camera, natural colour, fine detail, no text, no watermark, no illustration or render look.',
    opts.direction.trim() ? `Also: ${opts.direction.trim()}` : '',
  ].filter(Boolean);
  const prompt = parts.join('\n\n');
  return opts.maxLength && prompt.length > opts.maxLength ? prompt.slice(0, opts.maxLength) : prompt;
}
