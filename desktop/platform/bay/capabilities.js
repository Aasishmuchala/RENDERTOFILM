// What each provider can generate, in the shape of src/capabilities.ts. The ids
// are the ones src/models.ts spells (.router/desktop-dispatch.test.mjs compares
// them), and the rows are the Phase 12 table. The Runway API's own row is in
// ../providers/runway-api.js. Every row sets `recreate`: the client reads a
// missing field as off.
const ALL_IMAGE_MODELS = [
  'nano-banana-pro',
  'nano-banana-2-1',
  'nano-banana-2',
  'gpt-image-2-5-sunburst',
  'gpt-image-2-5-flare',
  'gpt-image-2',
  'seedream-5-pro',
  'seedream-5',
  'flux-2-max',
  'grok-imagine-2',
  'krea-image-3',
  'gen-4-image',
];
const ALL_VIDEO_MODELS = [
  'seedance-2',
  'seedance-2-5',
  'seedance-2-fast',
  'kling-3-pro',
  'kling-3-4k',
  'kling-o3-pro',
  'kling-4-0',
  'veo-3-1',
  'veo-3-1-fast',
  'gen-4-5',
  'gen-4-turbo',
  'minimax-h3',
  'ltx-2-5-pro',
  'wan-2-6',
];

const HIGGSFIELD_HIDES = new Set(['krea-image-3', 'gen-4-image', 'gen-4-5', 'gen-4-turbo', 'ltx-2-5-pro']);

export const HIGGSFIELD_CAPABILITIES = {
  provider: 'higgsfield',
  providerName: 'Higgsfield',
  desktop: true,
  imageModels: ALL_IMAGE_MODELS.filter((id) => !HIGGSFIELD_HIDES.has(id)),
  videoModels: ALL_VIDEO_MODELS.filter((id) => !HIGGSFIELD_HIDES.has(id)),
  stillUpscalers: [],
  clipUpscalers: ['bytedance'],
  aleph: false,
  export: true,
  master: true,
  recreate: true,
  textViaRunway: false,
  notes: {
    'seedream-5': 'Runs at 2K on Higgsfield',
    'flux-2-max': 'Runs at 2K on Higgsfield',
    'minimax-h3': 'Runs at 2K on Higgsfield',
  },
  rates: {},
};

export const SIMULATOR_CAPABILITIES = {
  provider: 'simulator',
  providerName: 'Simulator',
  desktop: true,
  imageModels: ALL_IMAGE_MODELS,
  videoModels: ALL_VIDEO_MODELS,
  stillUpscalers: ['precision', 'creative'],
  // Recreate in 4K runs the first one, so a task-artifact upscaler leads.
  clipUpscalers: ['runway', 'flux', 'bytedance', 'magnific-video'],
  aleph: true,
  export: true,
  master: true,
  recreate: true,
  textViaRunway: false,
  notes: {},
  rates: {},
};

/** A provider's row as the client reads it, with what every desktop provider shares on top. */
export function capabilitiesFor(provider) {
  return {
    ...provider.capabilities(),
    desktop: true,
    export: true,
  master: true,
    textViaRunway: false,
    rates: provider.rates ?? {},
  };
}
