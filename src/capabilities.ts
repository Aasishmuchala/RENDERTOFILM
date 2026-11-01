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
  /** Mastering: one finished file per deliverable, with music and QC, through the desktop app's own ffmpeg. */
  master: boolean;
  /** The cut as a file other editors read (OTIO, EDL), which names each clip's file on this computer. */
  interchange: boolean;
  /** Optional pinned command-line editors, set up under Settings, Power tools. */
  sidecars: boolean;
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
  master: false,
  interchange: false,
  sidecars: false,
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

/** Who ran a task in the desktop app; Bay has one provider and records none. */
export type GenerationProvider = Exclude<Capabilities['provider'], 'bay'>;

/**
 * The provider this client's tasks go to, for the work's later steps to be held
 * to. Read it on the line after the first task's `await`: createTask has just
 * read Settings, and nothing else runs before that line, so this names the
 * provider that task went to. Undefined on Bay.
 */
export function providerOf(runway: unknown): GenerationProvider | undefined {
  const { provider } = capabilitiesOf(runway);
  return provider === 'bay' ? undefined : provider;
}
