import { validateAmazonLwaTokenResponseBody } from './amazon-lwa-token-response';

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    access_token: 'Atza|fake-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    ...overrides,
  };
}

describe('validateAmazonLwaTokenResponseBody', () => {
  it('accepts a well-formed body and normalizes it to camelCase', () => {
    const result = validateAmazonLwaTokenResponseBody(validBody());
    expect(result).toEqual({
      valid: true,
      token: {
        accessToken: 'Atza|fake-access-token',
        tokenType: 'bearer',
        expiresInSeconds: 3600,
      },
    });
  });

  it('accepts token_type in a different case ("Bearer")', () => {
    const result = validateAmazonLwaTokenResponseBody(
      validBody({ token_type: 'Bearer' }),
    );
    expect(result.valid).toBe(true);
  });

  it.each([null, undefined, 'a string', 42, []])(
    'rejects a non-object body (%p)',
    (body) => {
      expect(validateAmazonLwaTokenResponseBody(body)).toEqual({
        valid: false,
      });
    },
  );

  it('rejects a missing access_token', () => {
    const body = validBody() as Record<string, unknown>;
    delete body.access_token;
    expect(validateAmazonLwaTokenResponseBody(body)).toEqual({
      valid: false,
    });
  });

  it('rejects an empty access_token', () => {
    expect(
      validateAmazonLwaTokenResponseBody(validBody({ access_token: '' })),
    ).toEqual({ valid: false });
  });

  it('rejects a non-string access_token', () => {
    expect(
      validateAmazonLwaTokenResponseBody(validBody({ access_token: 123 })),
    ).toEqual({ valid: false });
  });

  it('rejects a token_type other than bearer', () => {
    expect(
      validateAmazonLwaTokenResponseBody(validBody({ token_type: 'mac' })),
    ).toEqual({ valid: false });
  });

  it.each([0, -1, 1.5, 'a lot', null, 999999999999])(
    'rejects an invalid expires_in (%p)',
    (expiresIn) => {
      expect(
        validateAmazonLwaTokenResponseBody(
          validBody({ expires_in: expiresIn }),
        ),
      ).toEqual({ valid: false });
    },
  );

  it('rejects expires_in above the defensive ceiling', () => {
    expect(
      validateAmazonLwaTokenResponseBody(validBody({ expires_in: 86401 })),
    ).toEqual({ valid: false });
  });

  it('does not require a refresh_token field (LWA refresh grant does not guarantee one)', () => {
    const body = validBody() as Record<string, unknown>;
    expect('refresh_token' in body).toBe(false);
    expect(validateAmazonLwaTokenResponseBody(body).valid).toBe(true);
  });
});
