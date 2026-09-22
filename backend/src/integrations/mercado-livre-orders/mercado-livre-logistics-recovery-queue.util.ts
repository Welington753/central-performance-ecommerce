import type { LogisticsReclassificationRepository } from '../marketplace-orders/logistics-reclassification.repository';
import {
  applyShipmentLookupOutcome,
  CONSECUTIVE_TRANSIENT_FAILURE_LIMIT,
} from './mercado-livre-shipment-outcome.util';
import type { MercadoLivreShipmentLookupService } from './mercado-livre-shipment-lookup.service';
import type { MercadoLivreOrderDetailLookupService } from './mercado-livre-order-detail-lookup.service';
import type { ReclassificationAccountReport } from './logistics-reclassification-report';

/**
 * Fallback de recuperação (revisão crítica da auditoria Full): drena a fila
 * de pedidos `UNKNOWN` SEM `external_shipment_id` — qualquer pedido
 * sincronizado antes da migration 1789000000000. Extraído do serviço
 * principal só para manter os dois arquivos dentro do limite de linhas do
 * projeto; a lógica é exclusiva desta fila.
 *
 * Para cada pedido: `GET /orders/{id}` (read-only, nunca refaz o backfill —
 * só extrai `shipping.id`); se recuperado, grava condicionalmente
 * (`attachRecoveredShipmentId`, nunca sobrescreve) e consulta o envio pela
 * MESMA rotina da fila principal (`applyShipmentLookupOutcome`), sob o
 * MESMO orçamento de requisições. Pedido sem envio associado
 * (`shipmentId: null`) permanece `UNKNOWN` sem nenhuma segunda chamada.
 */
export async function drainRecoveryQueue(
  marketplaceAccountId: string,
  accessToken: string,
  deps: {
    repository: LogisticsReclassificationRepository;
    orderDetailLookup: MercadoLivreOrderDetailLookupService;
    shipmentLookup: MercadoLivreShipmentLookupService;
    budgetExhausted: (report: ReclassificationAccountReport) => boolean;
  },
  context: {
    report: ReclassificationAccountReport;
    batchSize: number;
  },
): Promise<void> {
  const { repository, orderDetailLookup, shipmentLookup, budgetExhausted } =
    deps;
  const { report, batchSize } = context;
  let cursor: string | null = null;
  const transientFailureState = { consecutive: 0 };

  for (;;) {
    const batch = await repository.fetchPendingWithoutShipmentIdBatch({
      marketplaceAccountId,
      limit: batchSize,
      afterId: cursor,
    });
    if (batch.length === 0) return;

    for (const order of batch) {
      if (budgetExhausted(report)) {
        report.outcome = 'STOPPED_MAX_REQUESTS';
        return;
      }

      // Cursor avança SEMPRE — nunca relê a mesma linha na execução atual.
      cursor = order.id;
      report.ordersExamined += 1;
      report.orderDetailRequests += 1;

      const { outcome } = await orderDetailLookup.lookup(
        accessToken,
        order.externalOrderId,
      );

      if (outcome.kind === 'unauthorized') {
        report.outcome = 'ABORTED_UNAUTHORIZED';
        return;
      }
      if (outcome.kind === 'rate_limited') {
        report.leftUnknownTransientFailure += 1;
        report.outcome = 'STOPPED_RATE_LIMITED';
        return;
      }
      if (outcome.kind === 'provider_unavailable') {
        report.leftUnknownTransientFailure += 1;
        transientFailureState.consecutive += 1;
        if (
          transientFailureState.consecutive >=
          CONSECUTIVE_TRANSIENT_FAILURE_LIMIT
        ) {
          report.outcome = 'STOPPED_PROVIDER_UNAVAILABLE';
          return;
        }
        continue;
      }
      transientFailureState.consecutive = 0;

      if (outcome.kind === 'not_found') {
        report.leftUnknownOrderNotFound += 1;
        continue;
      }
      if (outcome.kind === 'invalid_response') {
        report.leftUnknownInvalidResponse += 1;
        continue;
      }
      // success, mas sem envio associado — nunca inventado, nunca consultado.
      if (outcome.shipmentId === null) continue;

      const attached = await repository.attachRecoveredShipmentId({
        orderId: order.id,
        externalShipmentId: outcome.shipmentId,
      });
      if (!attached) {
        // Outro processo já preencheu/resolveu esta linha entretanto.
        report.skippedAlreadyResolved += 1;
        continue;
      }
      report.shipmentIdsRecovered += 1;

      if (budgetExhausted(report)) {
        report.outcome = 'STOPPED_MAX_REQUESTS';
        return;
      }
      report.shipmentRequests += 1;

      const shipmentResult = await shipmentLookup.lookup(
        accessToken,
        outcome.shipmentId,
      );
      const result = await applyShipmentLookupOutcome({
        outcome: shipmentResult.outcome,
        orderId: order.id,
        report,
        repository,
        transientFailureState,
      });
      if (result !== 'CONTINUE') return;
    }
  }
}
