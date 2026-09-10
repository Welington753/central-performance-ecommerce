import {
  ConflictException,
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
import type { MarketplaceAccount } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountStatus } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { AdvisoryLockService } from '../shared/advisory-lock.service';
import { buildAuthorizationUrl } from './build-authorization-url';
import type { CallbackQuery } from './callback-params.validator';
import { validateCallbackParams } from './callback-params.validator';
import { buildCallbackRedirectUrl } from './callback-redirect-url';
import { mapFailureCodeToPublicReason } from './callback-reason.mapper';
import type { MercadoLivreOAuthFailureCode } from './mercado-livre-oauth-failure-code';
import { MercadoLivreHttpClient } from './mercado-livre-http.client';
import { computeRefreshBackoffDelayMs } from './mercado-livre-refresh-backoff.util';
import {
  OAuthAuthorizationRequestsService,
  OAuthConnectionInProgressError,
} from './oauth-authorization-requests.service';

type RecoverableFailureCode =
  | 'REFRESH_TEMPORARY_FAILURE'
  | 'REFRESH_OUTCOME_UNKNOWN'
  | 'ML_APP_CONFIGURATION_ERROR';

// Códigos aceitos como "recuperável" pelo endpoint de recuperação — inclui
// o legado `REFRESH_RESULT_UNKNOWN` (nunca mais escrito, mas ainda pode
// existir em contas presas no incidente anterior a esta correção).
const RECOVERABLE_FAILURE_CODES: ReadonlySet<string> = new Set([
  'REFRESH_RESULT_UNKNOWN',
  'REFRESH_TEMPORARY_FAILURE',
  'REFRESH_OUTCOME_UNKNOWN',
  'ML_APP_CONFIGURATION_ERROR',
]);

export type RecoverConnectionOutcome =
  'RECOVERED' | 'PENDING_RETRY' | 'RECONNECT_REQUIRED' | 'CONFIGURATION_ERROR';

type AttemptRefreshResult =
  | { kind: 'success'; accessToken: string }
  | { kind: 'invalid_grant' }
  | { kind: 'invalid_client' }
  | { kind: 'temporary_failure' }
  | { kind: 'outcome_unknown' }
  | { kind: 'retry_scheduled' }
  | { kind: 'not_committed' };

const CONNECTABLE_STATUSES: MarketplaceAccountStatus[] = [
  MarketplaceAccountStatus.DISCONNECTED,
  MarketplaceAccountStatus.TOKEN_EXPIRED,
  MarketplaceAccountStatus.ERROR,
  MarketplaceAccountStatus.CONNECTED,
];

@Injectable()
export class MercadoLivreOAuthService {
  private readonly logger = new Logger(MercadoLivreOAuthService.name);

  // Circuito temporário para `invalid_client` (correção de resiliência
  // OAuth): quando o client_id/client_secret configurado está errado, TODA
  // conta bateria no mesmo erro — sem isto, um ciclo de sincronização
  // automática com várias contas repetiria a mesma chamada de rede fadada
  // ao fracasso para cada uma. Em memória, por instância do processo
  // (nunca persistido) — reinicia limpo a cada deploy/restart, e uma
  // renovação bem-sucedida em qualquer conta também o fecha.
  private mlAppConfigCircuitOpenUntil: number | null = null;
  private static readonly ML_APP_CONFIG_CIRCUIT_COOLDOWN_MS = 5 * 60 * 1000;

  constructor(
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
    private readonly authorizationRequestsService: OAuthAuthorizationRequestsService,
    private readonly advisoryLockService: AdvisoryLockService,
    private readonly httpClient: MercadoLivreHttpClient,
    private readonly encryptionService: EncryptionService,
    private readonly configService: ConfigService,
    // Não usado por `startConnection` — só é lido por `handleCallback`
    // (Task 19), que precisa abrir uma transação compartilhada entre o CAS
    // da conta e a finalização da tentativa. Introduzido já aqui, e não na
    // Task 19, para que a assinatura do construtor nunca mude no meio do
    // plano — todo call site (Tasks 16, 19, 20, 23) usa a mesma ordem de 7
    // argumentos desde o início.
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * Autorização interna nesta fase (design §6.1): sem RBAC/ownership na Fase
   * 1, qualquer usuário interno autenticado e ativo pode conectar/reconectar
   * qualquer conta — `initiatedByUserId` só serve para auditoria.
   */
  async startConnection(input: {
    marketplaceAccountId: string;
    initiatedByUserId: string;
  }): Promise<{ authorizationUrl: string }> {
    const account = await this.marketplaceAccountsService.findByIdOrFail(
      input.marketplaceAccountId,
    );

    if (
      account.marketplace !== Marketplace.MERCADO_LIVRE ||
      !CONNECTABLE_STATUSES.includes(account.status)
    ) {
      throw new NotFoundException('Conta de marketplace não encontrada.');
    }

    try {
      const pending = await this.authorizationRequestsService.createPending({
        marketplaceAccountId: account.id,
        initiatedByUserId: input.initiatedByUserId,
        marketplace: Marketplace.MERCADO_LIVRE,
      });

      return {
        authorizationUrl: buildAuthorizationUrl({
          clientId: this.configService.getOrThrow<string>('ML_CLIENT_ID'),
          redirectUri: this.configService.getOrThrow<string>('ML_REDIRECT_URI'),
          state: pending.state,
          codeChallenge: pending.codeChallenge,
        }),
      };
    } catch (error) {
      if (error instanceof OAuthConnectionInProgressError) {
        throw new ConflictException('OAUTH_CONNECTION_IN_PROGRESS');
      }
      throw error;
    }
  }

  /**
   * design §6.2: nunca lança — resultado esperado OU erro interno inesperado
   * sempre viram um redirect (`try/catch` de topo), nunca um 500 cru para o
   * navegador voltando do Mercado Livre.
   */
  async handleCallback(query: CallbackQuery): Promise<{ redirectUrl: string }> {
    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    const redirect = (
      reason: 'success' | ReturnType<typeof mapFailureCodeToPublicReason>,
    ) => ({ redirectUrl: buildCallbackRedirectUrl({ frontendUrl, reason }) });

    try {
      const parsed = validateCallbackParams(query);
      if (!parsed.valid) return redirect('OAUTH_CALLBACK_INVALID');

      const claimed = await this.authorizationRequestsService.claimByState(
        parsed.state,
        Marketplace.MERCADO_LIVRE,
      );
      if (!claimed) return redirect('OAUTH_CALLBACK_INVALID');

      if (parsed.error !== null) {
        const failureCode: MercadoLivreOAuthFailureCode =
          parsed.error === 'access_denied'
            ? 'AUTHORIZATION_DENIED'
            : 'AUTHORIZATION_PROVIDER_ERROR';
        await this.authorizationRequestsService.finalizeFailure(
          claimed.id,
          failureCode,
        );
        return redirect(mapFailureCodeToPublicReason(failureCode));
      }

      const code = parsed.code;
      const lock = await this.advisoryLockService.tryAcquire(
        claimed.marketplaceAccountId,
      );
      if (!lock) {
        await this.authorizationRequestsService.finalizeFailure(
          claimed.id,
          'ACCOUNT_BUSY',
        );
        return redirect(mapFailureCodeToPublicReason('ACCOUNT_BUSY'));
      }

      try {
        const account = await this.marketplaceAccountsService.findByIdOrFail(
          claimed.marketplaceAccountId,
        );
        const expectedTokenVersion = account.tokenVersion;

        // Revalidação pós-lock (design §6.2 hardening): a conta pode, em
        // teoria, ter mudado entre a criação da tentativa e este ponto. Só o
        // marketplace é checável de forma significativa aqui — os demais
        // campos relevantes (identidade, token_version) já são protegidos
        // pelo CAS mais abaixo.
        if (account.marketplace !== Marketplace.MERCADO_LIVRE) {
          await this.authorizationRequestsService.finalizeFailure(
            claimed.id,
            'ACCOUNT_STATE_CONFLICT',
          );
          return redirect(
            mapFailureCodeToPublicReason('ACCOUNT_STATE_CONFLICT'),
          );
        }

        let codeVerifier: string;
        try {
          codeVerifier = this.encryptionService.decrypt(
            claimed.encryptedCodeVerifier as string,
          );
        } catch {
          await this.authorizationRequestsService.finalizeFailure(
            claimed.id,
            'CREDENTIAL_DECRYPTION_FAILED',
          );
          return redirect(
            mapFailureCodeToPublicReason('CREDENTIAL_DECRYPTION_FAILED'),
          );
        }

        const exchange = await this.httpClient.exchangeCode({
          code,
          codeVerifier,
        });
        if (exchange.kind !== 'success') {
          // `definitive_error` (invalid_grant) e `client_configuration_error`
          // (invalid_client) são ambos tratados como falha DEFINITIVA da
          // troca no callback (design §6.2 passo 7 cita os dois lado a
          // lado) — a distinção entre eles só importa no refresh (Task 20),
          // onde `client_configuration_error` NUNCA pode virar TOKEN_EXPIRED.
          const failureCode: MercadoLivreOAuthFailureCode =
            exchange.kind === 'definitive_error' ||
            exchange.kind === 'client_configuration_error'
              ? 'TOKEN_EXCHANGE_FAILED'
              : exchange.kind === 'invalid_response'
                ? 'INVALID_TOKEN_RESPONSE'
                : 'CALLBACK_RESULT_UNKNOWN';
          await this.authorizationRequestsService.finalizeFailure(
            claimed.id,
            failureCode,
          );
          return redirect(mapFailureCodeToPublicReason(failureCode));
        }

        const identity = await this.httpClient.fetchIdentity(
          exchange.token.accessToken,
        );
        if (identity.kind !== 'success') {
          await this.authorizationRequestsService.finalizeFailure(
            claimed.id,
            'IDENTITY_LOOKUP_FAILED',
          );
          return redirect(
            mapFailureCodeToPublicReason('IDENTITY_LOOKUP_FAILED'),
          );
        }

        if (identity.externalUserId !== exchange.token.userId) {
          await this.authorizationRequestsService.finalizeFailure(
            claimed.id,
            'IDENTITY_MISMATCH',
          );
          return redirect(mapFailureCodeToPublicReason('IDENTITY_MISMATCH'));
        }

        const externalSellerId = String(identity.externalUserId);

        if (
          account.externalSellerId !== null &&
          account.externalSellerId !== externalSellerId
        ) {
          await this.authorizationRequestsService.finalizeFailure(
            claimed.id,
            'IDENTITY_MISMATCH',
          );
          return redirect(mapFailureCodeToPublicReason('IDENTITY_MISMATCH'));
        }

        if (account.externalSellerId === null) {
          const existing =
            await this.marketplaceAccountsService.findByMarketplaceAndExternalSellerId(
              Marketplace.MERCADO_LIVRE,
              externalSellerId,
            );
          if (existing && existing.id !== account.id) {
            await this.authorizationRequestsService.finalizeFailure(
              claimed.id,
              'ACCOUNT_ALREADY_CONNECTED',
            );
            await this.marketplaceAccountsService.markError({
              id: account.id,
              expectedTokenVersion,
              failureCode: 'ACCOUNT_ALREADY_CONNECTED',
              errorSummary:
                'Esta conta do Mercado Livre já está conectada em outro registro.',
            });
            return redirect(
              mapFailureCodeToPublicReason('ACCOUNT_ALREADY_CONNECTED'),
            );
          }
        }

        // ÚNICA escrita de "sucesso": CAS da conta + PROCESSING→SUCCESS da
        // tentativa, na MESMA transação (design §6.2 passo 11).
        const outcome = await this.applyConnectionAndFinalizeAtomically({
          accountId: account.id,
          expectedTokenVersion,
          externalSellerId,
          encryptedAccessToken: this.encryptionService.encrypt(
            exchange.token.accessToken,
          ),
          encryptedRefreshToken: this.encryptionService.encrypt(
            exchange.token.refreshToken,
          ),
          tokenExpiresAt: new Date(
            Date.now() + exchange.token.expiresInSeconds * 1000,
          ),
          connectedByUserId: claimed.initiatedByUserId,
          authorizationRequestId: claimed.id,
        });

        if (outcome === 'external_seller_conflict') {
          await this.authorizationRequestsService.finalizeFailure(
            claimed.id,
            'ACCOUNT_ALREADY_CONNECTED',
          );
          await this.marketplaceAccountsService.markError({
            id: account.id,
            expectedTokenVersion,
            failureCode: 'ACCOUNT_ALREADY_CONNECTED',
            errorSummary:
              'Esta conta do Mercado Livre já está conectada em outro registro.',
          });
          return redirect(
            mapFailureCodeToPublicReason('ACCOUNT_ALREADY_CONNECTED'),
          );
        }

        if (
          outcome === 'version_conflict' ||
          outcome === 'request_not_processing'
        ) {
          await this.authorizationRequestsService.finalizeFailure(
            claimed.id,
            'TOKEN_RESULT_NOT_COMMITTED',
          );
          return redirect(
            mapFailureCodeToPublicReason('TOKEN_RESULT_NOT_COMMITTED'),
          );
        }

        return redirect('success');
      } finally {
        await lock.release();
      }
    } catch (error) {
      // design §6.2: "Redireciona sempre" — mesmo um erro interno inesperado
      // (ex.: conexão com o banco caiu) nunca vira um 500 cru para o
      // navegador voltando do Mercado Livre. Mensagem estática ao usuário; o
      // detalhe (sanitizado — nunca segredo bruto) só vai para o log interno.
      this.logger.error('mercado_livre_callback_unexpected_error', {
        message: redactSensitiveData(
          error instanceof Error ? error.message : 'erro desconhecido',
        ),
      });
      return redirect('TRY_AGAIN_LATER');
    }
  }

  /**
   * CAS da `MarketplaceAccount` + `oauth_authorization_requests`
   * `PROCESSING → SUCCESS`, na mesma transação (design §6.2 passo 11).
   * `applySuccessfulConnection` (Task 15) recebe este `QueryRunner`
   * compartilhado — não gerencia commit/rollback quando recebe um.
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
    // `connect()`/`startTransaction()` ficam DENTRO do try: se qualquer um
    // dos dois lançar, o `finally` abaixo ainda libera o QueryRunner
    // exatamente uma vez (item 2 da segunda revisão) — antes, uma falha em
    // `connect()`/`startTransaction()` pulava o `finally` e vazava a
    // conexão dedicada.
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

      // Divergência mínima do plano (Task 19, Step 3): para `UPDATE ...
      // RETURNING`, `PostgresQueryRunner.query()` (TypeORM instalado)
      // devolve a tupla `[rows, rowCount]`, não o array de linhas puro — o
      // mesmo padrão já usado por `applySuccessfulConnection` (Task 15,
      // `marketplace-accounts.service.ts`). O pseudocódigo do plano tratava
      // o retorno como se fosse só `rows`; corrigido aqui via destructuring
      // para preservar o comportamento exigido (rollback quando a tentativa
      // não estava mais `PROCESSING`).
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
      // Uma exceção lançada pelo CAS (`applySuccessfulConnection`) ou pelo
      // `UPDATE` de finalização chegava direto ao `finally` sem rollback
      // explícito (item 5 da revisão) — a transação ficava aberta até o
      // `release()` devolver a conexão ao pool ainda com trabalho não
      // commitado nela. `isTransactionActive` evita chamar
      // `rollbackTransaction()` numa transação que já foi finalizada por um
      // dos `return`s acima (aqueles já fazem seu próprio rollback).
      if (queryRunner.isTransactionActive) {
        try {
          await queryRunner.rollbackTransaction();
        } catch {
          // Falha no próprio rollback não pode mascarar o erro original que
          // causou a falha da transação — ele é relançado abaixo mesmo
          // assim.
        }
      }
      throw error;
    } finally {
      try {
        await queryRunner.release();
      } catch {
        // Idem: uma falha na liberação não pode suprimir o erro (ou o
        // resultado) que já está sendo propagado/retornado.
      }
    }
  }

  /**
   * design §6.4: fast path sem lock quando o token atual ainda está fora da
   * janela de leeway; caso contrário, adquire o advisory lock (mesmo do
   * callback, §3), relê e revalida a conta, renova no ML fora de transação
   * e aplica CAS por `tokenVersion`.
   *
   * Correção de resiliência OAuth: uma falha RECUPERÁVEL de renovação
   * (`temporary_failure`/`outcome_unknown`/`invalid_client`) nunca muda o
   * status da conta nem apaga tokens — se o token atual ainda não expirou
   * de fato, esta chamada devolve o mesmo token de sempre (a sincronização
   * segue normalmente, só adiada até a próxima janela de leeway); se já
   * expirou, lança um `ConflictException` recuperável específico (nunca um
   * 500, nunca `REFRESH_RESULT_UNKNOWN` genérico). Só `invalid_grant`
   * confirmado pelo Mercado Livre marca TOKEN_EXPIRED de verdade.
   */
  async ensureValidAccessToken(accountId: string): Promise<string> {
    const leewayMs = this.configService.get<number>(
      'ML_TOKEN_REFRESH_LEEWAY_MS',
      900000,
    );

    const account = await this.assertEligibleForToken(accountId);
    if (this.isWithinLeeway(account.tokenExpiresAt, leewayMs)) {
      return this.decryptOrMarkError(
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
      if (this.isWithinLeeway(reread.tokenExpiresAt, leewayMs)) {
        return this.decryptOrMarkError(
          reread,
          reread.encryptedAccessToken as string,
        );
      }

      const result = await this.attemptRefresh(reread, { force: false });
      switch (result.kind) {
        case 'success':
          return result.accessToken;
        case 'invalid_grant':
          throw new ConflictException('REFRESH_TOKEN_REJECTED');
        case 'invalid_client':
          return this.returnCurrentTokenOrThrow(
            reread,
            'ML_APP_CONFIGURATION_ERROR',
          );
        case 'temporary_failure':
          return this.returnCurrentTokenOrThrow(
            reread,
            'REFRESH_TEMPORARY_FAILURE',
          );
        case 'outcome_unknown':
          return this.returnCurrentTokenOrThrow(
            reread,
            'REFRESH_OUTCOME_UNKNOWN',
          );
        case 'retry_scheduled':
          return this.returnCurrentTokenOrThrow(
            reread,
            reread.failureCode ?? 'REFRESH_TEMPORARY_FAILURE',
          );
        case 'not_committed':
          throw new ConflictException('REFRESH_RESULT_NOT_COMMITTED');
      }
    } finally {
      await lock.release();
    }
  }

  /**
   * Recuperação compatível para contas presas em `ERROR` por uma falha
   * recuperável de renovação (incluindo o legado `REFRESH_RESULT_UNKNOWN`,
   * de antes desta correção) — nunca para `TOKEN_EXPIRED`/`invalid_grant`
   * confirmado, que exige reconexão OAuth completa de verdade. Uma
   * tentativa CONTROLADA: mesmo lock/CAS de `ensureValidAccessToken`, mas
   * `force: true` ignora `refresh_retry_at`/o circuito de `invalid_client`
   * — o usuário pediu explicitamente "Tentar agora", uma ação já
   * rate-limited no controller, não um retry automático em massa.
   */
  async recoverConnection(
    accountId: string,
  ): Promise<RecoverConnectionOutcome> {
    const account =
      await this.marketplaceAccountsService.findByIdOrFail(accountId);
    if (account.marketplace !== Marketplace.MERCADO_LIVRE) {
      throw new NotFoundException('Conta de marketplace não encontrada.');
    }
    this.assertRecoverable(account);

    const lock = await this.advisoryLockService.tryAcquire(accountId);
    if (!lock) {
      throw new ConflictException('ACCOUNT_BUSY');
    }

    try {
      const reread =
        await this.marketplaceAccountsService.findByIdOrFail(accountId);
      this.assertRecoverable(reread);

      const result = await this.attemptRefresh(reread, { force: true });
      switch (result.kind) {
        case 'success':
          return 'RECOVERED';
        case 'invalid_grant':
          return 'RECONNECT_REQUIRED';
        case 'invalid_client':
          return 'CONFIGURATION_ERROR';
        case 'temporary_failure':
        case 'outcome_unknown':
        case 'retry_scheduled':
        case 'not_committed':
          return 'PENDING_RETRY';
      }
    } finally {
      await lock.release();
    }
  }

  private assertRecoverable(account: MarketplaceAccount): void {
    if (
      account.status !== MarketplaceAccountStatus.ERROR ||
      !account.failureCode ||
      !RECOVERABLE_FAILURE_CODES.has(account.failureCode) ||
      !account.encryptedAccessToken ||
      !account.encryptedRefreshToken
    ) {
      throw new ConflictException('ACCOUNT_NOT_RECOVERABLE');
    }
  }

  /**
   * Núcleo único da tentativa de renovação — usado tanto pelo caminho
   * passivo (`ensureValidAccessToken`) quanto pela recuperação manual
   * (`recoverConnection`). Nunca lança para um resultado RECUPERÁVEL
   * (`invalid_client`/`temporary_failure`/`outcome_unknown`/
   * `retry_scheduled`) — cada persistência já foi feita aqui dentro; o
   * chamador só decide o que DEVOLVER (token atual vs. erro específico).
   */
  private async attemptRefresh(
    reread: MarketplaceAccount,
    options: { force: boolean },
  ): Promise<AttemptRefreshResult> {
    if (
      !options.force &&
      reread.refreshRetryAt &&
      reread.refreshRetryAt.getTime() > Date.now()
    ) {
      return { kind: 'retry_scheduled' };
    }

    if (!options.force && this.isMlAppConfigCircuitOpen()) {
      await this.recordDeferredFailure(
        reread,
        'ML_APP_CONFIGURATION_ERROR',
        'Credenciais da aplicação Mercado Livre (client_id/client_secret) inválidas.',
        this.mlAppConfigCircuitRetryAt(),
      );
      return { kind: 'invalid_client' };
    }

    const refreshTokenPlain = await this.decryptOrMarkError(
      reread,
      reread.encryptedRefreshToken as string,
    );

    const outcome = await this.httpClient.refreshToken({
      refreshToken: refreshTokenPlain,
    });

    if (outcome.kind === 'invalid_grant') {
      // A ÚNICA confirmação real do provedor de que a autorização não vale
      // mais — nunca inferida de timeout/erro de configuração/ambiguidade.
      await this.marketplaceAccountsService.markTokenExpired({
        id: reread.id,
        expectedTokenVersion: reread.tokenVersion,
        failureCode: 'REFRESH_TOKEN_REJECTED',
        errorSummary:
          'O Mercado Livre rejeitou o refresh token. Reconexão necessária.',
      });
      return { kind: 'invalid_grant' };
    }

    if (outcome.kind === 'invalid_client') {
      // Erro GLOBAL da aplicação — reconectar ESTA conta nunca resolve.
      // Abre o circuito para que as próximas contas do mesmo ciclo nem
      // cheguem a tentar a mesma chamada fadada ao fracasso.
      this.openMlAppConfigCircuit();
      await this.recordDeferredFailure(
        reread,
        'ML_APP_CONFIGURATION_ERROR',
        'Credenciais da aplicação Mercado Livre (client_id/client_secret) inválidas.',
        this.mlAppConfigCircuitRetryAt(),
      );
      return { kind: 'invalid_client' };
    }

    if (
      outcome.kind === 'temporary_failure' ||
      outcome.kind === 'outcome_unknown'
    ) {
      const failureCode: RecoverableFailureCode =
        outcome.kind === 'temporary_failure'
          ? 'REFRESH_TEMPORARY_FAILURE'
          : 'REFRESH_OUTCOME_UNKNOWN';
      const delayMs =
        outcome.kind === 'temporary_failure' && outcome.retryAfterMs !== null
          ? outcome.retryAfterMs
          : computeRefreshBackoffDelayMs(reread.refreshFailureCount + 1);
      await this.recordDeferredFailure(
        reread,
        failureCode,
        outcome.kind === 'temporary_failure'
          ? 'Falha temporária (rede/indisponibilidade) ao renovar o token. Nova tentativa automática agendada.'
          : 'Resultado ambíguo ao renovar o token (conexão interrompida ou resposta incompleta). Nova tentativa automática agendada.',
        new Date(Date.now() + delayMs),
      );
      return { kind: outcome.kind };
    }

    // success
    const applied = await this.marketplaceAccountsService.applyRefreshedTokens({
      id: reread.id,
      expectedTokenVersion: reread.tokenVersion,
      encryptedAccessToken: this.encryptionService.encrypt(
        outcome.token.accessToken,
      ),
      encryptedRefreshToken: this.encryptionService.encrypt(
        outcome.token.refreshToken,
      ),
      tokenExpiresAt: new Date(
        Date.now() + outcome.token.expiresInSeconds * 1000,
      ),
    });

    if (!applied) {
      // REFRESH_RESULT_NOT_COMMITTED (design §6.4/§7): outra operação já
      // mudou a tokenVersion (ex.: reconexão concorrente, ou outra chamada
      // já aplicou uma renovação mais nova). Relê de verdade a conta e
      // preserva integralmente o que encontrar — NUNCA sobrescreve, NUNCA
      // força nenhum status, só alerta sobre a chamada atual. O refresh
      // token recém-obtido do provedor nunca é reenviado/reutilizado.
      const currentState = await this.marketplaceAccountsService.findByIdOrFail(
        reread.id,
      );
      this.logger.warn('mercado_livre_refresh_result_not_committed', {
        accountId: reread.id,
        currentStatus: currentState.status,
        currentTokenVersion: currentState.tokenVersion,
      });
      return { kind: 'not_committed' };
    }

    // Sucesso em QUALQUER conta prova que as credenciais da aplicação estão
    // boas agora — fecha o circuito imediatamente, sem esperar o cooldown.
    this.mlAppConfigCircuitOpenUntil = null;

    return { kind: 'success', accessToken: outcome.token.accessToken };
  }

  /**
   * Falha recuperável e o token ATUAL ainda não expirou de fato (só está
   * perto, dentro do leeway): devolve o mesmo token de sempre — a
   * sincronização desta conta segue normalmente, só adiada até a próxima
   * janela. Só lança quando o token já expirou e não há nada válido para
   * devolver — nunca devolve um token vencido.
   */
  private async returnCurrentTokenOrThrow(
    reread: MarketplaceAccount,
    code: string,
  ): Promise<string> {
    if (reread.tokenExpiresAt && reread.tokenExpiresAt.getTime() > Date.now()) {
      return this.decryptOrMarkError(
        reread,
        reread.encryptedAccessToken as string,
      );
    }
    throw new ConflictException(code);
  }

  private async recordDeferredFailure(
    reread: MarketplaceAccount,
    failureCode: RecoverableFailureCode,
    errorSummary: string,
    refreshRetryAt: Date,
  ): Promise<void> {
    const applied = await this.marketplaceAccountsService.markRefreshDeferred({
      id: reread.id,
      expectedTokenVersion: reread.tokenVersion,
      failureCode,
      errorSummary,
      refreshRetryAt,
    });
    if (!applied) {
      // CAS perdeu a corrida: outra chamada concorrente já aplicou um
      // sucesso (ou outra falha) para esta conta enquanto esta estava em
      // voo — uma resposta atrasada NUNCA sobrescreve um estado mais novo.
      this.logger.warn(
        'mercado_livre_refresh_deferred_write_skipped_stale_version',
        {
          accountId: reread.id,
        },
      );
    }
  }

  private isMlAppConfigCircuitOpen(): boolean {
    return (
      this.mlAppConfigCircuitOpenUntil !== null &&
      Date.now() < this.mlAppConfigCircuitOpenUntil
    );
  }

  private openMlAppConfigCircuit(): void {
    this.mlAppConfigCircuitOpenUntil =
      Date.now() + MercadoLivreOAuthService.ML_APP_CONFIG_CIRCUIT_COOLDOWN_MS;
  }

  private mlAppConfigCircuitRetryAt(): Date {
    return new Date(
      this.mlAppConfigCircuitOpenUntil ??
        Date.now() + MercadoLivreOAuthService.ML_APP_CONFIG_CIRCUIT_COOLDOWN_MS,
    );
  }

  private isWithinLeeway(
    tokenExpiresAt: Date | null,
    leewayMs: number,
  ): boolean {
    if (!tokenExpiresAt) return false;
    return tokenExpiresAt.getTime() > Date.now() + leewayMs;
  }

  private async assertEligibleForToken(
    accountId: string,
  ): Promise<MarketplaceAccount> {
    const account =
      await this.marketplaceAccountsService.findByIdOrFail(accountId);
    if (
      account.marketplace !== Marketplace.MERCADO_LIVRE ||
      account.status !== MarketplaceAccountStatus.CONNECTED ||
      !account.encryptedAccessToken ||
      !account.encryptedRefreshToken ||
      !account.tokenExpiresAt
    ) {
      throw new ConflictException('ACCOUNT_NOT_ELIGIBLE_FOR_TOKEN');
    }
    return account;
  }

  /**
   * Descriptografa qualquer credencial armazenada (access ou refresh
   * token) e trata falha uniformemente — usado tanto no fast path (sem
   * lock: `markError` é uma escrita condicional autocontida, segura sem
   * lock) quanto na releitura pós-lock, para o access token E o refresh
   * token.
   */
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
