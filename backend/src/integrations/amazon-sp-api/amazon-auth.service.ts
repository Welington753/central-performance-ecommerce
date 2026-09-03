import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
// `AdvisoryLockService` (utilitário genérico de lock por accountId) mora em
// `integrations/shared/` desde o Checkpoint 4-B ("Commit 1" — extraído de
// `mercado-livre-oauth/`, que não é mais importado por este módulo).
import { AdvisoryLockService } from '../shared/advisory-lock.service';
import { type AmazonConfig, loadAmazonConfig } from './amazon-config';
import { AmazonLwaClient } from './amazon-lwa.client';

/**
 * Serviço de autenticação Amazon SP-API (Fase 4, fundação). Espelha a forma
 * do equivalente já existente para o Mercado Livre — `ensureValidAccessToken`
 * com lock por conta, releitura pós-lock e CAS por tokenVersion —, mas
 * simplificado: a LWA não rotaciona o refresh token a cada renovação (Etapa
 * 4), então este serviço nunca reescreve `encryptedRefreshToken` fora de
 * `provisionAccount`.
 */
@Injectable()
export class AmazonAuthService {
  private readonly logger = new Logger(AmazonAuthService.name);

  constructor(
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
    private readonly advisoryLockService: AdvisoryLockService,
    private readonly lwaClient: AmazonLwaClient,
    private readonly encryptionService: EncryptionService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Nunca retorna um token para uma conta que não seja `Marketplace.AMAZON`
   * (rejeitada ANTES de qualquer checagem de configuração — Etapa 5).
   */
  async ensureValidAccessToken(accountId: string): Promise<string> {
    const account =
      await this.marketplaceAccountsService.findByIdOrFail(accountId);
    this.assertAmazonMarketplace(account);

    const configResult = loadAmazonConfig(this.configService);
    if (!configResult.configured) {
      throw new ConflictException('AMAZON_NOT_CONFIGURED');
    }

    const leewayMs = this.configService.get<number>(
      'AMAZON_TOKEN_REFRESH_LEEWAY_MS',
      900000,
    );

    this.assertEligible(account);
    if (this.isWithinLeeway(account.tokenExpiresAt, leewayMs)) {
      return this.decryptOrMarkError(
        account,
        account.encryptedAccessToken as string,
      );
    }

    const lock = await this.advisoryLockService.tryAcquire(accountId);
    if (!lock) {
      throw new ConflictException('AMAZON_ACCOUNT_BUSY');
    }

    try {
      const reread =
        await this.marketplaceAccountsService.findByIdOrFail(accountId);
      this.assertAmazonMarketplace(reread);
      this.assertEligible(reread);

      if (this.isWithinLeeway(reread.tokenExpiresAt, leewayMs)) {
        // Outra chamada concorrente já renovou enquanto esperávamos o lock —
        // nenhuma segunda chamada à LWA é feita (garante teste #9).
        return this.decryptOrMarkError(
          reread,
          reread.encryptedAccessToken as string,
        );
      }

      return await this.forceRefresh(accountId, reread, configResult.config);
    } finally {
      await lock.release();
    }
  }

  /**
   * Renovação FORÇADA após um 401/403 real da SP-API (Checkpoint 4-B-R1,
   * "Correção 6") — diferente de `ensureValidAccessToken`, nunca confia em
   * `tokenExpiresAt` local: um token pode estar marcado como válido no banco
   * e ainda assim já ter sido revogado do lado da Amazon. Sempre adquire o
   * lock e relê a conta primeiro:
   *   - se o token armazenado já NÃO é mais `rejectedAccessToken` (outra
   *     chamada concorrente já renovou enquanto esperávamos o lock), reusa o
   *     token mais novo sem nenhuma chamada LWA adicional;
   *   - senão, força uma renovação LWA mesmo que `tokenExpiresAt` esteja no
   *     futuro.
   * `rejectedAccessToken` nunca é logado, devolvido em erro ou serializado —
   * só comparado, em memória, contra o valor já descriptografado.
   */
  async refreshAccessTokenAfterUnauthorized(
    accountId: string,
    rejectedAccessToken: string,
  ): Promise<string> {
    const account =
      await this.marketplaceAccountsService.findByIdOrFail(accountId);
    this.assertAmazonMarketplace(account);

    const configResult = loadAmazonConfig(this.configService);
    if (!configResult.configured) {
      throw new ConflictException('AMAZON_NOT_CONFIGURED');
    }
    this.assertEligible(account);

    const lock = await this.advisoryLockService.tryAcquire(accountId);
    if (!lock) {
      throw new ConflictException('AMAZON_ACCOUNT_BUSY');
    }

    try {
      const reread =
        await this.marketplaceAccountsService.findByIdOrFail(accountId);
      this.assertAmazonMarketplace(reread);
      this.assertEligible(reread);

      const currentAccessToken = reread.encryptedAccessToken
        ? await this.decryptOrMarkError(reread, reread.encryptedAccessToken)
        : null;

      if (
        currentAccessToken !== null &&
        currentAccessToken !== rejectedAccessToken
      ) {
        // Outra chamada concorrente já substituiu o token rejeitado enquanto
        // esperávamos o lock — nenhuma segunda chamada à LWA é feita.
        return currentAccessToken;
      }

      return await this.forceRefresh(accountId, reread, configResult.config);
    } finally {
      await lock.release();
    }
  }

  /**
   * Corpo comum da renovação LWA (chamado só com o lock já adquirido e a
   * conta já relida) — compartilhado por `ensureValidAccessToken` (quando o
   * leeway local expirou) e `refreshAccessTokenAfterUnauthorized` (quando a
   * SP-API rejeitou o token com 401/403, independentemente do leeway).
   */
  private async forceRefresh(
    accountId: string,
    reread: MarketplaceAccount,
    config: AmazonConfig,
  ): Promise<string> {
    const refreshTokenPlain = await this.decryptOrMarkError(
      reread,
      reread.encryptedRefreshToken as string,
    );

    const outcome = await this.lwaClient.refreshAccessToken({
      refreshToken: refreshTokenPlain,
      clientId: config.lwaClientId,
      clientSecret: config.lwaClientSecret,
    });

    if (outcome.kind === 'invalid_grant') {
      await this.marketplaceAccountsService.markTokenExpired({
        id: accountId,
        expectedTokenVersion: reread.tokenVersion,
        failureCode: 'AMAZON_REFRESH_TOKEN_REJECTED',
        errorSummary:
          'A Amazon rejeitou o refresh token. Reautorização necessária.',
      });
      throw new ConflictException('AMAZON_REFRESH_TOKEN_REJECTED');
    }

    if (outcome.kind === 'client_configuration_error') {
      // invalid_client não prova nada sobre o refresh token do vendedor —
      // erro persistente de CONFIGURAÇÃO da aplicação, nunca TOKEN_EXPIRED
      // (mesmo raciocínio já usado na renovação de token do Mercado Livre).
      await this.marketplaceAccountsService.markError({
        id: accountId,
        expectedTokenVersion: reread.tokenVersion,
        failureCode: 'AMAZON_LWA_APP_CONFIGURATION_ERROR',
        errorSummary: 'Credencial de aplicação Amazon inválida.',
      });
      throw new ConflictException('AMAZON_LWA_APP_CONFIGURATION_ERROR');
    }

    if (
      outcome.kind === 'rate_limited' ||
      outcome.kind === 'provider_unavailable' ||
      outcome.kind === 'unknown_result' ||
      outcome.kind === 'invalid_response'
    ) {
      // Falha transitória ou resultado ambíguo: NUNCA apaga nem sobrescreve
      // o refresh token válido — a conta preserva seu status/credenciais
      // atuais, só a chamada atual falha.
      this.logger.warn('amazon_lwa_refresh_transient_failure', {
        accountId,
        kind: outcome.kind,
      });
      throw new ConflictException('AMAZON_REFRESH_TRANSIENT_FAILURE');
    }

    const applied = await this.marketplaceAccountsService.applyRefreshedTokens({
      id: accountId,
      expectedTokenVersion: reread.tokenVersion,
      encryptedAccessToken: this.encryptionService.encrypt(
        outcome.token.accessToken,
      ),
      // LWA não rotaciona o refresh token nesta chamada (Etapa 4) — o
      // mesmo valor criptografado já armazenado é preservado.
      encryptedRefreshToken: reread.encryptedRefreshToken as string,
      tokenExpiresAt: new Date(
        Date.now() + outcome.token.expiresInSeconds * 1000,
      ),
    });

    if (!applied) {
      // Uma resposta atrasada nunca sobrescreve uma tokenVersion mais nova
      // (ex.: reconexão/renovação concorrente já commitou). Releitura real,
      // nunca um valor assumido.
      const current =
        await this.marketplaceAccountsService.findByIdOrFail(accountId);
      this.logger.warn('amazon_refresh_result_not_committed', {
        accountId,
        currentStatus: current.status,
        currentTokenVersion: current.tokenVersion,
      });
      throw new ConflictException('AMAZON_REFRESH_RESULT_NOT_COMMITTED');
    }

    return outcome.token.accessToken;
  }

  /**
   * Provisionamento interno (Etapa 6) — nunca exposto por controller
   * público. Recebe o refresh token já obtido pela autoautorização (fora
   * deste sistema), criptografa imediatamente e nunca o loga. Limpa
   * qualquer access token antigo (Etapa 6): a próxima
   * `ensureValidAccessToken` renova naturalmente via LWA.
   */
  async provisionAccount(input: {
    accountId: string;
    sellingPartnerId: string;
    refreshToken: string;
  }): Promise<void> {
    const account = await this.marketplaceAccountsService.findByIdOrFail(
      input.accountId,
    );
    this.assertAmazonMarketplace(account);

    const encryptedRefreshToken = this.encryptionService.encrypt(
      input.refreshToken,
    );

    const outcome = await this.marketplaceAccountsService.provisionCredentials({
      id: account.id,
      expectedTokenVersion: account.tokenVersion,
      externalSellerId: input.sellingPartnerId,
      encryptedRefreshToken,
      connectedByUserId: null,
    });

    if (outcome === 'external_seller_conflict') {
      throw new ConflictException('AMAZON_ACCOUNT_ALREADY_CONNECTED');
    }
    if (outcome === 'version_conflict') {
      throw new ConflictException('AMAZON_PROVISION_VERSION_CONFLICT');
    }

    // Nunca loga accountId junto de qualquer segredo — só a confirmação, sem
    // argumentos sensíveis.
    this.logger.log('amazon_account_provisioned');
  }

  private assertAmazonMarketplace(account: MarketplaceAccount): void {
    if (account.marketplace !== Marketplace.AMAZON) {
      throw new ConflictException('AMAZON_ACCOUNT_MARKETPLACE_MISMATCH');
    }
  }

  private assertEligible(account: MarketplaceAccount): void {
    if (
      account.status !== MarketplaceAccountStatus.CONNECTED ||
      !account.encryptedRefreshToken
    ) {
      throw new ConflictException('AMAZON_ACCOUNT_NOT_ELIGIBLE_FOR_TOKEN');
    }
  }

  private isWithinLeeway(
    tokenExpiresAt: Date | null,
    leewayMs: number,
  ): boolean {
    if (!tokenExpiresAt) return false;
    return tokenExpiresAt.getTime() > Date.now() + leewayMs;
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
        failureCode: 'AMAZON_CREDENTIAL_DECRYPTION_FAILED',
        errorSummary: 'Falha ao descriptografar credencial armazenada.',
      });
      throw new ConflictException('AMAZON_CREDENTIAL_DECRYPTION_FAILED');
    }
  }
}
