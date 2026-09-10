import { ConfigService } from '@nestjs/config';
import { loadShopeeConfig } from './shopee-config';

function configServiceWith(
  values: Record<string, string | number>,
): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

const FULL_ENV = {
  SHOPEE_PARTNER_ID: '1000000',
  SHOPEE_PARTNER_KEY: 'partner-key-example',
  SHOPEE_REDIRECT_URI: 'https://api.example.com/integrations/shopee/callback',
};

describe('loadShopeeConfig', () => {
  it('returns configured:true, defaulting environment to SANDBOX and resolving apiHost from it', () => {
    const result = loadShopeeConfig(configServiceWith(FULL_ENV));

    expect(result.configured).toBe(true);
    if (result.configured) {
      expect(result.config).toEqual({
        partnerId: FULL_ENV.SHOPEE_PARTNER_ID,
        partnerKey: FULL_ENV.SHOPEE_PARTNER_KEY,
        redirectUri: FULL_ENV.SHOPEE_REDIRECT_URI,
        environment: 'SANDBOX',
        apiHost: 'https://openplatform.sandbox.test-stable.shopee.sg',
        httpTimeoutMs: 10000,
        tokenRefreshSkewSeconds: 600,
      });
    }
  });

  it('resolves apiHost to the production host when SHOPEE_ENVIRONMENT=PRODUCTION', () => {
    const result = loadShopeeConfig(
      configServiceWith({ ...FULL_ENV, SHOPEE_ENVIRONMENT: 'PRODUCTION' }),
    );

    expect(result.configured).toBe(true);
    if (result.configured) {
      expect(result.config.apiHost).toBe('https://partner.shopeemobile.com');
      expect(result.config.environment).toBe('PRODUCTION');
    }
  });

  it('returns configured:false when no Shopee variable is set (backend must still boot)', () => {
    const result = loadShopeeConfig(configServiceWith({}));
    expect(result).toEqual({ configured: false });
  });

  it.each(['SHOPEE_PARTNER_ID', 'SHOPEE_PARTNER_KEY', 'SHOPEE_REDIRECT_URI'])(
    'returns configured:false when only %s is missing',
    (missingKey) => {
      const partial = { ...FULL_ENV };
      delete (partial as Record<string, string>)[missingKey];
      const result = loadShopeeConfig(configServiceWith(partial));
      expect(result.configured).toBe(false);
    },
  );

  it('returns configured:false for an invalid SHOPEE_ENVIRONMENT value', () => {
    const result = loadShopeeConfig(
      configServiceWith({ ...FULL_ENV, SHOPEE_ENVIRONMENT: 'STAGING' }),
    );
    expect(result.configured).toBe(false);
  });

  it('respects explicit SHOPEE_HTTP_TIMEOUT_MS/SHOPEE_TOKEN_REFRESH_SKEW_SECONDS overrides', () => {
    const result = loadShopeeConfig(
      configServiceWith({
        ...FULL_ENV,
        SHOPEE_HTTP_TIMEOUT_MS: 5000,
        SHOPEE_TOKEN_REFRESH_SKEW_SECONDS: 120,
      }),
    );

    expect(result.configured).toBe(true);
    if (result.configured) {
      expect(result.config.httpTimeoutMs).toBe(5000);
      expect(result.config.tokenRefreshSkewSeconds).toBe(120);
    }
  });

  it('never throws, regardless of input', () => {
    expect(() => loadShopeeConfig(configServiceWith({}))).not.toThrow();
  });
});
