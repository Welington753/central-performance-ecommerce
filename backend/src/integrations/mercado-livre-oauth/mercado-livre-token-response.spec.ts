import { validateTokenResponseBody } from './mercado-livre-token-response';

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    access_token: 'APP_USR-123',
    refresh_token: 'TG-456',
    expires_in: 10800,
    user_id: 987654,
    token_type: 'bearer',
    scope: 'offline_access read',
    ...overrides,
  };
}

describe('validateTokenResponseBody', () => {
  it('accepts a well-formed response and maps snake_case to camelCase', () => {
    const result = validateTokenResponseBody(validBody());
    expect(result).toEqual({
      valid: true,
      token: {
        accessToken: 'APP_USR-123',
        refreshToken: 'TG-456',
        expiresInSeconds: 10800,
        userId: 987654,
        tokenType: 'bearer',
        scope: 'offline_access read',
      },
    });
  });

  it('accepts token_type in any case (Bearer, BEARER)', () => {
    expect(
      validateTokenResponseBody(validBody({ token_type: 'Bearer' })).valid,
    ).toBe(true);
    expect(
      validateTokenResponseBody(validBody({ token_type: 'BEARER' })).valid,
    ).toBe(true);
  });

  it.each([
    'access_token',
    'refresh_token',
    'user_id',
    'expires_in',
    'token_type',
    'scope',
  ])('rejects a response missing %s', (field) => {
    const body = validBody();
    delete (body as Record<string, unknown>)[field];
    expect(validateTokenResponseBody(body).valid).toBe(false);
  });

  it('rejects a token_type that is not bearer', () => {
    expect(
      validateTokenResponseBody(validBody({ token_type: 'mac' })).valid,
    ).toBe(false);
  });

  it('rejects a scope without "read"', () => {
    expect(
      validateTokenResponseBody(validBody({ scope: 'offline_access' })).valid,
    ).toBe(false);
  });

  it('rejects a scope containing "write" (privilégio mínimo)', () => {
    expect(
      validateTokenResponseBody(
        validBody({ scope: 'offline_access read write' }),
      ).valid,
    ).toBe(false);
  });

  it.each([0, -1, 'not-a-number', 86401, Number.MAX_SAFE_INTEGER + 1])(
    'rejects expires_in = %p (zero, negative, non-numeric, or above the 86400s defensive ceiling)',
    (expiresIn) => {
      expect(
        validateTokenResponseBody(validBody({ expires_in: expiresIn })).valid,
      ).toBe(false);
    },
  );

  it('accepts expires_in exactly at the 86400s ceiling', () => {
    expect(
      validateTokenResponseBody(validBody({ expires_in: 86400 })).valid,
    ).toBe(true);
  });

  it('rejects a non-object body', () => {
    expect(validateTokenResponseBody(null).valid).toBe(false);
    expect(validateTokenResponseBody('a string').valid).toBe(false);
  });
});
