/**
 * Relógio e timers do worker de sincronização de "Problemas" (CP2-C) — MESMO
 * padrão de `marketplace-sync/backfill-worker.clock.ts`, isolado atrás de
 * tokens de DI para que os testes usem um relógio/scheduler fake
 * determinístico em vez de `Date`/`setInterval` reais.
 */
export interface MarketplaceProblemsSyncWorkerClock {
  now(): Date;
}

export interface MarketplaceProblemsSyncWorkerTimers {
  setInterval(handler: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export const PROBLEMS_SYNC_WORKER_CLOCK = Symbol('PROBLEMS_SYNC_WORKER_CLOCK');
export const PROBLEMS_SYNC_WORKER_TIMERS = Symbol(
  'PROBLEMS_SYNC_WORKER_TIMERS',
);

export const SYSTEM_CLOCK: MarketplaceProblemsSyncWorkerClock = {
  now: () => new Date(),
};

export const SYSTEM_TIMERS: MarketplaceProblemsSyncWorkerTimers = {
  setInterval: (handler, intervalMs) => setInterval(handler, intervalMs),
  clearInterval: (handle) =>
    clearInterval(handle as ReturnType<typeof setInterval>),
};
