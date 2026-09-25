/**
 * The dev server's `/tts` endpoint: one line of speech from eSpeak NG.
 *
 * It runs `assets/tools/espeakTrack.ts`, which is the same code that writes the
 * committed tracks, so what the Speak panel shows is what the pipeline
 * measures. eSpeak NG is GPLv3 and runs here as a SEPARATE PROCESS on the
 * developer's machine: no eSpeak code is linked into the engine or the player,
 * and none is redistributed.
 *
 * It is a LOCAL endpoint on Vite dev and preview servers. Static files do not
 * include it. It binds nothing independently, and it exists so a human
 * can watch the mouth against real timings.
 */
import type { Plugin, ViteDevServer } from 'vite';
import { openEspeak } from '../assets/tools/espeakTrack.ts';

const NOTE = 'eSpeak NG, run as a build-time tool. The phoneme sequence and the WORD boundary '
  + 'times are measured from the synthesiser’s own audio; the division of a word’s duration '
  + 'among its phonemes is weighted, not measured (visemeTimingApproximated).';

export function ttsDevServer(): Plugin {
  const configure = (server: Pick<ViteDevServer, 'middlewares'>) => {
      server.middlewares.use('/tts', (request, response, next) => {
        const send = (status: number, body: unknown) => {
          response.statusCode = status;
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify(body));
        };
        // The probe answers whether the machine has eSpeak, so the page can say
        // which backend it is using before anyone presses a button.
        if (request.method === 'GET') {
          const espeak = openEspeak();
          return send(200, espeak
            ? { available: true, engine: espeak.version, voice: espeak.voice, note: NOTE }
            : { available: false, reason: 'eSpeak NG is not installed on this machine '
              + '(macOS: brew install espeak-ng; Debian: apt install espeak-ng). Nothing is '
              + 'fabricated in its absence.' });
        }
        if (request.method !== 'POST') return next();
        let body = '';
        request.on('data', chunk => { body += chunk; if (body.length > 1e6) request.destroy(); });
        request.on('end', () => {
          let text = '', lineId = 'speak';
          try {
            const parsed = JSON.parse(body) as { text?: unknown; lineId?: unknown };
            text = typeof parsed.text === 'string' ? parsed.text : '';
            if (typeof parsed.lineId === 'string') lineId = parsed.lineId;
          } catch { return send(400, { error: 'expected {"text": "..."}' }); }
          if (!text.trim()) return send(400, { error: 'no text' });
          const espeak = openEspeak();
          if (!espeak) {
            return send(503, { error: 'eSpeak NG is not installed on this machine; no track is '
              + 'fabricated in its absence.' });
          }
          try {
            const spoken = espeak.track(lineId, text, { wav: true });
            send(200, { track: spoken.track, engine: espeak.version, note: NOTE,
              wavBase64: spoken.wav ? Buffer.from(spoken.wav).toString('base64') : undefined });
          } catch (error) {
            send(500, { error: String(error) });
          }
        });
      });
  };
  return { name: 'rig-local-speech', apply: 'serve', configureServer: configure, configurePreviewServer: configure };
}
