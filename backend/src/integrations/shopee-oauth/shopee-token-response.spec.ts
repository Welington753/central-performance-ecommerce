import { validateShopeeTokenResponseBody } from './shopee-token-response';

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    error: '',
    access_token: 'access-token-example',
    refresh_token: 'refresh-token-example',
    expire_in: 14400,
    request_id: 'abc123-def456',
    ...overrides,
  };
}

describe('validateShopeeTokenResponseBody', () => {
  it('accepts a well-formed response and maps snake_case to camelCase', () => {
    const result = validateShopeeTokenResponseBody(validBody());
    expect(result).toEqual({
      valid: true,
      token: {
        accessToken: 'access-token-example',
        refreshToken: 'refresh-token-example',
        expiresInSeconds: 14400,
        requestId: 'abc123-def456',
      },
    });
  });

  it('accepts a response with no request_id, returning requestId: null', () => {
    const body = validBody();
    delete (body as Record<string, unknown>).request_id;
    const result = validateShopeeTokenResponseBody(body);
    expect(result).toEqual({
      valid: true,
      token: {
        accessToken: 'access-token-example',
        refreshToken: 'refresh-token-example',
        expiresInSeconds: 14400,
        requestId: null,
      },
    });
  });

  it('sanitizes an unexpected request_id format to null instead of propagating it', () => {
    const result = validateShopeeTokenResponseBody(
      validBody({ request_id: 'has spaces/and/slashes' }),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.token.requestId).toBeNull();
    }
  });

  it('never propagates a raw "message" field into the preserved token result', () => {
    const result = validateShopeeTokenResponseBody(
      validBody({
        message: 'some provider-specific detail that must never leak',
      }),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(Object.keys(result.token)).toEqual([
        'accessToken',
        'refreshToken',
        'expiresInSeconds',
        'requestId',
      ]);
    }
  });

  it('rejects a non-empty error field', () => {
    expect(
      validateShopeeTokenResponseBody(validBody({ error: 'error_param' }))
        .valid,
    ).toBe(false);
  });

  it.each(['error', 'access_token', 'refresh_token', 'expire_in'])(
    'rejects a response missing %s',
    (field) => {
      const body = validBody();
      delete (body as Record<string, unknown>)[field];
      expect(validateShopeeTokenResponseBody(body).valid).toBe(false);
    },
  );

  it('rejects an empty access_token', () => {
    expect(
      validateShopeeTokenResponseBody(validBody({ access_token: '' })).valid,
    ).toBe(false);
  });

  it('rejects an empty refresh_token', () => {
    expect(
      validateShopeeTokenResponseBody(validBody({ refresh_token: '' })).valid,
    ).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN, 999999999])(
    'rejects an invalid expire_in: %s',
    (invalidExpireIn) => {
      expect(
        validateShopeeTokenResponseBody(
          validBody({ expire_in: invalidExpireIn }),
        ).valid,
      ).toBe(false);
    },
  );

  it('rejects a non-object body', () => {
    expect(validateShopeeTokenResponseBody(null).valid).toBe(false);
    expect(validateShopeeTokenResponseBody('string').valid).toBe(false);
    expect(validateShopeeTokenResponseBody(42).valid).toBe(false);
  });
});
