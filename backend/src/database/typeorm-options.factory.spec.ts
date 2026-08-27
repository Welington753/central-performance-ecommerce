import { buildDataSourceOptions } from './typeorm-options.factory';

describe('buildDataSourceOptions', () => {
  const baseInput = {
    databaseUrl: 'postgres://user:password@localhost:5432/central_performance',
  };

  it('never enables synchronize, in any environment', () => {
    for (const nodeEnv of ['development', 'test', 'production']) {
      const options = buildDataSourceOptions({ ...baseInput, nodeEnv });
      expect(options.synchronize).toBe(false);
    }
  });

  it('does not omit synchronize (it must be explicitly present and falsy)', () => {
    const options = buildDataSourceOptions({
      ...baseInput,
      nodeEnv: 'production',
    });

    expect(options).toHaveProperty('synchronize');
    expect(options.synchronize).not.toBeUndefined();
    expect(Boolean(options.synchronize)).toBe(false);
  });

  it('uses the postgres driver and the given connection string', () => {
    const options = buildDataSourceOptions({
      ...baseInput,
      nodeEnv: 'development',
    });

    expect(options.type).toBe('postgres');
    expect(options).toMatchObject({ url: baseInput.databaseUrl });
  });
});
