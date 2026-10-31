import { useMemo } from 'react';

import { BAY_CAPABILITIES, type Capabilities } from '../../capabilities.ts';
import {
  CLIP_UPSCALERS,
  IMAGE_MODELS,
  imageModelName,
  STILL_UPSCALERS,
  VIDEO_MODELS,
  videoModelName,
} from '../../models.ts';
import { trpc } from '../trpc.ts';

export type ModelKind = 'image' | 'video' | 'stillUpscaler' | 'clipUpscaler';

type Hinted = { id: string; hint?: string | undefined };

/** Model or upscaler id to the alias `caps.rates` is keyed by. Two ids can share one (both Veo 3.1 models). */
const ALIASES = new Map<string, string>(
  [...IMAGE_MODELS, ...VIDEO_MODELS, ...STILL_UPSCALERS, ...CLIP_UPSCALERS].map((m) => [m.id, m.alias])
);

const SOUND = /\b(sound|audio|silent)\b/i;

/**
 * The provider's note after a model's hint. `src/models.ts` speaks for Bay, so
 * a hint that promises sound gives way to a note saying what this provider does.
 */
function withNote(hint: string | undefined, note: string) {
  if (!hint || (SOUND.test(hint) && SOUND.test(note))) return note;
  return `${hint}. ${note}`;
}

/** The options the provider offers, in their own order, each carrying the provider's note. */
function offered<T extends Hinted>(options: readonly T[], ids: readonly string[], notes: Capabilities['notes']): T[] {
  return options
    .filter((o) => ids.includes(o.id))
    .map((o) => {
      const note = notes[o.id];
      return note ? { ...o, hint: withNote(o.hint, note) } : o;
    });
}

function toolsFor(caps: Capabilities) {
  const ids: Record<ModelKind, readonly string[]> = {
    image: caps.imageModels,
    video: caps.videoModels,
    stillUpscaler: caps.stillUpscalers,
    clipUpscaler: caps.clipUpscalers,
  };
  const rateOf = (id: string) => caps.rates[id] ?? caps.rates[ALIASES.get(id) ?? id];

  return {
    caps,
    /** True on the web app: every model, and the page's own Runway wording. */
    onBay: caps.provider === 'bay',
    allowedImage: <T extends Hinted>(options: readonly T[]) => offered(options, caps.imageModels, caps.notes),
    allowedVideo: <T extends Hinted>(options: readonly T[]) => offered(options, caps.videoModels, caps.notes),
    allowedStillUpscalers: offered(STILL_UPSCALERS, caps.stillUpscalers, caps.notes),
    allowedClipUpscalers: offered(CLIP_UPSCALERS, caps.clipUpscalers, caps.notes),
    /** Names a page suggests ("Pick Seedance 2.0 to use them"), cut to what can be picked here. */
    offeredImageNames: (names: readonly string[]) =>
      names.filter((n) => caps.imageModels.some((id) => imageModelName(id) === n)),
    offeredVideoNames: (names: readonly string[]) =>
      names.filter((n) => caps.videoModels.some((id) => videoModelName(id) === n)),
    /** The sentence for a saved model this provider hides, else null. The saved value is never rewritten. */
    modelBlocked: (kind: ModelKind, id: string): string | null =>
      ids[kind].includes(id) ? null : `Not offered by ${caps.providerName}. Pick another model.`,
    /** The same notice when the provider has nothing to pick instead. */
    noneOffered: `Not offered by ${caps.providerName}. Choose another provider in Settings.`,
    /**
     * `CostLine`'s last sentence for these models or aliases, in the order they
     * run. Credits differ per provider, so each one speaks for itself: Higgsfield
     * quotes every run, the Runway API has a rate card, Bay says nothing here.
     */
    providerNote: (...models: string[]): string | undefined => {
      if (caps.provider === 'higgsfield') return 'Quoted by Higgsfield before each run.';
      if (caps.provider === 'simulator') return 'Simulated, so nothing is billed.';
      if (caps.provider !== 'runway') return undefined;
      const rates = [...new Set(models.map(rateOf).filter((r) => r !== undefined))];
      if (rates.length === 0) return undefined;
      return `Runway API ${rates.length > 1 ? 'rates' : 'rate'}: ${rates.join(', then ')}.`;
    },
  };
}

/**
 * What the server can generate for this owner, and the page helpers on top of
 * it. Bay's answer stands in until the query returns, so the web app paints
 * exactly as it always has.
 */
export function useCapabilities() {
  const { data } = trpc.settings.capabilities.useQuery(undefined, { staleTime: 30_000 });
  return useMemo(() => toolsFor(data ?? BAY_CAPABILITIES), [data]);
}
