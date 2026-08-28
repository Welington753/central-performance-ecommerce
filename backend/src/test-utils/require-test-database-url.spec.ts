import { requireTestDatabaseUrl } from './require-test-database-url';

describe('requireTestDatabaseUrl', () => {
  const original = process.env.TEST_DATABASE_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.TEST_DATABASE_URL;
    else process.env.TEST_DATABASE_URL = original;
  });

  it('returns the value when set', () => {
    process.env.TEST_DATABASE_URL = 'postgres://u:p@localhost:5433/db';
    expect(requireTestDatabaseUrl()).toBe('postgres://u:p@localhost:5433/db');
  });

  it('throws a clear error when unset (never silently skips)', () => {
    delete process.env.TEST_DATABASE_URL;
    expect(() => requireTestDatabaseUrl()).toThrow(/TEST_DATABASE_URL/);
  });
});
