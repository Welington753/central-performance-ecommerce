import { validateMercadoLivreRedirectUri } from './mercado-livre-redirect-uri.validator';

describe('validateMercadoLivreRedirectUri', () => {
  it('accepts an HTTPS URL with no query/fragment in production', () => {
    expect(
      validateMercadoLivreRedirectUri(
        'https://api.example.com/integrations/mercado-livre/callback',
        'production',
      ),
    ).toBe(true);
  });

  it('rejects HTTP in production', () => {
    expect(
      validateMercadoLivreRedirectUri(
        'http://api.example.com/integrations/mercado-livre/callback',
        'production',
      ),
    ).toBe(false);
  });

  it.each(['test', 'staging'])(
    'rejects HTTP in nodeEnv=%s (only "development" is allowed to use HTTP)',
    (nodeEnv) => {
      expect(
        validateMercadoLivreRedirectUri(
          'http://api.example.com/integrations/mercado-livre/callback',
          nodeEnv,
        ),
      ).toBe(false);
    },
  );

  it.each(['test', 'staging', 'production'])(
    'accepts HTTPS in nodeEnv=%s',
    (nodeEnv) => {
      expect(
        validateMercadoLivreRedirectUri(
          'https://api.example.com/integrations/mercado-livre/callback',
          nodeEnv,
        ),
      ).toBe(true);
    },
  );

  it('accepts HTTP only in development', () => {
    expect(
      validateMercadoLivreRedirectUri(
        'http://localhost:3000/integrations/mercado-livre/callback',
        'development',
      ),
    ).toBe(true);
  });

  it('rejects a pathname different from the fixed backend callback path (design §5: "corresponder exatamente")', () => {
    expect(
      validateMercadoLivreRedirectUri(
        'https://api.example.com/some/other/path',
        'production',
      ),
    ).toBe(false);
    expect(
      validateMercadoLivreRedirectUri(
        'https://api.example.com/integrations/mercado-livre/callback/',
        'production',
      ),
    ).toBe(false); // trailing slash also counts as a different pathname
  });

  it('rejects a URL with query string', () => {
    expect(
      validateMercadoLivreRedirectUri(
        'https://api.example.com/integrations/mercado-livre/callback?x=1',
        'production',
      ),
    ).toBe(false);
  });

  it('rejects a URL with a fragment', () => {
    expect(
      validateMercadoLivreRedirectUri(
        'https://api.example.com/integrations/mercado-livre/callback#frag',
        'production',
      ),
    ).toBe(false);
  });

  it('rejects a malformed URL', () => {
    expect(validateMercadoLivreRedirectUri('not-a-url', 'production')).toBe(
      false,
    );
  });
});
