import {
  type ClipUpscalerId,
  IMAGE_MODEL_IDS,
  type ImageModelId,
  STILL_UPSCALER_IDS,
  type StillUpscalerId,
  VIDEO_MODEL_IDS,
  type VideoModelId,
} from './models.ts';

/**
 * What the server this page talks to can generate. On Bay that is every model
 * in src/models.ts; the desktop app's client answers for the owner's provider,
 * so a client with no `capabilities()` is Bay and nothing is filtered out.
 */
export type Capabilities = {
  provider: 'bay' | 'higgsfield' | 'runway' | 'simulator';
  providerName: string;
  desktop: boolean;
  imageModels: ImageModelId[];
  videoModels: VideoModelId[];
  stillUpscalers: StillUpscalerId[];
  clipUpscalers: ClipUpscalerId[];
  aleph: boolean;
  export: boolean;
  /** Recreate in 4K: native 4K from a still and a reference clip. The Runway API cannot pin the still as the first frame alongside a reference video. */
  recreate: boolean;
  textViaRunway: boolean;
  /** Model id to one hint ("Runs at 2K on Higgsfield"). */
  notes: Partial<Record<string, string>>;
  /** Bay alias to one rate line ("12 credits per second"). */
  rates: Partial<Record<string, string>>;
};

export const BAY_CAPABILITIES: Capabilities = {
  provider: 'bay',
  providerName: 'Runway',
  desktop: false,
  imageModels: [...IMAGE_MODEL_IDS],
  videoModels: [...VIDEO_MODEL_IDS],
  stillUpscalers: [...STILL_UPSCALER_IDS],
  clipUpscalers: ['runway', 'flux'],
  aleph: true,
  export: true,
  recreate: true,
  textViaRunway: true,
  notes: {},
  rates: {},
};

/** `runway` is `ctx.runway`, which is unset for a visitor with no session. */
export function capabilitiesOf(runway: unknown): Capabilities {
  const client = runway as { capabilities?: () => Capabilities } | null | undefined;
  return typeof client?.capabilities === 'function' ? client.capabilities() : BAY_CAPABILITIES;
}
