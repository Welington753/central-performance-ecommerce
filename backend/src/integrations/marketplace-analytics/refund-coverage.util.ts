/**
 * Cobertura do aspecto "reembolso" do agregado de KPIs (auditoria "contrato
 * de dados Mercado Livre", Checkpoint BI-1) — nunca confundir com
 * `ConsolidatedCoverageStatus` (cobertura de SINCRONIZAÇÃO): este indicador
 * é sobre a qualidade do PRÓPRIO DADO de estorno, não sobre se o período foi
 * sincronizado.
 *
 * - `COMPLETE`: nenhum pedido `partially_refunded` no escopo — não há nada
 *   para o usuário desconfiar (vácuo genuíno, não lacuna).
 * - `PARTIAL`: existe ao menos um pedido `partially_refunded`, mas o valor
 *   efetivamente estornado não está disponível (o Mercado Livre nunca
 *   persiste esse campo hoje — ver auditoria de contrato de dados) — o
 *   valor bruto (`partiallyRefundedGrossAmount`) é anterior/independente do
 *   estorno, nunca a receita líquida real.
 * - `UNAVAILABLE`: reservado para quando nem a contagem de
 *   `partially_refunded` puder ser determinada com segurança (não ocorre
 *   neste lote — a contagem sempre vem de uma consulta agregada real).
 */
export type RefundCoverage = 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';

export function computeRefundCoverage(
  partiallyRefundedOrders: number,
): RefundCoverage {
  return partiallyRefundedOrders > 0 ? 'PARTIAL' : 'COMPLETE';
}
