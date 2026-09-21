import { MigrationAbortedError } from './migrate-ml-accounts.errors';

/**
 * Leitores defensivos das linhas cruas do driver: uma coluna com tipo
 * inesperado falha fechado com `SOURCE_ROW_MALFORMED` em vez de virar
 * `undefined` silencioso dentro do INSERT do destino.
 */
export function asRecord(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) {
    throw new MigrationAbortedError('SOURCE_ROW_MALFORMED');
  }
  return raw as Record<string, unknown>;
}

export function readString(
  row: Record<string, unknown>,
  column: string,
): string | null {
  const value = row[column];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new MigrationAbortedError('SOURCE_ROW_MALFORMED');
  }
  return value;
}

export function requireString(
  row: Record<string, unknown>,
  column: string,
): string {
  const value = readString(row, column);
  if (value === null) {
    throw new MigrationAbortedError('SOURCE_ROW_MALFORMED');
  }
  return value;
}

export function readDate(
  row: Record<string, unknown>,
  column: string,
): Date | null {
  const value = row[column];
  if (value === null || value === undefined) {
    return null;
  }
  if (!(value instanceof Date)) {
    throw new MigrationAbortedError('SOURCE_ROW_MALFORMED');
  }
  return value;
}

export function requireDate(
  row: Record<string, unknown>,
  column: string,
): Date {
  const value = readDate(row, column);
  if (value === null) {
    throw new MigrationAbortedError('SOURCE_ROW_MALFORMED');
  }
  return value;
}

export function requireInteger(
  row: Record<string, unknown>,
  column: string,
): number {
  const value = row[column];
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  throw new MigrationAbortedError('SOURCE_ROW_MALFORMED');
}

/** `count(*)` volta como `bigint` (string no driver) ou número. */
export function readCount(raw: unknown, column: string): number {
  const row = asRecord(raw);
  const value = row[column];
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  throw new MigrationAbortedError('TARGET_SCHEMA_INCOMPATIBLE');
}
