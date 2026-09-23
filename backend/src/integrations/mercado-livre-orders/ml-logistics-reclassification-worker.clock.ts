/**
 * Relógio e timers do worker de reclassificação histórica Full (correção da
 * auditoria Full, Render free sem Shell) — MESMO padrão de
 * `marketplace-sync/backfill-worker.clock.ts`, isolado atrás de tokens de DI
 * para que os testes usem um relógio/scheduler fake determinístico em vez de
 * `Date`/`setInterval` reais.
 */
export interface MlLogisticsReclassificationWorkerClock {
  now(): Date;
}

export interface MlLogisticsReclassificationWorkerTimers {
  setInterval(handler: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export const ML_LOGISTICS_RECLASSIFICATION_WORKER_CLOCK = Symbol(
  'ML_LOGISTICS_RECLASSIFICATION_WORKER_CLOCK',
);
export const ML_LOGISTICS_RECLASSIFICATION_WORKER_TIMERS = Symbol(
  'ML_LOGISTICS_RECLASSIFICATION_WORKER_TIMERS',
);

export const SYSTEM_CLOCK: MlLogisticsReclassificationWorkerClock = {
  now: () => new Date(),
};

export const SYSTEM_TIMERS: MlLogisticsReclassificationWorkerTimers = {
  setInterval: (handler, intervalMs) => setInterval(handler, intervalMs),
  clearInterval: (handle) =>
    clearInterval(handle as ReturnType<typeof setInterval>),
};
