/**
 * Relógio e timers do worker de backfill (Fase 4, "Backfill durável")
 * isolados atrás de tokens de DI — nos testes, `MarketplaceBackfillWorkerService`
 * recebe um relógio/scheduler fake determinístico em vez de `Date`/
 * `setInterval` reais, para nunca depender de tempo real (`sleep`) em specs.
 */
export interface BackfillWorkerClock {
  now(): Date;
}

export interface BackfillWorkerTimers {
  setInterval(handler: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export const BACKFILL_WORKER_CLOCK = Symbol('BACKFILL_WORKER_CLOCK');
export const BACKFILL_WORKER_TIMERS = Symbol('BACKFILL_WORKER_TIMERS');

export const SYSTEM_CLOCK: BackfillWorkerClock = {
  now: () => new Date(),
};

export const SYSTEM_TIMERS: BackfillWorkerTimers = {
  setInterval: (handler, intervalMs) => setInterval(handler, intervalMs),
  clearInterval: (handle) =>
    clearInterval(handle as ReturnType<typeof setInterval>),
};
