import { redactSensitiveData, REDACTED_VALUE_PLACEHOLDER } from './redact.util';

describe('redactSensitiveData', () => {
  it('never leaks password/token/authorization/cookie values in plain text', () => {
    const secrets = {
      password: 's3nh4-super-secreta',
      token: 'tok_abc123',
      accessToken: 'access-xyz789',
      refreshToken: 'refresh-uvw456',
      authorization: 'Bearer some.jwt.value',
      cookie: 'session=abc; other=def',
    };

    const sample = {
      user: { email: 'user@example.com', ...secrets },
      headers: { ...secrets, 'x-request-id': 'req-1' },
      nested: { deeply: { nested: { refreshToken: secrets.refreshToken } } },
    };

    const redacted = redactSensitiveData(sample);
    const serialized = JSON.stringify(redacted);

    for (const secretValue of Object.values(secrets)) {
      expect(serialized).not.toContain(secretValue);
    }
    expect(serialized).toContain(REDACTED_VALUE_PLACEHOLDER);
    // Campos não sensíveis continuam visíveis normalmente.
    expect(redacted.user.email).toBe('user@example.com');
    expect(redacted.headers['x-request-id']).toBe('req-1');
  });

  it('redacts keys regardless of case or separators (snake_case, kebab-case, camelCase)', () => {
    const sample = {
      ACCESS_TOKEN: 'a',
      'refresh-token': 'b',
      Authorization: 'c',
      Cookie: 'd',
      Password: 'e',
    };

    const redacted = redactSensitiveData(sample) as Record<string, unknown>;

    for (const key of Object.keys(sample)) {
      expect(redacted[key]).toBe(REDACTED_VALUE_PLACEHOLDER);
    }
  });

  it('redacts sensitive values nested inside arrays', () => {
    const sample = {
      sessions: [{ token: 'first-token' }, { token: 'second-token' }],
    };

    const redacted = redactSensitiveData(sample);
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain('first-token');
    expect(serialized).not.toContain('second-token');
  });

  it('leaves non-sensitive primitive values untouched', () => {
    expect(redactSensitiveData('hello')).toBe('hello');
    expect(redactSensitiveData(42)).toBe(42);
    expect(redactSensitiveData(null)).toBeNull();
    expect(redactSensitiveData(undefined)).toBeUndefined();
  });

  it('handles circular references without throwing', () => {
    const circular: Record<string, unknown> = { password: 'secret' };
    circular.self = circular;

    expect(() => redactSensitiveData(circular)).not.toThrow();
  });

  it('preserves failureCode, statusCode and tokenVersion (never over-redacted)', () => {
    const sample = {
      failureCode: 'ACCOUNT_ALREADY_CONNECTED',
      statusCode: 409,
      tokenVersion: 3,
    };

    const redacted = redactSensitiveData(sample);

    expect(redacted.failureCode).toBe('ACCOUNT_ALREADY_CONNECTED');
    expect(redacted.statusCode).toBe(409);
    expect(redacted.tokenVersion).toBe(3);
  });

  it('redacts ML_CLIENT_SECRET, CREDENTIAL_ENCRYPTION_KEY, encryptedAccessToken and a nested refresh_token by key', () => {
    const sample = {
      ML_CLIENT_SECRET: 'shh-secret',
      CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
      encryptedAccessToken: 'iv:tag:cipher',
      nested: { deeply: { refresh_token: 'TG-123' } },
    };

    const redacted = redactSensitiveData(sample);
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain('shh-secret');
    expect(serialized).not.toContain('a'.repeat(64));
    expect(serialized).not.toContain('iv:tag:cipher');
    expect(serialized).not.toContain('TG-123');
  });

  it('redacts bare "code" and "state" keys exactly, without touching "statusCode"-style keys', () => {
    const sample = { code: 'abc', state: 'xyz', statusCode: 200 };

    const redacted = redactSensitiveData(sample);

    expect(redacted.code).toBe(REDACTED_VALUE_PLACEHOLDER);
    expect(redacted.state).toBe(REDACTED_VALUE_PLACEHOLDER);
    expect(redacted.statusCode).toBe(200);
  });

  it('sweeps a secret embedded INSIDE a string value that is not itself under a sensitive key (message/url/nested)', () => {
    const sample = {
      message:
        'Callback failed for url https://api.example.com/cb?state=s1&code=c1',
      url: 'https://api.example.com/cb?client_secret=cs1&access_token=at1',
      nested: { deeply: { note: 'refresh_token=rt1 was rejected' } },
    };

    const redacted = redactSensitiveData(sample);
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain('s1&');
    expect(serialized).not.toContain('c1');
    expect(serialized).not.toContain('cs1');
    expect(serialized).not.toContain('at1');
    expect(serialized).not.toContain('rt1');
  });
});
