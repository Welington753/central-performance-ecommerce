import { buildCallbackRedirectUrl } from './callback-redirect-url';

describe('buildCallbackRedirectUrl', () => {
  it('builds a success URL pointing at the fixed /integracoes path', () => {
    const url = buildCallbackRedirectUrl({
      frontendUrl: 'https://app.example.com',
      reason: 'success',
    });
    const parsed = new URL(url);

    expect(parsed.origin).toBe('https://app.example.com');
    expect(parsed.pathname).toBe('/integracoes');
    expect(parsed.searchParams.get('ml')).toBe('success');
    expect(parsed.searchParams.get('reason')).toBe('success');
  });

  it('builds an error URL with ml=error and the given reason', () => {
    const url = buildCallbackRedirectUrl({
      frontendUrl: 'https://app.example.com',
      reason: 'IDENTITY_MISMATCH',
    });
    const parsed = new URL(url);

    expect(parsed.searchParams.get('ml')).toBe('error');
    expect(parsed.searchParams.get('reason')).toBe('IDENTITY_MISMATCH');
  });

  it('ignores any path already present in frontendUrl — always /integracoes', () => {
    const url = buildCallbackRedirectUrl({
      frontendUrl: 'https://app.example.com/some/other/path',
      reason: 'success',
    });
    expect(new URL(url).pathname).toBe('/integracoes');
  });
});
