import { ConfigService } from '@nestjs/config';
import { loadAmazonConfig } from './amazon-config';

function configServiceWith(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

const FULL_ENV = {
  AMAZON_SP_API_APP_ID: 'amzn1.sp.solution.example',
  AMAZON_LWA_CLIENT_ID: 'amzn1.application-oa2-client.example',
  AMAZON_LWA_CLIENT_SECRET: 'lwa-secret-example',
  AMAZON_SP_API_ENDPOINT: 'https://sellingpartnerapi-na.amazon.com',
  AMAZON_SP_API_USER_AGENT: 'CentralPerformance/1.0 (Language=TypeScript)',
};

describe('loadAmazonConfig', () => {
  it('returns configured:true with all five values when every variable is present', () => {
    const result = loadAmazonConfig(configServiceWith(FULL_ENV));

    expect(result.configured).toBe(true);
    if (result.configured) {
      expect(result.config).toEqual({
        appId: FULL_ENV.AMAZON_SP_API_APP_ID,
        lwaClientId: FULL_ENV.AMAZON_LWA_CLIENT_ID,
        lwaClientSecret: FULL_ENV.AMAZON_LWA_CLIENT_SECRET,
        spApiEndpoint: FULL_ENV.AMAZON_SP_API_ENDPOINT,
        userAgent: FULL_ENV.AMAZON_SP_API_USER_AGENT,
      });
    }
  });

  it('returns configured:false when no Amazon variable is set (backend must still boot)', () => {
    const result = loadAmazonConfig(configServiceWith({}));
    expect(result).toEqual({ configured: false });
  });

  it.each(Object.keys(FULL_ENV))(
    'returns configured:false when only %s is missing',
    (missingKey) => {
      const partial = { ...FULL_ENV };
      delete (partial as Record<string, string>)[missingKey];
      const result = loadAmazonConfig(configServiceWith(partial));
      expect(result.configured).toBe(false);
    },
  );

  it('never throws, regardless of input', () => {
    expect(() => loadAmazonConfig(configServiceWith({}))).not.toThrow();
  });
});
