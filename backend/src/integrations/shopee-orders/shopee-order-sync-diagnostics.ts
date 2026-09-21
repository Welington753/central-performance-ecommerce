import type { ShopeeOrderMappingErrorReason } from './shopee-order.mapper';
import {
  SHOPEE_ORDER_DETAIL_VALIDATION_FIELD_PATHS,
  SHOPEE_ORDER_DETAIL_VALIDATION_ISSUE_CODES,
  SHOPEE_VALIDATION_ACTUAL_TYPES,
  type ShopeeOrderDetailValidationFieldPath,
  type ShopeeOrderDetailValidationIssueCode,
  type ShopeeValidationActualType,
} from './shopee-order-detail-validation-issue';

/**
 * Vocabulário fechado e sanitização da instrumentação de diagnóstico de
 * `DATA_UNAVAILABLE`/`TEMPORARILY_UNAVAILABLE` na sincronização de pedidos
 * Shopee — nunca transporta corpo bruto, `raw.message`, `order_sn`, token,
 * assinatura ou qualquer dado de comprador/pedido. Usado por
 * `ShopeeOrdersApiClient` (origem, captura o outcome HTTP),
 * `shopee-orders-fetch.util.ts` (propagação, anexa `stage`/`blockIndex`/
 * `batchIndex`) e `ShopeeOrdersSyncService` (consumo, único ponto de log —
 * nunca logado em mais de uma camada).
 */

/** Etapa onde a falha ocorreu — fechado, nunca um `string` livre. */
export type ShopeeOrderSyncStage = 'ORDER_LIST' | 'ORDER_DETAIL' | 'MAPPING';

/**
 * Subconjunto de `ShopeeOrdersApiFailureKind` (`shopee-orders-sync-error.ts`)
 * que pode aparecer no diagnóstico — exclui deliberadamente
 * `configuration_error`/`invalid_request`: nenhum dos dois é causado pela
 * resposta do provedor (config da aplicação ou entrada já validada antes do
 * fetch), então nunca precisam de `stage`/diagnóstico de rede.
 */
export type ShopeeOrderSyncOutcomeKind =
  | 'provider_rejected'
  | 'invalid_response'
  | 'rate_limited'
  | 'temporary_failure'
  | 'unknown_result';

/** Mesmo padrão de `sanitizeShopeeProviderErrorCode` (`shopee-http.client.ts`) — duplicado deliberadamente (família de cliente própria, nunca um util cross-domain). */
const PROVIDER_ERROR_CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
/** Mesmo padrão de `REQUEST_ID_PATTERN` dos validadores de resposta (`shopee-order-list-response.ts`/`shopee-order-detail-response.ts`). */
const PROVIDER_REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

export const UNCLASSIFIED_PROVIDER_ERROR = 'UNCLASSIFIED_PROVIDER_ERROR';

/** `rawError` fora do formato curto de código nunca é propagado — cai fechado no sentinela, nunca no valor bruto (poderia ser `message` disfarçado de `error`). */
export function sanitizeShopeeOrdersProviderErrorCode(
  rawError: string,
): string {
  return PROVIDER_ERROR_CODE_PATTERN.test(rawError)
    ? rawError
    : UNCLASSIFIED_PROVIDER_ERROR;
}

/**
 * `undefined` quando ausente, vazio ou fora do formato — nunca um valor
 * sentinela: o campo é simplesmente omitido do diagnóstico/log
 * (`request_id` não é sensível, mas um valor malformado não é confiável o
 * bastante para registrar como se fosse válido).
 */
export function sanitizeShopeeOrdersProviderRequestId(
  rawRequestId: unknown,
): string | undefined {
  return typeof rawRequestId === 'string' &&
    PROVIDER_REQUEST_ID_PATTERN.test(rawRequestId)
    ? rawRequestId
    : undefined;
}

/**
 * Diagnóstico sanitizado capturado por `ShopeeOrdersApiClient` no momento em
 * que a resposta HTTP é recebida/interpretada — nunca inclui `raw.message`,
 * corpo bruto, `order_sn` ou qualquer payload de pedido. `httpStatus` só
 * existe quando uma resposta HTTP completa foi de fato recebida (nunca em
 * `unknown_result`, que é ambíguo por definição).
 */
export interface ShopeeOrdersHttpDiagnostics {
  httpStatus?: number;
  providerErrorCode?: string;
  providerRequestId?: string;
  validationIssueCode?: ShopeeOrderDetailValidationIssueCode;
  validationFieldPath?: ShopeeOrderDetailValidationFieldPath;
  validationActualType?: ShopeeValidationActualType;
  validationOrderIndex?: number;
}

/** Campos de validação do diagnóstico — nunca montados fora de {@link sanitizeShopeeOrderDetailValidationIssue}. */
export type ShopeeOrderValidationDiagnostics = Pick<
  ShopeeOrdersHttpDiagnostics,
  | 'validationIssueCode'
  | 'validationFieldPath'
  | 'validationActualType'
  | 'validationOrderIndex'
>;

const VALIDATION_ISSUE_CODES: ReadonlySet<string> = new Set(
  SHOPEE_ORDER_DETAIL_VALIDATION_ISSUE_CODES,
);
const VALIDATION_FIELD_PATHS: ReadonlySet<string> = new Set(
  SHOPEE_ORDER_DETAIL_VALIDATION_FIELD_PATHS,
);
const VALIDATION_ACTUAL_TYPES: ReadonlySet<string> = new Set(
  SHOPEE_VALIDATION_ACTUAL_TYPES,
);

/**
 * Fronteira final entre o validador e o log: reconfere o issue contra os
 * vocabulários fechados e copia campo a campo. Um `code`/`fieldPath`/
 * `actualType` fora do vocabulário derruba o diagnóstico inteiro (fecha em
 * `{}`, nunca propaga o valor não reconhecido), e nenhuma chave extra de um
 * issue adulterado sobrevive à cópia — é o que garante que só metadado
 * fechado chega a `SHOPEE_ORDER_SYNC_FAILED`.
 */
export function sanitizeShopeeOrderDetailValidationIssue(
  issue: unknown,
): ShopeeOrderValidationDiagnostics {
  if (typeof issue !== 'object' || issue === null || Array.isArray(issue)) {
    return {};
  }
  const raw = issue as Record<string, unknown>;

  const code = raw.code;
  const fieldPath = raw.fieldPath;
  const actualType = raw.actualType;
  if (
    typeof code !== 'string' ||
    !VALIDATION_ISSUE_CODES.has(code) ||
    typeof fieldPath !== 'string' ||
    !VALIDATION_FIELD_PATHS.has(fieldPath) ||
    typeof actualType !== 'string' ||
    !VALIDATION_ACTUAL_TYPES.has(actualType)
  ) {
    return {};
  }

  const orderIndex = raw.orderIndex;
  const validOrderIndex =
    typeof orderIndex === 'number' &&
    Number.isSafeInteger(orderIndex) &&
    orderIndex >= 0;

  return {
    validationIssueCode: code as ShopeeOrderDetailValidationIssueCode,
    validationFieldPath: fieldPath as ShopeeOrderDetailValidationFieldPath,
    validationActualType: actualType as ShopeeValidationActualType,
    ...(validOrderIndex ? { validationOrderIndex: orderIndex } : {}),
  };
}

/**
 * Diagnóstico fechado anexado a `ShopeeOrdersSyncError`
 * (`shopee-orders-sync-error.ts`) — o vocabulário completo permitido no log
 * `SHOPEE_ORDER_SYNC_FAILED`, exceto `failureCode`/`marketplaceAccountId`/
 * `syncRunId` (resolvidos só em `ShopeeOrdersSyncService`, o único nível que
 * conhece a conta/execução).
 */
export interface ShopeeOrderSyncFailureDiagnostics extends ShopeeOrdersHttpDiagnostics {
  stage: ShopeeOrderSyncStage;
  outcomeKind?: ShopeeOrderSyncOutcomeKind;
  mappingReason?: ShopeeOrderMappingErrorReason;
  blockIndex?: number;
  batchIndex?: number;
}

/** Payload final do log `SHOPEE_ORDER_SYNC_FAILED` — mesmos campos de {@link ShopeeOrderSyncFailureDiagnostics} mais os três resolvidos em nível de sincronização. */
export interface ShopeeOrderSyncFailureLogPayload extends ShopeeOrderSyncFailureDiagnostics {
  failureCode: string;
  marketplaceAccountId: string;
  syncRunId?: string;
}

/**
 * Monta o payload final do log, omitindo toda chave cujo valor seja
 * `undefined` (nunca `"campo": undefined` no log estruturado) — a única
 * transformação aplicada aqui é remoção de ausência, nunca sanitização
 * adicional (isso já aconteceu na origem, em
 * `sanitizeShopeeOrdersProviderErrorCode`/`sanitizeShopeeOrdersProviderRequestId`).
 */
export function buildShopeeOrderSyncFailureLogPayload(input: {
  failureCode: string;
  marketplaceAccountId: string;
  syncRunId?: string;
  diagnostics: ShopeeOrderSyncFailureDiagnostics;
}): ShopeeOrderSyncFailureLogPayload {
  const full: ShopeeOrderSyncFailureLogPayload = {
    failureCode: input.failureCode,
    marketplaceAccountId: input.marketplaceAccountId,
    syncRunId: input.syncRunId,
    stage: input.diagnostics.stage,
    outcomeKind: input.diagnostics.outcomeKind,
    mappingReason: input.diagnostics.mappingReason,
    providerErrorCode: input.diagnostics.providerErrorCode,
    providerRequestId: input.diagnostics.providerRequestId,
    httpStatus: input.diagnostics.httpStatus,
    blockIndex: input.diagnostics.blockIndex,
    batchIndex: input.diagnostics.batchIndex,
    validationIssueCode: input.diagnostics.validationIssueCode,
    validationFieldPath: input.diagnostics.validationFieldPath,
    validationActualType: input.diagnostics.validationActualType,
    validationOrderIndex: input.diagnostics.validationOrderIndex,
  };
  const entries = Object.entries(full).filter(
    ([, value]) => value !== undefined,
  );
  return Object.fromEntries(entries) as ShopeeOrderSyncFailureLogPayload;
}
