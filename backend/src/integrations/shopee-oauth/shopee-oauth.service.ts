import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { redactSensitiveData } from '../../common/logging/redact.util';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { Marketplace } from '../contracts/marketplace.enum';
import { MarketplaceAccountStatus } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { AdvisoryLockService } from '../shared/advisory-lock.service';
import { OAuthAuthorizationRequestsService } from '../mercado-livre-oauth/oauth-authorization-requests.service';
import { validateShopeeCallbackInput } from './shopee-callback-input.validator';
import { ShopeeHttpClient, ShopeeTokenOutcome } from './shopee-http.client';

/**
 * Relógio injetável (Checkpoint CP2C) — devolve milissegundos desde a
 * época, usado SOMENTE para calcular `tokenExpiresAt` a partir de
 * `expiresInSeconds`. Propositalmente distinto de `SHOPEE_CLOCK`
 * (`shopee-http.client.ts`, que devolve SEGUNDOS para a assinatura HMAC) —
 * unidades e motivos diferentes, nunca compartilhados.
 */
export const SHOPEE_OAUTH_CLOCK = Symbol('SHOPEE_OAUTH_CLOCK');
export type ShopeeOAuthClock = () => number;

function defaultShopeeOAuthClock(): number {
  return Date.now();
}

export type ShopeeCallbackOutcome =
  | { kind: 'success' }
  | { kind: 'invalid_callback' }
  | { kind: 'connection_failed' }
  | { kind: 'lock_unavailable' };

const CONNECTABLE_STATUSES: MarketplaceAccountStatus[] = [
  MarketplaceAccountStatus.DISCONNECTED,
  MarketplaceAccountStatus.TOKEN_EXPIRED,
  MarketplaceAccountStatus.ERROR,
  MarketplaceAccountStatus.CONNECTED,
];

/**
 * Processamento transacional do callback de autorização Shopee
 * (Checkpoint CP2C) — sem controller/rota pública ainda. Reaproveita
 * integralmente o padrão comprovado de `MercadoLivreOAuthService.handleCallback`:
 * mesmo `OAuthAuthorizationRequestsService.claimByState` (consumo atômico
 * de uso único), mesmo `AdvisoryLockService` por `marketplaceAccountId`, e
 * o MESMO desenho de `applyConnectionAndFinalizeAtomically` (CAS da conta +
 * `PROCESSING → SUCCESS` da tentativa dentro de UMA ÚNICA transação) —
 * `MarketplaceAccountsService.applySuccessfulConnection` já aceita um
 * `QueryRunner` externo (genérico, sem nenhuma mudança necessária nele).
 *
 * NUNCA retorna token, `code`, `state` ou `shopId` — só um `kind` fechado
 * (`ShopeeCallbackOutcome`), e NUNCA distingue externamente "state
 * inexistente" de "expirado" ou "já usado" (os três colapsam no mesmo
 * `claimByState` → `null` → `invalid_callback`).
 */
@Injectable()
export class ShopeeOAuthService {
  private readonly logger = new Logger(ShopeeOAuthService.name);

  constructor(
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
    private readonly authorizationRequestsService: OAuthAuthorizationRequestsService,
    private readonly advisoryLockService: AdvisoryLockService,
    private readonly httpClient: ShopeeHttpClient,
    private readonly encryptionService: EncryptionService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(SHOPEE_OAUTH_CLOCK)
    private readonly clock: ShopeeOAuthClock = defaultShopeeOAuthClock,
  ) {}

  async handleAuthorizationCallback(input: {
    state: unknown;
    code: unknown;
    shopId: unknown;
  }): Promise<ShopeeCallbackOutcome> {
    try {
      const parsed = validateShopeeCallbackInput(input);
      if (!parsed.valid) return { kind: 'invalid_callback' };

      // `expectedMarketplace` no próprio `claimByState` (correção de
      // isolamento pós-CP2C): um state válido de OUTRO marketplace nunca
      // casa com a `UPDATE ... WHERE marketplace = $2` atômica — não é
      // consumido, não é alterado, e colapsa no mesmo `null` →
      // `invalid_callback` de state inexistente/expirado/já usado.
      const claimed = await this.authorizationRequestsService.claimByState(
        parsed.state,
        Marketplace.SHOPEE,
      );
      if (!claimed) return { kind: 'invalid_callback' };

      // `claimByState` já consumiu a tentativa (PENDING → PROCESSING) —
      // daqui em diante, TODO caminho precisa finalizar via
      // `finalizeFailure`/o CAS de sucesso, nunca deixar presa em
      // PROCESSING.

      const lock = await this.advisoryLockService.tryAcquire(
        claimed.marketplaceAccountId,
      );
      if (!lock) {
        await this.authorizationRequestsService.finalizeFailure(
          claimed.id,
          'ACCOUNT_BUSY',
        );
        return { kind: 'lock_unavailable' };
      }

      try {
        const account = await this.marketplaceAccountsService.findByIdOrFail(
          claimed.marketplaceAccountId,
        );
        const expectedTokenVersion = account.tokenVersion;

        // Revalidação pós-lock (mesmo hardening do Mercado Livre): a conta
        // pode, em teoria, ter mudado entre a criação da tentativa e este
        // ponto.
        if (
          account.marketplace !== Marketplace.SHOPEE ||
          !CONNECTABLE_STATUSES.includes(account.status)
        ) {
          await this.authorizationRequestsService.finalizeFailure(
            claimed.id,
            'ACCOUNT_NOT_ELIGIBLE',
          );
          return { kind: 'connection_failed' };
        }

        const exchange = await this.httpClient.exchangeAuthorizationCode({
          code: parsed.code,
          shopId: parsed.shopId,
        });

        if (exchange.kind !== 'success') {
          await this.authorizationRequestsService.finalizeFailure(
            claimed.id,
            mapExchangeOutcomeToFailureCode(exchange),
          );
          return { kind: 'connection_failed' };
        }

        let encryptedAccessToken: string;
        let encryptedRefreshToken: string;
        try {
          encryptedAccessToken = this.encryptionService.encrypt(
            exchange.token.accessToken,
          );
          encryptedRefreshToken = this.encryptionService.encrypt(
            exchange.token.refreshToken,
          );
        } catch {
          // Nenhum token parcial é persistido — a tentativa finaliza em
          // falha controlada, nunca com um segredo em texto puro gravado.
          await this.authorizationRequestsService.finalizeFailure(
            claimed.id,
            'CREDENTIAL_ENCRYPTION_FAILED',
          );
          return { kind: 'connection_failed' };
        }

        // ÚNICA escrita de "sucesso": CAS da conta + PROCESSING→SUCCESS da
        // tentativa, na MESMA transação — nunca deixa a conta CONNECTED
        // com a tentativa ainda PROCESSING, nem o inverso.
        const outcome = await this.applyConnectionAndFinalizeAtomically({
          accountId: account.id,
          expectedTokenVersion,
          externalSellerId: parsed.shopId,
          encryptedAccessToken,
          encryptedRefreshToken,
          tokenExpiresAt: new Date(
            this.clock() + exchange.token.expiresInSeconds * 1000,
          ),
          connectedByUserId: claimed.initiatedByUserId,
          authorizationRequestId: claimed.id,
        });

        // NUNCA reenvia `code`/tokens depois deste ponto — a Shopee já os
        // emitiu; qualquer falha de persistência a partir daqui finaliza a
        // tentativa em falha controlada, nunca repete a troca.
        if (outcome === 'external_seller_conflict') {
          await this.authorizationRequestsService.finalizeFailure(
            claimed.id,
            'SHOP_ALREADY_CONNECTED',
          );
          await this.marketplaceAccountsService.markError({
            id: account.id,
            expectedTokenVersion,
            failureCode: 'SHOP_ALREADY_CONNECTED',
            errorSummary:
              'Esta loja Shopee já está conectada em outro registro.',
          });
          return { kind: 'connection_failed' };
        }

        if (
          outcome === 'version_conflict' ||
          outcome === 'request_not_processing'
        ) {
          await this.authorizationRequestsService.finalizeFailure(
            claimed.id,
            'TOKEN_RESULT_NOT_COMMITTED',
          );
          return { kind: 'connection_failed' };
        }

        return { kind: 'success' };
      } finally {
        await lock.release();
      }
    } catch (error) {
      this.logger.error('shopee_oauth_callback_unexpected_error', {
        message: redactSensitiveData(
          error instanceof Error ? error.message : 'erro desconhecido',
        ),
      });
      return { kind: 'connection_failed' };
    }
  }

  /**
   * CAS da `MarketplaceAccount` + `oauth_authorization_requests`
   * `PROCESSING → SUCCESS`, na mesma transação — cópia literal do desenho
   * de `MercadoLivreOAuthService.applyConnectionAndFinalizeAtomically`
   * (mesmo `QueryRunner` compartilhado, mesma ordem de operações, mesmo
   * tratamento de rollback/release). `applySuccessfulConnection` já é
   * genérico (nenhuma dependência de Mercado Livre) — reaproveitado sem
   * nenhuma alteração.
   */
  private async applyConnectionAndFinalizeAtomically(input: {
    accountId: string;
    expectedTokenVersion: number;
    externalSellerId: string;
    encryptedAccessToken: string;
    encryptedRefreshToken: string;
    tokenExpiresAt: Date;
    connectedByUserId: string | null;
    authorizationRequestId: string;
  }): Promise<
    | 'applied'
    | 'version_conflict'
    | 'external_seller_conflict'
    | 'request_not_processing'
  > {
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const accountOutcome =
        await this.marketplaceAccountsService.applySuccessfulConnection(
          {
            id: input.accountId,
            expectedTokenVersion: input.expectedTokenVersion,
            externalSellerId: input.externalSellerId,
            encryptedAccessToken: input.encryptedAccessToken,
            encryptedRefreshToken: input.encryptedRefreshToken,
            tokenExpiresAt: input.tokenExpiresAt,
            connectedByUserId: input.connectedByUserId,
          },
          queryRunner,
        );

      if (accountOutcome !== 'applied') {
        await queryRunner.rollbackTransaction();
        return accountOutcome;
      }

      const [requestRows] = (await queryRunner.query(
        `UPDATE oauth_authorization_requests
            SET status = 'SUCCESS', completed_at = now(), failure_code = NULL, encrypted_code_verifier = NULL
          WHERE id = $1 AND status = 'PROCESSING'
          RETURNING id`,
        [input.authorizationRequestId],
      )) as [Array<{ id: string }>, number];

      if (requestRows.length !== 1) {
        await queryRunner.rollbackTransaction();
        return 'request_not_processing';
      }

      await queryRunner.commitTransaction();
      return 'applied';
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        try {
          await queryRunner.rollbackTransaction();
        } catch {
          // Falha no próprio rollback não pode mascarar o erro original.
        }
      }
      throw error;
    } finally {
      try {
        await queryRunner.release();
      } catch {
        // Idem: falha na liberação não pode suprimir o erro/resultado já
        // em propagação.
      }
    }
  }
}

function mapExchangeOutcomeToFailureCode(
  exchange: Exclude<ShopeeTokenOutcome, { kind: 'success' }>,
): string {
  switch (exchange.kind) {
    case 'configuration_error':
    case 'invalid_request':
      return exchange.failureCode;
    case 'provider_rejected':
      return 'TOKEN_EXCHANGE_REJECTED';
    case 'rate_limited':
      return 'TOKEN_EXCHANGE_RATE_LIMITED';
    case 'invalid_response':
      return 'TOKEN_EXCHANGE_INVALID_RESPONSE';
    case 'unknown_result':
      return 'TOKEN_EXCHANGE_RESULT_UNKNOWN';
  }
}
