/**
 * Phoneme -> viseme lip sync.
 *
 * WHAT IS REAL AND WHAT IS APPROXIMATED. The track mixes measured synthesiser
 * output with a labelled approximation, and the label has to be precise, so:
 *
 *   REAL, from eSpeak NG 1.52 (GPLv3, local, offline):
 *     - the PHONEME SEQUENCE of every line, from eSpeak's own grapheme-to-
 *       phoneme rules (`espeak-ng -q -x`);
 *     - the WORD BOUNDARY TIMES, measured from the synthesiser's own audio by
 *       synthesising cumulative prefixes of the line and differencing their
 *       durations. Those are measurements of the real waveform, not estimates.
 *
 *   APPROXIMATED, and labelled `visemeTimingApproximated: true` in every track:
 *     - the timing of phonemes WITHIN a word. eSpeak's command-line interface
 *       emits per-phoneme timestamps only for MBROLA voices, which are not
 *       redistributable here, so a word's measured duration is divided among its
 *       phonemes in proportion to the intrinsic durations in `PHONEME_WEIGHT`
 *       below. A long vowel gets more of the word than a stop.
 *     - the phoneme -> viseme map itself. Every viseme set is an approximation;
 *       this one is the nine-mouth Preston Blair set that Rhubarb Lip Sync also
 *       targets, so a Rhubarb track can be swapped in with no code change.
 *
 * Swapping in a real per-phoneme timing source (Rhubarb, or eSpeak through its
 * C API's phoneme events) means replacing the `times` array in the track file.
 * Nothing else in the engine reads anything else.
 */

/**
 * The nine-mouth Preston Blair set, as used by Rhubarb Lip Sync.
 *   A  closed mouth: P, B, M                  E  rounded, slightly open: EH, AE
 *   B  slightly open, teeth together: K,S,T   F  puckered: UW, OW, W
 *   C  open: EH, AE                           G  upper teeth on lower lip: F, V
 *   D  wide open: AA, AH                      H  tongue up: L
 *   X  rest / silence
 */
export const VISEMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X'] as const;
export type Viseme = typeof VISEMES[number];

/**
 * eSpeak NG phoneme mnemonic -> viseme. The mnemonics are eSpeak's ASCII names
 * as printed by `espeak-ng -x` (not IPA): its own notation is what the generator
 * parses, so this table is keyed on exactly what comes out of the tool.
 */
export const PHONEME_VISEME: Record<string, Viseme> = {
  // closed mouth
  p: 'A', b: 'A', m: 'A',
  // teeth together / alveolar
  t: 'B', d: 'B', k: 'B', g: 'B', n: 'B', s: 'B', z: 'B', 'S': 'B', 'Z': 'B',
  'tS': 'B', 'dZ': 'B', j: 'B', 'N': 'B', r: 'B', 'r-': 'B', h: 'B',
  // labiodental
  f: 'G', v: 'G',
  // dental fricatives sit between teeth: nearest is the teeth-together shape
  'T': 'B', 'D': 'B',
  // tongue up
  l: 'H',
  // rounded / puckered
  w: 'F', 'uː': 'F', 'u:': 'F', u: 'F', 'oU': 'F', 'oːʊ': 'F', 'O': 'F', 'O2': 'F',
  'A@': 'F', 'o': 'F', 'U': 'F', 'W': 'F', 'OI': 'F',
  // mid-open
  'e': 'E', 'E': 'E', 'eI': 'E', '@': 'E', '@2': 'E', '3': 'E', '3:': 'E',
  'I': 'E', 'i': 'E', 'iː': 'E', 'i:': 'E', 'I2': 'E', 'e@': 'E', 'I@': 'E', 'U@': 'E',
  // open
  'a': 'C', 'a#': 'C', 'aI': 'C', 'aU': 'C', 'A': 'D', 'A:': 'D', 'V': 'D', 'Q': 'D',
  // silence
  '_': 'X', '_:': 'X', ',': 'X', '.': 'X',
};

/**
 * Intrinsic duration weights, used ONLY to divide a word's MEASURED duration
 * among its phonemes. Vowels and diphthongs carry a word; stops are brief.
 * The values are relative, not seconds, and they are the approximation this
 * module's header labels.
 */
export const PHONEME_WEIGHT: Record<string, number> = {
  p: 0.6, b: 0.6, t: 0.5, d: 0.5, k: 0.6, g: 0.6,
  f: 1.0, v: 0.9, 'T': 0.9, 'D': 0.8, s: 1.1, z: 1.0, 'S': 1.1, 'Z': 1.0,
  m: 0.8, n: 0.7, 'N': 0.8, l: 0.8, r: 0.8, 'r-': 0.8, w: 0.7, j: 0.6, h: 0.6,
  'tS': 1.0, 'dZ': 1.0,
};
/** Anything not listed is a vowel-ish nucleus and gets this weight. */
export const DEFAULT_PHONEME_WEIGHT = 1.6;
/** Diphthongs and long vowels are longer still. */
export const LONG_VOWEL_WEIGHT = 2.2;
const LONG = new Set(['aI', 'aU', 'oU', 'eI', 'OI', 'I@', 'e@', 'U@', 'A:', 'i:', 'iː', 'u:', 'uː', '3:', 'O:']);

export function phonemeWeight(p: string): number {
  if (LONG.has(p)) return LONG_VOWEL_WEIGHT;
  return PHONEME_WEIGHT[p] ?? DEFAULT_PHONEME_WEIGHT;
}

export function visemeFor(p: string): Viseme {
  if (PHONEME_VISEME[p]) return PHONEME_VISEME[p];
  // eSpeak marks stress with ' and , before the phoneme, and length with :.
  const bare = p.replace(/^['",]+/, '').replace(/[:ː]+$/, '');
  return PHONEME_VISEME[bare] ?? 'C';
}

/** A viseme track: what the mouth does, when. */
export interface VisemeTrack {
  lineId: string;
  /** Total speech duration in seconds, measured from the synthesised audio. */
  durationSec: number;
  /** Start time of each viseme, seconds from the line's start. */
  times: number[];
  visemes: Viseme[];
  /** eSpeak's phoneme mnemonics, parallel to `visemes`. Kept so the mapping can
   *  be audited and so a different viseme set can be derived without re-running
   *  the synthesiser. */
  phonemes: string[];
  /** Word boundary times, measured. `words[i]` starts at `wordTimes[i]`. */
  words: string[];
  wordTimes: number[];
  source: string;
  /** TRUE whenever the within-word phoneme timing is the weighted division
   *  described in this module's header rather than measured per phoneme. */
  visemeTimingApproximated: boolean;
}

/** The viseme active at `t` seconds. Binary search; tracks are short. */
export function visemeAt(track: VisemeTrack, t: number): Viseme {
  if (t < 0 || t >= track.durationSec || track.times.length === 0) return 'X';
  let lo = 0, hi = track.times.length - 1, best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (track.times[mid] <= t) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return track.visemes[best];
}

/**
 * Mouth openness in [0, 1] for a viseme, for rigs with a single jaw parameter
 * rather than nine mouth drawings. The placeholder characters have one mouth
 * part and a jaw bone, so this is what they use; a rig with nine mouth variants
 * would switch on the viseme directly through the same view-variant machinery
 * the face already uses.
 */
export const VISEME_OPENNESS: Record<Viseme, number> = {
  A: 0.02, B: 0.18, C: 0.62, D: 0.92, E: 0.38, F: 0.30, G: 0.16, H: 0.45, X: 0.0,
};

/** Smoothed openness: the mouth has mass, so a viseme boundary is not a step.
 *  `tau` is the time constant in seconds; 0.035 s is about two frames at 60 fps
 *  and is the shortest that does not read as a snap. */
export function mouthOpenness(track: VisemeTrack, t: number, tau = 0.035, samples = 5): number {
  let sum = 0, w = 0;
  for (let i = 0; i < samples; i++) {
    const dt = (i / (samples - 1) - 0.5) * 2 * tau;
    const k = Math.exp(-Math.abs(dt) / tau);
    sum += VISEME_OPENNESS[visemeAt(track, t + dt)] * k;
    w += k;
  }
  return w > 0 ? sum / w : 0;
}
