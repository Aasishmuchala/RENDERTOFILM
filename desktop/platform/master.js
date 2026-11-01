// The mastering graph builder and QC reader: pure functions, no process spawned,
// no file read. The `master` ffmpeg operation (and its tests) feed these an
// options object and run the argument arrays they answer.
//
// - buildMasterArgs(opts): the arguments of one finished film, from the first
//   `-i` to the output path. No global flags (-y, -loglevel): the runner owns them.
// - buildMeasureArgs(opts): the music bed alone through the first loudnorm pass
//   (`print_format=json`, `-f null -`); parseLoudnorm(stderr) reads its answer,
//   which feeds `opts.loudnorm` of the real render. Run it at the default log level,
//   or loudnorm's block never reaches stderr.
// - buildQcArgs(file) / parseQc(stderr, probe): read a finished file back for
//   loudness, true peak, colour tags and length.
//
// Length: the film is counted in frames. Each cut and each fade snaps to the nearest
// whole frame, every clip is cut to exactly that many, and filmSeconds / expectedFrames
// answer those counts, so the file QC reads has the length the plan says it has.
// Colour: every clip is scaled with `out_color_matrix=bt709` and tagged with
// `setparams`, and the encoder is told the same (research Q6: flags alone did not
// write all the tags on every build). The 10-bit deliverables go through zscale.
// Frame: the 9:16 deliverable is the h264 recipe at another size. A cut may carry a
// `frame`: `crop` takes a window of the clip at the film's shape (x and y place it,
// 0..1, default the middle), `fit` or none keeps the clip whole on black.
// Cards and fades: a cut flagged `image` is a still looped for its length (a title
// card); `fadeIn` / `fadeOut` take it up from or down to black over whole frames.
// Audio: the bed (when there is one) is trimmed, gained, faded, padded to the
// film's length and cut to it, then two-pass loudnormed to -14 LUFS / -2 dBTP.
// `duck` is accepted for the day a dialogue track exists; v1 has none, so it
// changes nothing.

export const DELIVERABLES = {
  h264: { ext: 'mp4', label: 'H.264 for web' },
  hevc10: { ext: 'mp4', label: 'HEVC 10-bit for review' },
  prores: { ext: 'mov', label: 'ProRes 422 HQ master' },
  vertical: { ext: 'mp4', label: '9:16 for social' },
};

/** What the sound is mastered to, in LUFS and dBTP; a file passes within `tolerance` LU. */
export const MASTER_TARGETS = { lufs: -14, truePeak: -2, tolerance: 1 };

/** QC's own ceiling is 0.5 dB above the aim, because ebur128 reads a little hotter than loudnorm. */
const QC_TRUE_PEAK_MAX = -1.5;

/**
 * @typedef {'h264' | 'hevc10' | 'prores' | 'vertical'} DeliverableId
 * @typedef {{ measured_I: number, measured_TP: number, measured_LRA: number, measured_thresh: number, target_offset: number }} Measured
 * @typedef {{ file: string, inSeconds?: number, gain?: number, fadeIn?: number, fadeOut?: number, duck?: boolean }} MasterMusic
 * @typedef {{
 *   sourceStart: number,
 *   duration: number,
 *   frame?: { mode: 'crop' | 'fit', x?: number, y?: number },
 *   image?: true,
 *   fadeIn?: number,
 *   fadeOut?: number,
 * }} MasterCut a cut of its input; `frame` crops a window (x and y 0..1, default 0.5) or fits on black, `image` loops a still for `duration`, the fades are in seconds
 * @typedef {{
 *   inputs: string[],
 *   cuts: MasterCut[],
 *   transition: 'hard' | 'fade',
 *   fadeSeconds?: number,
 *   width: number,
 *   height: number,
 *   fps: number,
 *   music?: MasterMusic,
 *   deliverable: DeliverableId,
 *   output: string,
 *   loudnorm?: Measured,
 * }} MasterOptions
 * @typedef {{ colorspace: string | null, primaries: string | null, trc: string | null, range: string | null }} QcTags
 * @typedef {{ integratedLufs: number | null, truePeakDbfs: number | null, frames: number | null, tags: QcTags, pass: boolean, findings: string[] }} QcReport
 */

const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : fallback);
const sec = (n) => String(Math.round(n * 1000) / 1000);
/** `sec` for a frame's time: rounded down, so a filter asked to start there does not miss that frame. */
const secDown = (n) => String(Math.floor(n * 1000) / 1000);
/** The shortest length `sec` keeps above 0. */
const MIN_SECONDS = 0.001;
/** What the last clip of a fade film runs past its count, so the film's end can be cut exactly. */
const SPARE_FRAMES = 2;

/** A frame rate for the fps filter; the NTSC rates keep their exact fractions. */
function fpsArg(n) {
  const v = num(n, 0);
  if (!(v >= 1 && v <= 240)) throw new Error('The frame rate must be between 1 and 240.');
  for (const [near, exact] of [[23.976, '24000/1001'], [29.97, '30000/1001'], [59.94, '60000/1001']]) {
    if (Math.abs(v - near) < 0.01) return exact;
  }
  return sec(v);
}

/** The frame rate as a number, for counting frames. */
function fpsValue(n) {
  const arg = fpsArg(n);
  const [a, b] = arg.split('/');
  return b ? Number(a) / Number(b) : Number(a);
}

// ---------------------------------------------------------------- video

const BT709_TAGS = 'setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv';
const ZSCALE_BT709 =
  'primariesin=bt709:transferin=bt709:matrixin=bt709:rangein=limited:primaries=bt709:transfer=bt709:matrix=bt709:range=limited:dither=error_diffusion';
const PIX_FORMAT = { h264: 'yuv420p', hevc10: 'yuv420p10le', prores: 'yuv422p10le', vertical: 'yuv420p' };

const COLOUR_FLAGS = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'];
const H264_VIDEO = [
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
  '-x264-params', 'aq-mode=3:aq-strength=0.9:deblock=-1,-1', '-g', '12', '-bf', '2',
  '-movflags', '+faststart', ...COLOUR_FLAGS, '-color_range', 'tv',
];
const H264_AUDIO = ['-c:a', 'aac', '-b:a', '320k', '-ar', '48000'];
const VIDEO_ENCODE = {
  h264: H264_VIDEO,
  hevc10: [
    '-c:v', 'libx265', '-preset', 'medium', '-crf', '16', '-tag:v', 'hvc1',
    '-x265-params', 'aq-mode=3:colorprim=bt709:transfer=bt709:colormatrix=bt709:range=limited',
    '-movflags', '+faststart',
  ],
  prores: ['-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', ...COLOUR_FLAGS],
  vertical: H264_VIDEO,
};
const AUDIO_ENCODE = {
  h264: H264_AUDIO,
  hevc10: ['-c:a', 'aac', '-b:a', '320k', '-ar', '48000'],
  prores: ['-c:a', 'pcm_s16le'],
  vertical: H264_AUDIO,
};

/**
 * One cut brought to the film's size, shape, rate and colour, so the cuts join
 * cleanly. The last trim is what sets its length: counted after `fps`, it gives
 * the same frames from a source of any rate.
 */
function conform(opts, fps, cut, frames) {
  const { deliverable, width, height } = opts;
  const trim = `trim=start=${sec(cut.sourceStart)}:duration=${sec(frames / fpsValue(opts.fps))},setpts=PTS-STARTPTS`;
  // A cut asked to crop takes the largest window of the film's shape, placed by x and y
  // (0 is the left or top edge, 1 the right or bottom); otherwise the whole picture goes on.
  const crop =
    cut.frame?.mode === 'crop'
      ? `,crop=w='min(iw,trunc(ih*${width}/${height}/2)*2)':h='min(ih,trunc(iw*${height}/${width}/2)*2)':x='(iw-ow)*${sec(num(cut.frame.x, 0.5))}':y='(ih-oh)*${sec(num(cut.frame.y, 0.5))}'`
      : '';
  // A cut of another shape fits inside the frame on black: never stretched. A crop is
  // already the film's shape to within a pixel, so it fills the frame and leaves no strip.
  const keep = crop ? '' : ':force_original_aspect_ratio=decrease:force_divisible_by=2';
  const zsized = crop
    ? `w=${width}:h=${height}`
    : `w='trunc(min(${width},iw*${height}/ih)/2)*2':h='trunc(min(${height},ih*${width}/iw)/2)*2'`;
  const scale =
    deliverable === 'h264' || deliverable === 'vertical'
      ? `scale=${width}:${height}${keep}:flags=lanczos+accurate_rnd+full_chroma_int:out_color_matrix=bt709:out_range=tv`
      : `zscale=${zsized}:filter=lanczos:${ZSCALE_BT709}`;
  const pad = `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`;
  // A fade is a whole number of frames of the cut, in at its head and out at its tail.
  const faded = (seconds) => Math.min(frames, Math.max(1, Math.round(seconds * fpsValue(opts.fps))));
  const fi = cut.fadeIn > 0 ? faded(cut.fadeIn) : 0;
  const fo = cut.fadeOut > 0 ? faded(cut.fadeOut) : 0;
  const fadeIn = fi ? `,fade=t=in:s=0:n=${fi}` : '';
  const fadeOut = fo ? `,fade=t=out:s=${frames - fo}:n=${fo}` : '';
  return `${trim}${crop},${scale},format=${PIX_FORMAT[deliverable]},${pad},setsar=1,fps=${fps},settb=AVTB,${BT709_TAGS},trim=end_frame=${frames}${fadeIn}${fadeOut}`;
}

/** Each cut's length in whole frames; a cut shorter than a frame still shows one. */
function cutFrames(opts) {
  const rate = fpsValue(opts.fps);
  return opts.cuts.map((c) => Math.max(1, Math.round(c.duration * rate)));
}

/**
 * The fade between neighbours in whole frames: 0 for hard cuts and a single clip;
 * throws on one that cannot play. An end cut carries one fade, a cut between two
 * carries both and must keep something of its own, or they would overlap.
 */
function fadeFrames(opts, frames) {
  if (opts.transition !== 'fade' || frames.length < 2) return 0;
  const seconds = num(opts.fadeSeconds, 0);
  if (!(seconds >= MIN_SECONDS)) throw new Error('A fade needs a length of at least a millisecond.');
  const fade = Math.max(1, Math.round(seconds * fpsValue(opts.fps)));
  const last = frames.length - 1;
  if (frames.some((n, i) => n <= (i === 0 || i === last ? fade : 2 * fade))) {
    throw new Error('The fade must be shorter than the first and last cuts, and under half of every cut between them.');
  }
  return fade;
}

/** The frames of the finished film: the cuts end to end, less the overlap of each fade. */
const filmFrames = (frames, fade) => frames.reduce((sum, n) => sum + n, 0) - (frames.length - 1) * fade;

/** How long the finished film plays, once its cuts and fades are on whole frames. */
export function filmSeconds(opts) {
  const frames = cutFrames(opts);
  return Number(sec(filmFrames(frames, fadeFrames(opts, frames)) / fpsValue(opts.fps)));
}

/** The frame count a film of `seconds` has at `fps`; QC compares the file against it. */
export function expectedFrames(seconds, fps) {
  return Math.round(seconds * fpsValue(fps));
}

/**
 * The video filters, ending at the label `[v]`. The join is followed by the
 * deliverable's own pixel format: xfade on the bundled build hands 4:4:4 10-bit
 * to the encoder otherwise, and an HEVC or ProRes file would not be 4:2:0 / 4:2:2.
 * An xfade chain ends with `fps`, then a cut to the film's frame count, and its
 * last clip brings spare frames for that cut. On ffmpeg 6 xfade can lose the
 * outgoing clip's last frame, leaving a gap at the seam, and it ends with a stale
 * time that makes `fps` drop the frame it holds, so the same films came out a frame
 * over or under. Re-timed and cut, they count exactly on 6.0 and 8.1 alike.
 */
function videoGraph(opts, fps, frames, fade) {
  const n = frames.length;
  const pix = PIX_FORMAT[opts.deliverable];
  const rate = fpsValue(opts.fps);
  const parts = opts.cuts.map((cut, i) => {
    const tail = fade && i === n - 1 ? `,tpad=stop=${SPARE_FRAMES}:stop_mode=clone` : '';
    return `[${i}:v]${conform(opts, fps, cut, frames[i])}${tail}[v${i}]`;
  });
  if (n === 1) {
    parts.push(`[v0]format=${pix}[v]`);
  } else if (!fade) {
    parts.push(`${frames.map((_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0,format=${pix}[v]`);
  } else {
    // As in ffmpeg.js: each fade starts one fade-length before the film so far ends.
    const d = sec(fade / rate);
    let prev = 'v0';
    let covered = frames[0];
    for (let k = 1; k < n; k += 1) {
      const last = k === n - 1;
      const offset = secDown((covered - fade) / rate);
      covered += frames[k] - fade;
      parts.push(`[${prev}][v${k}]xfade=transition=fade:duration=${d}:offset=${offset}${last ? `,fps=${fps},trim=end_frame=${covered},format=${pix}[v]` : `[x${k}]`}`);
      prev = `x${k}`;
    }
  }
  return parts;
}

// ---------------------------------------------------------------- audio

/** loudnorm: the first pass prints its JSON block, the second applies what the first measured. */
function loudnormFilter(m) {
  const head = `loudnorm=I=${MASTER_TARGETS.lufs}:TP=${MASTER_TARGETS.truePeak.toFixed(1)}:LRA=11`;
  if (!m) return `${head}:print_format=json`;
  const read = [m.measured_I, m.measured_TP, m.measured_LRA, m.measured_thresh, m.target_offset].map((v) => num(v, NaN));
  if (!read.every(Number.isFinite)) throw new Error('The loudness measurements are not numbers.');
  const [i, tp, lra, thresh, offset] = read;
  return `${head}:measured_I=${i}:measured_TP=${tp}:measured_LRA=${lra}:measured_thresh=${thresh}:offset=${offset}:linear=true`;
}

/** The music bed at input `index`, ending at the label `[a]`. */
function audioGraph(index, music, film, measured) {
  const fadeIn = num(music.fadeIn, 0);
  const fadeOut = num(music.fadeOut, 0);
  const bed = [
    'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo',
    `atrim=start=${sec(num(music.inSeconds, 0))}`,
    'asetpts=PTS-STARTPTS',
    `volume=${sec(num(music.gain, 0))}dB`,
  ];
  if (fadeIn > 0) bed.push(`afade=t=in:st=0:d=${sec(fadeIn)}:curve=esin`);
  if (fadeOut > 0) bed.push(`afade=t=out:st=${sec(Math.max(0, film - fadeOut))}:d=${sec(fadeOut)}:curve=esin`);
  // Padded to the film's length, then cut to it: a longer bed must not outlast the picture.
  bed.push(`apad=whole_dur=${sec(film)}`, `atrim=end=${sec(film)}`);
  const master = [loudnormFilter(measured), 'aresample=48000', 'aformat=sample_fmts=s32:channel_layouts=stereo'];
  return [`[${index}:a]${bed.join(',')}[mus]`, `[mus]${master.join(',')}[a]`];
}

// ---------------------------------------------------------------- builders

/** Checks the options once and answers the pieces both builders share. */
function plan(opts) {
  if (!Array.isArray(opts.inputs) || !opts.inputs.length) throw new Error('There is nothing to master.');
  if (!Array.isArray(opts.cuts) || opts.cuts.length !== opts.inputs.length) throw new Error('Every input needs one cut.');
  // The start must be a number it prints (a missing one would trim from NaN); the
  // length must survive `sec` as above 0, since trim=duration=0 means no limit.
  if (opts.cuts.some((c) => !(Number.isFinite(c?.sourceStart) && c.sourceStart >= 0) || !(Number.isFinite(c?.duration) && c.duration >= MIN_SECONDS))) {
    throw new Error('A cut needs a start of 0 or more and a length of at least a millisecond.');
  }
  for (const c of opts.cuts) {
    if (c.frame !== undefined && c.frame?.mode !== 'crop' && c.frame?.mode !== 'fit') throw new Error("A cut's frame must be crop or fit.");
    for (const at of [c.frame?.x, c.frame?.y]) {
      if (at !== undefined && !(Number.isFinite(at) && at >= 0 && at <= 1)) throw new Error('A crop window sits between 0 and 1.');
    }
    const fades = [c.fadeIn, c.fadeOut].filter((f) => f !== undefined);
    if (fades.some((f) => !(Number.isFinite(f) && f >= 0)) || (c.fadeIn ?? 0) + (c.fadeOut ?? 0) > c.duration) {
      throw new Error("A cut's fades must fit inside it.");
    }
  }
  if (!Object.hasOwn(DELIVERABLES, opts.deliverable)) throw new Error(`Unknown deliverable: ${opts.deliverable}.`);
  if (!opts.output) throw new Error('There is no output file.');
  for (const side of [opts.width, opts.height]) {
    if (!Number.isInteger(side) || side < 2 || side % 2) throw new Error('The film size must be even whole numbers.');
  }
  if (opts.music && !opts.music.file) throw new Error('The music has no file.');
  const fps = fpsArg(opts.fps);
  const frames = cutFrames(opts);
  return { fps, frames, fade: fadeFrames(opts, frames), film: filmSeconds(opts) };
}

/** @param {MasterOptions} opts @returns {string[]} the ffmpeg arguments of the finished film */
export function buildMasterArgs(opts) {
  const { fps, frames, fade, film } = plan(opts);
  const music = opts.music;
  const filters = videoGraph(opts, fps, frames, fade);
  if (music) filters.push(...audioGraph(opts.inputs.length, music, film, opts.loudnorm));
  return [
    // A card is a still: looped at the film's rate for its length, plus a second the trim cuts away.
    ...opts.inputs.flatMap((file, i) => (opts.cuts[i].image ? ['-loop', '1', '-framerate', fps, '-t', sec(opts.cuts[i].duration + 1), '-i', file] : ['-i', file])),
    ...(music ? ['-i', music.file] : []),
    '-filter_complex', filters.join(';'),
    '-map', '[v]',
    ...(music ? ['-map', '[a]'] : []),
    ...VIDEO_ENCODE[opts.deliverable],
    ...(music ? AUDIO_ENCODE[opts.deliverable] : ['-an']),
    opts.output,
  ];
}

/** @param {MasterOptions} opts the same options as the render; needs `music` @returns {string[]} the first loudnorm pass */
export function buildMeasureArgs(opts) {
  const { film } = plan(opts);
  if (!opts.music) throw new Error('There is no music to measure.');
  return ['-i', opts.music.file, '-filter_complex', audioGraph(0, opts.music, film, null).join(';'), '-map', '[a]', '-f', 'null', '-'];
}

/**
 * Reads loudnorm's JSON block from the first pass's stderr. The numbers come back
 * as numbers (loudnorm prints strings); null when there is no block or any of
 * them is not finite (a silent bed measures as -inf and cannot be normalised).
 * @returns {{ input_i: number, input_tp: number, input_lra: number, input_thresh: number, target_offset: number, normalization_type: string } | null}
 */
export function parseLoudnorm(stderr) {
  const blocks = String(stderr ?? '').match(/\{[^{}]*"input_i"[^{}]*\}/g);
  if (!blocks) return null;
  let raw;
  try {
    raw = JSON.parse(blocks[blocks.length - 1]);
  } catch {
    return null;
  }
  const read = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
  const out = {
    input_i: read(raw.input_i),
    input_tp: read(raw.input_tp),
    input_lra: read(raw.input_lra),
    input_thresh: read(raw.input_thresh),
    target_offset: read(raw.target_offset),
    normalization_type: String(raw.normalization_type ?? ''),
  };
  return [out.input_i, out.input_tp, out.input_lra, out.input_thresh, out.target_offset].every(Number.isFinite) ? out : null;
}

// ---------------------------------------------------------------- QC

/** @returns {string[]} the arguments that read a finished file's loudness and true peak */
export function buildQcArgs(file) {
  return ['-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'];
}

/**
 * Judges a finished file. `stderr` is ebur128's output; `probe` names the video's
 * tags (`colorspace`, `primaries`, `trc`, `range`, or ffprobe's own `color_*` names)
 * and, when known, its `frames` and the `expectedFrames` the plan called for.
 * Passes when loudness is within the tolerance of -14 LUFS, the true peak is at or
 * under -1.5 dBFS, all four tags are bt709 / tv, and the frame count is within one.
 * @returns {QcReport}
 */
export function parseQc(stderr, probe = {}) {
  const text = String(stderr ?? '');
  // Progress lines also print a running `I:`; only the closing Summary counts.
  const at = text.lastIndexOf('Summary:');
  const summary = at >= 0 ? text.slice(at) : '';
  const read = (pattern) => {
    const v = Number(summary.match(pattern)?.[1]);
    return Number.isFinite(v) ? v : null;
  };
  const integratedLufs = read(/^\s*I:\s*(-?[\d.]+|-?inf)\s+LUFS/m);
  const truePeakDbfs = read(/^\s*Peak:\s*(-?[\d.]+|-?inf)\s+dBFS/m);
  const pick = (...names) => {
    for (const name of names) if (probe?.[name] !== undefined && probe[name] !== null && probe[name] !== '') return String(probe[name]);
    return null;
  };
  const tags = {
    colorspace: pick('colorspace', 'color_space'),
    primaries: pick('primaries', 'color_primaries'),
    trc: pick('trc', 'color_transfer'),
    range: pick('range', 'color_range'),
  };
  const frames = Number.isFinite(Number(probe?.frames)) && probe?.frames !== null && probe?.frames !== '' ? Number(probe.frames) : null;
  const wanted = Number.isFinite(Number(probe?.expectedFrames)) && probe?.expectedFrames != null ? Number(probe.expectedFrames) : null;

  const findings = [];
  const { lufs, tolerance } = MASTER_TARGETS;
  if (integratedLufs === null) findings.push('Integrated loudness (LUFS) could not be read from the file.');
  else if (Math.abs(integratedLufs - lufs) > tolerance + 1e-9) findings.push(`Integrated loudness is ${integratedLufs} LUFS, outside ${lufs} LUFS +/- ${tolerance}.`);
  if (truePeakDbfs === null) findings.push('True peak (dBFS) could not be read from the file.');
  else if (truePeakDbfs > QC_TRUE_PEAK_MAX) findings.push(`True peak is ${truePeakDbfs} dBFS, above the ${QC_TRUE_PEAK_MAX} dBFS ceiling.`);
  for (const [key, want] of [['colorspace', 'bt709'], ['primaries', 'bt709'], ['trc', 'bt709'], ['range', 'tv']]) {
    const got = tags[key];
    // ffprobe and some builds say `limited` for the tv range.
    if (got !== want && !(key === 'range' && got === 'limited')) findings.push(`The ${key} tag is ${got ?? 'missing'}, expected ${want}.`);
  }
  if (wanted !== null) {
    if (frames === null) findings.push('The frame count could not be read from the file.');
    else if (Math.abs(frames - wanted) > 1) findings.push(`The file has ${frames} frames, the plan called for ${wanted} (+/- 1).`);
  }
  return { integratedLufs, truePeakDbfs, frames, tags, pass: findings.length === 0, findings };
}
