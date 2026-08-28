import { createHash } from 'crypto';
import { generatePkcePair, generateState, hashState } from './pkce.util';

describe('pkce.util', () => {
  it('generateState returns a non-empty, sufficiently random, URL-safe string', () => {
    const a = generateState();
    const b = generateState();

    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('hashState is deterministic SHA-256 hex', () => {
    const state = 'fixed-state-value';
    expect(hashState(state)).toBe(
      createHash('sha256').update(state).digest('hex'),
    );
  });

  it('hashState never returns the plaintext state', () => {
    const state = generateState();
    expect(hashState(state)).not.toBe(state);
  });

  it('generatePkcePair returns a code_challenge that is SHA-256(code_verifier), base64url, never equal to the verifier', () => {
    const { codeVerifier, codeChallenge } = generatePkcePair();

    const expectedChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    expect(codeChallenge).toBe(expectedChallenge);
    expect(codeChallenge).not.toBe(codeVerifier);
  });

  it('generatePkcePair produces different pairs on each call', () => {
    const first = generatePkcePair();
    const second = generatePkcePair();
    expect(first.codeVerifier).not.toBe(second.codeVerifier);
  });
});
