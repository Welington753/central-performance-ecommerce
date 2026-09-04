import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MercadoLivreTokenResponse,
  validateTokenResponseBody,
} from './mercado-livre-token-response';

export type TokenExchangeOutcome =
  | { kind: 'success'; token: MercadoLivreTokenResponse }
  | { kind: 'definitive_error' }
  | { kind: 'client_configuration_error' }
  | { kind: 'unknown_result' }
  | { kind: 'invalid_response' };

/**
 * Vocabulário fechado EXCLUSIVO de `refreshToken` (correção de resiliência
 * OAuth) — nunca reagrupado de volta ao `TokenExchangeOutcome` do
 * `exchangeCode`, que serve um contrato diferente (callback de uma
 * autorização nova, sem conta a preservar). Quatro resultados, nunca
 * fundidos entre si:
 * - `invalid_grant`: o PRÓPRIO refresh_token foi rejeitado pelo Mercado
 *   Livre — a única confirmação real de que a autorização não vale mais.
 * - `invalid_client`: nosso `client_id`/`client_secret` está errado — erro
 *   GLOBAL da aplicação, nunca prova nada sobre o refresh_token desta conta.
 * - `temporary_failure`: DNS, conexão recusada, timeout antes de qualquer
 *   resposta, 429 ou 5xx — sempre recuperável automaticamente, nunca exige
 *   reconexão.
 * - `outcome_unknown`: a conexão morreu DEPOIS de já termos uma resposta
 *   (corpo cortado no meio da leitura) ou um 200 estruturalmente
 *   incompleto/malformado — o provedor pode ter processado a requisição
 *   mesmo assim, então é ambíguo, mas ainda assim recuperável (nunca vira
 *   reconexão imediata).
 */
export type RefreshTokenOutcome =
  | { kind: 'success'; token: MercadoLivreTokenResponse }
  | { kind: 'invalid_grant' }
  | { kind: 'invalid_client' }
  | { kind: 'temporary_failure'; retryAfterMs: number | null }
  | { kind: 'outcome_unknown' };

export type IdentityLookupOutcome =
  { kind: 'success'; externalUserId: number } | { kind: 'failure' };

const TOKEN_ENDPOINT = 'https://api.mercadolibre.com/oauth/token';
const IDENTITY_ENDPOINT = 'https://api.mercadolibre.com/users/me';

/**
 * Token de injeção explícito para `fetch` (Task 23's `MercadoLivreOAuthModule`
 * provê `{ provide: ML_FETCH, useValue: fetch }`). NÃO usar um valor padrão
 * de parâmetro (`fetchImpl: typeof fetch = fetch`) — Nest ignora defaults de
 * JS na resolução de DI; sem um token/`@Inject` explícito, o container tenta
 * resolver o segundo parâmetro pelo tipo refletido (`Function`), não encontra
 * provider nenhum, e falha ao compilar o módulo com "Nest can't resolve
 * dependencies of MercadoLivreHttpClient (?, ConfigService)".
 */
export const ML_FETCH = Symbol('ML_FETCH');

/**
 * Resultado bruto e interno de `postToken` — nunca exposto fora deste
 * arquivo. `exchangeCode` e `refreshToken` mapeiam este MESMO resultado
 * para dois vocabulários fechados diferentes (`toTokenExchangeOutcome`/
 * `toRefreshTokenOutcome`), sem duplicar a lógica de rede/parsing abaixo.
 */
type PostTokenRawOutcome =
  | { kind: 'success'; token: MercadoLivreTokenResponse }
  | { kind: 'network_failure' }
  | { kind: 'rate_limited'; retryAfterMs: number | null }
  | { kind: 'server_error' }
  | { kind: 'invalid_grant' }
  | { kind: 'invalid_client' }
  | { kind: 'other_client_error' }
  | { kind: 'read_interrupted' }
  | { kind: 'malformed_success_body' };

/**
 * Único ponto do sistema que faz chamadas HTTP reais ao Mercado Livre
 * (`/oauth/token`, `/users/me`) — `/authorization` NUNCA é chamado por aqui
 * (design §2, ver `build-authorization-url.ts`). `fetchImpl` é injetado via
 * `ML_FETCH`, permitindo mock total na fronteira HTTP em todos os testes
 * (que continuam instanciando a classe diretamente com `new`, então o token
 * de DI não afeta a forma de testar — só a forma como o Nest resolve a
 * dependência em produção).
 */
@Injectable()
export class MercadoLivreHttpClient {
  constructor(
    private readonly configService: ConfigService,
    @Inject(ML_FETCH) private readonly fetchImpl: typeof fetch,
  ) {}

  private get timeoutMs(): number {
    return this.configService.get<number>('ML_HTTP_TIMEOUT_MS', 10000);
  }

  async exchangeCode(input: {
    code: string;
    codeVerifier: string;
  }): Promise<TokenExchangeOutcome> {
    const raw = await this.postToken({
      grant_type: 'authorization_code',
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: this.configService.getOrThrow<string>('ML_REDIRECT_URI'),
    });
    return this.toTokenExchangeOutcome(raw);
  }

  async refreshToken(input: {
    refreshToken: string;
  }): Promise<RefreshTokenOutcome> {
    const raw = await this.postToken({
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
    });
    return this.toRefreshTokenOutcome(raw);
  }

  async fetchIdentity(accessToken: string): Promise<IdentityLookupOutcome> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(IDENTITY_ENDPOINT, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });

      if (!response.ok) return { kind: 'failure' };

      const body = (await response.json()) as Record<string, unknown>;
      if (typeof body.id !== 'number') return { kind: 'failure' };

      return { kind: 'success', externalUserId: body.id };
    } catch {
      // Cobre tanto falha de rede/timeout quanto corpo não-JSON — para
      // /users/me o design não distingue essas causas, ambas viram
      // IDENTITY_LOOKUP_FAILED no chamador (Task 19).
      return { kind: 'failure' };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Mapeamento usado pelo callback de uma autorização NOVA (Task 19) —
   * preservado byte a byte do comportamento anterior à correção de
   * resiliência: `invalid_client` aqui vira o MESMO `client_configuration_error`
   * de sempre (nunca `definitive_error`), e qualquer falha de rede/429/5xx/
   * corpo cortado no meio da leitura continua caindo em `unknown_result`.
   */
  private toTokenExchangeOutcome(
    raw: PostTokenRawOutcome,
  ): TokenExchangeOutcome {
    switch (raw.kind) {
      case 'success':
        return raw;
      case 'invalid_grant':
        return { kind: 'definitive_error' };
      case 'invalid_client':
        return { kind: 'client_configuration_error' };
      case 'malformed_success_body':
        return { kind: 'invalid_response' };
      case 'network_failure':
      case 'rate_limited':
      case 'server_error':
      case 'other_client_error':
      case 'read_interrupted':
        return { kind: 'unknown_result' };
    }
  }

  /**
   * Mapeamento usado pela RENOVAÇÃO (correção de resiliência OAuth) — ver o
   * comentário de `RefreshTokenOutcome` para a justificativa de cada balde.
   * `other_client_error` (um 4xx com um `error` que não reconhecemos) entra
   * em `outcome_unknown`, não `temporary_failure`: recebemos uma resposta
   * completa e legível do provedor, só não sabemos o que ela significa —
   * bem diferente de uma falha de rede/rate-limit onde sabemos exatamente
   * a causa e que é seguro tentar de novo.
   */
  private toRefreshTokenOutcome(raw: PostTokenRawOutcome): RefreshTokenOutcome {
    switch (raw.kind) {
      case 'success':
        return raw;
      case 'invalid_grant':
        return { kind: 'invalid_grant' };
      case 'invalid_client':
        return { kind: 'invalid_client' };
      case 'network_failure':
        return { kind: 'temporary_failure', retryAfterMs: null };
      case 'rate_limited':
        return { kind: 'temporary_failure', retryAfterMs: raw.retryAfterMs };
      case 'server_error':
        return { kind: 'temporary_failure', retryAfterMs: null };
      case 'other_client_error':
      case 'read_interrupted':
      case 'malformed_success_body':
        return { kind: 'outcome_unknown' };
    }
  }

  private async postToken(
    params: Record<string, string>,
  ): Promise<PostTokenRawOutcome> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const body = new URLSearchParams({
      ...params,
      client_id: this.configService.getOrThrow<string>('ML_CLIENT_ID'),
      client_secret: this.configService.getOrThrow<string>('ML_CLIENT_SECRET'),
    });

    // O `clearTimeout` só roda no `finally` MAIS EXTERNO — o timeout cobre a
    // operação INTEIRA (fetch + leitura do corpo + validação), não só o
    // retorno dos headers do `fetch`. O corpo/mensagem bruta do provedor
    // NUNCA é logado nem armazenado em nenhum ramo abaixo — só o campo
    // `error` estruturado é inspecionado, em memória, quando necessário para
    // classificar o resultado.
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(TOKEN_ENDPOINT, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
          signal: controller.signal,
        });
      } catch {
        // Nenhuma resposta chegou a existir: DNS, conexão recusada, ou
        // nosso próprio timeout disparando antes de qualquer byte de volta.
        // Nunca prova que o provedor processou a requisição — sempre seguro
        // reenviar o MESMO refresh_token depois.
        return { kind: 'network_failure' };
      }

      // 408 (timeout do lado do provedor): o provedor respondeu, mas nunca
      // chegou a avaliar o refresh_token — mesmo balde de 5xx.
      if (response.status === 408) return { kind: 'server_error' };
      if (response.status === 429) {
        return {
          kind: 'rate_limited',
          retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
        };
      }

      if (response.status >= 400 && response.status < 500) {
        // Só `invalid_grant` é uma rejeição DEFINITIVA do refresh_token em
        // si. `invalid_client` (client_id/client_secret mal configurados no
        // nosso lado) nunca prova nada sobre o refresh_token do usuário.
        // Qualquer outro código de erro 4xx reconhecível permanece
        // `other_client_error` — resposta completa, significado
        // desconhecido, nunca tratado como falha de rede segura de repetir.
        let errorCode: unknown;
        try {
          const errorBody = (await response.json()) as Record<string, unknown>;
          errorCode = errorBody.error;
        } catch {
          errorCode = undefined;
        }
        // Um abort (timeout) no meio da leitura deste corpo de erro prova
        // que JÁ recebemos os headers/status — connection interrompida
        // DEPOIS do envio, nunca confundida com uma falha de rede limpa.
        if (controller.signal.aborted) return { kind: 'read_interrupted' };
        if (errorCode === 'invalid_grant') return { kind: 'invalid_grant' };
        if (errorCode === 'invalid_client') return { kind: 'invalid_client' };
        return { kind: 'other_client_error' };
      }

      if (!response.ok) {
        // 5xx e qualquer outro status não coberto acima.
        return { kind: 'server_error' };
      }

      // Um 200 cujo corpo não é JSON válido: se o abort disparou durante a
      // leitura, a causa é a conexão interrompida DEPOIS de já termos uma
      // resposta 200 (read_interrupted), nunca um corpo malformado por si só.
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        if (controller.signal.aborted) return { kind: 'read_interrupted' };
        return { kind: 'malformed_success_body' };
      }

      const validation = validateTokenResponseBody(json);
      if (!validation.valid) return { kind: 'malformed_success_body' };

      return { kind: 'success', token: validation.token };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * `Retry-After` só é honrado quando é um inteiro de segundos válido e não
 * negativo (formato HTTP-date não é suportado — nunca inventa um valor).
 * Duplicado deliberadamente do equivalente em `amazon-sp-api.client.ts`
 * (não extraído para um util compartilhado) para nunca tocar o módulo
 * Amazon nesta correção.
 */
function parseRetryAfterMs(headerValue: string | null): number | null {
  if (headerValue === null) return null;
  if (!/^\d+$/.test(headerValue)) return null;
  const seconds = Number(headerValue);
  if (!Number.isSafeInteger(seconds) || seconds < 0) return null;
  return seconds * 1000;
}
