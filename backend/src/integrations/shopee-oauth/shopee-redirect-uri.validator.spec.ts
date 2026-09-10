import { validateShopeeRedirectUri } from './shopee-redirect-uri.validator';

const VALID_PATHNAME = '/integrations/shopee/callback';

describe('validateShopeeRedirectUri', () => {
  it('accepts an HTTPS URL with the exact pathname in production', () => {
    expect(
      validateShopeeRedirectUri(
        `https://api.example.com${VALID_PATHNAME}`,
        'production',
      ),
    ).toBe(true);
  });

  it('accepts HTTP+localhost in development', () => {
    expect(
      validateShopeeRedirectUri(
        `http://localhost:3000${VALID_PATHNAME}`,
        'development',
      ),
    ).toBe(true);
  });

  it('accepts HTTPS+localhost in development', () => {
    expect(
      validateShopeeRedirectUri(
        `https://localhost:3000${VALID_PATHNAME}`,
        'development',
      ),
    ).toBe(true);
  });

  it('rejects HTTP in production', () => {
    expect(
      validateShopeeRedirectUri(
        `http://api.example.com${VALID_PATHNAME}`,
        'production',
      ),
    ).toBe(false);
  });

  it('rejects HTTP outside development in any non-development nodeEnv (e.g. staging)', () => {
    expect(
      validateShopeeRedirectUri(
        `http://api.example.com${VALID_PATHNAME}`,
        'staging',
      ),
    ).toBe(false);
  });

  it('rejects localhost in production, even with HTTPS', () => {
    expect(
      validateShopeeRedirectUri(
        `https://localhost${VALID_PATHNAME}`,
        'production',
      ),
    ).toBe(false);
  });

  it('rejects 127.0.0.1 in production', () => {
    expect(
      validateShopeeRedirectUri(
        `https://127.0.0.1${VALID_PATHNAME}`,
        'production',
      ),
    ).toBe(false);
  });

  it('rejects a query string', () => {
    expect(
      validateShopeeRedirectUri(
        `https://api.example.com${VALID_PATHNAME}?foo=bar`,
        'production',
      ),
    ).toBe(false);
  });

  it('rejects a fragment', () => {
    expect(
      validateShopeeRedirectUri(
        `https://api.example.com${VALID_PATHNAME}#frag`,
        'production',
      ),
    ).toBe(false);
  });

  it('rejects embedded username/password', () => {
    expect(
      validateShopeeRedirectUri(
        `https://user:pass@api.example.com${VALID_PATHNAME}`,
        'production',
      ),
    ).toBe(false);
  });

  it('rejects a pathname other than /integrations/shopee/callback', () => {
    expect(
      validateShopeeRedirectUri(
        'https://api.example.com/integrations/shopee/other',
        'production',
      ),
    ).toBe(false);
  });

  it('rejects a malformed URL', () => {
    expect(validateShopeeRedirectUri('not a url', 'production')).toBe(false);
  });
});
