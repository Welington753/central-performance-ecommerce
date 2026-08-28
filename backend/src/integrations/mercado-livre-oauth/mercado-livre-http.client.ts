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
    return this.postToken({
      grant_type: 'authorization_code',
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: this.configService.getOrThrow<string>('ML_REDIRECT_URI'),
    });
  }

  async refreshToken(input: {
    refreshToken: string;
  }): Promise<TokenExchangeOutcome> {
    return this.postToken({
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
    });
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

  private async postToken(
    params: Record<string, string>,
  ): Promise<TokenExchangeOutcome> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const body = new URLSearchParams({
      ...params,
      client_id: this.configService.getOrThrow<string>('ML_CLIENT_ID'),
      client_secret: this.configService.getOrThrow<string>('ML_CLIENT_SECRET'),
    });

    // O `clearTimeout` só roda no `finally` MAIS EXTERNO — o timeout cobre a
    // operação INTEIRA (fetch + leitura do corpo + validação), não só o
    // retorno dos headers do `fetch`. Uma versão anterior deste método
    // limpava o timer logo após o `fetch` resolver, antes de
    // `response.json()` terminar — um corpo lento a ler corria então sem
    // limite de tempo nenhum, apesar de `ML_HTTP_TIMEOUT_MS` existir. O
    // corpo/mensagem bruta do provedor NUNCA é logado nem armazenado em
    // nenhum ramo abaixo — só o campo `error` estruturado é inspecionado,
    // em memória, quando necessário para classificar o resultado.
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
        // Timeout (abort) ou falha de rede antes mesmo de haver resposta —
        // resultado DESCONHECIDO (design §6.2), nunca reenviado como
        // rejeição definitiva do code/refresh_token.
        return { kind: 'unknown_result' };
      }

      // 408 (timeout do lado do provedor) e 429 (rate limit) são falhas do
      // PROVEDOR, não uma rejeição do code/refresh_token apresentado —
      // sempre resultado desconhecido/transitório.
      if (response.status === 408 || response.status === 429) {
        return { kind: 'unknown_result' };
      }

      if (response.status >= 400 && response.status < 500) {
        // Só `invalid_grant` é uma rejeição DEFINITIVA do code/refresh_token
        // em si (design §7/§8: mapeia para TOKEN_EXCHANGE_FAILED no
        // callback, REFRESH_TOKEN_REJECTED/TOKEN_EXPIRED no refresh).
        //
        // `invalid_client` (client_id/client_secret mal configurados no
        // nosso lado) é um resultado ESTRUTURALMENTE DIFERENTE, nem
        // definitivo nem puramente desconhecido: o design §6.2 passo 7 o
        // cita ao lado de `invalid_grant` como falha definitiva de
        // callback (→ TOKEN_EXCHANGE_FAILED), mas no refresh (design §6.4)
        // ele NÃO prova que o refresh_token foi rejeitado — tratá-lo como
        // `definitive_error` ali faria um refresh_token perfeitamente
        // válido virar TOKEN_EXPIRED só porque a credencial do app está
        // errada, destruindo a conexão do usuário sem causa real no token
        // dele. Por isso ganha seu próprio `kind: 'client_configuration_error'`,
        // permitindo que cada chamador (Task 19 x Task 20) escolha o
        // mapeamento correto para o seu contexto, sem reintroduzir a
        // ambiguidade que `unknown_result` teria aqui.
        //
        // Qualquer outro código de erro 4xx, ou um corpo que nem chega a
        // ser JSON válido, permanece `unknown_result` — já aprovado no
        // design para timeout/5xx/resultado ambíguo.
        let errorCode: unknown;
        try {
          const errorBody = (await response.json()) as Record<string, unknown>;
          errorCode = errorBody.error;
        } catch {
          errorCode = undefined;
        }
        // Um abort (timeout) no meio da leitura deste corpo de erro não é
        // prova de corpo malformado — é a mesma condição "desconhecida" de
        // qualquer outro timeout, então tem prioridade sobre a falta de
        // `errorCode`.
        if (controller.signal.aborted) return { kind: 'unknown_result' };
        if (errorCode === 'invalid_grant') return { kind: 'definitive_error' };
        if (errorCode === 'invalid_client')
          return { kind: 'client_configuration_error' };
        return { kind: 'unknown_result' };
      }

      if (!response.ok) {
        // 5xx e qualquer outro status não coberto acima.
        return { kind: 'unknown_result' };
      }

      // Um 200 cujo corpo não é JSON válido é estruturalmente inválido — não
      // ambíguo como um timeout — então vira invalid_response. A exceção é
      // um abort no meio desta leitura: aí a causa é o timeout, não um
      // corpo malformado, então continua sendo unknown_result.
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        if (controller.signal.aborted) return { kind: 'unknown_result' };
        return { kind: 'invalid_response' };
      }

      const validation = validateTokenResponseBody(json);
      if (!validation.valid) return { kind: 'invalid_response' };

      return { kind: 'success', token: validation.token };
    } finally {
      clearTimeout(timeout);
    }
  }
}
