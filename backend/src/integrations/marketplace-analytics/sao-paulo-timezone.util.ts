/**
 * Primitivas de data/hora para `America/Sao_Paulo` (Checkpoint BI-1) — via
 * `Intl.DateTimeFormat`, NUNCA um offset fixo `-03:00` hardcoded (diferente
 * do atalho já usado em `marketplace-orders/period.util.ts`, justificado ali
 * só para dia-calendário de exibição). Aqui a conversão vem sempre do
 * próprio fuso IANA, continuando correta mesmo se o Brasil um dia voltar a
 * ter horário de verão.
 */
export const SAO_PAULO_IANA_TIME_ZONE = 'America/Sao_Paulo';

export interface DateOnly {
  year: number;
  month: number;
  day: number;
}

const PARTS_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = PARTS_FORMATTER_CACHE.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  PARTS_FORMATTER_CACHE.set(timeZone, formatter);
  return formatter;
}

interface ZonedParts extends DateOnly {
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Data-calendário (fuso informado) correspondente a um instante UTC. */
export function zonedDateOnly(
  instant: Date,
  timeZone: string = SAO_PAULO_IANA_TIME_ZONE,
): DateOnly {
  const { year, month, day } = zonedParts(instant, timeZone);
  return { year, month, day };
}

/**
 * Instante UTC correspondente à meia-noite de uma data-calendário no fuso
 * informado — via ida-e-volta pelo próprio `Intl` (nunca soma/subtrai um
 * offset fixo). Uma iteração de correção é suficiente: o offset é constante
 * dentro do dia consultado para qualquer fuso relevante aqui.
 */
export function zonedDateOnlyToUtcInstant(
  date: DateOnly,
  timeZone: string = SAO_PAULO_IANA_TIME_ZONE,
): Date {
  const naiveUtcMs = Date.UTC(date.year, date.month - 1, date.day, 0, 0, 0, 0);
  const guessed = zonedParts(new Date(naiveUtcMs), timeZone);
  const guessedAsUtcMs = Date.UTC(
    guessed.year,
    guessed.month - 1,
    guessed.day,
    guessed.hour,
    guessed.minute,
    guessed.second,
    0,
  );
  const driftMs = naiveUtcMs - guessedAsUtcMs;
  return new Date(naiveUtcMs + driftMs);
}

export function daysInMonth(year: number, month: number): number {
  // Dia 0 do mês seguinte = último dia do mês pedido (aritmética de
  // calendário em UTC — não é conversão de fuso).
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDaysToDateOnly(date: DateOnly, days: number): DateOnly {
  const base = Date.UTC(date.year, date.month - 1, date.day);
  const shifted = new Date(base + days * 24 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function dateOnlyToString(date: DateOnly): string {
  const y = String(date.year).padStart(4, '0');
  const m = String(date.month).padStart(2, '0');
  const d = String(date.day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
