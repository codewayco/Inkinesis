/** Shared vision client with bounded SDK retries. */
import Anthropic from '@anthropic-ai/sdk';

/** Up to eight SDK retries for transient provider failures. */
const MAX_RETRIES = 8;
/** A single call may think for a while; the default would cut a long one off. */
const TIMEOUT_MS = 180_000;

export function anthropicClient(): Anthropic {
  return new Anthropic({ maxRetries: MAX_RETRIES, timeout: TIMEOUT_MS });
}
