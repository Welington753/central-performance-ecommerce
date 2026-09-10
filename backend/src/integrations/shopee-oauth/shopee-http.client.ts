import { Inject, Injectable } from '@nestjs/common';
import { ShopeeCredentialsService } from './shopee-credentials.service';
import { signShopeePublicRequest } from './shopee-signature.util';
import {
  ShopeeTokenResult,
  validateShopeeTokenResponseBody,
} from './shopee-token-response';
import {
  SHOPEE_REFRESH_TOKEN_PATH,
  SHOPEE_TOKEN_PATH,
} from './shopee-endpoints';

export type ShopeeTokenOutcome =
  | { kind: 'success'; token: ShopeeTokenResult }
  | { kind: 'configuration_error'; failureCode: 'SHOPEE_NOT_CONFIGURED' }
  | { kind: 'invalid_request'; failureCode: 'INVALID_AUTHORIZATION_RESPONSE' }
  | { kind: 'provider_rejected' }
  | { kind: 'rate_limited'; retryAfterMs: number | null }
  | { kind: 'invalid_response' }
  | { kind: 'unknown_result' };

/**
 * Token de injeção explícito para `fetch` — mesmo motivo de `ML_FETCH`
 * (`mercado-livre-http.client.ts`): sem um token/`@Inject` explícito, o
 * Nest não consegue resolver a dependência pelo tipo refletido (`Function`).
 * Os testes continuam instanciando a classe diretamente com `new`, então o
 * token de DI não afeta a forma de testar.
 */
export const SHOPEE_FETCH = Symbol('SHOPEE_FETCH');

/**
 * Relógio injetável (Checkpoint CP2B) — devolve o timestamp Shopee em
 * SEGUNDOS (nunca milissegundos). Permite testes determinísticos da
 * assinatura sem depender de `Date.now()` real.
 */
export const SHOPEE_CLOCK = Symbol('SHOPEE_CLOCK');
export type ShopeeClock = () => number;

function defaultShopeeClock(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Converte uma string decimal para `number` SOMENTE depois de confirmar que
 * ela representa um inteiro positivo seguro (Checkpoint CP2B — revisão de
 * segurança, "Correção 4"): nunca aceita sinal negativo, zero, caracteres
 * não numéricos, nem um valor que exceda `Number.MAX_SAFE_INTEGER`. A
 * comparação `String(parsed) !== value` cobre dois problemas ao mesmo
 * tempo: perda de precisão (um valor grande demais arredonda na conversão,
 * então o round-trip nunca bate) E zeros à esquerda (`"007"` nunca é uma
 * representação canônica de `7`, mesmo sendo numericamente válida) — a
 * Shopee nunca envia nenhum dos dois formatos para IDs reais.
 */
function parsePositiveSafeIntegerString(value: string): number | null {
  if (!/^[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  if (String(parsed) !== value) return null;
  return parsed;
}

/**
 * Cliente HTTP Shopee (Checkpoint CP2B, revisado na revisão de segurança
 * subsequente) — SOMENTE troca de code por tokens e renovação. Nenhum
 * controller/callback consome esta classe ainda.
 *
 * NUNCA retenta automaticamente `exchangeAuthorizationCode`/
 * `refreshAccessToken`: `code` é de uso único (expira em 10 minutos) e
 * `refresh_token` é rotativo (cada renovação emite um novo, que deve
 * substituir o anterior) — reenviar a mesma requisição após qualquer
 * rejeição de rede arrisca descartar um token novo que a Shopee já emitiu.
 * Por isso esta classe faz exatamente UMA tentativa de rede por chamada,
 * sempre — e NUNCA afirma que uma requisição "não chegou" ao provedor: uma
 * vez que `fetch` foi chamado, qualquer rejeição (timeout, abort, DNS, TLS,
 * reset de conexão, erro genérico) é tratada como `unknown_result`
 * (ambígua), nunca como prova de que nada foi recebido do outro lado —
 * não existe, nesta API, um jeito comprovável de garantir isso.
 *
 * NUNCA loga: URL completa (contém `sign`), Partner Key, `code`,
 * `access_token`, `refresh_token`, nem o corpo/mensagem bruta da Shopee —
 * o outcome nunca transporta nada disso, só os sete `kind` fechados acima.
 *
 * Não persiste nada no banco, não descriptografa tokens — puramente a
 * fronteira HTTP, como `MercadoLivreHttpClient`/`AmazonSpApiClient`.
 */
@Injectable()
export class ShopeeHttpClient {
  constructor(
    private readonly credentialsService: ShopeeCredentialsService,
    @Inject(SHOPEE_FETCH) private readonly fetchImpl: typeof fetch,
    @Inject(SHOPEE_CLOCK)
    private readonly clock: ShopeeClock = defaultShopeeClock,
  ) {}

  async exchangeAuthorizationCode(input: {
    code: string;
    shopId: string;
  }): Promise<ShopeeTokenOutcome> {
    if (input.code.length === 0) {
      return {
        kind: 'invalid_request',
        failureCode: 'INVALID_AUTHORIZATION_RESPONSE',
      };
    }
    return this.postPublicToken(
      SHOPEE_TOKEN_PATH,
      input.shopId,
      (shopIdNumber) => ({
        code: input.code,
        shop_id: shopIdNumber,
      }),
    );
  }

  async refreshAccessToken(input: {
    refreshToken: string;
    shopId: string;
  }): Promise<ShopeeTokenOutcome> {
    if (input.refreshToken.length === 0) {
      return {
        kind: 'invalid_request',
        failureCode: 'INVALID_AUTHORIZATION_RESPONSE',
      };
    }
    return this.postPublicToken(
      SHOPEE_REFRESH_TOKEN_PATH,
      input.shopId,
      (shopIdNumber) => ({
        refresh_token: input.refreshToken,
        shop_id: shopIdNumber,
      }),
    );
  }

  /**
   * Assinatura Public API (`partner_id + api_path + timestamp`) — os dois
   * endpoints de token/refresh usam a mesma forma, nunca a Shop API.
   * `partner_id`/`shop_id` usam a representação decimal em STRING na query
   * e na assinatura (`signShopeePublicRequest` exige `string`, para nunca
   * perder precisão) — só no corpo JSON, exigido pelo contrato da Shopee,
   * eles são convertidos para `number`, e só DEPOIS de validados como
   * inteiro positivo seguro (nunca antes).
   */
  private async postPublicToken(
    apiPath: string,
    shopId: string,
    buildBodyFields: (shopIdNumber: number) => Record<string, string | number>,
  ): Promise<ShopeeTokenOutcome> {
    let config;
    try {
      config = this.credentialsService.ensureCredentials();
    } catch {
      return {
        kind: 'configuration_error',
        failureCode: 'SHOPEE_NOT_CONFIGURED',
      };
    }
    const { partnerId, partnerKey, apiHost, httpTimeoutMs } = config;

    const shopIdNumber = parsePositiveSafeIntegerString(shopId);
    if (shopIdNumber === null) {
      return {
        kind: 'invalid_request',
        failureCode: 'INVALID_AUTHORIZATION_RESPONSE',
      };
    }

    const partnerIdNumber = parsePositiveSafeIntegerString(partnerId);
    if (partnerIdNumber === null) {
      return {
        kind: 'invalid_request',
        failureCode: 'INVALID_AUTHORIZATION_RESPONSE',
      };
    }

    const timestampSeconds = this.clock();
    const sign = signShopeePublicRequest({
      partnerId,
      partnerKey,
      apiPath,
      timestampSeconds,
    });

    const url = new URL(apiPath, apiHost);
    url.searchParams.set('partner_id', partnerId);
    url.searchParams.set('timestamp', String(timestampSeconds));
    url.searchParams.set('sign', sign);

    const requestBody = JSON.stringify({
      ...buildBodyFields(shopIdNumber),
      partner_id: partnerIdNumber,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), httpTimeoutMs);

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody,
          signal: controller.signal,
        });
      } catch {
        // Qualquer rejeição DEPOIS de chamar `fetch` (timeout/AbortError,
        // DNS, TLS, reset de conexão, ou qualquer outro `TypeError`) é
        // ambígua — a Shopee pode já ter recebido e processado o
        // code/refresh_token antes da conexão cair. Nunca afirmamos "não
        // chegou": não existe, nesta fronteira, uma forma comprovável de
        // garantir isso.
        return { kind: 'unknown_result' };
      }

      if (response.status === 429) {
        return {
          kind: 'rate_limited',
          retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
        };
      }

      if (response.status >= 500) {
        // Resposta completa recebida, mas o provedor sinalizou falha do
        // lado dele — ambíguo se o code/refresh_token foi consumido.
        return { kind: 'unknown_result' };
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        // Um abort (nosso timeout) disparando DURANTE a leitura do corpo de
        // uma resposta 2xx já recebida é a mesma ambiguidade de
        // "unknown_result" — nunca prova que o corpo era estruturalmente
        // inválido. Sem abort, é um corpo genuinamente não-JSON.
        if (controller.signal.aborted) return { kind: 'unknown_result' };
        return { kind: 'invalid_response' };
      }

      if (typeof json !== 'object' || json === null) {
        return { kind: 'invalid_response' };
      }
      const raw = json as Record<string, unknown>;
      if (typeof raw.error === 'string' && raw.error.length > 0) {
        return { kind: 'provider_rejected' };
      }

      const validation = validateShopeeTokenResponseBody(json);
      if (!validation.valid) return { kind: 'invalid_response' };

      return { kind: 'success', token: validation.token };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * `Retry-After` só é honrado quando é um inteiro de segundos válido e não
 * negativo (formato HTTP-date não é suportado — nunca inventa um valor).
 * Duplicado deliberadamente do equivalente em `mercado-livre-http.client.ts`/
 * `amazon-sp-api.client.ts` — nunca extraído para um util compartilhado,
 * para nunca acoplar os três módulos de marketplace entre si.
 */
function parseRetryAfterMs(headerValue: string | null): number | null {
  if (headerValue === null) return null;
  if (!/^\d+$/.test(headerValue)) return null;
  const seconds = Number(headerValue);
  if (!Number.isSafeInteger(seconds) || seconds < 0) return null;
  return seconds * 1000;
}
