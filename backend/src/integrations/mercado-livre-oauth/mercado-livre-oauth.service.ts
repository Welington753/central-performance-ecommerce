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
import { MarketplaceAccountStatus } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { AdvisoryLockService } from './advisory-lock.service';
import { buildAuthorizationUrl } from './build-authorization-url';
import type { CallbackQuery } from './callback-params.validator';
import { validateCallbackParams } from './callback-params.validator';
import { buildCallbackRedirectUrl } from './callback-redirect-url';
import { mapFailureCodeToPublicReason } from './callback-reason.mapper';
import type { MercadoLivreOAuthFailureCode } from './mercado-livre-oauth-failure-code';
import { MercadoLivreHttpClient } from './mercado-livre-http.client';
import {
  OAuthAuthorizationRequestsService,
  OAuthConnectionInProgressError,
} from './oauth-authorization-requests.service';

const CONNECTABLE_STATUSES: MarketplaceAccountStatus[] = [
  MarketplaceAccountStatus.DISCONNECTED,
  MarketplaceAccountStatus.TOKEN_EXPIRED,
  MarketplaceAccountStatus.ERROR,
  MarketplaceAccountStatus.CONNECTED,
];

@Injectable()
export class MercadoLivreOAuthService {
  private readonly logger = new Logger(MercadoLivreOAuthService.name);

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
}
