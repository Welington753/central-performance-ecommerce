import { buildAuthorizationUrl } from './build-authorization-url';

describe('buildAuthorizationUrl', () => {
  it('builds a deterministic URL with all required parameters, S256 fixed', () => {
    const url = buildAuthorizationUrl({
      clientId: 'app-123',
      redirectUri:
        'https://api.example.com/integrations/mercado-livre/callback',
      state: 'state-value-with-special-&-chars',
      codeChallenge: 'challenge-value',
    });

    const parsed = new URL(url);

    expect(parsed.origin).toBe('https://auth.mercadolivre.com.br');
    expect(parsed.pathname).toBe('/authorization');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('client_id')).toBe('app-123');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'https://api.example.com/integrations/mercado-livre/callback',
    );
    expect(parsed.searchParams.get('state')).toBe(
      'state-value-with-special-&-chars',
    );
    expect(parsed.searchParams.get('code_challenge')).toBe('challenge-value');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('never emits a plain code_challenge_method', () => {
    const url = buildAuthorizationUrl({
      clientId: 'a',
      redirectUri: 'https://x.example.com/cb',
      state: 's',
      codeChallenge: 'c',
    });
    expect(url).not.toContain('plain');
  });

  it('never emits a scope parameter (not documented — design §2)', () => {
    const url = buildAuthorizationUrl({
      clientId: 'a',
      redirectUri: 'https://x.example.com/cb',
      state: 's',
      codeChallenge: 'c',
    });
    expect(new URL(url).searchParams.has('scope')).toBe(false);
  });

  it('percent-encodes special characters correctly via the URL API', () => {
    const url = buildAuthorizationUrl({
      clientId: 'a',
      redirectUri: 'https://x.example.com/cb',
      state: 'a b&c',
      codeChallenge: 'c',
    });
    expect(new URL(url).searchParams.get('state')).toBe('a b&c');
  });
});
