/**
 * One line of speech through eSpeak NG: the viseme track, and the audio.
 *
 * The same code path serves the committed tracks AND the player's Speak panel.
 * Two implementations of "what eSpeak says" would be two sets of timings, and
 * the panel exists to look at the timings.
 *
 * WHAT IS MEASURED AND WHAT IS APPROXIMATED is set out in
 * `engine/src/lipsync/visemes.ts` and repeated in every track: the phoneme
 * sequence and the WORD boundary times are real output of the real synthesiser;
 * the division of a word's duration among its phonemes is weighted, and every
 * track carries `visemeTimingApproximated: true`.
 *
 * LICENCE. eSpeak NG is GPLv3 and is used strictly as a BUILD-TIME (and
 * dev-server) TOOL: it is executed as a separate process, no eSpeak code is
 * linked into the engine or the player, and no eSpeak data is redistributed.
 * Nothing in this file is shipped to a browser.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { phonemeWeight, visemeFor, type Viseme, type VisemeTrack } from '../../engine/src/lipsync/visemes.ts';

export interface EspeakOptions {
  voice?: string;
  /** Words per minute, as eSpeak's `-s`. */
  speed?: string;
  /** Scratch directory for the WAVs the measurement needs. */
  tmp?: string;
}

/** The eSpeak NG binary, or null. A caller that gets null says so; it never
 * fabricates a track. */
export function findEspeak(): string | null {
  for (const path of ['espeak-ng', '/opt/homebrew/bin/espeak-ng', '/usr/bin/espeak-ng',
    '/usr/local/bin/espeak-ng']) {
    try { execFileSync(path, ['--version'], { stdio: 'pipe' }); return path; } catch { /* keep looking */ }
  }
  return null;
}

/** Duration in seconds of a WAV eSpeak just wrote. Reads the fmt/data headers
 *  directly: a dependency for this would be absurd. */
export function wavSeconds(path: string): number {
  const b = readFileSync(path);
  let off = 12, rate = 0, byteRate = 0, dataLen = 0;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') { rate = b.readUInt32LE(off + 12); byteRate = b.readUInt32LE(off + 16); }
    else if (id === 'data') { dataLen = size; break; }
    off += 8 + size + (size % 2);
  }
  if (!byteRate || !dataLen) return 0;
  void rate;
  return dataLen / byteRate;
}

/**
 * eSpeak writes stress as a leading ' or , on the syllable, length as a
 * trailing :, and a handful of two-character mnemonics. Longest-match against
 * the known set, which is exactly the key set of the viseme table, so an
 * unknown mnemonic is visible as a single-character fallback rather than
 * silently absorbed.
 */
const KNOWN_TWO = ['aI', 'aU', 'oU', 'eI', 'OI', 'I@', 'e@', 'U@', 'A@', 'tS', 'dZ', 'r-',
  '@2', 'I2', 'O2', 'a#', 'A:', 'i:', 'u:', '3:', 'O:', 'e:', 'o:', '_:'];
export function splitPhonemes(word: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < word.length) {
    if (word[i] === "'" || word[i] === ',' || word[i] === '%' || word[i] === '=') { i++; continue; }
    const two = word.slice(i, i + 2);
    if (KNOWN_TWO.includes(two)) { out.push(two); i += 2; continue; }
    out.push(word[i]);
    i += 1;
  }
  return out;
}

export interface Espeak {
  binary: string;
  version: string;
  voice: string;
  speed: string;
  /** The viseme track for one line, and optionally the WAV bytes for it. */
  track(lineId: string, text: string, options?: { wav?: boolean; wavPath?: string }):
  { track: VisemeTrack; wav?: Uint8Array };
}

/** Bind eSpeak, or return null if it is not installed. Nothing is fabricated. */
export function openEspeak(options: EspeakOptions = {}): Espeak | null {
  const binary = findEspeak();
  if (!binary) return null;
  const voice = options.voice ?? 'en-us', speed = options.speed ?? '165';
  const tmp = options.tmp ?? join(tmpdir(), 'inkinesis-speech');
  if (!existsSync(tmp)) mkdirSync(tmp, { recursive: true });
  const version = execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim();
  // `-D` is deterministic random mode and `-z` removes the trailing sentence
  // pause, so the same text always produces the same track.
  const synth = (text: string, wav: string): number => {
    execFileSync(binary, ['-v', voice, '-s', speed, '-z', '-D', '-w', wav, text], { stdio: 'pipe' });
    return wavSeconds(wav);
  };
  const phonemesPerWord = (text: string): string[][] => {
    const out = execFileSync(binary, ['-v', voice, '-s', speed, '-q', '-x', '-D', text],
      { encoding: 'utf8' });
    return out.replace(/\n/g, ' ').trim().split(/\s+/).filter(Boolean).map(splitPhonemes);
  };
  return { binary, version, voice, speed,
    track(lineId, text, opts = {}) {
      const words = text.trim().replace(/[^\w\s'-]/g, ' ').split(/\s+/).filter(Boolean);
      const linePath = opts.wavPath ?? join(tmp, 'line.wav');
      const total = synth(text, linePath);
      // Word boundaries by prefix synthesis. Monotonic by construction: a
      // prefix that measured shorter than its predecessor (it happens at a
      // comma, where eSpeak re-phrases) is clamped forward.
      const wordTimes: number[] = [];
      let prev = 0;
      for (let k = 0; k < words.length; k++) {
        wordTimes.push(prev);
        const d = k === words.length - 1 ? total
          : synth(words.slice(0, k + 1).join(' '), join(tmp, 'p.wav'));
        prev = Math.max(prev, Math.min(total, d));
      }
      const perWord = phonemesPerWord(text);
      const times: number[] = [], visemes: Viseme[] = [], phonemes: string[] = [];
      for (let k = 0; k < words.length; k++) {
        const start = wordTimes[k];
        const end = k + 1 < words.length ? wordTimes[k + 1] : total;
        const ph = perWord[k] ?? ['@'];
        const weights = ph.map(phonemeWeight);
        const sum = weights.reduce((a, b) => a + b, 0) || 1;
        let t = start;
        for (let j = 0; j < ph.length; j++) {
          times.push(Math.round(t * 1e4) / 1e4);
          phonemes.push(ph[j]);
          visemes.push(visemeFor(ph[j]));
          t += (end - start) * (weights[j] / sum);
        }
      }
      const track: VisemeTrack = { lineId, durationSec: Math.round(total * 1e4) / 1e4,
        times, visemes, phonemes, words,
        wordTimes: wordTimes.map(x => Math.round(x * 1e4) / 1e4),
        source: `${version} voice=${voice} speed=${speed}`,
        visemeTimingApproximated: true };
      return { track, ...(opts.wav ? { wav: new Uint8Array(readFileSync(linePath)) } : {}) };
    } };
}
