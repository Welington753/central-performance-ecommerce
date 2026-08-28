import { sanitizeSensitiveSubstrings } from './sanitize-string.util';

describe('sanitizeSensitiveSubstrings', () => {
  it('masks a Bearer credential embedded in a string, without corrupting the rest of the string', () => {
    const input = 'Authorization: Bearer APP_USR-12345-abcde and nothing else';
    const result = sanitizeSensitiveSubstrings(input);

    expect(result).not.toContain('APP_USR-12345-abcde');
    expect(result).toContain('Authorization: Bearer');
    expect(result).toContain('and nothing else');
  });

  it('masks a code= value embedded in a full query-string URL (query/form URL-encoded style)', () => {
    const input =
      'https://api.example.com/integrations/mercado-livre/callback?state=xyz&code=TG-secret-code-value';
    const result = sanitizeSensitiveSubstrings(input);
    expect(result).not.toContain('TG-secret-code-value');
    expect(result).not.toContain('xyz');
  });

  it('masks a state= value embedded in a string', () => {
    const input = 'redirecting with state=abc123secretstate';
    expect(sanitizeSensitiveSubstrings(input)).not.toContain(
      'abc123secretstate',
    );
  });

  it('masks a client_secret= value and a code_verifier= value in a form-urlencoded body string', () => {
    const input =
      'grant_type=authorization_code&client_secret=super-secret-value&code_verifier=verifier-secret&code=xyz';
    const result = sanitizeSensitiveSubstrings(input);
    expect(result).not.toContain('super-secret-value');
    expect(result).not.toContain('verifier-secret');
    expect(result).not.toContain('xyz');
  });

  it('masks access_token= and refresh_token= values', () => {
    const input =
      'access_token=APP_USR-abc&refresh_token=TG-xyz&token_type=bearer';
    const result = sanitizeSensitiveSubstrings(input);
    expect(result).not.toContain('APP_USR-abc');
    expect(result).not.toContain('TG-xyz');
    expect(result).toContain('token_type=bearer'); // não sensível, preservado
  });

  it('masks a JSON-like "code": "value" / "client_secret":"value" pair embedded in a logged string', () => {
    const input =
      '{"code":"json-secret-code","other":"kept","client_secret": "json-secret-value"}';
    const result = sanitizeSensitiveSubstrings(input);
    expect(result).not.toContain('json-secret-code');
    expect(result).not.toContain('json-secret-value');
    expect(result).toContain('"other":"kept"');
  });

  it('does not corrupt an unrelated key like "statusCode"/"failureCode"/"zipcode" appearing in free text', () => {
    const input =
      'statusCode=409, failureCode=ACCOUNT_ALREADY_CONNECTED, zipcode=94105';
    const result = sanitizeSensitiveSubstrings(input);
    expect(result).toBe(input); // nada aqui corresponde a code=/state=/etc. isolados
  });

  it('leaves an ordinary string untouched', () => {
    expect(sanitizeSensitiveSubstrings('hello world')).toBe('hello world');
  });
});
