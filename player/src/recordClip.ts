/**
 * Record what the canvas is drawing to a video file, in the browser.
 *
 * WHY THIS EXISTS. Everything the engine does is on screen and nowhere else: a
 * person who generates a character, watches it breathe and hears it speak has
 * no way to keep or send that. All three of the open-source players this
 * project is measured against export video, and without it the work reads as a
 * demo rather than as something you use.
 *
 * NO FFMPEG AND NO SERVER. `HTMLCanvasElement.captureStream` gives a live video
 * track of the canvas and `MediaRecorder` encodes it; both are in the browser.
 * Nothing is uploaded, nothing is installed, and the recording is exactly the
 * pixels the page drew -- it is the engine's own output, not a re-render
 * through a second path that could disagree with it.
 *
 * WHAT IT DOES NOT DO. There is no AUDIO in the file. The Speak panel plays
 * through its own `Audio` element and capturing that would mean routing it
 * through a `MediaStreamDestination` and mixing two tracks whose clocks are not
 * the same; a video that drifts from its own voice is worse than a silent one.
 * The recording is silent and the button says so.
 *
 * The container is whatever the browser will encode. Chrome and Firefox give
 * WebM (VP9 or VP8); Safari gives MP4. The first supported type in
 * `CANDIDATES` wins and the file is named for what was actually used, so a file
 * that will not open elsewhere can be traced to the codec that wrote it.
 */

/** Tried in order. VP9 first for size, then VP8, then whatever the browser has. */
const CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
];

export interface Recorder {
  /** Start recording, or stop and hand back the clip. */
  toggle(): void;
  readonly recording: boolean;
}

/**
 * `onState` is called whenever recording starts or stops, with a line to show.
 * The caller owns the button; this owns the stream.
 */
export function createRecorder(canvas: HTMLCanvasElement,
  onState: (recording: boolean, message: string) => void): Recorder {
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let started = 0;

  const mimeType = CANDIDATES.find(type =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type));

  function stop() {
    if (!recorder) return;
    recorder.stop();
  }

  function start() {
    if (!mimeType) {
      onState(false, 'This browser cannot record the canvas.');
      return;
    }
    // 30 fps: the rate the idle and the body clips are driven at. Asking for
    // more would record duplicate frames and say nothing new.
    const stream = canvas.captureStream(30);
    chunks = [];
    recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = event => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      const seconds = (performance.now() - started) / 1000;
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = `avatar.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
      link.click();
      // Revoked on the next frame: revoking immediately races the download in
      // some browsers and produces an empty file.
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      recorder = null;
      const size = blob.size >= 1e6
        ? `${(blob.size / 1e6).toFixed(1)} MB` : `${Math.round(blob.size / 1e3)} kB`;
      onState(false, `Saved ${seconds.toFixed(1)}s, ${size}, ${mimeType.split(';')[0]}. No audio.`);
    };
    recorder.start();
    started = performance.now();
    onState(true, 'Recording the canvas. No audio is captured.');
  }

  return {
    toggle: () => (recorder ? stop() : start()),
    get recording() { return recorder !== null; },
  };
}
