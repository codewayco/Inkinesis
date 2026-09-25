/**
 * The text-to-speech seam.
 *
 * The player asks for a line and gets back a viseme track and, if the backend
 * has one, the audio. It does not know which synthesiser produced them. That is
 * the whole point of this file: eSpeak NG is what runs today, and swapping in
 * Piper, Rhubarb's timings or a cloud voice must be one new implementation of
 * `TtsBackend` and no change to the player.
 *
 * Two rules the seam enforces rather than documents:
 *
 * - **A backend that cannot run says so.** `check()` returns a reason, and the
 *   caller reports it. Nothing here invents a track when the synthesiser is
 *   missing, which is the same rule `assets/tools/espeakTrack.ts` follows.
 * - **The result carries its own provenance.** `engine` and `note` travel with
 *   the track to the status line, so a viewer can see which voice produced what
 *   they are watching and what about its timing is measured.
 *
 * DOM-free: this is the interface and the shared shapes. The implementations
 * that touch `fetch` live in the player.
 */
import type { VisemeTrack } from './visemes';

export interface SpeechAudio {
  mimeType: string;
  bytes: Uint8Array;
}

export interface SpeechResult {
  track: VisemeTrack;
  /** Null when the backend produces timings but no audio, which is a legitimate
   * backend and must be said rather than shown as silence. */
  audio: SpeechAudio | null;
  /** The backend's id, for the status line. */
  backend: string;
  /** The synthesiser and its version, as the backend reports it. */
  engine: string;
  /** What is measured and what is approximated in this result. */
  note: string;
}

export type BackendCheck = { ok: true; detail: string } | { ok: false; reason: string };

export interface TtsBackend {
  id: string;
  /** One line for a status line: what this is, and what it gives. */
  describe(): string;
  /** Whether this backend can run here, and why not when it cannot. */
  check(): Promise<BackendCheck>;
  speak(text: string, lineId?: string): Promise<SpeechResult>;
}
