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
});
