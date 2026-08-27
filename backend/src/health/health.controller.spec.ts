import { Test } from '@nestjs/testing';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { HealthController } from './health.controller';

type HealthIndicatorFn = () => Promise<Record<string, unknown>>;

async function fakeHealthCheck(indicators: HealthIndicatorFn[]) {
  const results = await Promise.all(indicators.map((indicator) => indicator()));
  const details = results.reduce<Record<string, unknown>>(
    (accumulated, result) => ({ ...accumulated, ...result }),
    {},
  );
  return { status: 'ok' as const, info: details, error: {}, details };
}

describe('HealthController', () => {
  it('returns an "ok" status when the database indicator is up (DB mockado)', async () => {
    const pingCheck = jest
      .fn()
      .mockResolvedValue({ database: { status: 'up' } });
    const check = jest.fn(fakeHealthCheck);

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: { check } },
        { provide: TypeOrmHealthIndicator, useValue: { pingCheck } },
      ],
    }).compile();

    const controller = moduleRef.get(HealthController);
    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(pingCheck).toHaveBeenCalledWith('database');
    expect(result.details).toEqual({ database: { status: 'up' } });
  });
});
