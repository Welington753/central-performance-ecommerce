import { validateCallbackParams } from './callback-params.validator';

describe('validateCallbackParams', () => {
  it('accepts state + code', () => {
    const result = validateCallbackParams({ state: 's', code: 'c' });
    expect(result).toEqual({ valid: true, state: 's', code: 'c', error: null });
  });

  it('accepts state + error (access_denied)', () => {
    const result = validateCallbackParams({
      state: 's',
      error: 'access_denied',
    });
    expect(result).toEqual({
      valid: true,
      state: 's',
      code: null,
      error: 'access_denied',
    });
  });

  it('accepts state + error + error_description + error_uri, but discards them from the result', () => {
    const result = validateCallbackParams({
      state: 's',
      error: 'access_denied',
      error_description: 'the user said no',
      error_uri: 'https://example.com/docs',
    });
    expect(result).toEqual({
      valid: true,
      state: 's',
      code: null,
      error: 'access_denied',
    });
    expect(JSON.stringify(result)).not.toContain('the user said no');
  });

  it('rejects missing state', () => {
    expect(validateCallbackParams({ code: 'c' })).toEqual({ valid: false });
  });

  it('rejects both code and error present (never both)', () => {
    expect(
      validateCallbackParams({ state: 's', code: 'c', error: 'access_denied' }),
    ).toEqual({ valid: false });
  });

  it('rejects neither code nor error present', () => {
    expect(validateCallbackParams({ state: 's' })).toEqual({ valid: false });
  });

  it('rejects an array value for a repeated param (duplication)', () => {
    expect(validateCallbackParams({ state: ['a', 'b'], code: 'c' })).toEqual({
      valid: false,
    });
    expect(validateCallbackParams({ state: 's', code: ['a', 'b'] })).toEqual({
      valid: false,
    });
  });

  it('rejects an unexpected parameter', () => {
    expect(
      validateCallbackParams({ state: 's', code: 'c', unexpected: 'x' }),
    ).toEqual({ valid: false });
  });

  it('rejects error_description/error_uri sent alongside code (only valid alongside error)', () => {
    expect(
      validateCallbackParams({
        state: 's',
        code: 'c',
        error_description: 'x',
      }),
    ).toEqual({ valid: false });
  });

  it('rejects a state longer than 512 characters', () => {
    expect(
      validateCallbackParams({ state: 'x'.repeat(513), code: 'c' }),
    ).toEqual({ valid: false });
  });

  it('rejects a code longer than 2048 characters', () => {
    expect(
      validateCallbackParams({ state: 's', code: 'x'.repeat(2049) }),
    ).toEqual({ valid: false });
  });

  it('rejects an error_description longer than 1024 characters', () => {
    expect(
      validateCallbackParams({
        state: 's',
        error: 'access_denied',
        error_description: 'x'.repeat(1025),
      }),
    ).toEqual({ valid: false });
  });
});
