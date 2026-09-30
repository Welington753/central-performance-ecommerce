import type { MarketplaceProblemsSyncJobRow } from './marketplace-problems-sync-jobs.types';
import type { ProblemsSyncResult } from './mercado-livre-problems-sync.types';
import { ProblemsSyncError } from './mercado-livre-problems-sync-preflight.util';
import { MarketplaceProblemsSyncTickService } from './marketplace-problems-sync-tick.service';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const CURSOR = new Date('2026-06-15T11:00:00.000Z');

function job(
  overrides: Partial<MarketplaceProblemsSyncJobRow> = {},
): MarketplaceProblemsSyncJobRow {
  return {
    id: 'job-1',
    marketplaceAccountId: 'acc-1',
    status: 'RUNNING',
    windowCursorAt: CURSOR,
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
    retryAfterMs: null,
    coverageFrom: null,
    claimsFound: 0,
    claimsProcessed: 0,
    claimsCoreCovered: 0,
    claimsPersisted: 0,
    claimsPreserved: 0,
    claimsFailed: 0,
    detailFailures: 0,
    reputationFailures: 0,
    reasonLookupFailures: 0,
    reasonCacheRefreshed: 0,
    httpCallsMade: 0,
    pagesFetched: 0,
    nextWindowFrom: null,
    ...overrides,
  };
}

const CONFIG = {
  tickMaxClaims: 50,
  tickMaxHttpCalls: 300,
  refreshBatchSize: 20,
  censusIntervalMs: 6 * 60 * 60 * 1000,
};

function build(
  sync: Partial<{
    syncCreationWindow: jest.Mock;
    censusOpenClaims: jest.Mock;
    refreshNonTerminalBatch: jest.Mock;
  }> = {},
) {
  const service = {
    syncCreationWindow: jest.fn().mockResolvedValue(result()),
    censusOpenClaims: jest.fn().mockResolvedValue(result()),
    refreshNonTerminalBatch: jest.fn().mockResolvedValue(result()),
    ...sync,
  };
  return {
    service,
    tick: new MarketplaceProblemsSyncTickService(service as never),
  };
}

describe('MarketplaceProblemsSyncTickService', () => {
  it('roda criação, depois censo, depois refresh, com o orçamento GLOBAL descontado a cada etapa', async () => {
    const { service, tick } = build({
      syncCreationWindow: jest.fn().mockResolvedValue(
        result({
          claimsFound: 10,
          claimsProcessed: 10,
          claimsPersisted: 9,
          httpCallsMade: 40,
          nextWindowFrom: '2026-06-15T11:59:59.000Z',
        }),
      ),
      censusOpenClaims: jest
        .fn()
        .mockResolvedValue(
          result({ claimsFound: 5, claimsProcessed: 5, httpCallsMade: 30 }),
        ),
    });

    const report = await tick.runTick(job(), NOW, CONFIG);

    expect(service.syncCreationWindow).toHaveBeenCalledWith(
      'acc-1',
      { from: CURSOR, to: NOW },
      { maxClaims: 50, maxHttpCalls: 300 },
    );
    expect(service.censusOpenClaims).toHaveBeenCalledWith(
      'acc-1',
      'opened',
      null,
      { maxClaims: 40, maxHttpCalls: 260 },
    );
    expect(service.refreshNonTerminalBatch).toHaveBeenCalledWith('acc-1', 20, {
      maxClaims: 35,
      maxHttpCalls: 230,
    });
    // Ordem das chamadas: criação -> censo -> refresh.
    const order = [
      service.syncCreationWindow.mock.invocationCallOrder[0],
      service.censusOpenClaims.mock.invocationCallOrder[0],
      service.refreshNonTerminalBatch.mock.invocationCallOrder[0],
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(report.stopReason).toBe('COMPLETED');
    expect(report.claimsProcessed).toBe(15);
    expect(report.claimsPersisted).toBe(9);
    expect(report.callsMade).toBe(70);
    expect(report.censusCompletedInFull).toBe(true);
  });

  it('nunca reinicia o orçamento: a etapa seguinte só recebe o que sobrou', async () => {
    const { service, tick } = build({
      syncCreationWindow: jest
        .fn()
        .mockResolvedValue(result({ claimsFound: 50, httpCallsMade: 100 })),
    });
    await tick.runTick(job({ lastCompleteCensusAt: NOW }), NOW, CONFIG);
    // Criação consumiu TODOS os claims: censo (fora de cadência) e refresh não rodam.
    expect(service.censusOpenClaims).not.toHaveBeenCalled();
    expect(service.refreshNonTerminalBatch).not.toHaveBeenCalled();
  });

  it('etapa sem orçamento restante é PULADA (não é falha) — resultado continua COMPLETED', async () => {
    const { service, tick } = build({
      syncCreationWindow: jest
        .fn()
        .mockResolvedValue(result({ claimsFound: 3, httpCallsMade: 300 })),
    });
    const report = await tick.runTick(job(), NOW, CONFIG);
    expect(service.censusOpenClaims).not.toHaveBeenCalled();
    expect(service.refreshNonTerminalBatch).not.toHaveBeenCalled();
    expect(report.stopReason).toBe('COMPLETED');
    expect(report.thrownCode).toBeNull();
  });

  it.each([
    'CORE_COVERAGE_INCOMPLETE',
    'RATE_LIMITED',
    'PROVIDER_UNAVAILABLE',
    'PERSISTENCE_UNAVAILABLE',
    'SEARCH_CONTRACT_ERROR',
    'TERMINAL_AUTH_ERROR',
    'SAFETY_LIMIT_REACHED',
  ] as const)(
    'criação com %s interrompe o tick: censo e refresh não rodam, cursor não avança',
    async (stopReason) => {
      const { service, tick } = build({
        syncCreationWindow: jest.fn().mockResolvedValue(
          result({
            complete: false,
            stopReason,
            retryAfterMs: stopReason === 'RATE_LIMITED' ? 7000 : null,
            // O CP2-B devolve o mesmo `from` quando não avança.
            nextWindowFrom: CURSOR.toISOString(),
            httpCallsMade: 4,
          }),
        ),
      });
      const report = await tick.runTick(job(), NOW, CONFIG);
      expect(service.censusOpenClaims).not.toHaveBeenCalled();
      expect(service.refreshNonTerminalBatch).not.toHaveBeenCalled();
      expect(report.stopReason).toBe(stopReason);
      expect(report.creationCursorAdvancedTo).toBeNull();
      expect(report.callsMade).toBe(4);
      expect(report.retryAfterMs).toBe(
        stopReason === 'RATE_LIMITED' ? 7000 : null,
      );
    },
  );

  it('cursor avança em sucesso de criação (nextWindowFrom do CP2-B, já com sobreposição)', async () => {
    const { tick } = build({
      syncCreationWindow: jest
        .fn()
        .mockResolvedValue(
          result({ nextWindowFrom: '2026-06-15T11:59:59.000Z' }),
        ),
    });
    const report = await tick.runTick(job(), NOW, CONFIG);
    expect(report.creationCursorAdvancedTo).toEqual(
      new Date('2026-06-15T11:59:59.000Z'),
    );
  });

  it('cursor NÃO avança se o CP2-B devolver um valor que não é posterior ao atual', async () => {
    const { tick } = build({
      syncCreationWindow: jest
        .fn()
        .mockResolvedValue(result({ nextWindowFrom: CURSOR.toISOString() })),
    });
    expect(
      (await tick.runTick(job(), NOW, CONFIG)).creationCursorAdvancedTo,
    ).toBeNull();
  });

  it('falha de enriquecimento na criação não bloqueia progresso (COMPLETED com detailFailures)', async () => {
    const { service, tick } = build({
      syncCreationWindow: jest.fn().mockResolvedValue(
        result({
          detailFailures: 2,
          reputationFailures: 1,
          reasonLookupFailures: 1,
          nextWindowFrom: '2026-06-15T11:59:59.000Z',
        }),
      ),
    });
    const report = await tick.runTick(job(), NOW, CONFIG);
    expect(report.creationCursorAdvancedTo).not.toBeNull();
    expect(service.refreshNonTerminalBatch).toHaveBeenCalled();
  });

  it('censo respeita a cadência: pula se rodou dentro do intervalo, roda se nunca rodou ou se venceu', async () => {
    const recent = new Date(NOW.getTime() - 60_000);
    const old = new Date(NOW.getTime() - CONFIG.censusIntervalMs);

    const a = build();
    await a.tick.runTick(job({ lastCompleteCensusAt: recent }), NOW, CONFIG);
    expect(a.service.censusOpenClaims).not.toHaveBeenCalled();

    const b = build();
    await b.tick.runTick(job({ lastCompleteCensusAt: old }), NOW, CONFIG);
    expect(b.service.censusOpenClaims).toHaveBeenCalledTimes(1);

    const c = build();
    await c.tick.runTick(job({ lastCompleteCensusAt: null }), NOW, CONFIG);
    expect(c.service.censusOpenClaims).toHaveBeenCalledTimes(1);

    const d = build();
    await d.tick.runTick(job({ lastCompleteCensusAt: recent }), NOW, {
      ...CONFIG,
      censusIntervalMs: 0,
    });
    expect(d.service.censusOpenClaims).toHaveBeenCalledTimes(1);
  });

  describe('yield de orçamento da CRIAÇÃO', () => {
    const creationYield = (
      stopReason: 'CALL_BUDGET_EXHAUSTED' | 'CLAIM_BUDGET_EXHAUSTED',
      httpCallsMade = 2,
    ) =>
      jest.fn().mockResolvedValue(
        result({
          complete: false,
          stopReason,
          httpCallsMade,
          // O CP2-B devolve o mesmo `from` quando a janela não avança.
          nextWindowFrom: CURSOR.toISOString(),
        }),
      );

    it.each(['CALL_BUDGET_EXHAUSTED', 'CLAIM_BUDGET_EXHAUSTED'] as const)(
      '%s: cursor não avança, censo NÃO é chamado, refresh roda com o orçamento restante e o yield é preservado',
      async (stopReason) => {
        const { service, tick } = build({
          syncCreationWindow: creationYield(stopReason, 2),
          refreshNonTerminalBatch: jest.fn().mockResolvedValue(
            result({
              claimsFound: 4,
              claimsProcessed: 4,
              claimsPersisted: 3,
              claimsFailed: 1,
              httpCallsMade: 12,
            }),
          ),
        });
        const report = await tick.runTick(job(), NOW, CONFIG);
        expect(report.creationCursorAdvancedTo).toBeNull();
        expect(service.censusOpenClaims).not.toHaveBeenCalled();
        expect(service.refreshNonTerminalBatch).toHaveBeenCalledWith(
          'acc-1',
          20,
          { maxClaims: 50, maxHttpCalls: 298 },
        );
        expect(report.stopReason).toBe(stopReason);
        expect(report.thrownCode).toBeNull();
        expect(report.censusCompletedInFull).toBe(false);
        expect(report.claimsProcessed).toBe(4);
        expect(report.claimsPersisted).toBe(3);
        expect(report.claimsFailed).toBe(1);
        expect(report.callsMade).toBe(14);
      },
    );

    it('sem orçamento restante: finaliza normalmente, sem refresh nem censo', async () => {
      const { service, tick } = build({
        syncCreationWindow: creationYield('CALL_BUDGET_EXHAUSTED', 300),
      });
      const report = await tick.runTick(job(), NOW, CONFIG);
      expect(service.refreshNonTerminalBatch).not.toHaveBeenCalled();
      expect(service.censusOpenClaims).not.toHaveBeenCalled();
      expect(report.stopReason).toBe('CALL_BUDGET_EXHAUSTED');
      expect(report.creationCursorAdvancedTo).toBeNull();
    });

    it('falha do refresh prevalece sobre o yield da criação', async () => {
      const { tick } = build({
        syncCreationWindow: creationYield('CLAIM_BUDGET_EXHAUSTED'),
        refreshNonTerminalBatch: jest
          .fn()
          .mockResolvedValue(
            result({ complete: false, stopReason: 'PROVIDER_UNAVAILABLE' }),
          ),
      });
      const report = await tick.runTick(job(), NOW, CONFIG);
      expect(report.stopReason).toBe('PROVIDER_UNAVAILABLE');
    });

    it('refresh lançando erro depois do yield também prevalece (thrownCode)', async () => {
      const { tick } = build({
        syncCreationWindow: creationYield('CALL_BUDGET_EXHAUSTED'),
        refreshNonTerminalBatch: jest
          .fn()
          .mockRejectedValue(new ProblemsSyncError('TOKEN_EXPIRED')),
      });
      const report = await tick.runTick(job(), NOW, CONFIG);
      expect(report.thrownCode).toBe('TOKEN_EXPIRED');
    });
  });

  it('censo NUNCA recebe o window_cursor_at como coverageFrom (sempre null, all-or-nothing do CP2-B)', async () => {
    const { service, tick } = build();
    await tick.runTick(job({ windowCursorAt: CURSOR }), NOW, CONFIG);
    const args = service.censusOpenClaims.mock.calls[0] as unknown[];
    expect(args[2]).toBeNull();
  });

  it.each(['CALL_BUDGET_EXHAUSTED', 'CLAIM_BUDGET_EXHAUSTED'] as const)(
    'censo com %s é yield normal: NÃO marca censo completo, o refresh AINDA roda com o orçamento restante e o stopReason do yield é preservado',
    async (stopReason) => {
      const { service, tick } = build({
        censusOpenClaims: jest
          .fn()
          .mockResolvedValue(
            result({ complete: false, stopReason, httpCallsMade: 1 }),
          ),
        refreshNonTerminalBatch: jest.fn().mockResolvedValue(
          result({
            claimsFound: 4,
            claimsProcessed: 4,
            claimsPersisted: 3,
            claimsFailed: 1,
            httpCallsMade: 12,
          }),
        ),
      });
      const report = await tick.runTick(job(), NOW, CONFIG);
      // Orçamento global: census gastou 1 chamada (probe); refresh recebe o resto.
      expect(service.refreshNonTerminalBatch).toHaveBeenCalledWith(
        'acc-1',
        20,
        {
          maxClaims: 50,
          maxHttpCalls: 299,
        },
      );
      expect(report.censusCompletedInFull).toBe(false);
      expect(report.stopReason).toBe(stopReason);
      expect(report.thrownCode).toBeNull();
      // Contadores do refresh entram no commit.
      expect(report.claimsProcessed).toBe(4);
      expect(report.claimsPersisted).toBe(3);
      expect(report.claimsFailed).toBe(1);
      expect(report.callsMade).toBe(13);
    },
  );

  it('yield do censo sem orçamento restante: refresh é pulado e o yield é o resultado final', async () => {
    const { service, tick } = build({
      censusOpenClaims: jest.fn().mockResolvedValue(
        result({
          complete: false,
          stopReason: 'CALL_BUDGET_EXHAUSTED',
          httpCallsMade: 300,
        }),
      ),
    });
    const report = await tick.runTick(job(), NOW, CONFIG);
    expect(service.refreshNonTerminalBatch).not.toHaveBeenCalled();
    expect(report.stopReason).toBe('CALL_BUDGET_EXHAUSTED');
    expect(report.censusCompletedInFull).toBe(false);
  });

  it('falha do refresh depois de yield do censo prevalece sobre o yield', async () => {
    const { tick } = build({
      censusOpenClaims: jest
        .fn()
        .mockResolvedValue(
          result({ complete: false, stopReason: 'CLAIM_BUDGET_EXHAUSTED' }),
        ),
      refreshNonTerminalBatch: jest
        .fn()
        .mockResolvedValue(
          result({ complete: false, stopReason: 'PROVIDER_UNAVAILABLE' }),
        ),
    });
    const report = await tick.runTick(job(), NOW, CONFIG);
    expect(report.stopReason).toBe('PROVIDER_UNAVAILABLE');
  });

  it.each([
    'SAFETY_LIMIT_REACHED',
    'RATE_LIMITED',
    'PROVIDER_UNAVAILABLE',
    'PERSISTENCE_UNAVAILABLE',
    'SEARCH_CONTRACT_ERROR',
    'CORE_COVERAGE_INCOMPLETE',
    'TERMINAL_AUTH_ERROR',
  ] as const)(
    'censo com %s interrompe o tick (sem refresh) e NUNCA marca censo completo',
    async (stopReason) => {
      const { service, tick } = build({
        censusOpenClaims: jest
          .fn()
          .mockResolvedValue(result({ complete: false, stopReason })),
      });
      const report = await tick.runTick(job(), NOW, CONFIG);
      expect(service.refreshNonTerminalBatch).not.toHaveBeenCalled();
      expect(report.stopReason).toBe(stopReason);
      expect(report.censusCompletedInFull).toBe(false);
    },
  );

  it('censo lançando erro (pré-voo) não marca censo completo', async () => {
    const { tick } = build({
      censusOpenClaims: jest
        .fn()
        .mockRejectedValue(new ProblemsSyncError('ACCOUNT_BUSY')),
    });
    const report = await tick.runTick(job(), NOW, CONFIG);
    expect(report.censusCompletedInFull).toBe(false);
    expect(report.thrownCode).toBe('ACCOUNT_BUSY');
  });

  it('censo COMPLETED marca censo completo', async () => {
    const { tick } = build();
    const report = await tick.runTick(job(), NOW, CONFIG);
    expect(report.censusCompletedInFull).toBe(true);
  });

  it('refresh não usa cursor persistido: só batchSize e orçamento', async () => {
    const { service, tick } = build();
    await tick.runTick(job({ lastCompleteCensusAt: NOW }), NOW, CONFIG);
    const args = (service.refreshNonTerminalBatch.mock.calls as unknown[][])[0];
    expect(args).toHaveLength(3);
    expect(args[1]).toBe(20);
  });

  it('cursor >= now (relógio adiantado) pula a criação sem erro', async () => {
    const { service, tick } = build();
    const report = await tick.runTick(
      job({ windowCursorAt: new Date(NOW.getTime() + 1000) }),
      NOW,
      CONFIG,
    );
    expect(service.syncCreationWindow).not.toHaveBeenCalled();
    expect(report.stopReason).toBe('COMPLETED');
  });

  it('ProblemsSyncError do pré-voo vira thrownCode e preserva o progresso das etapas anteriores', async () => {
    const { tick } = build({
      syncCreationWindow: jest.fn().mockResolvedValue(
        result({
          nextWindowFrom: '2026-06-15T11:59:59.000Z',
          httpCallsMade: 5,
        }),
      ),
      censusOpenClaims: jest
        .fn()
        .mockRejectedValue(new ProblemsSyncError('TOKEN_EXPIRED')),
    });
    const report = await tick.runTick(job(), NOW, CONFIG);
    expect(report.thrownCode).toBe('TOKEN_EXPIRED');
    expect(report.creationCursorAdvancedTo).not.toBeNull();
    expect(report.callsMade).toBe(5);
  });

  it('erro inesperado vira SYNC_FAILED sem vazar a mensagem', async () => {
    const { tick } = build({
      syncCreationWindow: jest
        .fn()
        .mockRejectedValue(new Error('Bearer APP_USR-123 quebrou')),
    });
    const report = await tick.runTick(job(), NOW, CONFIG);
    expect(report.thrownCode).toBe('SYNC_FAILED');
    expect(JSON.stringify(report)).not.toContain('APP_USR');
  });
});
