import { ConfigService } from '@nestjs/config';
import { ShopeeCredentialsService } from './shopee-credentials.service';

function configServiceWith(
  values: Record<string, string | number>,
): ConfigService {
  return {
    get: (key: string, defaultValue?: unknown) =>
      key in values ? values[key] : defaultValue,
  } as unknown as ConfigService;
}

const FULL_ENV = {
  SHOPEE_PARTNER_ID: '1000000',
  SHOPEE_PARTNER_KEY: 'partner-key-example',
  SHOPEE_REDIRECT_URI: 'https://api.example.com/integrations/shopee/callback',
  NODE_ENV: 'production',
};

describe('ShopeeCredentialsService', () => {
  describe('isConfigured', () => {
    it('returns true when every credential variable is present', () => {
      const service = new ShopeeCredentialsService(configServiceWith(FULL_ENV));
      expect(service.isConfigured()).toBe(true);
    });

    it('returns false when no credential variable is set (backend must still boot)', () => {
      const service = new ShopeeCredentialsService(configServiceWith({}));
      expect(service.isConfigured()).toBe(false);
    });
  });

  describe('ensureConfigured', () => {
    it('returns the config object when credentials and redirect URI are valid', () => {
      const service = new ShopeeCredentialsService(configServiceWith(FULL_ENV));
      const config = service.ensureConfigured();
      expect(config.partnerId).toBe(FULL_ENV.SHOPEE_PARTNER_ID);
      expect(config.redirectUri).toBe(FULL_ENV.SHOPEE_REDIRECT_URI);
    });

    it('throws ConflictException("SHOPEE_NOT_CONFIGURED") when credentials are missing, never including any credential value', () => {
      const service = new ShopeeCredentialsService(configServiceWith({}));
      expect(() => service.ensureConfigured()).toThrow('SHOPEE_NOT_CONFIGURED');
    });

    it('never includes partnerKey in the thrown error message', () => {
      const service = new ShopeeCredentialsService(configServiceWith({}));
      expect.assertions(2);
      try {
        service.ensureConfigured();
      } catch (error) {
        expect((error as Error).message).not.toContain('partner-key');
        expect((error as Error).message).toBe('SHOPEE_NOT_CONFIGURED');
      }
    });

    it('throws ConflictException("INVALID_REDIRECT_URI") when the redirect URI is HTTP in production, never including the URL itself', () => {
      const service = new ShopeeCredentialsService(
        configServiceWith({
          ...FULL_ENV,
          SHOPEE_REDIRECT_URI:
            'http://api.example.com/integrations/shopee/callback',
        }),
      );

      expect.assertions(2);
      try {
        service.ensureConfigured();
      } catch (error) {
        expect((error as Error).message).toBe('INVALID_REDIRECT_URI');
        expect((error as Error).message).not.toContain('http://');
      }
    });

    it('throws ConflictException("INVALID_REDIRECT_URI") when the redirect URI uses localhost in production', () => {
      const service = new ShopeeCredentialsService(
        configServiceWith({
          ...FULL_ENV,
          SHOPEE_REDIRECT_URI: 'https://localhost/integrations/shopee/callback',
        }),
      );
      expect(() => service.ensureConfigured()).toThrow('INVALID_REDIRECT_URI');
    });

    it('accepts http+localhost redirect URI in development', () => {
      const service = new ShopeeCredentialsService(
        configServiceWith({
          ...FULL_ENV,
          NODE_ENV: 'development',
          SHOPEE_REDIRECT_URI:
            'http://localhost:3000/integrations/shopee/callback',
        }),
      );
      expect(() => service.ensureConfigured()).not.toThrow();
    });
  });
});
