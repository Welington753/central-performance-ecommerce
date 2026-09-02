import {
  ALLOWED_AMAZON_SP_API_ENDPOINTS,
  isAllowedAmazonSpApiEndpoint,
} from './amazon-sp-api-endpoint.allowlist';

describe('isAllowedAmazonSpApiEndpoint', () => {
  it('accepts each one of the three official regional endpoints', () => {
    for (const endpoint of ALLOWED_AMAZON_SP_API_ENDPOINTS) {
      expect(isAllowedAmazonSpApiEndpoint(endpoint)).toBe(true);
    }
  });

  it('rejects an arbitrary host (SSRF protection)', () => {
    expect(isAllowedAmazonSpApiEndpoint('https://evil.example.com')).toBe(
      false,
    );
  });

  it('rejects a look-alike host that merely contains an allowed hostname as a substring', () => {
    expect(
      isAllowedAmazonSpApiEndpoint(
        'https://sellingpartnerapi-na.amazon.com.evil.com',
      ),
    ).toBe(false);
  });

  it('rejects the same host over plain http', () => {
    expect(
      isAllowedAmazonSpApiEndpoint('http://sellingpartnerapi-na.amazon.com'),
    ).toBe(false);
  });

  it('rejects an allowed host with a trailing slash (exact-match only)', () => {
    expect(
      isAllowedAmazonSpApiEndpoint('https://sellingpartnerapi-na.amazon.com/'),
    ).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isAllowedAmazonSpApiEndpoint('')).toBe(false);
  });
});
