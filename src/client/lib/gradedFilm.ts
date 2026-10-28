import { useCallback, useEffect, useRef, useState } from 'react';

import { type CutColour, colourSteps, cutEnds } from '../../colour.ts';

/** What a graded download needs from an export (src/timeline.ts `ExportJob`). */
export type GradedJob = {
  grades: readonly { seconds: number; colour?: CutColour | undefined }[];
  transition: 'hard' | 'fade';
  fadeSeconds?: number | undefined;
};

const VERTEX = `
attribute vec2 p;
varying vec2 uv;
void main() {
  uv = vec2((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// The same steps, in the same order and with the same clamping, as the live
// preview's CSS filter and layers (src/colour.ts `colourCss`).
const FRAGMENT = `
precision mediump float;
uniform sampler2D frame;
uniform float gain;
uniform float saturate;
uniform float contrast;
uniform float highlight;
uniform vec3 balance;
uniform float lift;
uniform vec3 tint;
varying vec2 uv;
void main() {
  vec3 c = clamp(texture2D(frame, uv).rgb * gain, 0.0, 1.0);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = clamp(mix(vec3(l), c, saturate), 0.0, 1.0);
  c = clamp((c - 0.5) * contrast + 0.5, 0.0, 1.0);
  c = clamp(c * highlight, 0.0, 1.0);
  c = c * balance;
  c = mix(c, tint, lift);
  gl_FragColor = vec4(c, 1.0);
}`;

const MIME_TYPES = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/** A failure the person can act on; its message is shown as is. */
export class GradedFilmError extends Error {}

/** Thrown when the person cancels; never shown as a failure. */
export class GradedFilmCancelled extends Error {}

/** No playback progress for this long means the film has stalled. */
const STALL_MS = 15_000;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new GradedFilmError('This browser could not grade the film.');
  return s;
}

/**
 * Plays the exported film once, frame by frame, through each cut's built-in
 * grade on a WebGL canvas, and records the result. It takes as long as the
 * film, and the tab has to stay in front while it runs.
 */
export async function recordGradedFilm(
  src: string,
  job: GradedJob,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal
): Promise<{ blob: Blob; ext: string }> {
  const cancelled = () => new GradedFilmCancelled('Cancelled.');
  if (signal?.aborted) throw cancelled();
  let file: Blob;
  try {
    const res = await fetch(src, { signal });
    if (!res.ok) throw new Error(String(res.status));
    file = await res.blob();
  } catch {
    if (signal?.aborted) throw cancelled();
    throw new GradedFilmError(
      'Your browser could not read the film to grade it. Download it without the grade, or grade the cuts with Aleph 2.0 to bake the look into the clips.'
    );
  }
  const mimeType = MIME_TYPES.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
  if (!mimeType) throw new GradedFilmError('This browser cannot record video. Try Chrome, Edge or Safari.');

  const href = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = href;
  let raf = 0;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  // Settles with an error when the film fails to play, stalls, or is cancelled.
  let fail: (err: Error) => void = () => undefined;
  const failed = new Promise<never>((_, reject) => {
    fail = reject;
  });
  failed.catch(() => undefined);
  const onAbort = () => fail(cancelled());
  signal?.addEventListener('abort', onAbort);
  video.onerror = () => fail(new GradedFilmError('The film stopped playing while it was being graded.'));
  try {
    await Promise.race([
      new Promise<void>((resolve) => {
        video.onloadeddata = () => resolve();
      }),
      failed,
    ]);

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) throw new GradedFilmError('This browser cannot grade video. Download the film without the grade instead.');

    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new GradedFilmError('This browser could not grade the film.');
    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const p = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(p);
    gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);

    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.viewport(0, 0, canvas.width, canvas.height);
    const at = (name: string) => gl.getUniformLocation(program, name);
    const u = {
      gain: at('gain'),
      saturate: at('saturate'),
      contrast: at('contrast'),
      highlight: at('highlight'),
      balance: at('balance'),
      lift: at('lift'),
      tint: at('tint'),
    };
    const NEUTRAL = { gain: 1, saturate: 1, contrast: 1, highlight: 1, balance: [1, 1, 1], lift: 0, tint: [0, 0, 0] } as const;
    const uniforms = job.grades.map((g) => colourSteps(g.colour) ?? NEUTRAL);
    const ends = cutEnds(
      job.grades.map((g) => g.seconds),
      job.transition,
      job.fadeSeconds ?? 0.5,
      video.duration
    );
    let shown = -1;
    let reported = -1;
    const draw = () => {
      const t = video.currentTime;
      let i = ends.findIndex((end) => t < end);
      if (i < 0) i = uniforms.length - 1;
      const g = uniforms[i];
      if (i !== shown && g) {
        gl.uniform1f(u.gain, g.gain);
        gl.uniform1f(u.saturate, g.saturate);
        gl.uniform1f(u.contrast, g.contrast);
        gl.uniform1f(u.highlight, g.highlight);
        gl.uniform3fv(u.balance, [...g.balance]);
        gl.uniform1f(u.lift, g.lift);
        gl.uniform3fv(u.tint, [...g.tint]);
        shown = i;
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // Tell the page once per whole percent, not once per frame.
      const pct = video.duration ? Math.floor(Math.min(1, t / video.duration) * 100) : 0;
      if (pct !== reported) {
        reported = pct;
        onProgress(pct / 100);
      }
    };

    stream = canvas.captureStream(30);
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 16_000_000 });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const rec = recorder;
    const stopped = new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
    });

    draw();
    recorder.start(1000);
    const ended = new Promise<void>((resolve) => {
      video.onended = () => resolve();
    });
    let lastTime = -1;
    let lastMove = Date.now();
    watchdog = setInterval(() => {
      if (video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        lastMove = Date.now();
      } else if (Date.now() - lastMove > STALL_MS) {
        fail(new GradedFilmError('The film stopped playing partway through grading. Keep this tab in front and try again, or download the film without the grade.'));
      }
    }, 1000);
    const frames = 'requestVideoFrameCallback' in video;
    const loop = () => {
      draw();
      if (video.ended) return;
      if (frames) video.requestVideoFrameCallback(loop);
      else raf = requestAnimationFrame(loop);
    };
    await Promise.race([video.play(), failed]);
    loop();
    await Promise.race([ended, failed]);
    cancelAnimationFrame(raf);
    draw();
    recorder.stop();
    await stopped;
    const type = mimeType.split(';')[0]!;
    return { blob: new Blob(chunks, { type }), ext: type === 'video/mp4' ? 'mp4' : 'webm' };
  } finally {
    cancelAnimationFrame(raf);
    if (watchdog) clearInterval(watchdog);
    signal?.removeEventListener('abort', onAbort);
    if (recorder && recorder.state !== 'inactive') {
      recorder.ondataavailable = null;
      recorder.stop();
    }
    stream?.getTracks().forEach((t) => t.stop());
    video.pause();
    video.removeAttribute('src');
    URL.revokeObjectURL(href);
  }
}

/** A "Download graded film" button's state, like `useDownload`; `cancel` aborts a run. */
export function useGradedDownload() {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const start = useCallback((src: string, job: GradedJob, filename: string) => {
    if (abort.current) return;
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setProgress(0);
    recordGradedFilm(src, job, setProgress, controller.signal)
      .then(({ blob, ext }) => {
        const href = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = href;
        a.download = `${filename}.${ext}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
      })
      .catch((err: unknown) => {
        if (err instanceof GradedFilmCancelled) return;
        setError(
          err instanceof GradedFilmError
            ? err.message
            : 'The graded film could not be made. Try again, or download it without the grade.'
        );
      })
      .finally(() => {
        abort.current = null;
        setProgress(null);
      });
  }, []);
  const cancel = useCallback(() => abort.current?.abort(), []);
  // Leaving the page stops a run that nobody is waiting for.
  useEffect(() => () => abort.current?.abort(), []);
  const pending = progress !== null;
  const label = (idle: string) =>
    pending ? (progress > 0 ? `Grading ${Math.round(progress * 100)}%` : 'Preparing…') : idle;
  return { start, cancel, pending, label, error, clearError: () => setError(null) };
}
