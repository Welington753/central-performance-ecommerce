import type { ProblemsMonthlyCoverage } from './marketplace-problems.types';

export interface MonthlyCoverageInput {
  /** Início (inclusivo) e fim (exclusivo) do mês em America/Sao_Paulo. */
  monthStart: Date;
  monthEnd: Date;
  /**
   * Intervalo contíguo já varrido da conta: `coveredFrom` (cursor do histórico,
   * a menor data coberta) até `coveredThrough` (cursor do incremental).
   * `null` = conta sem job iniciado.
   */
  coverage: { coveredFrom: Date; coveredThrough: Date } | null;
  /** Claims em quarentena PENDENTES cuja data de criação cai NESTE mês. */
  quarantinedInMonth: number;
  /** Quarentenas PENDENTES sem data conhecida (legado): podem pertencer a qualquer mês. */
  quarantinedUnknownDate: number;
}

/**
 * Cobertura honesta de um mês (decisão documentada):
 * - `UNKNOWN`: conta sem job iniciado (nada foi varrido), ou quarentena
 *   pendente SEM data conhecida — só linha legada; não dá para afirmar nem
 *   negar que ela pertence ao mês, então a cobertura fica indeterminada em
 *   TODOS os meses que seriam completos.
 * - `PARTIAL`: o mês não está inteiro dentro do intervalo varrido (inclui
 *   mês ainda fora do alcance do histórico, mês que atravessa o cursor e mês
 *   corrente) OU há claim em quarentena pendente com data NESTE mês. Quarentena
 *   datada afeta SÓ o seu mês (America/Sao_Paulo); resolvida, deixa de afetar.
 * - `COMPLETE`: o mês inteiro está dentro do intervalo varrido e não há
 *   pendência que o toque.
 * Precedência: sem job > mês fora do intervalo > quarentena do mês > quarentena sem data.
 */
export function monthlyCoverage(
  input: MonthlyCoverageInput,
): ProblemsMonthlyCoverage {
  const { monthStart, monthEnd, coverage } = input;
  if (coverage === null) return 'UNKNOWN';
  const inside =
    monthStart.getTime() >= coverage.coveredFrom.getTime() &&
    monthEnd.getTime() <= coverage.coveredThrough.getTime();
  if (!inside || input.quarantinedInMonth > 0) return 'PARTIAL';
  return input.quarantinedUnknownDate > 0 ? 'UNKNOWN' : 'COMPLETE';
}

/** Taxa por 100 pedidos arredondada a 2 casas; `null` sem pedidos (nunca divide por zero). */
export function problemsPer100Orders(
  problems: number,
  orders: number,
): number | null {
  if (orders <= 0) return null;
  return Math.round((problems / orders) * 10000) / 100;
}

/** Percentual 0–100 com 2 casas; `null` quando não há base. */
export function percentage(part: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((part / total) * 10000) / 100;
}
