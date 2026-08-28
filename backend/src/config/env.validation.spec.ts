import { envValidationSchema } from './env.validation';

interface ValidatedEnv {
  PORT: number;
  ACCESS_TOKEN_TTL_SECONDS: number;
  REFRESH_TOKEN_TTL_DAYS: number;
}

interface ValidatedMercadoLivreTimingEnv {
  ML_HTTP_TIMEOUT_MS: number;
  ML_OAUTH_PROCESSING_STALE_AFTER_MS: number;
  ML_ACCOUNT_LOCK_WAIT_MS: number;
  ML_TOKEN_REFRESH_LEEWAY_MS: number;
}

const VALID_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  PORT: '3000',
  DATABASE_URL: 'postgres://user:password@localhost:5432/central_performance',
  ACCESS_TOKEN_SECRET: 'a'.repeat(32),
  CREDENTIAL_ENCRYPTION_KEY: 'b'.repeat(64),
  FRONTEND_URL: 'http://localhost:3001',
  COOKIE_SECURE: 'false',
  ML_CLIENT_ID: 'app-id',
  ML_CLIENT_SECRET: 'app-secret',
  ML_REDIRECT_URI: 'http://localhost:3000/integrations/mercado-livre/callback',
};

function withoutKey(
  env: Record<string, string>,
  key: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(([entryKey]) => entryKey !== key),
  );
}

describe('envValidationSchema', () => {
  it('accepts a fully valid environment and fills in defaults', () => {
    const result = envValidationSchema.validate(VALID_ENV, {
      abortEarly: false,
    });
    const validated = result.value as ValidatedEnv;

    expect(result.error).toBeUndefined();
    expect(validated.PORT).toBe(3000);
    expect(validated.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(validated.REFRESH_TOKEN_TTL_DAYS).toBe(30);
  });

  it('fails when DATABASE_URL is missing', () => {
    const { error } = envValidationSchema.validate(
      withoutKey(VALID_ENV, 'DATABASE_URL'),
      {
        abortEarly: false,
      },
    );

    expect(error).toBeDefined();
    expect(error?.message).toMatch(/DATABASE_URL/);
  });

  it('fails when ACCESS_TOKEN_SECRET is missing', () => {
    const { error } = envValidationSchema.validate(
      withoutKey(VALID_ENV, 'ACCESS_TOKEN_SECRET'),
      {
        abortEarly: false,
      },
    );

    expect(error).toBeDefined();
    expect(error?.message).toMatch(/ACCESS_TOKEN_SECRET/);
  });

  it('fails when ACCESS_TOKEN_SECRET is too short', () => {
    const { error } = envValidationSchema.validate(
      { ...VALID_ENV, ACCESS_TOKEN_SECRET: 'too-short' },
      { abortEarly: false },
    );

    expect(error).toBeDefined();
  });

  it('fails when CREDENTIAL_ENCRYPTION_KEY is missing', () => {
    const { error } = envValidationSchema.validate(
      withoutKey(VALID_ENV, 'CREDENTIAL_ENCRYPTION_KEY'),
      { abortEarly: false },
    );

    expect(error).toBeDefined();
    expect(error?.message).toMatch(/CREDENTIAL_ENCRYPTION_KEY/);
  });

  it('fails when FRONTEND_URL is missing', () => {
    const { error } = envValidationSchema.validate(
      withoutKey(VALID_ENV, 'FRONTEND_URL'),
      {
        abortEarly: false,
      },
    );

    expect(error).toBeDefined();
    expect(error?.message).toMatch(/FRONTEND_URL/);
  });

  it('fails when COOKIE_SECURE is missing', () => {
    const { error } = envValidationSchema.validate(
      withoutKey(VALID_ENV, 'COOKIE_SECURE'),
      {
        abortEarly: false,
      },
    );

    expect(error).toBeDefined();
    expect(error?.message).toMatch(/COOKIE_SECURE/);
  });

  it('fails when DATABASE_URL is not a postgres URI', () => {
    const { error } = envValidationSchema.validate(
      { ...VALID_ENV, DATABASE_URL: 'mysql://user:pass@localhost:3306/db' },
      { abortEarly: false },
    );

    expect(error).toBeDefined();
  });

  it('fails when NODE_ENV has an unsupported value', () => {
    const { error } = envValidationSchema.validate(
      { ...VALID_ENV, NODE_ENV: 'staging-typo' },
      { abortEarly: false },
    );

    expect(error).toBeDefined();
  });

  it('fails without ML_CLIENT_ID / ML_CLIENT_SECRET / ML_REDIRECT_URI', () => {
    const { error } = envValidationSchema.validate(
      {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://u:p@localhost:5432/db',
        ACCESS_TOKEN_SECRET: 'x'.repeat(32),
        CREDENTIAL_ENCRYPTION_KEY: 'y'.repeat(64),
        FRONTEND_URL: 'https://app.example.com',
        COOKIE_SECURE: 'true',
      },
      { abortEarly: false },
    );

    const messages = error?.details.map((d) => d.message).join('\n') ?? '';
    expect(messages).toMatch(/ML_CLIENT_ID/);
    expect(messages).toMatch(/ML_CLIENT_SECRET/);
    expect(messages).toMatch(/ML_REDIRECT_URI/);
  });

  it('accepts valid Mercado Livre variables and applies defaults for timing configs', () => {
    const result = envValidationSchema.validate({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      ACCESS_TOKEN_SECRET: 'x'.repeat(32),
      CREDENTIAL_ENCRYPTION_KEY: 'y'.repeat(64),
      FRONTEND_URL: 'https://app.example.com',
      COOKIE_SECURE: 'true',
      ML_CLIENT_ID: 'app-id',
      ML_CLIENT_SECRET: 'app-secret',
      ML_REDIRECT_URI:
        'https://api.example.com/integrations/mercado-livre/callback',
    });

    expect(result.error).toBeUndefined();
    const validated = result.value as ValidatedMercadoLivreTimingEnv;
    expect(validated.ML_HTTP_TIMEOUT_MS).toBe(10000);
    expect(validated.ML_OAUTH_PROCESSING_STALE_AFTER_MS).toBe(120000);
    expect(validated.ML_ACCOUNT_LOCK_WAIT_MS).toBe(3000);
    expect(validated.ML_TOKEN_REFRESH_LEEWAY_MS).toBe(900000);
  });

  it('rejects an ML_REDIRECT_URI with a query string in production', () => {
    const { error } = envValidationSchema.validate({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      ACCESS_TOKEN_SECRET: 'x'.repeat(32),
      CREDENTIAL_ENCRYPTION_KEY: 'y'.repeat(64),
      FRONTEND_URL: 'https://app.example.com',
      COOKIE_SECURE: 'true',
      ML_CLIENT_ID: 'app-id',
      ML_CLIENT_SECRET: 'app-secret',
      ML_REDIRECT_URI:
        'https://api.example.com/integrations/mercado-livre/callback?x=1',
    });

    expect(error?.message).toMatch(/ML_REDIRECT_URI/);
  });

  it("rejects ML_OAUTH_PROCESSING_STALE_AFTER_MS smaller than the callback's worst-case duration (2x ML_HTTP_TIMEOUT_MS + ML_ACCOUNT_LOCK_WAIT_MS)", () => {
    const { error } = envValidationSchema.validate({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      ACCESS_TOKEN_SECRET: 'x'.repeat(32),
      CREDENTIAL_ENCRYPTION_KEY: 'y'.repeat(64),
      FRONTEND_URL: 'https://app.example.com',
      COOKIE_SECURE: 'true',
      ML_CLIENT_ID: 'app-id',
      ML_CLIENT_SECRET: 'app-secret',
      ML_REDIRECT_URI:
        'https://api.example.com/integrations/mercado-livre/callback',
      ML_HTTP_TIMEOUT_MS: 10000,
      ML_ACCOUNT_LOCK_WAIT_MS: 3000,
      // Mínimo exigido: 2*10000 + 3000 + margem > 23000. 5000 é claramente insuficiente.
      ML_OAUTH_PROCESSING_STALE_AFTER_MS: 5000,
    });

    expect(error?.message).toMatch(/ML_OAUTH_PROCESSING_STALE_AFTER_MS/);
  });

  it('accepts the Task 5 defaults (10000/3000/120000) since 120000 comfortably exceeds 2*10000 + 3000', () => {
    const { error } = envValidationSchema.validate({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      ACCESS_TOKEN_SECRET: 'x'.repeat(32),
      CREDENTIAL_ENCRYPTION_KEY: 'y'.repeat(64),
      FRONTEND_URL: 'https://app.example.com',
      COOKIE_SECURE: 'true',
      ML_CLIENT_ID: 'app-id',
      ML_CLIENT_SECRET: 'app-secret',
      ML_REDIRECT_URI:
        'https://api.example.com/integrations/mercado-livre/callback',
    });

    expect(error).toBeUndefined();
  });
});
