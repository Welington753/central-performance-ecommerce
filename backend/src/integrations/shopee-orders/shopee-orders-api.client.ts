import { Inject, Injectable } from '@nestjs/common';
import { parsePositiveSafeIntegerString } from '../shopee-oauth/shopee-decimal-id.util';
import { SHOPEE_CLOCK, SHOPEE_FETCH } from '../shopee-oauth/shopee-http.client';
import type { ShopeeClock } from '../shopee-oauth/shopee-http.client';
import { ShopeeCredentialsService } from '../shopee-oauth/shopee-credentials.service';
import { signShopeeShopRequest } from '../shopee-oauth/shopee-signature.util';
import {
  SHOPEE_ORDER_DETAIL_PATH,
  SHOPEE_ORDER_LIST_PATH,
} from './shopee-order-endpoints';
import {
  ShopeeOrderListInput,
  ShopeeOrderListInputInvalidCode,
  validateShopeeOrderListInput,
} from './shopee-order-list-input';
import { buildShopeeOrderListUrl } from './shopee-order-list-url';
import {
  ShopeeOrderListResult,
  validateShopeeOrderListResponseBody,
} from './shopee-order-list-response';
import {
  ShopeeOrderDetailInput,
  ShopeeOrderDetailInputInvalidCode,
  validateShopeeOrderDetailInput,
} from './shopee-order-detail-input';
import { buildShopeeOrderDetailUrl } from './shopee-order-detail-url';
import {
  ShopeeOrderDetailResult,
  validateShopeeOrderDetailResponseBody,
} from './shopee-order-detail-response';
import {
  parseRetryAfterMs,
  readLimitedResponseText,
} from './shopee-orders-http.util';
import {
  sanitizeShopeeOrdersProviderErrorCode,
  sanitizeShopeeOrdersProviderRequestId,
  type ShopeeOrdersHttpDiagnostics,
} from './shopee-order-sync-diagnostics';

export interface ShopeeOrderListRequest extends ShopeeOrderListInput {
  accessToken: string;
  shopId: string;
}

export type ShopeeOrderListOutcome =
  | { kind: 'success'; result: ShopeeOrderListResult }
  | { kind: 'configuration_error'; failureCode: 'SHOPEE_NOT_CONFIGURED' }
  | {
      kind: 'invalid_request';
      failureCode:
        | 'INVALID_SHOP_ID'
        | 'INVALID_ACCESS_TOKEN'
        | ShopeeOrderListInputInvalidCode;
    }
  | { kind: 'provider_rejected'; diagnostics: ShopeeOrdersHttpDiagnostics }
  | {
      kind: 'rate_limited';
      retryAfterMs: number | null;
      diagnostics: ShopeeOrdersHttpDiagnostics;
    }
  | { kind: 'temporary_failure'; diagnostics: ShopeeOrdersHttpDiagnostics }
  | { kind: 'invalid_response'; diagnostics: ShopeeOrdersHttpDiagnostics }
  | { kind: 'unknown_result' };

export interface ShopeeOrderDetailRequest extends ShopeeOrderDetailInput {
  accessToken: string;
  shopId: string;
}

export type ShopeeOrderDetailOutcome =
  | { kind: 'success'; result: ShopeeOrderDetailResult }
  | { kind: 'configuration_error'; failureCode: 'SHOPEE_NOT_CONFIGURED' }
  | {
      kind: 'invalid_request';
      failureCode:
        | 'INVALID_SHOP_ID'
        | 'INVALID_ACCESS_TOKEN'
        | ShopeeOrderDetailInputInvalidCode;
    }
  | { kind: 'provider_rejected'; diagnostics: ShopeeOrdersHttpDiagnostics }
  | {
      kind: 'rate_limited';
      retryAfterMs: number | null;
      diagnostics: ShopeeOrdersHttpDiagnostics;
    }
  | { kind: 'temporary_failure'; diagnostics: ShopeeOrdersHttpDiagnostics }
  | { kind: 'invalid_response'; diagnostics: ShopeeOrdersHttpDiagnostics }
  | { kind: 'unknown_result' };

/**
 * Teto de `get_order_list` (CP2K-1): resposta só traz `order_sn` por item -
 * 64 KiB é generoso mesmo no maior `page_size` (100).
 */
const MAX_ORDER_LIST_RESPONSE_BYTES = 65536;

/**
 * Teto de `get_order_detail` (CP2K-2): MAIOR porque cada pedido traz
 * `item_list` completo. 512 KiB é ESTIMATIVA LOCAL nossa (50 pedidos *
 * (~500B + ~20 itens * ~300B) ≈ 325 KB), não um limite oficial da Shopee
 * nem um pior caso garantido pela documentação - só uma margem
 * conservadora acima da estimativa.
 */
const MAX_ORDER_DETAIL_RESPONSE_BYTES = 524288;

/**
 * Cliente interno, somente leitura, de `get_order_list`/`get_order_detail`
 * (Checkpoints CP2K-1/CP2K-2) - Shop API da Shopee, assinatura de 5
 * parâmetros (`signShopeeShopRequest`) já usada por `ShopeeShopApiClient`.
 * Reaproveita `SHOPEE_FETCH`/`SHOPEE_CLOCK` e o mesmo host allowlist
 * (`assertAllowedShopApiHost`). `get_order_detail` sempre usa
 * `response_optional_fields` fechado (`total_amount,item_list,
 * fulfillment_flag`) - nunca vindo do chamador, nunca campo pessoal.
 *
 * Nunca loga nada e nunca inclui URL/querystring/`access_token`/`sign`/
 * Partner Key em nenhum outcome. GET é idempotente, então HTTP 5xx vira
 * `temporary_failure`, nunca `unknown_result` (reservado para falha de rede
 * antes/durante o recebimento de uma resposta completa). NUNCA retenta
 * automaticamente - exatamente uma tentativa de rede por chamada. Não
 * pagina, não mapeia pedidos, não persiste nada - escopo de checkpoints
 * futuros.
 */
type ShopeeOrdersTransportOutcome<TResult> =
  | { kind: 'success'; result: TResult }
  | { kind: 'provider_rejected'; diagnostics: ShopeeOrdersHttpDiagnostics }
  | {
      kind: 'rate_limited';
      retryAfterMs: number | null;
      diagnostics: ShopeeOrdersHttpDiagnostics;
    }
  | { kind: 'temporary_failure'; diagnostics: ShopeeOrdersHttpDiagnostics }
  | { kind: 'invalid_response'; diagnostics: ShopeeOrdersHttpDiagnostics }
  | { kind: 'unknown_result' };

@Injectable()
export class ShopeeOrdersApiClient {
  constructor(
    private readonly credentialsService: ShopeeCredentialsService,
    @Inject(SHOPEE_FETCH) private readonly fetchImpl: typeof fetch,
    @Inject(SHOPEE_CLOCK) private readonly clock: ShopeeClock,
  ) {}

  /**
   * Transporte HTTP compartilhado por `getOrderList`/`getOrderDetail` (evita
   * duplicar fetch/timeout/limite de tamanho/parsing); cada método público
   * só monta sua própria URL/assinatura e passa seu validador de resposta.
   */
  private async executeGetOrdersRequest<TResult>(
    url: URL,
    httpTimeoutMs: number,
    maxBytes: number,
    validate: (
      json: unknown,
    ) => { valid: true; result: TResult } | { valid: false },
  ): Promise<ShopeeOrdersTransportOutcome<TResult>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), httpTimeoutMs);

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url.toString(), {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
      } catch {
        // Qualquer rejeição depois de chamar `fetch` nunca prova que a
        // requisição não chegou - nunca inspeciona `error.message` (poderia
        // conter a URL completa).
        return { kind: 'unknown_result' };
      }

      const httpStatus = response.status;

      if (httpStatus === 429) {
        return {
          kind: 'rate_limited',
          retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
          diagnostics: { httpStatus },
        };
      }
      if (httpStatus >= 500) {
        return { kind: 'temporary_failure', diagnostics: { httpStatus } };
      }

      let text: string;
      try {
        text = await readLimitedResponseText(response, maxBytes);
      } catch {
        if (controller.signal.aborted) return { kind: 'unknown_result' };
        return { kind: 'invalid_response', diagnostics: { httpStatus } };
      }

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return { kind: 'invalid_response', diagnostics: { httpStatus } };
      }

      if (typeof json !== 'object' || json === null) {
        return { kind: 'invalid_response', diagnostics: { httpStatus } };
      }
      const raw = json as Record<string, unknown>;
      // `request_id` é lido de forma independente da validação de schema
      // abaixo (nunca sensível, mas só incluído no diagnóstico quando passa
      // pelo próprio formato sanitizado — nunca o valor bruto sem checagem).
      const providerRequestId = sanitizeShopeeOrdersProviderRequestId(
        raw.request_id,
      );
      if (typeof raw.error === 'string' && raw.error.length > 0) {
        return {
          kind: 'provider_rejected',
          diagnostics: {
            httpStatus,
            providerErrorCode: sanitizeShopeeOrdersProviderErrorCode(raw.error),
            ...(providerRequestId !== undefined ? { providerRequestId } : {}),
          },
        };
      }

      const validation = validate(json);
      if (!validation.valid) {
        return {
          kind: 'invalid_response',
          diagnostics: {
            httpStatus,
            ...(providerRequestId !== undefined ? { providerRequestId } : {}),
          },
        };
      }

      return { kind: 'success', result: validation.result };
    } finally {
      clearTimeout(timeout);
    }
  }

  async getOrderList(
    input: ShopeeOrderListRequest,
  ): Promise<ShopeeOrderListOutcome> {
    let config;
    try {
      config = this.credentialsService.ensureCredentials();
    } catch {
      return {
        kind: 'configuration_error',
        failureCode: 'SHOPEE_NOT_CONFIGURED',
      };
    }

    if (parsePositiveSafeIntegerString(input.shopId) === null) {
      return { kind: 'invalid_request', failureCode: 'INVALID_SHOP_ID' };
    }
    if (input.accessToken.length === 0) {
      return { kind: 'invalid_request', failureCode: 'INVALID_ACCESS_TOKEN' };
    }

    const inputValidation = validateShopeeOrderListInput({
      timeRangeField: input.timeRangeField,
      timeFrom: input.timeFrom,
      timeTo: input.timeTo,
      pageSize: input.pageSize,
      cursor: input.cursor,
    });
    if (!inputValidation.valid) {
      return {
        kind: 'invalid_request',
        failureCode: inputValidation.failureCode,
      };
    }

    const { partnerId, partnerKey, environment, httpTimeoutMs } = config;
    if (parsePositiveSafeIntegerString(partnerId) === null) {
      // `partnerId` malformado vem da PRÓPRIA configuração (não de `input`
      // do chamador) - problema de configuração da aplicação, nunca
      // `invalid_request` (mesma distinção do CP2I).
      return {
        kind: 'configuration_error',
        failureCode: 'SHOPEE_NOT_CONFIGURED',
      };
    }

    const timestampSeconds = this.clock();
    const sign = signShopeeShopRequest({
      partnerId,
      partnerKey,
      apiPath: SHOPEE_ORDER_LIST_PATH,
      timestampSeconds,
      accessToken: input.accessToken,
      shopId: input.shopId,
    });

    const url = buildShopeeOrderListUrl({
      environment,
      partnerId,
      timestampSeconds,
      accessToken: input.accessToken,
      shopId: input.shopId,
      sign,
      timeRangeField: inputValidation.input.timeRangeField,
      timeFrom: inputValidation.input.timeFrom,
      timeTo: inputValidation.input.timeTo,
      pageSize: inputValidation.input.pageSize,
      cursor: inputValidation.input.cursor,
    });

    return this.executeGetOrdersRequest(
      url,
      httpTimeoutMs,
      MAX_ORDER_LIST_RESPONSE_BYTES,
      validateShopeeOrderListResponseBody,
    );
  }

  /**
   * `GET /api/v2/order/get_order_detail` (Checkpoint CP2K-2) - mesmo padrão
   * de `getOrderList`: valida entrada antes de qualquer fetch,
   * `response_optional_fields` é SEMPRE a constante fechada (nunca vinda do
   * chamador), uma única tentativa de rede, nunca loga nada.
   */
  async getOrderDetail(
    input: ShopeeOrderDetailRequest,
  ): Promise<ShopeeOrderDetailOutcome> {
    let config;
    try {
      config = this.credentialsService.ensureCredentials();
    } catch {
      return {
        kind: 'configuration_error',
        failureCode: 'SHOPEE_NOT_CONFIGURED',
      };
    }

    if (parsePositiveSafeIntegerString(input.shopId) === null) {
      return { kind: 'invalid_request', failureCode: 'INVALID_SHOP_ID' };
    }
    if (input.accessToken.length === 0) {
      return { kind: 'invalid_request', failureCode: 'INVALID_ACCESS_TOKEN' };
    }

    const inputValidation = validateShopeeOrderDetailInput({
      orderSnList: input.orderSnList,
    });
    if (!inputValidation.valid) {
      return {
        kind: 'invalid_request',
        failureCode: inputValidation.failureCode,
      };
    }

    const { partnerId, partnerKey, environment, httpTimeoutMs } = config;
    if (parsePositiveSafeIntegerString(partnerId) === null) {
      return {
        kind: 'configuration_error',
        failureCode: 'SHOPEE_NOT_CONFIGURED',
      };
    }

    const timestampSeconds = this.clock();
    const sign = signShopeeShopRequest({
      partnerId,
      partnerKey,
      apiPath: SHOPEE_ORDER_DETAIL_PATH,
      timestampSeconds,
      accessToken: input.accessToken,
      shopId: input.shopId,
    });

    const url = buildShopeeOrderDetailUrl({
      environment,
      partnerId,
      timestampSeconds,
      accessToken: input.accessToken,
      shopId: input.shopId,
      sign,
      orderSnList: inputValidation.input.orderSnList,
    });

    return this.executeGetOrdersRequest(
      url,
      httpTimeoutMs,
      MAX_ORDER_DETAIL_RESPONSE_BYTES,
      (json) =>
        validateShopeeOrderDetailResponseBody(
          json,
          inputValidation.input.orderSnList,
        ),
    );
  }
}
