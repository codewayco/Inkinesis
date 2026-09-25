/**
 * The TTS backends the browser can reach.
 *
 * `espeakService` is the one that runs today: the dev server executes the
 * eSpeak path in `assets/tools/espeakTrack.ts` and returns the viseme track
 * with the audio. eSpeak NG is GPLv3 and stays a separate process on the
 * server side; no eSpeak code is linked into the player.
 *
 * Adding another synthesiser is one more object in this file.
 */
import type { TtsBackend } from '../../../engine/src/lipsync/tts';
import type { VisemeTrack } from '../../../engine/src/lipsync/visemes';

const decodeBase64 = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/** eSpeak NG, through the dev server. */
export function espeakServiceBackend(endpoint = '/tts'): TtsBackend {
  let engine = 'eSpeak NG';
  return {
    id: 'espeak-service',
    describe: () => `eSpeak NG via the dev server (${engine})`,
    async check() {
      try {
        const response = await fetch(`${endpoint}?probe=1`);
        if (!response.ok) return { ok: false as const, reason: `the /tts endpoint answered ${response.status}` };
        const body = await response.json() as { available: boolean; engine?: string; reason?: string };
        if (!body.available) {
          return { ok: false as const, reason: body.reason ?? 'eSpeak NG is not installed on the server' };
        }
        engine = body.engine ?? engine;
        return { ok: true as const, detail: engine };
      } catch (error) {
        return { ok: false as const, reason: `no /tts endpoint here (${String(error)})` };
      }
    },
    async speak(text, lineId = 'speak') {
      const response = await fetch(endpoint, { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, lineId }) });
      if (!response.ok) throw new Error(`the speech service answered ${response.status}`);
      const body = await response.json() as { track: VisemeTrack; wavBase64?: string;
        engine: string; note: string };
      engine = body.engine;
      return { track: body.track, backend: 'espeak-service', engine: body.engine, note: body.note,
        audio: body.wavBase64
          ? { mimeType: 'audio/wav', bytes: decodeBase64(body.wavBase64) } : null };
    },
  };
}
