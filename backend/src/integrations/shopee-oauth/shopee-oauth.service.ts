import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { redactSensitiveData } from '../../common/logging/redact.util';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { Marketplace } from '../contracts/marketplace.enum';
import { MarketplaceAccountStatus } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { AdvisoryLockService } from '../shared/advisory-lock.service';
import {
  OAuthAuthorizationRequestsService,
  OAuthConnectionInProgressError,
} from '../mercado-livre-oauth/oauth-authorization-requests.service';
import { validateShopeeCallbackInput } from './shopee-callback-input.validator';
import { buildShopeeCallbackRedirectUrl } from './shopee-callback-redirect-url';
import { mapShopeeCallbackOutcomeToPublicReason } from './shopee-callback-reason.mapper';
import { ShopeeCredentialsService } from './shopee-credentials.service';
import { parsePositiveSafeIntegerString } from './shopee-decimal-id.util';
import { SHOPEE_ENDPOINTS } from './shopee-endpoints';
import { validateShopeeFrontendUrl } from './shopee-frontend-url.validator';
import { ShopeeHttpClient, ShopeeTokenOutcome } from './shopee-http.client';
import { buildShopeeAuthorizationUrl } from './shopee-build-authorization-url';

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
    private readonly credentialsService: ShopeeCredentialsService,
    private readonly configService: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(SHOPEE_OAUTH_CLOCK)
    private readonly clock: ShopeeOAuthClock = defaultShopeeOAuthClock,
  ) {}

  /**
   * Início da conexão (Checkpoint CP2D) — ORDEM SEGURA deliberada (evita
   * tentativa ativa órfã): 1) conta existe/elegível; 2) credenciais +
   * `redirectUri` válidos (`ensureConfigured`); 3) host de autorização
   * resolvido SÓ pela allowlist + `partnerId` em formato válido; 4) SÓ
   * ENTÃO `createPending`; 5) `buildShopeeAuthorizationUrl` com dados já
   * validados nos passos 2/3 — na prática nunca deveria lançar depois do
   * `createPending`, mas nenhuma etapa anterior ao passo 4 tem efeito
   * colateral no banco, então qualquer falha até ali nunca deixa rastro.
   * Autorização idêntica à do Mercado Livre (`MercadoLivreOAuthController.
   * connect`): `AccessTokenGuard`, sem RBAC/ownership adicional nesta fase —
   * decisão verificada na revisão final do CP2D, não só herdada: `AppModule`
   * só registra `ThrottlerGuard` como `APP_GUARD` (rate limiting, nenhum
   * guard de autenticação global), e `MarketplaceAccount`
   * (`marketplace-account.entity.ts`) não tem `ownerId`/`tenantId` — é um
   * recurso GLOBAL do sistema nesta fase, não por conta/usuário. Qualquer
   * usuário autenticado e ativo pode conectar/reconectar qualquer conta,
   * exatamente como o Mercado Livre já permite. Nunca criar uma política
   * nova só para a Shopee, nunca reduzir a proteção existente do ML.
   */
  async startConnection(input: {
    marketplaceAccountId: string;
    initiatedByUserId: string;
  }): Promise<{ authorizationUrl: string }> {
    const account = await this.marketplaceAccountsService.findByIdOrFail(
      input.marketplaceAccountId,
    );

    if (
      account.marketplace !== Marketplace.SHOPEE ||
      !CONNECTABLE_STATUSES.includes(account.status)
    ) {
      throw new NotFoundException('Conta de marketplace não encontrada.');
    }

    // `ensureConfigured` (não `ensureCredentials`) — a ÚNICA operação
    // Shopee que de fato depende da URL de callback estar correta antes de
    // redirecionar o navegador (CP2A, já valida `redirectUri` via
    // `validateShopeeRedirectUri`, com `NODE_ENV`).
    const config = this.credentialsService.ensureConfigured();

    const authorizationHost =
      SHOPEE_ENDPOINTS[config.environment].authorizationHost;
    if (authorizationHost === null) {
      // Ambiente sem host de autorização confirmado na allowlist — nunca
      // usa produção como fallback (mesma regra do builder).
      throw new ConflictException('SHOPEE_NOT_CONFIGURED');
    }
    if (parsePositiveSafeIntegerString(config.partnerId) === null) {
      throw new ConflictException('SHOPEE_NOT_CONFIGURED');
    }

    let pending: { id: string; state: string };
    try {
      pending = await this.authorizationRequestsService.createPending({
        marketplaceAccountId: account.id,
        initiatedByUserId: input.initiatedByUserId,
        marketplace: Marketplace.SHOPEE,
        usePkce: false,
      });
    } catch (error) {
      if (error instanceof OAuthConnectionInProgressError) {
        throw new ConflictException('OAUTH_CONNECTION_IN_PROGRESS');
      }
      throw error;
    }

    // Passos 1-3 já validaram tudo que `buildShopeeAuthorizationUrl`
    // verifica — em operação normal, isto nunca deveria lançar depois do
    // `createPending`. Mesmo assim, esta rede de segurança fecha a
    // tentativa IMEDIATAMENTE (nunca confia só no TTL de 10 minutos para
    // "curar" uma órfã): `failPending` atua por `id` primário, então nunca
    // afeta nenhuma tentativa de outra conta/marketplace. Nunca retorna
    // `state`/detalhes de configuração — só um código interno fechado.
    try {
      // Nunca retorna `codeChallenge` (sempre `null` aqui, `usePkce: false`)
      // nem Partner ID/Key separadamente — só a URL final.
      return {
        authorizationUrl: buildShopeeAuthorizationUrl({
          authorizationHost,
          partnerId: config.partnerId,
          redirectUri: config.redirectUri,
          state: pending.state,
        }),
      };
    } catch (error) {
      await this.authorizationRequestsService.failPending(
        pending.id,
        'AUTHORIZATION_URL_BUILD_FAILED',
      );
      this.logger.error('shopee_oauth_start_connection_unexpected_error', {
        message: redactSensitiveData(
          error instanceof Error ? error.message : 'erro desconhecido',
        ),
      });
      throw new ConflictException('CONNECTION_FAILED');
    }
  }

  /**
   * Callback HTTP (Checkpoint CP2D) — usado pelo controller público
   * (`GET /integrations/shopee/callback`). Sempre devolve um redirect fixo
   * para `FRONTEND_URL/integracoes`, nunca JSON, nunca token/code/state/
   * shopId. `FRONTEND_URL` é validada ANTES de chamar
   * `handleAuthorizationCallback` — uma configuração inválida falha de
   * forma fechada (exceção genérica, nunca um redirect malformado) sem
   * desperdiçar o claim do state.
   */
  async handleCallback(input: {
    state: unknown;
    code: unknown;
    shopId: unknown;
  }): Promise<{ redirectUrl: string }> {
    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');

    if (!validateShopeeFrontendUrl(frontendUrl, nodeEnv)) {
      throw new Error('SHOPEE_FRONTEND_URL_INVALID');
    }

    const outcome = await this.handleAuthorizationCallback(input);
    const reason =
      outcome.kind === 'success'
        ? 'success'
        : mapShopeeCallbackOutcomeToPublicReason(outcome.kind);

    return {
      redirectUrl: buildShopeeCallbackRedirectUrl({ frontendUrl, reason }),
    };
  }

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
