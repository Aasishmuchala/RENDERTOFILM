/**
 * The mastering presets the pages share: which deliverables exist, what each
 * is called, and what the sound is mastered to. The graph builder that turns
 * these into ffmpeg arguments is desktop/platform/master.js (desktop only);
 * `.router/master-presets.ts` fails when the two disagree.
 */

export const DELIVERABLE_IDS = ['h264', 'hevc10', 'prores', 'vertical'] as const;
export type DeliverableId = (typeof DELIVERABLE_IDS)[number];

export const DELIVERABLE_LABELS: Record<DeliverableId, string> = {
  h264: 'H.264 for web',
  hevc10: 'HEVC 10-bit for review',
  prores: 'ProRes 422 HQ master',
  vertical: '9:16 for social',
};

/** The 9:16 deliverable is always this size, whatever the film's own. */
export const VERTICAL_SIZE = { width: 1080, height: 1920 } as const;

/** What a title card may hold and how it plays: seconds on screen, the fade in or out of it, and the text limits. */
export const TITLE_CARD = { minSeconds: 1, maxSeconds: 10, defaultSeconds: 3, fadeSeconds: 0.5, maxTitle: 80, maxSubtitle: 120 } as const;

/** A cut in the 9:16 file either crops a window of the clip or sits whole on black. */
export type FrameMode = 'crop' | 'fit';
/** `x` is the window's horizontal position, 0 (left) to 1 (right). */
export type CutFrame = { mode: FrameMode; x: number };
export type TitleCard = { text: string; subtitle?: string | undefined; seconds: number };
export type EditTitles = { head?: TitleCard | null | undefined; tail?: TitleCard | null | undefined };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * How a clip of `width` x `height` goes into the 9:16 frame: what the user chose
 * (the window kept inside 0..1), else decided from its own shape. A clip wider than
 * 9:16 crops at the centre, since fitting it leaves a thin strip; one at or taller
 * than 9:16 sits whole on black.
 */
export function verticalFrame(width: number, height: number, chosen?: CutFrame | null): CutFrame {
  if (chosen) return { mode: chosen.mode, x: clamp01(chosen.x) };
  return width / height > 9 / 16 + 1e-6 ? { mode: 'crop', x: 0.5 } : { mode: 'fit', x: 0.5 };
}

/** What the finished row says a cut did in the 9:16 file. */
export function frameLabel(f: CutFrame): string {
  if (f.mode === 'fit') return 'Fit on black';
  return f.x < 0.4 ? 'Crop \u00b7 left' : f.x > 0.6 ? 'Crop \u00b7 right' : 'Crop \u00b7 centre';
}

/** Integrated loudness in LUFS, true peak in dBTP, and how far a file may sit from the loudness (LU). */
export const MASTER_TARGETS = { lufs: -14, truePeak: -2, tolerance: 1 } as const;

/** What reading a finished master back found; `pass` is false when `findings` is not empty. */
export type QcReport = {
  /** Null when the file's loudness could not be read (no audio, or silence). */
  integratedLufs: number | null;
  truePeakDbfs: number | null;
  frames: number | null;
  tags: { colorspace: string | null; primaries: string | null; trc: string | null; range: string | null };
  pass: boolean;
  findings: string[];
  /** What was left out on purpose, such as the loudness gate on a silent film. */
  notes?: string[] | undefined;
};
