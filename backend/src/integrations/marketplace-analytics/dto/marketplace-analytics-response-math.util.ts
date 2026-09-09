export function shareOf(part: number, total: number): number {
  if (total === 0) return 0;
  return roundTo((part / total) * 100, 1);
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
