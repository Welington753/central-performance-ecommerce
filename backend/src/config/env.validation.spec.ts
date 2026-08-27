import { envValidationSchema } from './env.validation';

interface ValidatedEnv {
  PORT: number;
  ACCESS_TOKEN_TTL_SECONDS: number;
  REFRESH_TOKEN_TTL_DAYS: number;
}

const VALID_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  PORT: '3000',
  DATABASE_URL: 'postgres://user:password@localhost:5432/central_performance',
  ACCESS_TOKEN_SECRET: 'a'.repeat(32),
  CREDENTIAL_ENCRYPTION_KEY: 'b'.repeat(64),
  FRONTEND_URL: 'http://localhost:3001',
  COOKIE_SECURE: 'false',
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
});
