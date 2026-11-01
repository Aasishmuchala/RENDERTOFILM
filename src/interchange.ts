/**
 * The cut list as files other editors read: OpenTimelineIO (`toOtio`) and a
 * CMX3600 EDL (`toEdl`). Pure: the caller (the edit router) resolves each cut's
 * media file and length, and this module only lays them out.
 *
 * Every time is whole frames at the film's rate. Cuts keep the app's 0.01 s
 * times, so each cut's length is the difference of two rounded running totals:
 * the track then always holds round(sum of durations * fps) frames, never a
 * frame more or less than the sum of rounded cuts. Halves round up.
 *
 * The app's fade is an overlap (ffmpeg xfade): a film of n cuts is
 * sum - (n - 1) * fade seconds long. An OTIO or EDL dissolve does not shorten
 * the track, so the track is longer than the film; `metadata.rtf.fadeModel` and
 * `filmSeconds` say so, for a reader that cares.
 *
 * A music bed is an Audio track under the cuts: one clip from the bed's in point,
 * the length of the Video track, because a longer one would lengthen FilmCraft's
 * film. What each side carries, checked on the pinned FilmCraft 0.15.0 on 2026-11-01:
 * - The gain: OTIO has no field for it, so it sits in `metadata.filmcraft.gain_db`,
 *   which FilmCraft plays to the dB and another editor passes over.
 * - The fades: one-sided dissolves at the clip's two ends, the one way OTIO has to
 *   say it. FilmCraft plays them at constant power, not the master's exponential sine.
 * - Not the master's loudness pass: a conform plays the bed at its own level plus its
 *   gain, not at -14 LUFS, and nothing there limits its peaks.
 * - Not the bed's length: `available_range` is null, as only the desktop's ffmpeg can
 *   read a file. A bed that runs out leaves silence, as the master pads it, and one
 *   whose in point is past its end is a silent film here, where a master refuses it.
 * `metadata.rtf.music` keeps the settings as set, for a reader that cares.
 */

export type InterchangeInput = {
  name: string;
  fps: number;
  width: number;
  height: number;
  transition: 'hard' | 'fade';
  fadeSeconds: number;
  cuts: {
    key: string;
    clipId: string;
    playId: string;
    sourceStart: number;
    duration: number;
    file: string;
    availableSeconds: number;
    colour?: unknown;
  }[];
  /** The bed under the film, on its file on this computer. */
  music?: { name: string; file: string; inSeconds: number; gain: number; fadeIn: number; fadeOut: number } | null | undefined;
};

/** The NTSC rates keep their exact fractions, as the export's fps filter does (desktop/platform/ffmpeg.js). */
const NTSC: readonly (readonly [number, number])[] = [
  [23.976, 24000 / 1001],
  [29.97, 30000 / 1001],
  [59.94, 60000 / 1001],
];

function rateOf(fps: number): number {
  for (const [near, exact] of NTSC) if (Math.abs(fps - near) < 0.01) return exact;
  return fps;
}

/** Round half up; the nudge keeps 8.499999999999999 (a product of 0.01 s times) on its half. */
const frames = (n: number): number => Math.floor(n + 0.5 + 1e-9);

type Span = {
  cut: InterchangeInput['cuts'][number];
  /** First frame of the cut in its source file. */
  from: number;
  /** Where the cut sits on the timeline, in frames. */
  start: number;
  length: number;
};

function spans(input: InterchangeInput, rate: number): Span[] {
  let seconds = 0;
  let start = 0;
  return input.cuts.map((cut) => {
    seconds += cut.duration;
    const end = frames(seconds * rate);
    const span = { cut, from: frames(cut.sourceStart * rate), start, length: end - start };
    start = end;
    return span;
  });
}

const dissolves = (input: InterchangeInput): boolean => input.transition === 'fade' && input.cuts.length > 1;

function fileUrl(file: string): string {
  const drive = /^[A-Za-z]:[\\/]/.test(file);
  const path = drive ? `/${file.replace(/\\/g, '/')}` : file;
  return `file://${encodeURI(path).replace(/[?#]/g, (c) => encodeURIComponent(c))}`;
}

const rationalTime = (value: number, rate: number) => ({ OTIO_SCHEMA: 'RationalTime.1', rate, value });
const timeRange = (start: number, duration: number, rate: number) => ({
  OTIO_SCHEMA: 'TimeRange.1',
  start_time: rationalTime(start, rate),
  duration: rationalTime(duration, rate),
});

const dissolve = (inFrames: number, outFrames: number, rate: number) => ({
  OTIO_SCHEMA: 'Transition.1',
  name: '',
  transition_type: 'SMPTE_Dissolve',
  in_offset: rationalTime(inFrames, rate),
  out_offset: rationalTime(outFrames, rate),
  metadata: {},
});

const track = (name: string, kind: 'Video' | 'Audio', children: object[]) => ({
  OTIO_SCHEMA: 'Track.1',
  name,
  kind,
  source_range: null,
  effects: [],
  markers: [],
  enabled: true,
  metadata: {},
  children,
});

/** The bed's fades in frames. One clip can't hold two that overlap, so when they want more than it has they share it in proportion. */
function bedFades(music: NonNullable<InterchangeInput['music']>, rate: number, length: number): [number, number] {
  const fadeIn = frames(music.fadeIn * rate);
  const fadeOut = frames(music.fadeOut * rate);
  const wanted = fadeIn + fadeOut;
  if (wanted <= length) return [fadeIn, fadeOut];
  const shared = frames((fadeIn * length) / wanted);
  return [shared, length - shared];
}

function bedTrack(music: NonNullable<InterchangeInput['music']>, rate: number, length: number) {
  const { file, name, ...settings } = music;
  const [fadeIn, fadeOut] = bedFades(music, rate, length);
  return track('A1', 'Audio', [
    ...(fadeIn > 0 ? [dissolve(0, fadeIn, rate)] : []),
    {
      OTIO_SCHEMA: 'Clip.1',
      name,
      source_range: timeRange(frames(music.inSeconds * rate), length, rate),
      effects: [],
      markers: [],
      enabled: true,
      metadata: { filmcraft: { gain_db: music.gain }, rtf: { music: settings } },
      media_reference: {
        OTIO_SCHEMA: 'ExternalReference.1',
        name: '',
        target_url: fileUrl(file),
        available_range: null,
        metadata: {},
      },
    },
    ...(fadeOut > 0 ? [dissolve(fadeOut, 0, rate)] : []),
  ]);
}

export function toOtio(input: InterchangeInput): object {
  const rate = rateOf(input.fps);
  const overlap = dissolves(input);
  const half = frames((input.fadeSeconds * rate) / 2);
  const children: object[] = [];
  const laid = spans(input, rate);
  laid.forEach(({ cut, from, length }, i) => {
    if (overlap && i > 0) children.push(dissolve(half, half, rate));
    children.push({
      OTIO_SCHEMA: 'Clip.1',
      name: cut.key,
      source_range: timeRange(from, length, rate),
      effects: [],
      markers: [],
      enabled: true,
      metadata: {
        rtf: {
          key: cut.key,
          clipId: cut.clipId,
          playId: cut.playId,
          ...(cut.colour === undefined ? {} : { colour: cut.colour }),
        },
      },
      media_reference: {
        OTIO_SCHEMA: 'ExternalReference.1',
        name: '',
        target_url: fileUrl(cut.file),
        available_range: timeRange(0, frames(cut.availableSeconds * rate), rate),
        metadata: {},
      },
    });
  });

  const sum = input.cuts.reduce((a, c) => a + c.duration, 0);
  const filmSeconds = overlap ? sum - (input.cuts.length - 1) * input.fadeSeconds : sum;
  const last = laid.at(-1);
  return {
    OTIO_SCHEMA: 'Timeline.1',
    name: input.name,
    global_start_time: rationalTime(0, rate),
    metadata: {
      rtf: {
        fadeModel: overlap ? 'xfade-overlap' : 'none',
        filmSeconds: Number(filmSeconds.toFixed(6)),
        transition: input.transition,
        fadeSeconds: input.fadeSeconds,
        width: input.width,
        height: input.height,
      },
    },
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      name: 'tracks',
      source_range: null,
      effects: [],
      markers: [],
      enabled: true,
      metadata: {},
      children: [
        track('V1', 'Video', children),
        ...(input.music && last ? [bedTrack(input.music, rate, last.start + last.length)] : []),
      ],
    },
  };
}

/** HH:MM:SS:FF at the nominal (whole) frame rate. */
function timecode(count: number, base: number): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  const seconds = Math.floor(count / base);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60, count % base].map(two).join(':');
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

export function toEdl(input: InterchangeInput): string {
  const rate = rateOf(input.fps);
  const base = Math.round(rate);
  const overlap = dissolves(input);
  const fade = String(frames(input.fadeSeconds * rate)).padStart(3, '0');
  const lines = [`TITLE: ${oneLine(input.name)}`, 'FCM: NON-DROP FRAME', ''];
  spans(input, rate).forEach(({ cut, from, start, length }, i) => {
    const reel = cut.clipId.slice(0, 8).toUpperCase().replace(/\s/g, '_').padEnd(8);
    const edit = overlap && i > 0 ? `D    ${fade}` : 'C       ';
    const times = [from, from + length, start, start + length].map((n) => timecode(n, base)).join(' ');
    lines.push(`${String(i + 1).padStart(3, '0')}  ${reel} ${'V'.padEnd(6)}${edit} ${times}`);
    lines.push(`* FROM CLIP NAME: ${oneLine(cut.key)}`);
  });
  return `${lines.join('\n')}\n`;
}
