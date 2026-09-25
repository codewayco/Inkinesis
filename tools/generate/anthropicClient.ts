/** Shared vision client with bounded SDK retries and actionable error messages. */
import Anthropic from '@anthropic-ai/sdk';

/**
 * Eight attempts. The SDK backs off exponentially with jitter and caps the wait
 * at eight seconds, so this spans roughly forty seconds of retrying -- long
 * enough to outlast the overloads seen here, short enough that a genuinely
 * broken key still fails while someone is watching.
 */
export const MAX_RETRIES = 8;
/** A single call may think for a while; the default would cut a long one off. */
export const TIMEOUT_MS = 180_000;

export function anthropicClient(): Anthropic {
  return new Anthropic({ maxRetries: MAX_RETRIES, timeout: TIMEOUT_MS });
}

/**
 * One line saying what went wrong, for a person reading a UI log rather than a
 * stack trace. It NAMES the transient cases, because "overloaded" and "your
 * description is bad" call for different actions from the reader.
 */
export function explain(error: unknown, step: string): string {
  const status = (error as { status?: number } | null)?.status;
  const message = error instanceof Error ? error.message : String(error);
  if (status === 529 || status === 503) {
    return `${step}: the model API is overloaded right now (${status}). `
      + `Tried ${MAX_RETRIES} times over about forty seconds. Nothing is wrong with the `
      + 'description -- run it again in a minute.';
  }
  if (status === 429) {
    return `${step}: rate limited (429) after ${MAX_RETRIES} attempts. Wait and run it again.`;
  }
  if (status === 401 || status === 403) {
    return `${step}: the API key was rejected (${status}). Check ANTHROPIC_API_KEY in .env.`;
  }
  if (status && status >= 500) {
    return `${step}: the model API failed (${status}) after ${MAX_RETRIES} attempts. `
      + 'This is upstream, not the description.';
  }
  return `${step}: ${message.split('\n')[0]}`;
}

/** Print `explain` and exit 1, so the chain stops with a legible reason. */
export function fail(error: unknown, step: string): never {
  console.error(explain(error, step));
  process.exit(1);
}
