import {
  MONTHLY_REVENUE_GOAL_MAX_YEAR,
  MONTHLY_REVENUE_GOAL_MIN_YEAR,
} from './dto/upsert-monthly-revenue-goal.dto';

export type YearMonthQueryErrorCode =
  'MISSING_PARAMETER' | 'INVALID_YEAR' | 'INVALID_MONTH';

export class YearMonthQueryError extends Error {
  constructor(public readonly code: YearMonthQueryErrorCode) {
    super(code);
  }
}

export interface YearMonth {
  year: number;
  month: number;
}

/**
 * Valida `?year=&month=` para os endpoints de meta/progresso mensal
 * (Checkpoint BI-1) — a mensagem da exceção É o código fechado, nunca a
 * query string bruta (mesma convenção de `period.util.ts#resolveKpiPeriod`).
 */
export function parseYearMonthQuery(
  yearRaw: string | undefined,
  monthRaw: string | undefined,
): YearMonth {
  if (
    yearRaw === undefined ||
    yearRaw === '' ||
    monthRaw === undefined ||
    monthRaw === ''
  ) {
    throw new YearMonthQueryError('MISSING_PARAMETER');
  }

  if (!/^-?\d+$/.test(yearRaw)) throw new YearMonthQueryError('INVALID_YEAR');
  const year = Number(yearRaw);
  if (
    year < MONTHLY_REVENUE_GOAL_MIN_YEAR ||
    year > MONTHLY_REVENUE_GOAL_MAX_YEAR
  ) {
    throw new YearMonthQueryError('INVALID_YEAR');
  }

  if (!/^-?\d+$/.test(monthRaw)) throw new YearMonthQueryError('INVALID_MONTH');
  const month = Number(monthRaw);
  if (month < 1 || month > 12) {
    throw new YearMonthQueryError('INVALID_MONTH');
  }

  return { year, month };
}
