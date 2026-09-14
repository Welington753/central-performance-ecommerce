/**
 * Vocabulário público fechado da sincronização de pedidos Shopee (Checkpoint
 * CP2K-3B) — estruturalmente paralelo a `ShopeeShopErrorCode`
 * (`shopee-oauth/shopee-shop.service.ts`, Checkpoint CP2J), mas um tipo
 * PRÓPRIO: nunca reaproveitado por import direto (aquele vocabulário é
 * privado ao recurso de informações de loja, nomeado com o prefixo `SHOPEE_`
 * por design daquele checkpoint) — apenas a mesma FORMA de classificação é
 * intencionalmente espelhada aqui. `SYNC_ALREADY_RUNNING` não tem equivalente
 * lá (conceito exclusivo de sincronização, nunca aplicável a uma consulta
 * somente-leitura de informações de loja).
 */
export type ShopeeOrdersSyncErrorCode =
  | 'NOT_CONNECTED'
  | 'CONNECTION_BUSY'
  | 'NOT_CONFIGURED'
  | 'TEMPORARILY_UNAVAILABLE'
  | 'DATA_UNAVAILABLE'
  | 'SYNC_ALREADY_RUNNING'
  | 'SYNC_FAILED';

/**
 * A mensagem da exceção É o código — nunca inclui corpo de resposta, URL com
 * query string, token, `sign` ou qualquer payload bruto da Shopee.
 */
export class ShopeeOrdersSyncError extends Error {
  constructor(public readonly code: ShopeeOrdersSyncErrorCode) {
    super(code);
  }
}

/**
 * Traduz o `message` de um `ConflictException` lançado por
 * `ShopeeAccessTokenService.ensureValidShopCredentials` (Checkpoint CP2H)
 * para o vocabulário fechado desta camada — MESMA classificação já provada
 * por `ShopeeShopService.mapCredentialsError` (Checkpoint CP2J): reescrita
 * aqui deliberadamente (nunca importada de lá, arquivo privado ao recurso de
 * shop-info) para não acoplar/alterar aquele módulo já commitado. Qualquer
 * mensagem não listada explicitamente cai fechada em `NOT_CONNECTED`, nunca
 * propaga o código interno cru.
 */
export function resolveShopeeCredentialsErrorCode(
  conflictMessage: string,
): ShopeeOrdersSyncErrorCode {
  switch (conflictMessage) {
    case 'ACCOUNT_BUSY':
    case 'REFRESH_RESULT_NOT_COMMITTED':
      return 'CONNECTION_BUSY';
    case 'SHOPEE_NOT_CONFIGURED':
      return 'NOT_CONFIGURED';
    case 'ACCOUNT_NOT_ELIGIBLE':
    case 'INVALID_AUTHORIZATION_RESPONSE':
    case 'REFRESH_FAILED':
    case 'REFRESH_RESULT_AMBIGUOUS':
    case 'CREDENTIAL_DECRYPTION_FAILED':
    default:
      return 'NOT_CONNECTED';
  }
}

/**
 * Kinds de outcome que representam FALHA em `ShopeeOrdersApiClient`
 * (`getOrderList`/`getOrderDetail`, Checkpoints CP2K-1/CP2K-2) — o vocabulário
 * completo tem também `success`, tratado à parte pelo chamador, nunca
 * passado para esta função.
 */
export type ShopeeOrdersApiFailureKind =
  | 'configuration_error'
  | 'invalid_request'
  | 'provider_rejected'
  | 'rate_limited'
  | 'temporary_failure'
  | 'invalid_response'
  | 'unknown_result';

/**
 * Traduz um outcome de falha do cliente HTTP interno da Shopee para o
 * vocabulário fechado desta camada — mesma classificação já provada por
 * `ShopeeShopService.toPublicDto` (Checkpoint CP2J) para o mesmo vocabulário
 * de outcomes (`ShopeeShopApiClient`/`ShopeeOrdersApiClient` compartilham a
 * mesma forma, herdada do mesmo desenho de CP2I).
 */
export function resolveShopeeOrdersApiErrorCode(
  kind: ShopeeOrdersApiFailureKind,
): ShopeeOrdersSyncErrorCode {
  switch (kind) {
    case 'configuration_error':
    case 'invalid_request':
      // Nenhum dos dois é causa do chamador: `accessToken`/`shopId` já vêm
      // de `ensureValidShopCredentials`, e os demais parâmetros são sempre
      // calculados internamente (nunca vindos direto do usuário HTTP).
      return 'NOT_CONFIGURED';
    case 'provider_rejected':
    case 'invalid_response':
      return 'DATA_UNAVAILABLE';
    case 'rate_limited':
    case 'temporary_failure':
    case 'unknown_result':
      return 'TEMPORARILY_UNAVAILABLE';
  }
}
