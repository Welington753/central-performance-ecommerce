import { Inject, Injectable } from '@nestjs/common';
import { parsePositiveSafeIntegerString } from './shopee-decimal-id.util';
import { SHOPEE_SHOP_INFO_PATH } from './shopee-endpoints';
import { SHOPEE_CLOCK, SHOPEE_FETCH } from './shopee-http.client';
import type { ShopeeClock } from './shopee-http.client';
import { ShopeeCredentialsService } from './shopee-credentials.service';
import { buildShopeeShopInfoUrl } from './shopee-shop-api-url';
import { signShopeeShopRequest } from './shopee-signature.util';
import {
  ShopeeShopInfoResult,
  validateShopeeShopInfoResponseBody,
} from './shopee-shop-info-response';

export type ShopeeShopInfoOutcome =
  | { kind: 'success'; shopInfo: ShopeeShopInfoResult }
  | { kind: 'configuration_error'; failureCode: 'SHOPEE_NOT_CONFIGURED' }
  | {
      kind: 'invalid_request';
      failureCode: 'INVALID_SHOP_ID' | 'INVALID_ACCESS_TOKEN';
    }
  | { kind: 'provider_rejected' }
  | { kind: 'rate_limited'; retryAfterMs: number | null }
  | { kind: 'temporary_failure' }
  | { kind: 'invalid_response' }
  | { kind: 'unknown_result' };

/**
 * Teto defensivo do corpo da resposta (Checkpoint CP2I) — a resposta de
 * `get_shop_info` documentada é pequena (poucas dezenas de campos
 * escalares); 64 KiB já é generoso e barra tanto uma resposta corrompida
 * quanto um `message`/campo desconhecido anormalmente grande antes de
 * qualquer `JSON.parse`.
 */
const MAX_RESPONSE_BYTES = 65536;

/**
 * Cliente interno, somente leitura, de `GET /api/v2/shop/get_shop_info`
 * (Checkpoint CP2I) — Shop API da Shopee, assinatura de 5 parâmetros
 * (`signShopeeShopRequest`), distinta da Public API usada por
 * `ShopeeHttpClient`. Reaproveita `SHOPEE_FETCH`/`SHOPEE_CLOCK` (mesmo
 * relógio em SEGUNDOS já usado para a assinatura da Public API) — não há
 * razão para uma instância própria aqui, ao contrário do relógio em
 * milissegundos de `ShopeeAccessTokenService` (unidade/uso diferentes).
 *
 * Nunca loga nada (nem `Logger`, nem `console`) e nunca inclui a URL
 * completa, a querystring, `access_token`, `sign` ou a Partner Key em
 * qualquer outcome — a união fechada acima nunca carrega esses valores. GET
 * é idempotente (nenhum token de uso único é consumido aqui, ao contrário do
 * fluxo de refresh), então HTTP 5xx é classificado como `temporary_failure`
 * (retry manual futuro é seguro), nunca `unknown_result` — esse `kind` fica
 * reservado para uma falha de rede antes/durante o recebimento de uma
 * resposta completa (ambiguidade real sobre se o provedor respondeu).
 *
 * NUNCA retenta automaticamente nesta primeira versão — exatamente uma
 * tentativa de rede por chamada, sempre.
 */
@Injectable()
export class ShopeeShopApiClient {
  constructor(
    private readonly credentialsService: ShopeeCredentialsService,
    @Inject(SHOPEE_FETCH) private readonly fetchImpl: typeof fetch,
    @Inject(SHOPEE_CLOCK) private readonly clock: ShopeeClock,
  ) {}

  async getShopInfo(input: {
    accessToken: string;
    shopId: string;
  }): Promise<ShopeeShopInfoOutcome> {
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

    const { partnerId, partnerKey, environment, httpTimeoutMs } = config;
    if (parsePositiveSafeIntegerString(partnerId) === null) {
      // `partnerId` malformado vem da PRÓPRIA configuração (não de `input`
      // do chamador) — é um problema de configuração da aplicação, nunca
      // `invalid_request` (que é sobre a entrada do chamador).
      return {
        kind: 'configuration_error',
        failureCode: 'SHOPEE_NOT_CONFIGURED',
      };
    }
    const timestampSeconds = this.clock();
    const sign = signShopeeShopRequest({
      partnerId,
      partnerKey,
      apiPath: SHOPEE_SHOP_INFO_PATH,
      timestampSeconds,
      accessToken: input.accessToken,
      shopId: input.shopId,
    });

    const url = buildShopeeShopInfoUrl({
      environment,
      partnerId,
      timestampSeconds,
      accessToken: input.accessToken,
      shopId: input.shopId,
      sign,
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
        // Mesma regra de `ShopeeHttpClient`: qualquer rejeição depois de
        // chamar `fetch` nunca prova que a requisição não chegou — nunca
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

      const validation = validateShopeeShopInfoResponseBody(json);
      if (!validation.valid) return { kind: 'invalid_response' };

      return { kind: 'success', shopInfo: validation.shopInfo };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Duplicado deliberadamente de `shopee-http.client.ts` — mesma razão de lá:
 * nunca extraído para um util compartilhado entre marketplaces.
 */
function parseRetryAfterMs(headerValue: string | null): number | null {
  if (headerValue === null) return null;
  if (!/^\d+$/.test(headerValue)) return null;
  const seconds = Number(headerValue);
  if (!Number.isSafeInteger(seconds) || seconds < 0) return null;
  return seconds * 1000;
}

/**
 * Lê o corpo com um teto de tamanho (Checkpoint CP2I, revisado no CP2I-R1).
 * Duas camadas, nessa ordem:
 *
 *   1. `Content-Length` declarado: se presente e maior que `maxBytes`,
 *      rejeita ANTES de chamar `response.text()` — o corpo nunca chega a ser
 *      lido nesse caso (provado por
 *      `shopee-shop-api.client.outcomes.spec.ts`, que espia o mock de
 *      `text()` e confirma que ele nunca é invocado).
 *   2. Tamanho real pós-leitura: mesmo sem `Content-Length` (ausente ou
 *      mentiroso), o texto já lido é recontado em bytes UTF-8 e rejeitado se
 *      ultrapassar `maxBytes` — cobre o caso do passo 1 não disparar.
 *
 * Em ambos os casos o erro lançado (`SHOPEE_SHOP_API_RESPONSE_TOO_LARGE`) é
 * um código fixo, nunca interpola o corpo/texto lido — o chamador mapeia
 * qualquer rejeição daqui para `invalid_response` sem nunca logar ou incluir
 * o conteúdo bruto em lugar nenhum (outcome ou log).
 *
 * Risco documentado (aceito neste checkpoint, não resolvido): quando
 * `Content-Length` está ausente ou mentiroso E o corpo real excede
 * `maxBytes`, a camada 1 não impede a leitura — `response.text()` ainda
 * bufferiza o corpo inteiro na memória do processo antes da camada 2
 * conseguir rejeitá-lo. NÃO existe aqui um limite rígido de memória via
 * streaming (nenhum cliente HTTP do projeto usa streaming —
 * `ShopeeHttpClient`/`AmazonLwaClient` têm a mesma limitação). Mitigação
 * aceita apenas porque: (a) o host de destino é sempre um dos dois hosts
 * fechados de `SHOPEE_ENDPOINTS[environment].shopApiHost`, nunca um host
 * arbitrário/externo; (b) o path é sempre a constante `SHOPEE_SHOP_INFO_PATH`,
 * nunca recebido por parâmetro. Uma solução real (streaming com corte no
 * primeiro byte acima do teto) fica fora de escopo deste checkpoint — não
 * fazer aqui uma refatoração ampla compartilhada com
 * `ShopeeHttpClient`/`AmazonLwaClient`.
 */
async function readLimitedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader !== null) {
    const declaredBytes = Number(contentLengthHeader);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      throw new Error('SHOPEE_SHOP_API_RESPONSE_TOO_LARGE');
    }
  }

  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new Error('SHOPEE_SHOP_API_RESPONSE_TOO_LARGE');
  }
  return text;
}
