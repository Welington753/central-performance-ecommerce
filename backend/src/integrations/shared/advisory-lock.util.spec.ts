import { createHash } from 'crypto';
import { deriveAdvisoryLockKey } from './advisory-lock.util';

describe('deriveAdvisoryLockKey', () => {
  it('is deterministic: same accountId always yields the same key', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    expect(deriveAdvisoryLockKey(id)).toBe(deriveAdvisoryLockKey(id));
  });

  it('yields (very likely) different keys for different accountIds', () => {
    const a = deriveAdvisoryLockKey('11111111-1111-1111-1111-111111111111');
    const b = deriveAdvisoryLockKey('22222222-2222-2222-2222-222222222222');
    expect(a).not.toBe(b);
  });

  it('matches the documented algorithm: namespace + SHA-256 + first 8 bytes big-endian + signed 64-bit', () => {
    const id = '33333333-3333-3333-3333-333333333333';
    const digest = createHash('sha256')
      .update(`central-performance:marketplace-account:${id}`)
      .digest();
    const unsigned = digest.subarray(0, 8).readBigUInt64BE(0);
    const expected = BigInt.asIntN(64, unsigned);

    expect(deriveAdvisoryLockKey(id)).toBe(expected);
  });

  it('returns a value within the signed 64-bit range accepted by pg_advisory_lock(bigint)', () => {
    const key = deriveAdvisoryLockKey('44444444-4444-4444-4444-444444444444');
    expect(key).toBeGreaterThanOrEqual(-(2n ** 63n));
    expect(key).toBeLessThanOrEqual(2n ** 63n - 1n);
  });
});
