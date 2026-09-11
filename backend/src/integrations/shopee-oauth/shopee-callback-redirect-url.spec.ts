import { buildShopeeCallbackRedirectUrl } from './shopee-callback-redirect-url';

describe('buildShopeeCallbackRedirectUrl', () => {
  it('sucesso: FRONTEND_URL/integracoes?shopee=success, sem reason', () => {
    const url = buildShopeeCallbackRedirectUrl({
      frontendUrl: 'https://app.example.com',
      reason: 'success',
    });
    expect(url).toBe('https://app.example.com/integracoes?shopee=success');
  });

  it('falha: FRONTEND_URL/integracoes?shopee=error&reason=CODIGO_PUBLICO', () => {
    const url = buildShopeeCallbackRedirectUrl({
      frontendUrl: 'https://app.example.com',
      reason: 'CONNECTION_FAILED',
    });
    expect(url).toBe(
      'https://app.example.com/integracoes?shopee=error&reason=CONNECTION_FAILED',
    );
  });

  it('pathname final é sempre fixo /integracoes, descartando qualquer path pré-existente de FRONTEND_URL', () => {
    const url = buildShopeeCallbackRedirectUrl({
      frontendUrl: 'https://app.example.com/algum/path',
      reason: 'success',
    });
    expect(new URL(url).pathname).toBe('/integracoes');
  });

  it('descarta query/fragmento pré-existentes de FRONTEND_URL', () => {
    const url = buildShopeeCallbackRedirectUrl({
      frontendUrl: 'https://app.example.com?x=1#frag',
      reason: 'success',
    });
    expect(url).toBe('https://app.example.com/integracoes?shopee=success');
  });

  it('nunca inclui code/state/shopId (nem recebe esses valores como entrada)', () => {
    const url = buildShopeeCallbackRedirectUrl({
      frontendUrl: 'https://app.example.com',
      reason: 'OAUTH_CALLBACK_INVALID',
    });
    expect(url).not.toContain('code=');
    expect(url).not.toContain('state=');
    expect(url).not.toContain('shop_id=');
  });
});
