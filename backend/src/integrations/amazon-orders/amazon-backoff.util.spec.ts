import { computeBackoffDelayMs } from './amazon-backoff.util';

describe('computeBackoffDelayMs', () => {
  it('grows exponentially with the attempt number (no jitter, randomFn=0)', () => {
    const zero = () => 0;
    expect(computeBackoffDelayMs(1, zero)).toBe(500);
    expect(computeBackoffDelayMs(2, zero)).toBe(1000);
    expect(computeBackoffDelayMs(3, zero)).toBe(2000);
    expect(computeBackoffDelayMs(4, zero)).toBe(4000);
  });

  it('caps at the maximum delay regardless of how large the attempt is', () => {
    const zero = () => 0;
    expect(computeBackoffDelayMs(10, zero)).toBe(8000);
    expect(computeBackoffDelayMs(100, zero)).toBe(8000);
  });

  it('adds up to 50% jitter on top of the exponential base', () => {
    const full = () => 1;
    expect(computeBackoffDelayMs(1, full)).toBe(750); // 500 + 500*0.5*1
  });

  it('never returns a negative or zero delay', () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(computeBackoffDelayMs(attempt, () => 0)).toBeGreaterThan(0);
    }
  });

  it('is deterministic given a fixed randomFn — never depends on real time', () => {
    const fixed = () => 0.25;
    expect(computeBackoffDelayMs(2, fixed)).toBe(
      computeBackoffDelayMs(2, fixed),
    );
  });
});
