/**
 * Variação percentual entre dois valores, arredondada a uma casa decimal.
 * `null` quando a base de comparação é zero (variação percentual
 * indefinida) — nunca `Infinity`/`NaN`.
 */
export function percentChange(
  current: number,
  previous: number,
): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
