import type { PendingLogisticsCounts } from '../marketplace-orders/logistics-reclassification.repository';

/**
 * Vocabulário FECHADO de desfecho por conta da reclassificação logística
 * (correção da auditoria Full). Nunca contém mensagem do provedor, URL,
 * token, identificador de pedido ou de envio.
 */
export type ReclassificationAccountOutcome =
  /** A fila processável daquela conta acabou dentro desta execução. */
  | 'COMPLETED'
  /** Teto de requisições da execução atingido — retomável sem perda. */
  | 'STOPPED_MAX_REQUESTS'
  /** 429 persistente mesmo após o retry limitado — retomável sem perda. */
  | 'STOPPED_RATE_LIMITED'
  /** Indisponibilidade consecutiva do provedor — retomável sem perda. */
  | 'STOPPED_PROVIDER_UNAVAILABLE'
  /** 401/403: lote INTERROMPIDO de imediato, para não degradar vários registros. */
  | 'ABORTED_UNAUTHORIZED'
  /** Falha ao obter access token válido (inclui disputa de refresh). */
  | 'ABORTED_TOKEN_UNAVAILABLE'
  /** Outra execução já detém o lock desta conta — nada foi feito. */
  | 'SKIPPED_ACCOUNT_BUSY'
  /** Conta não conectada — nenhuma chamada externa foi tentada. */
  | 'SKIPPED_NOT_CONNECTED'
  /** Nenhum pedido pendente COM identificador de envio. */
  | 'SKIPPED_NOTHING_PENDING';

export interface ReclassificationAccountReport {
  nickname: string | null;
  outcome: ReclassificationAccountOutcome;
  ordersExamined: number;
  shipmentRequests: number;
  resolvedMarketplaceFulfilled: number;
  resolvedSellerFulfilled: number;
  /** Envio consultado com sucesso, mas `logistic_type` não reconhecido — permanece `UNKNOWN`. */
  leftUnknownUnrecognizedType: number;
  /** `GET /shipments/{id}` devolveu 404 — permanece `UNKNOWN`. */
  leftUnknownNotFound: number;
  /** Falha transitória após o retry limitado — permanece `UNKNOWN`. */
  leftUnknownTransientFailure: number;
  /** Resposta fora da allowlist — permanece `UNKNOWN`. */
  leftUnknownInvalidResponse: number;
  /** Linha já resolvida por outro processo entre a leitura e a escrita — nada foi sobrescrito. */
  skippedAlreadyResolved: number;
  /**
   * Fallback de recuperação (revisão crítica): pedidos `UNKNOWN` SEM
   * `external_shipment_id` examinados via `GET /orders/{id}`, só em
   * `--apply`. Contam contra o MESMO orçamento de `shipmentRequests`
   * (`maxRequestsPerAccount`), nunca um orçamento à parte.
   */
  orderDetailRequests: number;
  /** `shipping.id` recuperado e persistido com sucesso — ainda não é `MARKETPLACE_FULFILLED`/`SELLER_FULFILLED`, só passa a ser consultável. */
  shipmentIdsRecovered: number;
  /** `GET /orders/{id}` devolveu 404 — permanece `UNKNOWN`, sem shipment id. */
  leftUnknownOrderNotFound: number;
  /**
   * Cursor durável (correção "sem starvation", worker do backend) — onde a
   * fila 1 (com `external_shipment_id`) parou nesta chamada. Eco do cursor
   * de ENTRADA (`queue1AfterId`) quando a fila 1 nem chega a rodar (ex.:
   * conta desconectada). O CHAMADOR (worker) é quem decide persistir isto
   * entre ticks — este serviço nunca grava cursor em lugar nenhum.
   */
  queue1EndCursor: string | null;
  /** `true` quando o último lote lido da fila 1 nesta chamada veio vazio — cursor alcançou o fim de tudo que hoje é `UNKNOWN` com shipment id, a partir de onde começou. */
  queue1Exhausted: boolean;
  /** Mesma semântica de `queue1EndCursor`, para a fila 2 (recuperação, sem `external_shipment_id`). */
  queue2EndCursor: string | null;
  /** Mesma semântica de `queue1Exhausted`, para a fila 2. */
  queue2Exhausted: boolean;
}

export interface ReclassificationPlanAccountReport extends Pick<
  PendingLogisticsCounts,
  'nickname' | 'pendingWithShipmentId' | 'pendingWithoutShipmentId' | 'resolved'
> {
  /** `pendingWithShipmentId + pendingWithoutShipmentId` — todo `UNKNOWN` da conta. */
  totalUnknown: number;
  /** Estimativa PESSIMISTA de chamadas HTTP necessárias para drenar a fila hoje: 1 por pedido já com shipment id, até 2 (detalhe do pedido + envio) por pedido dependente de recuperação. Nunca uma contagem exata — o provedor pode responder `not_found`/erro antes da segunda chamada. */
  estimatedMaxRequests: number;
  /** `ceil(totalUnknown / batchSize)` — nº de lotes de leitura do banco necessários com o `batchSize` atual, não o nº de chamadas HTTP. */
  estimatedBatches: number;
}

export interface ReclassificationPlanReport {
  /** Tamanho de lote considerado para `estimatedBatches` — o mesmo default/config que `--apply` usaria. */
  batchSize: number;
  accounts: ReclassificationPlanAccountReport[];
}

export interface ReclassificationApplyOptions {
  accountId?: string | null;
  /** Tamanho do lote lido do banco por vez. */
  batchSize?: number;
  /** Teto de consultas `GET /shipments/{id}` desta execução, por conta. */
  maxRequestsPerAccount?: number;
  /**
   * Cursor durável de ENTRADA (correção "sem starvation", worker do
   * backend) — de onde a fila 1/fila 2 devem retomar, em vez de sempre
   * `null` (início). Só faz sentido com `accountId` de UMA conta específica
   * — a CLI (múltiplas contas, `accountId: null`) nunca os informa, e o
   * comportamento sem eles é IDÊNTICO ao de antes desta correção (sempre
   * começa do zero).
   */
  queue1AfterId?: string | null;
  queue2AfterId?: string | null;
}

export function emptyAccountReport(
  nickname: string | null,
  initialCursors: {
    queue1AfterId?: string | null;
    queue2AfterId?: string | null;
  } = {},
): ReclassificationAccountReport {
  return {
    nickname,
    outcome: 'COMPLETED',
    ordersExamined: 0,
    shipmentRequests: 0,
    resolvedMarketplaceFulfilled: 0,
    resolvedSellerFulfilled: 0,
    leftUnknownUnrecognizedType: 0,
    leftUnknownNotFound: 0,
    leftUnknownTransientFailure: 0,
    leftUnknownInvalidResponse: 0,
    skippedAlreadyResolved: 0,
    orderDetailRequests: 0,
    shipmentIdsRecovered: 0,
    leftUnknownOrderNotFound: 0,
    queue1EndCursor: initialCursors.queue1AfterId ?? null,
    queue1Exhausted: false,
    queue2EndCursor: initialCursors.queue2AfterId ?? null,
    queue2Exhausted: false,
  };
}
