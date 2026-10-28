/**
 * The Location tab's presets and prompt: a Google Earth screenshot of a place
 * becomes a photoreal aerial photograph of that exact spot. Shared by the
 * server (src/location-api.ts) and the client (src/client/LocationPage.tsx).
 */

export const VIEWS = [
  {
    id: 'match',
    name: 'Match the screenshot',
    hint: "Keep the screenshot's exact camera",
    prompt:
      "Keep the exact camera of the screenshot: the same viewpoint, angle, tilt, framing and crop. Show the same extent of land as the screenshot.",
  },
  {
    id: 'top-down',
    name: 'Top-down satellite',
    hint: 'Straight down, like a survey photo',
    prompt:
      'Shoot it straight down from above, a true top-down orthographic-style satellite view, with the same centre point and the same extent of land as the screenshot. Only a small correction of the camera is allowed; show nothing the screenshot does not show.',
  },
  {
    id: 'oblique',
    name: 'Oblique aerial',
    hint: 'Tilted, like a drone or helicopter',
    prompt:
      'Show it as an oblique aerial photograph, tilted about 45 degrees from a drone or helicopter, with the same centre point as the screenshot. Use a small camera move only and keep the same extent of land; never invent new parts of the site beyond the screenshot.',
  },
] as const;

export type LocationViewId = (typeof VIEWS)[number]['id'];
export const VIEW_IDS = VIEWS.map((v) => v.id) as [LocationViewId, ...LocationViewId[]];

export const LIGHTS = [
  {
    id: 'match',
    name: 'Match the screenshot',
    hint: "Keep the screenshot's sun",
    prompt:
      "Keep the screenshot's own light: the same time of day, sun direction, shadow direction and softness, and the same colour temperature.",
  },
  {
    id: 'clear-midday',
    name: 'Clear midday',
    hint: 'High sun, crisp, short shadows',
    prompt: 'Light it with clear midday sun high in a deep blue sky: crisp, short shadows, strong natural colour and high clarity.',
  },
  {
    id: 'golden-hour',
    name: 'Golden hour',
    hint: 'Low warm sun, long shadows',
    prompt: 'Light it at golden hour: low warm sun raking across the land, long soft shadows and a gentle warm glow on roofs and trees.',
  },
  {
    id: 'soft-overcast',
    name: 'Soft overcast',
    hint: 'Even, shadowless, true colour',
    prompt: 'Light it under a bright soft overcast sky: even, diffuse light, very gentle shadows and true, slightly muted natural colour.',
  },
  {
    id: 'blue-hour',
    name: 'Blue hour',
    hint: 'Dusk, cool sky, lit windows',
    prompt: 'Light it at blue hour just after sunset: a deep blue sky, cool ambient light on the ground, and warm lights glowing in windows and along roads.',
  },
] as const;

export type LocationLightId = (typeof LIGHTS)[number]['id'];
export const LIGHT_IDS = LIGHTS.map((l) => l.id) as [LocationLightId, ...LocationLightId[]];

/** "12.9716° N, 77.5946° E" */
export function formatCoords(lat: number, lng: number): string {
  const ns = lat < 0 ? 'S' : 'N';
  const ew = lng < 0 ? 'W' : 'E';
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lng).toFixed(4)}° ${ew}`;
}

/** The place name when there is one, else the formatted coordinates. */
export function locationName(loc: { lat: number; lng: number; place?: string | undefined }): string {
  const place = loc.place?.trim();
  return place ? place : formatCoords(loc.lat, loc.lng);
}

export function viewName(id: string): string {
  return VIEWS.find((v) => v.id === id)?.name ?? id;
}

export function lightName(id: string): string {
  return LIGHTS.find((l) => l.id === id)?.name ?? id;
}

/** The prompt that turns a Google Earth screenshot into a real aerial photograph. */
export function buildLocationPrompt(opts: {
  lat: number;
  lng: number;
  place?: string | undefined;
  view: LocationViewId;
  light: LocationLightId;
  direction: string;
  maxLength?: number | undefined;
}): string {
  const view = VIEWS.find((v) => v.id === opts.view) ?? VIEWS[0];
  const light = LIGHTS.find((l) => l.id === opts.light) ?? LIGHTS[0];
  const place = opts.place?.trim();
  const where = `${formatCoords(opts.lat, opts.lng)} (latitude ${opts.lat.toFixed(5)}, longitude ${opts.lng.toFixed(5)})${place ? `, ${place}` : ''}`;
  const base = [
    `Turn this Google Earth satellite screenshot into a real, high-resolution aerial photograph of that exact place: ${where}.`,
    "Keep the exact layout: every building footprint and roof shape, every road and path, plot boundary, tree position, water body and piece of terrain stays in the same place at the same size. Add, remove or move nothing.",
    view.prompt,
    `Use the coordinates${place ? ' and the place name' : ''} for regional realism: the real climate zone, the season-appropriate species and colour of the vegetation, the soil and ground colour, local building materials, roofing (tile, metal, concrete, thatch or whatever is typical there), road surfaces and the vehicles typical of that region.`,
    'Remove every Google Earth artifact: interface, labels, pins, watermark, compass, attribution text, low-poly 3D-mesh melting, smeared or blurry textures, warped trees, stitching seams and cloud patches.',
    'Render crisp, detailed texture everywhere: roof tiles, gravel, asphalt cracks, grass blades, leaf canopies, water ripples, car details and true cast shadows.',
    light.prompt,
    'Photoreal, shot from an aircraft or drone with a full-frame camera, natural colour, no text, no illustration, no render look.',
  ].join('\n\n');
  const extra = opts.direction.trim() ? `\n\nAlso: ${opts.direction.trim()}` : '';
  const max = opts.maxLength;
  if (!max || base.length + extra.length <= max) return base + extra;
  // Over the model's limit: shorten the standing text, never the visitor's own direction.
  return base.slice(0, Math.max(0, max - extra.length)) + extra;
}
