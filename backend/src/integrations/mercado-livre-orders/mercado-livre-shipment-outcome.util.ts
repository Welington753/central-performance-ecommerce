import { LOGISTICS_UNKNOWN } from '../marketplace-orders/logistics-classification';
import type { LogisticsReclassificationRepository } from '../marketplace-orders/logistics-reclassification.repository';
import { classifyLogisticType } from './mercado-livre-logistics.util';
import type { ReclassificationAccountReport } from './logistics-reclassification-report';
import type { FetchShipmentOutcome } from './mercado-livre-shipment.client';

export type ShipmentOutcomeHandlingResult = 'CONTINUE' | 'STOP' | 'ABORT';

/**
 * Após esta quantidade de falhas transitórias CONSECUTIVAS (`provider_unavailable`),
 * a conta é encerrada de forma retomável — mesmo teto usado pelas duas filas
 * (com e sem `external_shipment_id`), para que uma indisponibilidade
 * prolongada nunca queime o orçamento inteiro sem resolver nada.
 */
export const CONSECUTIVE_TRANSIENT_FAILURE_LIMIT = 5;

/**
 * Traduz UM resultado de `GET /shipments/{id}` em contadores + escrita
 * condicional — extraído para ser reaproveitado IDÊNTICO pelas duas filas da
 * reclassificação (pedidos que já tinham `external_shipment_id` e pedidos
 * cujo shipment id acabou de ser recuperado pelo fallback), nunca duas
 * implementações que podem divergir.
 *
 * Nunca classifica como `SELLER_FULFILLED` por causa de uma falha — toda
 * saída que não é `success` reconhecido deixa o pedido `UNKNOWN`.
 */
export async function applyShipmentLookupOutcome(params: {
  outcome: FetchShipmentOutcome;
  orderId: string;
  report: ReclassificationAccountReport;
  repository: LogisticsReclassificationRepository;
  transientFailureState: { consecutive: number };
}): Promise<ShipmentOutcomeHandlingResult> {
  const { outcome, orderId, report, repository, transientFailureState } =
    params;

  if (outcome.kind === 'unauthorized') {
    report.outcome = 'ABORTED_UNAUTHORIZED';
    return 'ABORT';
  }
  if (outcome.kind === 'rate_limited') {
    report.leftUnknownTransientFailure += 1;
    report.outcome = 'STOPPED_RATE_LIMITED';
    return 'STOP';
  }
  if (outcome.kind === 'provider_unavailable') {
    report.leftUnknownTransientFailure += 1;
    transientFailureState.consecutive += 1;
    if (
      transientFailureState.consecutive >= CONSECUTIVE_TRANSIENT_FAILURE_LIMIT
    ) {
      report.outcome = 'STOPPED_PROVIDER_UNAVAILABLE';
      return 'STOP';
    }
    return 'CONTINUE';
  }

  transientFailureState.consecutive = 0;

  if (outcome.kind === 'not_found') {
    report.leftUnknownNotFound += 1;
    return 'CONTINUE';
  }
  if (outcome.kind === 'invalid_response') {
    report.leftUnknownInvalidResponse += 1;
    return 'CONTINUE';
  }

  const classification = classifyLogisticType(outcome.logisticType);
  if (classification === LOGISTICS_UNKNOWN) {
    report.leftUnknownUnrecognizedType += 1;
    return 'CONTINUE';
  }

  const applied = await repository.applyResolvedClassification({
    orderId,
    classification,
    logisticsType: outcome.logisticType,
  });
  if (!applied) {
    report.skippedAlreadyResolved += 1;
    return 'CONTINUE';
  }
  if (classification === 'MARKETPLACE_FULFILLED') {
    report.resolvedMarketplaceFulfilled += 1;
  } else {
    report.resolvedSellerFulfilled += 1;
  }
  return 'CONTINUE';
}
