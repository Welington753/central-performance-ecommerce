import type { SyncedInterval } from './coverage-interval.util';

export const SAO_PAULO_TIME_ZONE = 'America/Sao_Paulo';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PeriodWindow {
  from: Date;
  to: Date;
}

/**
 * Janela de 60 dias usada na PRIMEIRA sincronização (design da Fase 3):
 * termina no instante de referência (UTC, internamente sempre correto
 * independente do fuso do processo Node) e cobre exatamente os 60 dias
 * anteriores. `America/Sao_Paulo` não observa horário de verão desde 2019 —
 * um dia tem sempre 24h em qualquer fuso relevante aqui, então a subtração
 * de duração em UTC já produz o resultado correto sem precisar de biblioteca
 * de fuso horário. O fuso só importa para EXIBIÇÃO (frontend), nunca para
 * este cálculo.
 */
export function computeInitialSyncWindow(referenceNow: Date): PeriodWindow {
  return rollingWindow(referenceNow, 60);
}

export interface KpiWindows {
  current: PeriodWindow;
  previous: PeriodWindow;
}

/**
 * Período atual: últimos 30 dias terminando agora. Comparação: os 30 dias
 * imediatamente anteriores — contíguo, sem sobreposição nem lacuna (o fim do
 * período anterior é exatamente o início do período atual).
 */
export function computeKpiWindows(referenceNow: Date): KpiWindows {
  const current = rollingWindow(referenceNow, 30);
  const previous: PeriodWindow = {
    from: new Date(current.from.getTime() - 30 * DAY_MS),
    to: current.from,
  };
  return { current, previous };
}

function rollingWindow(referenceNow: Date, days: number): PeriodWindow {
  return {
    from: new Date(referenceNow.getTime() - days * DAY_MS),
    to: referenceNow,
  };
}

// Sobreposição de segurança aplicada ao início de uma janela incremental —
// recobre o último dia já sincronizado para capturar atualizações tardias de
// status (ex.: pedido concluído pouco depois do corte anterior) sem nunca
// redownloadar o histórico inteiro a cada execução.
const INCREMENTAL_OVERLAP_MS = DAY_MS;

/**
 * Janela usada por uma sincronização RECORRENTE (botão manual repetido ou
 * ciclo automático) — nunca a janela fixa de 60 dias em toda execução.
 * Sem cobertura anterior (primeira sincronização real desta conta): cai no
 * mesmo `computeInitialSyncWindow` de sempre. Com cobertura: começa 1 dia
 * antes do fim do intervalo mesclado mais recente (nunca antes de `to`, que
 * usaria uma janela invertida) e vai até `referenceNow`.
 */
export function computeIncrementalSyncWindow(
  priorIntervals: readonly SyncedInterval[],
  referenceNow: Date,
): PeriodWindow {
  if (priorIntervals.length === 0) {
    return computeInitialSyncWindow(referenceNow);
  }
  const latestTo = priorIntervals.reduce(
    (latest, interval) =>
      interval.to.getTime() > latest.getTime() ? interval.to : latest,
    priorIntervals[0].to,
  );
  const from = new Date(
    Math.min(
      latestTo.getTime() - INCREMENTAL_OVERLAP_MS,
      referenceNow.getTime(),
    ),
  );
  return { from, to: referenceNow };
}

export const BACKFILL_CHUNK_DAYS = 30;

/**
 * Próxima janela do backfill histórico — sempre contígua e mais antiga que
 * `oldestCoveredFrom` (nunca sobrepõe nem deixa lacuna com o que já foi
 * sincronizado), em passos pequenos e paginados (`BACKFILL_CHUNK_DAYS`) para
 * nunca tentar baixar anos de histórico em uma única chamada ao provedor.
 */
export function computeBackfillChunkWindow(
  oldestCoveredFrom: Date,
  chunkDays: number = BACKFILL_CHUNK_DAYS,
): PeriodWindow {
  return {
    from: new Date(oldestCoveredFrom.getTime() - chunkDays * DAY_MS),
    to: oldestCoveredFrom,
  };
}

/**
 * Checkpoint 2 (filtros de data): vocabulário fechado de erro de validação
 * do período — a mensagem da exceção É o código, nunca inclui a query string
 * bruta recebida.
 */
export type KpiPeriodErrorCode =
  | 'INVALID_DATE_FORMAT'
  | 'MISSING_PARAMETER'
  | 'FROM_AFTER_TO'
  | 'TO_IN_FUTURE'
  | 'RANGE_TOO_LONG';

export class InvalidKpiPeriodError extends Error {
  constructor(public readonly code: KpiPeriodErrorCode) {
    super(code);
  }
}

export interface DateOnly {
  year: number;
  month: number;
  day: number;
}

const MAX_KPI_RANGE_DAYS = 366;
const DEFAULT_KPI_RANGE_DAYS = 30;
const SAO_PAULO_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * `America/Sao_Paulo` não observa horário de verão desde 2019 (mesma
 * premissa documentada acima para `computeInitialSyncWindow`) — por isso
 * todo o cálculo de dia-calendário aqui usa um deslocamento fixo de -03:00
 * em vez de uma biblioteca de fuso horário.
 */
export function saoPauloDateOnly(instant: Date): DateOnly {
  const shifted = new Date(instant.getTime() - SAO_PAULO_UTC_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function dateOnlyToUtcInstant(date: DateOnly): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 3, 0, 0, 0));
}

export function addDaysToDateOnly(date: DateOnly, days: number): DateOnly {
  const base = Date.UTC(date.year, date.month - 1, date.day);
  const shifted = new Date(base + days * DAY_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function compareDateOnly(a: DateOnly, b: DateOnly): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

export function dateOnlyToString(date: DateOnly): string {
  const y = String(date.year).padStart(4, '0');
  const m = String(date.month).padStart(2, '0');
  const d = String(date.day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Converte um instante UTC (ex.: `sync_runs.date_from`) para a data
 * (dia-calendário) correspondente em `America/Sao_Paulo`, só para exibição
 * — nunca usado em comparação de cobertura, que sempre compara instantes.
 */
export function utcInstantToSaoPauloDateString(instant: Date): string {
  return dateOnlyToString(saoPauloDateOnly(instant));
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Valida o formato `YYYY-MM-DD` estrito E que a data seja um dia-calendário
 * real (rejeita, por exemplo, `2026-02-30`, que sem esta checagem "rolaria"
 * silenciosamente para 2 de março).
 */
export function parseDateOnlyStrict(value: string): DateOnly {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) throw new InvalidKpiPeriodError('INVALID_DATE_FORMAT');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  const isRealCalendarDate =
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day;

  if (!isRealCalendarDate)
    throw new InvalidKpiPeriodError('INVALID_DATE_FORMAT');

  return { year, month, day };
}

export interface KpiPeriodQuery {
  from?: string;
  to?: string;
}

/**
 * Resolve o par de janelas (atual + comparação) para o endpoint de KPIs
 * (Checkpoint 2, "Filtro por data") a partir da query string bruta.
 *
 * - Sem `from`/`to`: últimos 30 dias, incluindo hoje (`America/Sao_Paulo`).
 * - Apenas um dos dois: `MISSING_PARAMETER` (o controller traduz para 400).
 * - `from` e `to` são dias inclusivos para o usuário; internamente sempre
 *   início inclusivo e o dia seguinte a `to` como fim exclusivo.
 * - Período de comparação: mesma quantidade de dias, terminando no dia
 *   imediatamente anterior a `from` (sem sobreposição, sem lacuna).
 */
export function resolveKpiPeriod(
  query: KpiPeriodQuery,
  referenceNow: Date,
  maxRangeDays: number = MAX_KPI_RANGE_DAYS,
): KpiWindows {
  const hasFrom = query.from !== undefined && query.from !== '';
  const hasTo = query.to !== undefined && query.to !== '';

  if (hasFrom !== hasTo) {
    throw new InvalidKpiPeriodError('MISSING_PARAMETER');
  }

  const today = saoPauloDateOnly(referenceNow);

  let fromDate: DateOnly;
  let toDate: DateOnly;

  if (!hasFrom && !hasTo) {
    toDate = today;
    fromDate = addDaysToDateOnly(today, -(DEFAULT_KPI_RANGE_DAYS - 1));
  } else {
    fromDate = parseDateOnlyStrict(query.from as string);
    toDate = parseDateOnlyStrict(query.to as string);

    if (compareDateOnly(fromDate, toDate) > 0) {
      throw new InvalidKpiPeriodError('FROM_AFTER_TO');
    }
    if (compareDateOnly(toDate, today) > 0) {
      throw new InvalidKpiPeriodError('TO_IN_FUTURE');
    }
  }

  const days = diffDaysInclusive(fromDate, toDate);
  if (days > maxRangeDays) {
    throw new InvalidKpiPeriodError('RANGE_TOO_LONG');
  }

  const currentFrom = dateOnlyToUtcInstant(fromDate);
  const currentTo = dateOnlyToUtcInstant(addDaysToDateOnly(toDate, 1));
  const previousTo = currentFrom;
  const previousFrom = dateOnlyToUtcInstant(addDaysToDateOnly(fromDate, -days));

  return {
    current: { from: currentFrom, to: currentTo },
    previous: { from: previousFrom, to: previousTo },
  };
}

function diffDaysInclusive(from: DateOnly, to: DateOnly): number {
  const fromMs = Date.UTC(from.year, from.month - 1, from.day);
  const toMs = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((toMs - fromMs) / DAY_MS) + 1;
}

/**
 * Lista, em ordem crescente, cada dia-calendário (`YYYY-MM-DD`,
 * `America/Sao_Paulo`) coberto por uma janela `[from, to)` — usada para
 * preencher a série diária sem nenhum dia ausente (Checkpoint 2, "Evolução
 * diária").
 */
export function listDaysInWindow(window: PeriodWindow): string[] {
  const fromDate = saoPauloDateOnly(window.from);
  const totalDays = Math.round(
    (window.to.getTime() - window.from.getTime()) / DAY_MS,
  );
  const days: string[] = [];
  for (let i = 0; i < totalDays; i += 1) {
    days.push(dateOnlyToString(addDaysToDateOnly(fromDate, i)));
  }
  return days;
}
