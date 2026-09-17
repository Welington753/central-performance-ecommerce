import { Inject, Injectable } from '@nestjs/common';
import { parsePositiveSafeIntegerString } from './shopee-decimal-id.util';
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
  | { kind: 'provider_rejected'; providerErrorCode: string }
  | { kind: 'rate_limited'; retryAfterMs: number | null }
  | { kind: 'invalid_response' }
  | { kind: 'unknown_result' };

/**
 * Vocabulário de diagnóstico seguro para `raw.error` (Checkpoint de
 * instrumentação da rejeição Live) — `raw.error` é entrada NÃO confiável
 * vinda do provedor: só um código curto (letras/dígitos/`_`/`-`/`.`/`:`,
 * até 64 caracteres) é aceito como `providerErrorCode`; qualquer outra
 * coisa (espaço, quebra de linha, símbolo fora da allowlist, ou tamanho
 * maior) vira o valor fixo abaixo — o valor original rejeitado NUNCA é
 * gravado nem logado em lugar nenhum, nem mesmo aqui.
 */
const PROVIDER_ERROR_CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
export const UNCLASSIFIED_PROVIDER_ERROR = 'UNCLASSIFIED_PROVIDER_ERROR';

export function sanitizeShopeeProviderErrorCode(rawError: string): string {
  return PROVIDER_ERROR_CODE_PATTERN.test(rawError)
    ? rawError
    : UNCLASSIFIED_PROVIDER_ERROR;
}

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
        return {
          kind: 'provider_rejected',
          providerErrorCode: sanitizeShopeeProviderErrorCode(raw.error),
        };
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
