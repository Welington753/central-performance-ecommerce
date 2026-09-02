const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8000;

/**
 * Backoff exponencial com jitter (0-50% adicional) para retentativas de
 * 429/5xx/falha transitória (Checkpoint 4-B). `randomFn` é injetável para
 * tornar o jitter determinístico em teste — nunca depende de tempo real.
 */
export function computeBackoffDelayMs(
  attempt: number,
  randomFn: () => number = Math.random,
): number {
  const exponential = Math.min(
    BASE_DELAY_MS * 2 ** Math.max(attempt - 1, 0),
    MAX_DELAY_MS,
  );
  const jitter = exponential * 0.5 * randomFn();
  return Math.round(exponential + jitter);
}
