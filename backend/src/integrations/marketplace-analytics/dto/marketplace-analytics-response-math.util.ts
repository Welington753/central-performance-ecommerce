export function shareOf(part: number, total: number): number {
  if (total === 0) return 0;
  return roundTo((part / total) * 100, 1);
}

/**
 * Mesma ideia de `shareOf`, mas para valores monetários em centavos
 * (`bigint`) — evita perda de precisão do `number` em somas grandes.
 */
export function shareOfCents(part: bigint, total: bigint): number {
  if (total === 0n) return 0;
  return roundTo((Number(part) / Number(total)) * 100, 1);
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * "Despesas e ajustes conhecidos" / "Resultado após ajustes conhecidos" —
 * hoje soma SOMENTE `couponAmountCents` (mesma população `paid` de
 * `grossRevenueCents`, confirmado que ainda não é descontado do valor
 * bruto). `refundedAmountCents` NUNCA entra aqui: seus pedidos têm status
 * `partially_refunded`, população DISJUNTA de `grossRevenueCents` (nunca
 * contam como `paid`) — sem prova no código/fixtures de que `total_amount`
 * desses pedidos já reflita o reembolso, somar arriscaria excluir a receita
 * do pedido da base E ainda descontar o reembolso (dupla penalização). Ver
 * `AnalyticsKpiSummary.knownAdjustmentsAmount` no DTO.
 */
export function knownAdjustmentsAndResult(totals: {
  grossRevenueCents: bigint;
  couponAmountCents: bigint;
}): {
  knownAdjustmentsAmount: bigint;
  knownAdjustmentsPctOfGrossRevenue: number;
  resultAfterKnownAdjustmentsCents: bigint;
  marginAfterKnownAdjustmentsPct: number;
} {
  const knownAdjustmentsCents = totals.couponAmountCents;
  const resultCents = totals.grossRevenueCents - knownAdjustmentsCents;
  return {
    knownAdjustmentsAmount: knownAdjustmentsCents,
    knownAdjustmentsPctOfGrossRevenue: shareOfCents(
      knownAdjustmentsCents,
      totals.grossRevenueCents,
    ),
    resultAfterKnownAdjustmentsCents: resultCents,
    marginAfterKnownAdjustmentsPct: shareOfCents(
      resultCents,
      totals.grossRevenueCents,
    ),
  };
}
