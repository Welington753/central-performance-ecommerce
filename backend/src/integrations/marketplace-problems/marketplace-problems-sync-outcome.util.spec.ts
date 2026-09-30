import type { MarketplaceProblemsSyncJobRow } from './marketplace-problems-sync-jobs.types';
import type { ProblemsSyncTickReport } from './marketplace-problems-sync-tick.service';
import type { ProblemsSyncWorkerConfig } from './marketplace-problems-sync-worker-config.util';
import { buildCommitUpdate } from './marketplace-problems-sync-outcome.util';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const CURSOR = new Date('2026-06-15T11:00:00.000Z');

const CONFIG: ProblemsSyncWorkerConfig = {
  enabled: true,
  tickMs: 10000,
  maxConcurrentJobs: 2,
  leaseMs: 300000,
  maxAttempts: 3,
  retryBaseMs: 1000,
  retryMaxMs: 8000,
  requeueDelayMs: 5000,
  rateLimitBackoffMs: 60000,
  syncIntervalMs: 30000,
  censusIntervalMs: 0,
  tickMaxClaims: 50,
  tickMaxHttpCalls: 300,
  refreshBatchSize: 20,
};

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

function report(
  overrides: Partial<ProblemsSyncTickReport> = {},
): ProblemsSyncTickReport {
  return {
    stopReason: 'COMPLETED',
    retryAfterMs: null,
    thrownCode: null,
    failureCode: null,
    creationCursorAdvancedTo: null,
    censusCompletedInFull: false,
    claimsProcessed: 0,
    claimsPersisted: 0,
    claimsFailed: 0,
    callsMade: 0,
    ...overrides,
  };
}

const at = (ms: number) => new Date(NOW.getTime() + ms);

describe('buildCommitUpdate', () => {
  describe('sucesso e yield normal', () => {
    it('COMPLETED: RUNNING, attempt_count=0, próxima execução em syncIntervalMs, sem erro', () => {
      const update = buildCommitUpdate(
        job({ attemptCount: 2, lastErrorCode: 'PROVIDER_UNAVAILABLE' }),
        report({ claimsProcessed: 4, claimsPersisted: 3, callsMade: 12 }),
        NOW,
        CONFIG,
      );
      expect(update).toMatchObject({
        status: 'RUNNING',
        attemptCount: 0,
        lastErrorCode: null,
        claimsProcessedDelta: 4,
        claimsPersistedDelta: 3,
        callsMadeDelta: 12,
        lastActivityAt: NOW,
      });
      expect(update.nextAttemptAt).toEqual(at(30000));
    });

    it('cursor avança para o valor do relatório; sem avanço, ecoa o anterior', () => {
      const advanced = new Date('2026-06-15T11:59:59.000Z');
      expect(
        buildCommitUpdate(
          job(),
          report({ creationCursorAdvancedTo: advanced }),
          NOW,
          CONFIG,
        ).windowCursorAt,
      ).toEqual(advanced);
      expect(
        buildCommitUpdate(job(), report(), NOW, CONFIG).windowCursorAt,
      ).toEqual(CURSOR);
    });

    it('backlog (cursor ainda longe de now) agenda o próximo tick IMEDIATAMENTE', () => {
      const update = buildCommitUpdate(
        job(),
        report({
          creationCursorAdvancedTo: new Date(NOW.getTime() - 3_600_000),
        }),
        NOW,
        CONFIG,
      );
      expect(update.nextAttemptAt).toEqual(NOW);
    });

    it('lastCompleteCensusAt só é gravado quando o censo completou', () => {
      expect(
        buildCommitUpdate(
          job(),
          report({ censusCompletedInFull: true }),
          NOW,
          CONFIG,
        ).lastCompleteCensusAt,
      ).toEqual(NOW);
      expect(
        buildCommitUpdate(job(), report(), NOW, CONFIG).lastCompleteCensusAt,
      ).toBeNull();
    });

    it.each(['CALL_BUDGET_EXHAUSTED', 'CLAIM_BUDGET_EXHAUSTED'] as const)(
      '%s é yield normal: RUNNING, attempt_count=0, intervalo normal, sem erro',
      (stopReason) => {
        const update = buildCommitUpdate(
          job({ attemptCount: 2 }),
          report({ stopReason }),
          NOW,
          CONFIG,
        );
        expect(update.status).toBe('RUNNING');
        expect(update.attemptCount).toBe(0);
        expect(update.nextAttemptAt).toEqual(at(CONFIG.syncIntervalMs));
        expect(update.lastErrorCode).toBeNull();
      },
    );
  });

  describe('censo: yield e cobertura', () => {
    it.each(['CALL_BUDGET_EXHAUSTED', 'CLAIM_BUDGET_EXHAUSTED'] as const)(
      'yield do CENSO (%s): RUNNING, attempt_count=0, stopReason sem erro e próximo tick no intervalo NORMAL (sem hot loop)',
      (stopReason) => {
        const update = buildCommitUpdate(
          job({ attemptCount: 2 }),
          report({
            stopReason,
            claimsProcessed: 3,
            claimsPersisted: 3,
            callsMade: 9,
          }),
          NOW,
          CONFIG,
        );
        expect(update.status).toBe('RUNNING');
        expect(update.attemptCount).toBe(0);
        expect(update.lastErrorCode).toBeNull();
        expect(update.nextAttemptAt).toEqual(at(CONFIG.syncIntervalMs));
        // Contadores do refresh feito depois do yield entram no commit.
        expect(update.claimsProcessedDelta).toBe(3);
        expect(update.callsMadeDelta).toBe(9);
        // Censo incompleto nunca declara cobertura.
        expect(update.lastCompleteCensusAt).toBeNull();
      },
    );

    it.each(['CALL_BUDGET_EXHAUSTED', 'CLAIM_BUDGET_EXHAUSTED'] as const)(
      'yield da CRIAÇÃO (%s) sem avanço do cursor: intervalo normal, cursor mantido, attempt_count=0 (sem hot loop)',
      (stopReason) => {
        const update = buildCommitUpdate(
          job({ attemptCount: 2 }),
          report({ stopReason, creationCursorAdvancedTo: null }),
          NOW,
          CONFIG,
        );
        expect(update.status).toBe('RUNNING');
        expect(update.attemptCount).toBe(0);
        expect(update.windowCursorAt).toEqual(CURSOR);
        expect(update.nextAttemptAt).toEqual(at(CONFIG.syncIntervalMs));
        expect(update.lastErrorCode).toBeNull();
      },
    );

    it('last_census_at só é gravado com censo completo e bem-sucedido; falhas/safety limit/auth nunca gravam', () => {
      expect(
        buildCommitUpdate(
          job(),
          report({ censusCompletedInFull: true }),
          NOW,
          CONFIG,
        ).lastCompleteCensusAt,
      ).toEqual(NOW);
      for (const partial of [
        { stopReason: 'SAFETY_LIMIT_REACHED' as const },
        { stopReason: 'PROVIDER_UNAVAILABLE' as const },
        { stopReason: 'PERSISTENCE_UNAVAILABLE' as const },
        { stopReason: 'CORE_COVERAGE_INCOMPLETE' as const },
        { stopReason: 'RATE_LIMITED' as const, retryAfterMs: 1000 },
        { stopReason: 'TERMINAL_AUTH_ERROR' as const },
        { thrownCode: 'SYNC_FAILED' as const },
      ]) {
        expect(
          buildCommitUpdate(job(), report(partial), NOW, CONFIG)
            .lastCompleteCensusAt,
        ).toBeNull();
      }
    });
  });

  describe('auth terminal', () => {
    it.each([
      [{ stopReason: 'TERMINAL_AUTH_ERROR' as const }, 'TERMINAL_AUTH_ERROR'],
      [{ thrownCode: 'TOKEN_EXPIRED' as const }, 'TOKEN_EXPIRED'],
      [
        { thrownCode: 'ACCOUNT_NOT_CONNECTED' as const },
        'ACCOUNT_NOT_CONNECTED',
      ],
    ])('%p -> FAILED_AUTH sem retry automático (%s)', (partial, code) => {
      const update = buildCommitUpdate(
        job({ attemptCount: 1 }),
        report(partial),
        NOW,
        CONFIG,
      );
      expect(update.status).toBe('FAILED_AUTH');
      expect(update.lastErrorCode).toBe(code);
      expect(update.attemptCount).toBe(1);
    });

    it.each([
      'SEARCH_UNAUTHORIZED',
      'SEARCH_FORBIDDEN',
      'CORE_UNAUTHORIZED',
      'DETAIL_UNAUTHORIZED',
      'REPUTATION_UNAUTHORIZED',
      'REASON_UNAUTHORIZED',
    ] as const)(
      'TERMINAL_AUTH_ERROR com diagnóstico %s: FAILED_AUTH grava o código específico e mantém o cursor',
      (failureCode) => {
        const update = buildCommitUpdate(
          job({ attemptCount: 0 }),
          report({ stopReason: 'TERMINAL_AUTH_ERROR', failureCode }),
          NOW,
          CONFIG,
        );
        expect(update.status).toBe('FAILED_AUTH');
        expect(update.lastErrorCode).toBe(failureCode);
        expect(update.attemptCount).toBe(0);
        expect(update.windowCursorAt).toEqual(CURSOR);
      },
    );
  });

  describe('403 em fetch_core (CORE_FORBIDDEN)', () => {
    it('cobertura incompleta: WAITING_RETRY retomável, nunca FAILED_AUTH, cursor mantido e código específico', () => {
      const update = buildCommitUpdate(
        job({ attemptCount: 0 }),
        report({
          stopReason: 'CORE_COVERAGE_INCOMPLETE',
          failureCode: 'CORE_FORBIDDEN',
          claimsPersisted: 3,
        }),
        NOW,
        CONFIG,
      );
      expect(update.status).toBe('WAITING_RETRY');
      expect(update.lastErrorCode).toBe('CORE_FORBIDDEN');
      expect(update.attemptCount).toBe(1);
      expect(update.windowCursorAt).toEqual(CURSOR);
      expect(update.claimsPersistedDelta).toBe(3);
    });

    it('diagnóstico nunca vaza em sucesso/yield', () => {
      for (const stopReason of [
        'COMPLETED',
        'CALL_BUDGET_EXHAUSTED',
      ] as const) {
        expect(
          buildCommitUpdate(
            job(),
            report({ stopReason, failureCode: 'CORE_FORBIDDEN' }),
            NOW,
            CONFIG,
          ).lastErrorCode,
        ).toBeNull();
      }
    });
  });

  describe('retry com backoff e attempt_count', () => {
    it('falha transitória incrementa attempt_count EXATAMENTE uma vez e usa backoff exponencial', () => {
      const first = buildCommitUpdate(
        job({ attemptCount: 0 }),
        report({ stopReason: 'PROVIDER_UNAVAILABLE' }),
        NOW,
        CONFIG,
      );
      expect(first).toMatchObject({
        status: 'WAITING_RETRY',
        attemptCount: 1,
        lastErrorCode: 'PROVIDER_UNAVAILABLE',
      });
      expect(first.nextAttemptAt).toEqual(at(1000));

      const second = buildCommitUpdate(
        job({ attemptCount: 1 }),
        report({ stopReason: 'PROVIDER_UNAVAILABLE' }),
        NOW,
        CONFIG,
      );
      expect(second.attemptCount).toBe(2);
      expect(second.nextAttemptAt).toEqual(at(2000));
    });

    it('backoff é limitado por retryMaxMs', () => {
      const update = buildCommitUpdate(
        job({ attemptCount: 1 }),
        report({ stopReason: 'PROVIDER_UNAVAILABLE' }),
        NOW,
        { ...CONFIG, maxAttempts: 99, retryBaseMs: 5000, retryMaxMs: 8000 },
      );
      expect(update.nextAttemptAt).toEqual(at(8000));
    });

    it.each([
      'PROVIDER_UNAVAILABLE',
      'PERSISTENCE_UNAVAILABLE',
      'SEARCH_CONTRACT_ERROR',
      'CORE_COVERAGE_INCOMPLETE',
    ] as const)('%s é transitório e mantém o cursor', (stopReason) => {
      const update = buildCommitUpdate(
        job(),
        report({ stopReason }),
        NOW,
        CONFIG,
      );
      expect(update.status).toBe('WAITING_RETRY');
      expect(update.attemptCount).toBe(1);
      expect(update.windowCursorAt).toEqual(CURSOR);
      expect(update.lastErrorCode).toBe(stopReason);
    });

    it('erro inesperado (SYNC_FAILED) é transitório', () => {
      const update = buildCommitUpdate(
        job(),
        report({ thrownCode: 'SYNC_FAILED' }),
        NOW,
        CONFIG,
      );
      expect(update.status).toBe('WAITING_RETRY');
      expect(update.lastErrorCode).toBe('SYNC_FAILED');
    });

    it('ao atingir MAX_ATTEMPTS vira FAILED', () => {
      const update = buildCommitUpdate(
        job({ attemptCount: 2 }),
        report({ stopReason: 'PROVIDER_UNAVAILABLE' }),
        NOW,
        CONFIG,
      );
      expect(update.status).toBe('FAILED');
      expect(update.attemptCount).toBe(3);
      expect(update.lastErrorCode).toBe('PROVIDER_UNAVAILABLE');
    });

    it('rate limit usa retryAfterMs do provedor e incrementa uma vez', () => {
      const update = buildCommitUpdate(
        job(),
        report({ stopReason: 'RATE_LIMITED', retryAfterMs: 12345 }),
        NOW,
        CONFIG,
      );
      expect(update.status).toBe('WAITING_RETRY');
      expect(update.attemptCount).toBe(1);
      expect(update.nextAttemptAt).toEqual(at(12345));
    });

    it.each([null, 0, -5, NaN])(
      'rate limit com retryAfterMs=%p usa o fallback configurável',
      (retryAfterMs) => {
        const update = buildCommitUpdate(
          job(),
          report({ stopReason: 'RATE_LIMITED', retryAfterMs }),
          NOW,
          CONFIG,
        );
        expect(update.nextAttemptAt).toEqual(at(60000));
      },
    );

    it('rate limit também respeita MAX_ATTEMPTS', () => {
      const update = buildCommitUpdate(
        job({ attemptCount: 2 }),
        report({ stopReason: 'RATE_LIMITED', retryAfterMs: 1000 }),
        NOW,
        CONFIG,
      );
      expect(update.status).toBe('FAILED');
    });
  });

  describe('requeue OAuth', () => {
    it.each(['ACCOUNT_BUSY', 'TOKEN_REFRESH_PENDING'] as const)(
      '%s reagenda SEM incrementar tentativa',
      (thrownCode) => {
        const update = buildCommitUpdate(
          job({ attemptCount: 2 }),
          report({ thrownCode }),
          NOW,
          CONFIG,
        );
        expect(update.status).toBe('WAITING_RETRY');
        expect(update.attemptCount).toBe(2);
        expect(update.nextAttemptAt).toEqual(at(5000));
        expect(update.lastErrorCode).toBe(thrownCode);
      },
    );

    it('requeue nunca leva a FAILED, mesmo com attempt_count já no limite', () => {
      const update = buildCommitUpdate(
        job({ attemptCount: 99 }),
        report({ thrownCode: 'ACCOUNT_BUSY' }),
        NOW,
        CONFIG,
      );
      expect(update.status).toBe('WAITING_RETRY');
    });
  });

  describe('falhas terminais explícitas', () => {
    it('SAFETY_LIMIT_REACHED falha de forma explícita (nunca finge cobertura) e mantém o cursor', () => {
      const update = buildCommitUpdate(
        job(),
        report({ stopReason: 'SAFETY_LIMIT_REACHED' }),
        NOW,
        CONFIG,
      );
      expect(update.status).toBe('FAILED');
      expect(update.lastErrorCode).toBe('SAFETY_LIMIT_REACHED');
      expect(update.windowCursorAt).toEqual(CURSOR);
    });

    it.each([
      'ML_APP_CONFIGURATION_ERROR',
      'CREDENTIAL_DECRYPTION_FAILED',
    ] as const)('%s é terminal (FAILED, exige correção)', (thrownCode) => {
      const update = buildCommitUpdate(
        job(),
        report({ thrownCode }),
        NOW,
        CONFIG,
      );
      expect(update.status).toBe('FAILED');
      expect(update.lastErrorCode).toBe(thrownCode);
    });
  });

  it('falha depois de progresso preserva cursor avançado e contadores', () => {
    const advanced = new Date('2026-06-15T11:59:59.000Z');
    const update = buildCommitUpdate(
      job(),
      report({
        stopReason: 'PROVIDER_UNAVAILABLE',
        creationCursorAdvancedTo: advanced,
        claimsProcessed: 7,
        callsMade: 21,
      }),
      NOW,
      CONFIG,
    );
    expect(update.windowCursorAt).toEqual(advanced);
    expect(update.claimsProcessedDelta).toBe(7);
    expect(update.callsMadeDelta).toBe(21);
  });

  it('thrownCode tem precedência sobre stopReason', () => {
    const update = buildCommitUpdate(
      job(),
      report({ stopReason: 'COMPLETED', thrownCode: 'TOKEN_EXPIRED' }),
      NOW,
      CONFIG,
    );
    expect(update.status).toBe('FAILED_AUTH');
  });

  it('o código de erro persistido pertence ao vocabulário fechado (nunca texto livre)', () => {
    const update = buildCommitUpdate(
      job(),
      report({ thrownCode: 'SYNC_FAILED' }),
      NOW,
      CONFIG,
    );
    expect(update.lastErrorCode).toMatch(/^[A-Z_]+$/);
  });
});
