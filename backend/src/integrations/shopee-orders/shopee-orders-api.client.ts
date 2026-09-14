import { Inject, Injectable } from '@nestjs/common';
import { parsePositiveSafeIntegerString } from '../shopee-oauth/shopee-decimal-id.util';
import { SHOPEE_CLOCK, SHOPEE_FETCH } from '../shopee-oauth/shopee-http.client';
import type { ShopeeClock } from '../shopee-oauth/shopee-http.client';
import { ShopeeCredentialsService } from '../shopee-oauth/shopee-credentials.service';
import { signShopeeShopRequest } from '../shopee-oauth/shopee-signature.util';
import { SHOPEE_ORDER_LIST_PATH } from './shopee-order-endpoints';
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
  | { kind: 'provider_rejected' }
  | { kind: 'rate_limited'; retryAfterMs: number | null }
  | { kind: 'temporary_failure' }
  | { kind: 'invalid_response' }
  | { kind: 'unknown_result' };

/**
 * Teto defensivo do corpo da resposta (Checkpoint CP2K-1) - mesmo espírito
 * de `ShopeeShopApiClient` (Checkpoint CP2I): mesmo no maior `page_size`
 * suportado (100) a resposta documentada só traz `order_sn` por item (poucas
 * dezenas de bytes cada), então 64 KiB é generoso e barra tanto um corpo
 * corrompido quanto uma resposta anormalmente grande antes de qualquer
 * `JSON.parse`.
 */
const MAX_RESPONSE_BYTES = 65536;

/**
 * Cliente interno, somente leitura, de `GET /api/v2/order/get_order_list`
 * (Checkpoint CP2K-1) - Shop API da Shopee, mesma assinatura de 5 parâmetros
 * (`signShopeeShopRequest`) já usada por `ShopeeShopApiClient`. Reaproveita
 * `SHOPEE_FETCH`/`SHOPEE_CLOCK` (mesmo relógio em SEGUNDOS) e o mesmo host
 * allowlist (`assertAllowedShopApiHost`, via `buildShopeeOrderListUrl`).
 *
 * Suporta apenas os 5 parâmetros específicos documentados neste checkpoint
 * (`time_range_field`/`time_from`/`time_to`/`page_size`/`cursor`) - NUNCA
 * `order_status`/`response_optional_fields`/`request_order_status_pending`/
 * `logistics_channel_id` (fora de escopo, ver CP2K-DOC).
 *
 * Nunca loga nada (nem `Logger`, nem `console`) e nunca inclui a URL
 * completa, a querystring, `access_token`, `sign` ou a Partner Key em
 * qualquer outcome. GET é idempotente, então HTTP 5xx vira
 * `temporary_failure` (retry manual futuro é seguro), nunca `unknown_result`
 * - esse `kind` fica reservado para falha de rede antes/durante o
 * recebimento de uma resposta completa.
 *
 * NUNCA retenta automaticamente nesta primeira versão - exatamente uma
 * tentativa de rede por chamada, sempre. Este cliente não pagina
 * sozinho, não mapeia pedidos e não persiste nada - isso é escopo de um
 * checkpoint futuro (serviço de sincronização).
 */
@Injectable()
export class ShopeeOrdersApiClient {
  constructor(
    private readonly credentialsService: ShopeeCredentialsService,
    @Inject(SHOPEE_FETCH) private readonly fetchImpl: typeof fetch,
    @Inject(SHOPEE_CLOCK) private readonly clock: ShopeeClock,
  ) {}

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
        // Mesma regra de `ShopeeShopApiClient`: qualquer rejeição depois de
        // chamar `fetch` nunca prova que a requisição não chegou - nunca
        // inspeciona `error.message` (poderia conter a URL completa).
        return { kind: 'unknown_result' };
      }

      if (response.status === 429) {
        return {
          kind: 'rate_limited',
          retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
        };
      }
      if (response.status >= 500) {
        return { kind: 'temporary_failure' };
      }

      let text: string;
      try {
        text = await readLimitedResponseText(response, MAX_RESPONSE_BYTES);
      } catch {
        if (controller.signal.aborted) return { kind: 'unknown_result' };
        return { kind: 'invalid_response' };
      }

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return { kind: 'invalid_response' };
      }

      if (typeof json !== 'object' || json === null) {
        return { kind: 'invalid_response' };
      }
      const raw = json as Record<string, unknown>;
      if (typeof raw.error === 'string' && raw.error.length > 0) {
        return { kind: 'provider_rejected' };
      }

      const validation = validateShopeeOrderListResponseBody(json);
      if (!validation.valid) return { kind: 'invalid_response' };

      return { kind: 'success', result: validation.result };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Duplicado deliberadamente de `shopee-shop-api.client.ts`/
 * `shopee-http.client.ts` - mesma razão de lá: nunca extraído para um util
 * compartilhado (evita acoplar `shopee-orders/` a detalhes internos de
 * `shopee-oauth/` além do que já é explicitamente exportado).
 */
function parseRetryAfterMs(headerValue: string | null): number | null {
  if (headerValue === null) return null;
  if (!/^\d+$/.test(headerValue)) return null;
  const seconds = Number(headerValue);
  if (!Number.isSafeInteger(seconds) || seconds < 0) return null;
  return seconds * 1000;
}

/**
 * Lê o corpo com um teto de tamanho (Checkpoint CP2K-1) - mesmas duas
 * camadas de `ShopeeShopApiClient.readLimitedResponseText` (Checkpoint CP2I,
 * revisado no CP2I-R1):
 *
 *   1. `Content-Length` declarado: se presente e maior que `maxBytes`,
 *      rejeita ANTES de chamar `response.text()`.
 *   2. Tamanho real pós-leitura: mesmo sem `Content-Length` (ausente ou
 *      mentiroso), o texto já lido é recontado em bytes UTF-8 e rejeitado se
 *      ultrapassar `maxBytes`.
 *
 * Risco documentado (mesmo aceito no CP2I, não resolvido aqui): quando
 * `Content-Length` está ausente ou mentiroso E o corpo real excede
 * `maxBytes`, a camada 1 não impede a leitura - `response.text()` ainda
 * bufferiza o corpo inteiro na memória antes da camada 2 rejeitá-lo. Sem
 * streaming (nenhum cliente HTTP do projeto usa). Mitigação aceita pelo
 * mesmo motivo do CP2I: o host de destino é sempre um dos dois hosts
 * fechados de `SHOPEE_ENDPOINTS[environment].shopApiHost`, e o path é
 * sempre a constante `SHOPEE_ORDER_LIST_PATH`, nunca recebidos por
 * parâmetro externo.
 */
async function readLimitedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader !== null) {
    const declaredBytes = Number(contentLengthHeader);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      throw new Error('SHOPEE_ORDER_LIST_RESPONSE_TOO_LARGE');
    }
  }

  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new Error('SHOPEE_ORDER_LIST_RESPONSE_TOO_LARGE');
  }
  return text;
}
