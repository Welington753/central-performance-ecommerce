import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Marketplace } from '../contracts/marketplace.enum';
import { EncryptionService } from '../../common/encryption/encryption.service';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { AdvisoryLockService } from '../shared/advisory-lock.service';
import { parsePositiveSafeIntegerString } from './shopee-decimal-id.util';
import { ShopeeHttpClient } from './shopee-http.client';

const DEFAULT_TOKEN_REFRESH_SKEW_SECONDS = 600;

/**
 * Relógio injetável (Checkpoint CP2H) — mesma forma de `SHOPEE_OAUTH_CLOCK`
 * (milissegundos desde a época), usado só para o cálculo do fast path de
 * skew. Instância própria (nunca compartilhada com `SHOPEE_OAUTH_CLOCK`):
 * este serviço não depende de `ShopeeOAuthService`.
 */
export const SHOPEE_ACCESS_TOKEN_CLOCK = Symbol('SHOPEE_ACCESS_TOKEN_CLOCK');
export type ShopeeAccessTokenClock = () => number;

function defaultShopeeAccessTokenClock(): number {
  return Date.now();
}

/**
 * Checkpoint CP2J — `accessToken` + `shopId` (`externalSellerId`) SEMPRE da
 * MESMA leitura/versão da conta: nunca um `shopId` relido separadamente
 * depois de obter o `accessToken`, o que arriscaria emparelhar um token com
 * o `shopId` de uma reconexão concorrente mais nova (ou vice-versa).
 * Estritamente interno — nunca serializado, logado, ou devolvido por um
 * controller.
 */
export interface ShopeeShopCredentials {
  accessToken: string;
  shopId: string;
}

/**
 * Orquestração segura de renovação do access token da Shopee (Checkpoint
 * CP2H) — extraído para um serviço dedicado (não `ShopeeOAuthService`, já
 * acima do limite de linhas do projeto). Estruturalmente inspirado em
 * `MercadoLivreOAuthService.ensureValidAccessToken`, mas NUNCA retenta a
 * mesma chamada de rede automaticamente após um resultado ambíguo: o
 * `refresh_token` da Shopee é de uso único (cada renovação bem-sucedida
 * emite um novo, que substitui o anterior), então reenviar o mesmo
 * `refresh_token` após um resultado ambíguo (timeout, JSON inválido, 5xx)
 * arriscaria uma segunda tentativa com um token que a Shopee já pode ter
 * consumido — ao contrário do Mercado Livre, aqui não existe um caminho de
 * backoff-com-retry seguro para esse caso.
 */
@Injectable()
export class ShopeeAccessTokenService {
  private readonly logger = new Logger(ShopeeAccessTokenService.name);

  constructor(
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
    private readonly advisoryLockService: AdvisoryLockService,
    private readonly httpClient: ShopeeHttpClient,
    private readonly encryptionService: EncryptionService,
    private readonly configService: ConfigService,
    @Inject(SHOPEE_ACCESS_TOKEN_CLOCK)
    private readonly clock: ShopeeAccessTokenClock = defaultShopeeAccessTokenClock,
  ) {}

  /** Wrapper compatível — só o `accessToken` de {@link ensureValidShopCredentials}. */
  async ensureValidAccessToken(accountId: string): Promise<string> {
    const { accessToken } = await this.ensureValidShopCredentials(accountId);
    return accessToken;
  }

  async ensureValidShopCredentials(
    accountId: string,
  ): Promise<ShopeeShopCredentials> {
    const skewMs = this.tokenRefreshSkewMs();

    const account = await this.assertEligibleForToken(accountId);
    if (this.isWithinSkew(account.tokenExpiresAt, skewMs)) {
      return this.buildCredentials(
        account,
        account.encryptedAccessToken as string,
      );
    }

    const lock = await this.advisoryLockService.tryAcquire(accountId);
    if (!lock) {
      throw new ConflictException('ACCOUNT_BUSY');
    }

    try {
      const reread = await this.assertEligibleForToken(accountId);
      if (this.isWithinSkew(reread.tokenExpiresAt, skewMs)) {
        return this.buildCredentials(
          reread,
          reread.encryptedAccessToken as string,
        );
      }

      return await this.attemptRefresh(reread);
    } finally {
      await lock.release();
    }
  }

  /**
   * Sempre extrai `shopId` do MESMO objeto `account` cujo `encryptedAccessToken`
   * está sendo descriptografado aqui — nunca de uma releitura separada.
   */
  private async buildCredentials(
    account: MarketplaceAccount,
    encryptedAccessToken: string,
  ): Promise<ShopeeShopCredentials> {
    const accessToken = await this.decryptOrMarkError(
      account,
      encryptedAccessToken,
    );
    return { accessToken, shopId: account.externalSellerId as string };
  }

  private async attemptRefresh(
    reread: MarketplaceAccount,
  ): Promise<ShopeeShopCredentials> {
    const refreshTokenPlain = await this.decryptOrMarkError(
      reread,
      reread.encryptedRefreshToken as string,
    );

    const outcome = await this.httpClient.refreshAccessToken({
      refreshToken: refreshTokenPlain,
      shopId: reread.externalSellerId as string,
    });

    switch (outcome.kind) {
      case 'success': {
        // Access + refresh novos são criptografados e persistidos JUNTOS,
        // numa única chamada CAS por `id + token_version` — nunca um sem o
        // outro (`applyRefreshedTokens` já zera `refresh_failure_count`/
        // `refresh_retry_at` e incrementa `token_version` no mesmo UPDATE).
        const applied =
          await this.marketplaceAccountsService.applyRefreshedTokens({
            id: reread.id,
            expectedTokenVersion: reread.tokenVersion,
            encryptedAccessToken: this.encryptionService.encrypt(
              outcome.token.accessToken,
            ),
            encryptedRefreshToken: this.encryptionService.encrypt(
              outcome.token.refreshToken,
            ),
            tokenExpiresAt: new Date(
              this.clock() + outcome.token.expiresInSeconds * 1000,
            ),
          });

        if (!applied) {
          // A Shopee JÁ confirmou sucesso e emitiu tokens novos, mas o CAS
          // local perdeu a corrida (outra chamada concorrente mudou
          // `token_version` primeiro) — o refresh_token recém-emitido pela
          // Shopee NUNCA é reenviado/reaplicado a partir daqui. Relê o
          // estado atual: se já é uma conexão CONNECTED mais nova e íntegra
          // (versão ESTRITAMENTE maior que a usada nesta tentativa), essa É
          // a renovação vencedora — usa só o que está armazenado.
          return this.recoverFromLostRefreshCas(reread.id, reread.tokenVersion);
        }

        return {
          accessToken: outcome.token.accessToken,
          shopId: reread.externalSellerId as string,
        };
      }

      case 'provider_rejected': {
        // Revisão CP2H-R1: `ShopeeHttpClient` agrupa QUALQUER `error` não
        // vazio da Shopee neste `kind` (assinatura inválida, Partner ID/Key
        // incorretos, timestamp, parâmetro, autorização, refresh_token
        // inválido/expirado, ou qualquer erro desconhecido) — nunca
        // transporta o código real do provedor para fora do cliente HTTP
        // (política de nunca vazar mensagem bruta). Sem essa informação,
        // este serviço NÃO PODE distinguir "refresh_token inválido/expirado"
        // de um erro de configuração/assinatura da própria aplicação —
        // marcar TOKEN_EXPIRED aqui seria uma afirmação não comprovada (um
        // Partner Key errado afetaria IGUALMENTE uma reconexão OAuth nova,
        // já que ela usa a mesma assinatura). Classificação conservadora:
        // ERROR (nunca TOKEN_EXPIRED), reconexão manual necessária — o
        // operador decide se é a loja ou a configuração da aplicação.
        await this.markFailureConservatively({
          accountId: reread.id,
          expectedTokenVersion: reread.tokenVersion,
          failureCode: 'REFRESH_FAILED',
          errorSummary:
            'A Shopee rejeitou a renovação do token (motivo não detalhado pelo provedor — pode ser refresh_token inválido, assinatura ou configuração). Reconexão necessária.',
        });
        throw new ConflictException('REFRESH_FAILED');
      }

      case 'rate_limited':
      case 'invalid_response':
      case 'unknown_result': {
        // Revisão CP2H-R1: a documentação oficial coletada NÃO afirma que
        // um 429 (rate limit) garante que o refresh_token não foi
        // consumido — a requisição FOI enviada e uma resposta HTTP completa
        // FOI recebida (não é uma falha pré-envio). Sem prova técnica
        // inequívoca do contrário, `rate_limited` é tratado como resultado
        // AMBÍGUO, exatamente como `invalid_response`/`unknown_result`
        // (JSON inválido, 5xx, timeout, conexão interrompida): o
        // refresh_token de uso único pode já ter sido consumido pela
        // Shopee sem o sistema ter recebido os tokens novos. NUNCA repete
        // automaticamente com o mesmo refresh_token e NUNCA agenda
        // `refresh_retry_at` para reutilizá-lo — fail-closed: marca ERROR,
        // reconexão manual via novo fluxo OAuth (que emite um code/token
        // completamente novo, nunca reaproveita o refresh_token antigo).
        await this.markFailureConservatively({
          accountId: reread.id,
          expectedTokenVersion: reread.tokenVersion,
          failureCode: 'REFRESH_RESULT_AMBIGUOUS',
          errorSummary:
            'Resultado ambíguo ao renovar o token da Shopee (limite de requisições, resposta inválida ou conexão interrompida) — sem confirmação de que o refresh_token não foi consumido. Reconexão manual necessária.',
        });
        throw new ConflictException('REFRESH_RESULT_AMBIGUOUS');
      }

      case 'configuration_error':
      case 'invalid_request':
        // Falha ANTES do envio (config ausente / entrada inválida,
        // verificado em `ShopeeCredentialsService.ensureCredentials`/
        // validação local do `ShopeeHttpClient`, sempre antes do `fetch`) —
        // o refresh_token nunca saiu do processo, nenhuma escrita
        // necessária.
        throw new ConflictException(outcome.failureCode);
    }
  }

  /**
   * Recuperação pós-CAS-perdido em sucesso (Checkpoint CP2H, endurecido no
   * CP2H-R1) — NUNCA reaplica/reenvia o refresh_token recém-emitido pela
   * Shopee que perdeu a corrida. Relê o estado ATUAL e só o usa se for
   * genuinamente uma renovação vencedora mais nova: `token_version`
   * ESTRITAMENTE maior que a versão usada nesta tentativa (nunca igual —
   * uma versão igual não prova nada, é só a mesma linha ainda não
   * atualizada), CONNECTED, com ambos os tokens e expiração futura
   * presentes. Qualquer outra coisa falha fechado, nunca sobrescreve nem
   * infere um estado que não foi realmente observado.
   *
   * Checkpoint CP2J: também exige um `externalSellerId` válido na releitura
   * — o `shopId` devolvido é SEMPRE o desta mesma linha vencedora, nunca o
   * `shopId` da tentativa que perdeu o CAS (que pode já pertencer a uma loja
   * diferente, se a reconexão concorrente trocou de loja).
   */
  private async recoverFromLostRefreshCas(
    accountId: string,
    expectedTokenVersion: number,
  ): Promise<ShopeeShopCredentials> {
    const current =
      await this.marketplaceAccountsService.findByIdOrFail(accountId);

    if (
      current.marketplace === Marketplace.SHOPEE &&
      current.status === MarketplaceAccountStatus.CONNECTED &&
      current.tokenVersion > expectedTokenVersion &&
      current.encryptedAccessToken &&
      current.encryptedRefreshToken &&
      current.tokenExpiresAt &&
      current.tokenExpiresAt.getTime() > this.clock() &&
      current.externalSellerId !== null &&
      parsePositiveSafeIntegerString(current.externalSellerId) !== null
    ) {
      return this.buildCredentials(current, current.encryptedAccessToken);
    }

    throw new ConflictException('REFRESH_RESULT_NOT_COMMITTED');
  }

  /**
   * Escrita de falha condicionada por `id + token_version` (Revisão CP2H-R1
   * — CAS já garantido pelo SQL de `MarketplaceAccountsService.markError`,
   * confirmado por leitura de código: `WHERE id = $1 AND token_version =
   * $4`). Uma conta que recebeu credenciais mais novas por um callback/
   * reconexão concorrente (que já teria incrementado `token_version`) NUNCA
   * é sobrescrita por esta escrita atrasada — mesmo padrão de
   * `MercadoLivreOAuthService.recordDeferredFailure`: se o CAS falhar, só
   * loga e descarta, nunca relê/sobrescreve/lança um erro sobre a escrita
   * em si (o chamador decide o que devolver com base no `outcome.kind`,
   * não no resultado desta escrita).
   */
  private async markFailureConservatively(input: {
    accountId: string;
    expectedTokenVersion: number;
    failureCode: string;
    errorSummary: string;
  }): Promise<void> {
    const applied = await this.marketplaceAccountsService.markError({
      id: input.accountId,
      expectedTokenVersion: input.expectedTokenVersion,
      failureCode: input.failureCode,
      errorSummary: input.errorSummary,
    });
    if (!applied) {
      this.logger.warn(
        'shopee_access_token_error_write_skipped_stale_version',
        {
          accountId: input.accountId,
          failureCode: input.failureCode,
        },
      );
    }
  }

  private tokenRefreshSkewMs(): number {
    return (
      this.configService.get<number>(
        'SHOPEE_TOKEN_REFRESH_SKEW_SECONDS',
        DEFAULT_TOKEN_REFRESH_SKEW_SECONDS,
      ) * 1000
    );
  }

  /** Fast path: só devolve o token atual se ainda vale por MAIS que a margem. */
  private isWithinSkew(tokenExpiresAt: Date | null, skewMs: number): boolean {
    if (!tokenExpiresAt) return false;
    return tokenExpiresAt.getTime() > this.clock() + skewMs;
  }

  private async assertEligibleForToken(
    accountId: string,
  ): Promise<MarketplaceAccount> {
    const account =
      await this.marketplaceAccountsService.findByIdOrFail(accountId);

    const shopId = account.externalSellerId;
    const shopIdValid =
      shopId !== null && parsePositiveSafeIntegerString(shopId) !== null;

    if (
      account.marketplace !== Marketplace.SHOPEE ||
      account.status !== MarketplaceAccountStatus.CONNECTED ||
      !account.encryptedAccessToken ||
      !account.encryptedRefreshToken ||
      !account.tokenExpiresAt ||
      !shopIdValid
    ) {
      throw new ConflictException('ACCOUNT_NOT_ELIGIBLE');
    }

    return account;
  }

  private async decryptOrMarkError(
    account: MarketplaceAccount,
    encryptedValue: string,
  ): Promise<string> {
    try {
      return this.encryptionService.decrypt(encryptedValue);
    } catch {
      await this.marketplaceAccountsService.markError({
        id: account.id,
        expectedTokenVersion: account.tokenVersion,
        failureCode: 'CREDENTIAL_DECRYPTION_FAILED',
        errorSummary: 'Falha ao descriptografar credencial armazenada.',
      });
      throw new ConflictException('CREDENTIAL_DECRYPTION_FAILED');
    }
  }
}
