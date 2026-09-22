/**
 * Diagnóstico SANITIZADO da etapa de classificação logística de UMA execução
 * de sincronização (correção da auditoria Full — antes, o código citava um
 * contador `shipmentLookupsSkipped` que nunca existiu, então o volume de
 * pedidos deixados `UNKNOWN` era invisível).
 *
 * Contrato de privacidade, verificado por teste: TODO campo é um inteiro não
 * negativo e as chaves são um vocabulário FECHADO. Nunca contém token, URL,
 * identificador de pedido, identificador de envio, dado de comprador nem
 * mensagem de erro do provedor — só contagens e os códigos fixos abaixo.
 */
export interface LogisticsClassificationDiagnostics {
  /** Envios DISTINTOS referenciados pelos pedidos desta execução (após deduplicação por envio). */
  distinctShipments: number;
  /** Consultas `GET /shipments/{id}` efetivamente iniciadas (uma por envio distinto consultado). */
  lookupsPerformed: number;
  /**
   * Envios distintos que NÃO foram consultados por causa do teto defensivo
   * de consultas por execução. Esta é a medida direta da pendência de
   * reclassificação gerada por esta execução.
   */
  lookupsSkippedByCap: number;
  /** Tentativas HTTP totais, incluindo as repetições de erro transitório (sempre `>= lookupsPerformed`). */
  httpAttempts: number;
  /** Envios cujo `logistic_type` foi reconhecido (`MARKETPLACE_FULFILLED` ou `SELLER_FULFILLED`). */
  classificationsResolved: number;
  /** Envios que permaneceram `UNKNOWN` — soma de falhas e de `logistic_type` não reconhecido. */
  classificationsUnknown: number;
  failuresRateLimited: number;
  failuresProviderUnavailable: number;
  failuresNotFound: number;
  failuresUnauthorized: number;
  failuresInvalidResponse: number;
  /**
   * Pedidos desta execução que terminaram com classificação `UNKNOWN` — a
   * pendência de reclassificação contada em PEDIDOS (enquanto
   * `lookupsSkippedByCap` conta ENVIOS). Nunca marcados como "processados do
   * ponto de vista logístico": continuam elegíveis para a reclassificação
   * dedicada (ver `logistics-reclassification.repository.ts`).
   */
  ordersLeftUnclassified: number;
}

const DIAGNOSTICS_KEYS: ReadonlyArray<
  keyof LogisticsClassificationDiagnostics
> = [
  'distinctShipments',
  'lookupsPerformed',
  'lookupsSkippedByCap',
  'httpAttempts',
  'classificationsResolved',
  'classificationsUnknown',
  'failuresRateLimited',
  'failuresProviderUnavailable',
  'failuresNotFound',
  'failuresUnauthorized',
  'failuresInvalidResponse',
  'ordersLeftUnclassified',
];

export function createLogisticsDiagnostics(): LogisticsClassificationDiagnostics {
  return {
    distinctShipments: 0,
    lookupsPerformed: 0,
    lookupsSkippedByCap: 0,
    httpAttempts: 0,
    classificationsResolved: 0,
    classificationsUnknown: 0,
    failuresRateLimited: 0,
    failuresProviderUnavailable: 0,
    failuresNotFound: 0,
    failuresUnauthorized: 0,
    failuresInvalidResponse: 0,
    ordersLeftUnclassified: 0,
  };
}

/**
 * Última barreira antes da escrita no banco: reconstrói o objeto a partir do
 * vocabulário fechado acima, descartando qualquer chave extra que algum
 * chamador futuro tenha acrescentado e normalizando todo valor para inteiro
 * não negativo. Nenhuma string jamais atravessa este ponto.
 */
export function sanitizeLogisticsDiagnostics(
  diagnostics: LogisticsClassificationDiagnostics,
): Record<string, number> {
  const sanitized: Record<string, number> = {};
  for (const key of DIAGNOSTICS_KEYS) {
    const value = diagnostics[key];
    sanitized[key] =
      typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : 0;
  }
  return sanitized;
}

/**
 * `true` quando esta execução deixou alguma pendência logística — usado pelo
 * chamador para registrar explicitamente a pendência em vez de tratar a
 * execução como logisticamente completa.
 */
export function hasPendingReclassification(
  diagnostics: LogisticsClassificationDiagnostics,
): boolean {
  return (
    diagnostics.lookupsSkippedByCap > 0 ||
    diagnostics.ordersLeftUnclassified > 0
  );
}
