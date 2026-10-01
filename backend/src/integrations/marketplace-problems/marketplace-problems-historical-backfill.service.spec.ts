import { MarketplaceProblemsHistoricalBackfillService } from './marketplace-problems-historical-backfill.service';
import type { MarketplaceProblemsSyncJobRow } from './marketplace-problems-sync-jobs.types';
import type { ProblemsSyncResult } from './mercado-livre-problems-sync.types';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const WINDOW_MS = 14 * DAY;
const COVERED_FROM = new Date('2026-08-01T12:00:00.000Z');
const RETRY = { baseMs: 1000, maxMs: 8000 };
const BUDGET = { maxClaims: 40, maxHttpCalls: 200 };

function job(
  overrides: Partial<MarketplaceProblemsSyncJobRow> = {},
): MarketplaceProblemsSyncJobRow {
  return {
    id: 'job-1',
    marketplaceAccountId: 'acc-1',
    status: 'RUNNING',
    windowCursorAt: NOW,
    claimsProcessedCount: 0,
    claimsPersistedCount: 0,
    claimsFailedCount: 0,
    callsMadeCount: 0,
    attemptCount: 0,
    nextAttemptAt: NOW,
    lastErrorCode: null,
    pauseRequested: false,
    leaseOwner: 'w',
    leaseExpiresAt: null,
    version: 1,
    lastActivityAt: null,
    lastCompleteCensusAt: null,
    historicalCoveredFrom: COVERED_FROM,
    historicalTargetFrom: null,
    historicalStatus: 'RUNNING',
    historicalCompletedAt: null,
    historicalLastErrorCode: null,
    historicalAttemptCount: 0,
    historicalNextAttemptAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function result(
  overrides: Partial<ProblemsSyncResult> = {},
): ProblemsSyncResult {
  return {
    complete: true,
    stopReason: 'COMPLETED',
    failureCode: null,
    retryAfterMs: null,
    coverageFrom: null,
    claimsFound: 3,
    claimsProcessed: 3,
    claimsCoreCovered: 3,
    claimsPersisted: 3,
    claimsPreserved: 0,
    claimsFailed: 0,
    claimsQuarantined: 0,
    detailFailures: 0,
    reputationFailures: 0,
    reasonLookupFailures: 0,
    reasonCacheRefreshed: 0,
    httpCallsMade: 10,
    pagesFetched: 2,
    nextWindowFrom: null,
    ...overrides,
  };
}

function build(oldestOrder: Date | null, sync: jest.Mock = jest.fn()) {
  const query = jest.fn().mockResolvedValue([{ oldest: oldestOrder }]);
  const service = new MarketplaceProblemsHistoricalBackfillService(
    { query } as never,
    { syncHistoricalWindow: sync } as never,
  );
  return { service, query, sync };
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

describe('MarketplaceProblemsHistoricalBackfillService', () => {
  it.each(['PAUSED', 'FAILED'] as const)(
    '%s: nada roda (nem consulta de pedidos, nem busca)',
    async (historicalStatus) => {
      const { service, query, sync } = build(new Date('2026-01-01'));

      const report = await service.run(
        job({ historicalStatus }),
        NOW,
        BUDGET,
        WINDOW_MS,
        RETRY,
      );

      expect(report).toEqual({
        result: null,
        commit: null,
        terminalFailure: false,
      });
      expect(query).not.toHaveBeenCalled();
      expect(sync).not.toHaveBeenCalled();
    },
  );

  it('conta sem pedidos persistidos: NO_TARGET, nenhuma data inventada e nenhuma busca', async () => {
    const { service, sync } = build(null);

    const report = await service.run(job(), NOW, BUDGET, WINDOW_MS, RETRY);

    expect(sync).not.toHaveBeenCalled();
    expect(report.result).toBeNull();
    expect(report.commit).toEqual({
      coveredFrom: null,
      targetFrom: null,
      status: 'NO_TARGET',
      completedAt: null,
      errorCode: null,
      attemptCount: 0,
      nextAttemptAt: null,
    });
  });

  it('alvo posterior ao início da cobertura: conclui na hora, sem buscar, mantendo a menor data coberta', async () => {
    const { service, sync } = build(new Date('2026-08-15T00:00:00.000Z'));

    const report = await service.run(job(), NOW, BUDGET, WINDOW_MS, RETRY);

    expect(sync).not.toHaveBeenCalled();
    expect(report.commit).toMatchObject({
      status: 'COMPLETED',
      completedAt: NOW,
      coveredFrom: null,
      targetFrom: new Date('2026-08-15T00:00:00.000Z'),
    });
  });

  it('anda PARA TRÁS: janela [coveredFrom - largura, coveredFrom + sobreposição] com o orçamento recebido', async () => {
    const target = new Date('2026-01-01T00:00:00.000Z');
    const newFrom = new Date(COVERED_FROM.getTime() - WINDOW_MS);
    const sync = jest
      .fn()
      .mockResolvedValue(result({ nextWindowFrom: newFrom.toISOString() }));
    const { service } = build(target, sync);

    const report = await service.run(job(), NOW, BUDGET, WINDOW_MS, RETRY);

    expect(sync).toHaveBeenCalledTimes(1);
    const [accountId, window, budget] = sync.mock.calls[0] as [
      string,
      { from: Date; to: Date },
      typeof BUDGET,
    ];
    expect(accountId).toBe('acc-1');
    expect(iso(window.to)).toBe(
      new Date(COVERED_FROM.getTime() + 1000).toISOString(),
    );
    expect(iso(window.from)).toBe(newFrom.toISOString());
    expect(budget).toEqual(BUDGET);
    expect(report.commit).toEqual({
      coveredFrom: newFrom,
      targetFrom: target,
      status: 'RUNNING',
      completedAt: null,
      errorCode: null,
      attemptCount: 0,
      nextAttemptAt: null,
    });
  });

  it('a janela nunca ultrapassa o alvo (from = max(alvo, cursor - largura))', async () => {
    const target = new Date(COVERED_FROM.getTime() - 3 * DAY);
    const sync = jest
      .fn()
      .mockResolvedValue(result({ nextWindowFrom: target.toISOString() }));
    const { service } = build(target, sync);

    await service.run(job(), NOW, BUDGET, WINDOW_MS, RETRY);

    const [, window] = (sync.mock.calls as Array<[string, { from: Date }]>)[0];
    expect(iso(window.from)).toBe(target.toISOString());
  });

  it('termina na data do pedido mais antigo: COMPLETED com data de conclusão e a menor data efetivamente coberta', async () => {
    const target = new Date(COVERED_FROM.getTime() - 3 * DAY);
    const sync = jest
      .fn()
      .mockResolvedValue(result({ nextWindowFrom: target.toISOString() }));
    const { service } = build(target, sync);

    const report = await service.run(job(), NOW, BUDGET, WINDOW_MS, RETRY);

    expect(report.commit).toEqual({
      coveredFrom: target,
      targetFrom: target,
      status: 'COMPLETED',
      completedAt: NOW,
      errorCode: null,
      attemptCount: 0,
      nextAttemptAt: null,
    });
  });

  it('nunca declara conclusão enquanto o cursor ainda está acima do alvo', async () => {
    const target = new Date(COVERED_FROM.getTime() - 30 * DAY);
    const newFrom = new Date(target.getTime() + 1);
    const sync = jest
      .fn()
      .mockResolvedValue(result({ nextWindowFrom: newFrom.toISOString() }));
    const { service } = build(target, sync);

    const report = await service.run(job(), NOW, BUDGET, WINDOW_MS, RETRY);

    expect(report.commit?.status).toBe('RUNNING');
    expect(report.commit?.completedAt).toBeNull();
  });

  it.each([
    ['RATE_LIMITED', 'RATE_LIMITED'],
    ['PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE'],
    ['PERSISTENCE_UNAVAILABLE', 'PERSISTENCE_UNAVAILABLE'],
    ['SEARCH_CONTRACT_ERROR', 'SEARCH_CONTRACT_ERROR'],
    ['CORE_COVERAGE_INCOMPLETE', 'CORE_COVERAGE_INCOMPLETE'],
  ] as const)(
    'falha %s: o cursor NÃO avança e o código sanitizado fica registrado',
    async (stopReason, code) => {
      const sync = jest.fn().mockResolvedValue(
        result({
          complete: false,
          stopReason,
          nextWindowFrom: '2020-01-01T00:00:00.000Z',
        }),
      );
      const { service } = build(new Date('2026-01-01'), sync);

      const report = await service.run(job(), NOW, BUDGET, WINDOW_MS, RETRY);

      expect(report.commit?.coveredFrom).toBeNull();
      expect(report.commit?.status).toBe('RUNNING');
      expect(report.commit?.errorCode).toBe(code);
      expect(report.terminalFailure).toBe(false);
    },
  );

  it('falha com diagnóstico específico grava o failureCode no lugar do stopReason', async () => {
    const sync = jest.fn().mockResolvedValue(
      result({
        complete: false,
        stopReason: 'TERMINAL_AUTH_ERROR',
        failureCode: 'SEARCH_FORBIDDEN',
      }),
    );
    const { service } = build(new Date('2026-01-01'), sync);

    const report = await service.run(job(), NOW, BUDGET, WINDOW_MS, RETRY);

    expect(report.commit?.errorCode).toBe('SEARCH_FORBIDDEN');
    expect(report.commit?.coveredFrom).toBeNull();
  });

  it.each(['CALL_BUDGET_EXHAUSTED', 'CLAIM_BUDGET_EXHAUSTED'] as const)(
    'yield %s: sem avanço e SEM erro (orçamento não é falha)',
    async (stopReason) => {
      const sync = jest
        .fn()
        .mockResolvedValue(result({ complete: false, stopReason }));
      const { service } = build(new Date('2026-01-01'), sync);

      const report = await service.run(job(), NOW, BUDGET, WINDOW_MS, RETRY);

      expect(report.commit?.coveredFrom).toBeNull();
      expect(report.commit?.errorCode).toBeNull();
      expect(report.commit?.status).toBe('RUNNING');
      expect(report.terminalFailure).toBe(false);
    },
  );

  it('SAFETY_LIMIT_REACHED: histórico FAILED e falha terminal só dele', async () => {
    const sync = jest
      .fn()
      .mockResolvedValue(
        result({ complete: false, stopReason: 'SAFETY_LIMIT_REACHED' }),
      );
    const { service } = build(new Date('2026-01-01'), sync);

    const report = await service.run(job(), NOW, BUDGET, WINDOW_MS, RETRY);

    expect(report.terminalFailure).toBe(true);
    expect(report.commit).toMatchObject({
      status: 'FAILED',
      coveredFrom: null,
      errorCode: 'SAFETY_LIMIT_REACHED',
    });
  });

  it('defensivo: um "avanço" que não anda para trás nunca grava o cursor', async () => {
    const sync = jest
      .fn()
      .mockResolvedValue(
        result({ nextWindowFrom: COVERED_FROM.toISOString() }),
      );
    const { service } = build(new Date('2026-01-01'), sync);

    const report = await service.run(job(), NOW, BUDGET, WINDOW_MS, RETRY);

    expect(report.commit?.coveredFrom).toBeNull();
    expect(report.commit?.status).toBe('RUNNING');
  });

  it('NO_TARGET é reavaliado: com pedidos agora persistidos o histórico volta a andar', async () => {
    const target = new Date('2026-01-01T00:00:00.000Z');
    const newFrom = new Date(COVERED_FROM.getTime() - WINDOW_MS);
    const sync = jest
      .fn()
      .mockResolvedValue(result({ nextWindowFrom: newFrom.toISOString() }));
    const { service } = build(target, sync);

    const report = await service.run(
      job({ historicalStatus: 'NO_TARGET' }),
      NOW,
      BUDGET,
      WINDOW_MS,
      RETRY,
    );

    expect(sync).toHaveBeenCalledTimes(1);
    expect(report.commit?.status).toBe('RUNNING');
    expect(report.commit?.coveredFrom).toEqual(newFrom);
  });

  it('consulta o MIN(date_created) dos pedidos UMA vez por chamada (uma por tick/conta)', async () => {
    const newFrom = new Date(COVERED_FROM.getTime() - WINDOW_MS);
    const sync = jest
      .fn()
      .mockResolvedValue(result({ nextWindowFrom: newFrom.toISOString() }));
    const { service, query } = build(new Date('2026-01-01'), sync);

    await service.run(job(), NOW, BUDGET, WINDOW_MS, RETRY);

    expect(query).toHaveBeenCalledTimes(1);
  });

  describe('reabertura automática do histórico COMPLETED', () => {
    const OLD_TARGET = new Date('2026-07-15T00:00:00.000Z');
    const completedJob = (
      overrides: Partial<MarketplaceProblemsSyncJobRow> = {},
    ) =>
      job({
        historicalStatus: 'COMPLETED',
        historicalTargetFrom: OLD_TARGET,
        historicalCoveredFrom: OLD_TARGET,
        historicalCompletedAt: new Date('2026-09-01T00:00:00.000Z'),
        ...overrides,
      });
    const run = (
      service: MarketplaceProblemsHistoricalBackfillService,
      row: MarketplaceProblemsSyncJobRow,
    ) => service.run(row, NOW, BUDGET, WINDOW_MS, RETRY);

    it('continua COMPLETED (idle) quando nenhum pedido mais antigo apareceu — sem busca e sem gravação', async () => {
      const { service, query, sync } = build(OLD_TARGET);

      const report = await run(service, completedJob());

      expect(query).toHaveBeenCalledTimes(1);
      expect(sync).not.toHaveBeenCalled();
      expect(report).toEqual({
        result: null,
        commit: null,
        terminalFailure: false,
      });
    });

    it('conta que ficou sem pedidos: COMPLETED é preservado (nada é inventado nem apagado)', async () => {
      const { service, sync } = build(null);

      const report = await run(service, completedJob());

      expect(sync).not.toHaveBeenCalled();
      expect(report.commit).toBeNull();
    });

    it('pedido mais antigo que o alvo: REABRE (alvo novo, cursor preservado) e busca a partir do cursor existente', async () => {
      const newTarget = new Date('2026-06-01T00:00:00.000Z');
      const newFrom = new Date(OLD_TARGET.getTime() - WINDOW_MS);
      const sync = jest
        .fn()
        .mockResolvedValue(result({ nextWindowFrom: newFrom.toISOString() }));
      const { service } = build(newTarget, sync);

      const report = await run(service, completedJob());

      const [, window] = (
        sync.mock.calls as Array<[string, { from: Date; to: Date }]>
      )[0];
      // Continua do cursor já salvo (nunca reinicia do início da cobertura).
      expect(window.to.toISOString()).toBe(
        new Date(OLD_TARGET.getTime() + 1000).toISOString(),
      );
      expect(report.commit).toEqual({
        coveredFrom: newFrom,
        targetFrom: newTarget,
        status: 'RUNNING',
        completedAt: null,
        errorCode: null,
        attemptCount: 0,
        nextAttemptAt: null,
      });
    });

    it('reaberto e alcançando o novo alvo na mesma passada: COMPLETED de novo, com nova data de conclusão', async () => {
      const newTarget = new Date(OLD_TARGET.getTime() - 3 * DAY);
      const sync = jest
        .fn()
        .mockResolvedValue(result({ nextWindowFrom: newTarget.toISOString() }));
      const { service } = build(newTarget, sync);

      const report = await run(service, completedJob());

      expect(report.commit).toMatchObject({
        status: 'COMPLETED',
        coveredFrom: newTarget,
        targetFrom: newTarget,
        completedAt: NOW,
      });
    });

    it('reaberto com cursor já abaixo do novo alvo: conclui sem buscar', async () => {
      const newTarget = new Date(OLD_TARGET.getTime() - 3 * DAY);
      const { service, sync } = build(newTarget);

      const report = await run(
        service,
        completedJob({
          historicalCoveredFrom: new Date(newTarget.getTime() - DAY),
        }),
      );

      expect(sync).not.toHaveBeenCalled();
      expect(report.commit).toMatchObject({
        status: 'COMPLETED',
        completedAt: NOW,
      });
    });
  });

  describe('espera durável (nunca hot loop) para falha por-claim do histórico', () => {
    const failure = (stopReason: ProblemsSyncResult['stopReason']) =>
      result({ complete: false, stopReason, claimsFailed: 1 });
    const run = (
      service: MarketplaceProblemsHistoricalBackfillService,
      row: MarketplaceProblemsSyncJobRow,
    ) => service.run(row, NOW, BUDGET, WINDOW_MS, RETRY);

    it('CORE_COVERAGE_INCOMPLETE agenda backoff exponencial durável e não avança o cursor', async () => {
      const sync = jest
        .fn()
        .mockResolvedValue(failure('CORE_COVERAGE_INCOMPLETE'));
      const { service } = build(new Date('2026-01-01'), sync);

      const first = await run(service, job());
      expect(first.commit).toMatchObject({
        coveredFrom: null,
        errorCode: 'CORE_COVERAGE_INCOMPLETE',
        attemptCount: 1,
        nextAttemptAt: new Date(NOW.getTime() + 1000),
      });

      const third = await run(service, job({ historicalAttemptCount: 2 }));
      expect(third.commit?.attemptCount).toBe(3);
      expect(third.commit?.nextAttemptAt).toEqual(
        new Date(NOW.getTime() + 4000),
      );

      const capped = await run(service, job({ historicalAttemptCount: 30 }));
      expect(capped.commit?.nextAttemptAt).toEqual(
        new Date(NOW.getTime() + 8000),
      );
    });

    it('enquanto a espera não vence: nada roda (nem consulta de pedidos, nem busca) — sem retry a cada tick', async () => {
      const { service, query, sync } = build(new Date('2026-01-01'));

      const report = await run(
        service,
        job({
          historicalAttemptCount: 3,
          historicalNextAttemptAt: new Date(NOW.getTime() + 1),
        }),
      );

      expect(report).toEqual({
        result: null,
        commit: null,
        terminalFailure: false,
      });
      expect(query).not.toHaveBeenCalled();
      expect(sync).not.toHaveBeenCalled();
    });

    it('espera vencida: volta a tentar; o sucesso limpa tentativas e espera', async () => {
      const newFrom = new Date(COVERED_FROM.getTime() - WINDOW_MS);
      const sync = jest
        .fn()
        .mockResolvedValue(result({ nextWindowFrom: newFrom.toISOString() }));
      const { service } = build(new Date('2026-01-01'), sync);

      const report = await run(
        service,
        job({ historicalAttemptCount: 3, historicalNextAttemptAt: NOW }),
      );

      expect(sync).toHaveBeenCalledTimes(1);
      expect(report.commit).toMatchObject({
        coveredFrom: newFrom,
        errorCode: null,
        attemptCount: 0,
        nextAttemptAt: null,
      });
    });

    it('falhas globais (rate limit) NÃO usam a espera do histórico — o backoff é do job', async () => {
      const sync = jest.fn().mockResolvedValue(failure('RATE_LIMITED'));
      const { service } = build(new Date('2026-01-01'), sync);

      const report = await run(service, job());

      expect(report.commit).toMatchObject({
        attemptCount: 0,
        nextAttemptAt: null,
      });
    });
  });
});
