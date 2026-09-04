import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThanOrEqual, QueryRunner, Repository } from 'typeorm';
import type { Marketplace } from '../contracts/marketplace.enum';
import type { CreateMarketplaceAccountInput } from './dto/create-marketplace-account.input';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from './marketplace-account.entity';
import {
  NicknameAlreadyInUseError,
  assertValidNickname,
  normalizeNickname,
} from './nickname.util';

export interface FindMarketplaceAccountsFilter {
  marketplace?: Marketplace;
}

export type ApplySuccessfulConnectionOutcome =
  'applied' | 'version_conflict' | 'external_seller_conflict';

@Injectable()
export class MarketplaceAccountsService {
  constructor(
    @InjectRepository(MarketplaceAccount)
    private readonly repository: Repository<MarketplaceAccount>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  findAll(
    filter: FindMarketplaceAccountsFilter = {},
  ): Promise<MarketplaceAccount[]> {
    return this.repository.find({
      where: filter.marketplace ? { marketplace: filter.marketplace } : {},
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Pré-cadastra uma conta de marketplace, sempre em status DISCONNECTED e
   * sem nenhuma credencial. Nenhuma chamada externa é feita aqui — apenas a
   * criação do registro que uma futura fase de OAuth virá completar.
   *
   * A unicidade real de (marketplace, externalSellerId) quando não nulo é
   * garantida pelo índice único parcial no Postgres (ver migration inicial);
   * aqui apenas montamos e persistimos a entidade.
   */
  async create(
    input: CreateMarketplaceAccountInput,
  ): Promise<MarketplaceAccount> {
    const account = this.repository.create({
      marketplace: input.marketplace,
      externalSellerId: input.externalSellerId ?? null,
      nickname: input.nickname ?? null,
      status: MarketplaceAccountStatus.DISCONNECTED,
    });
    return this.repository.save(account);
  }

  /**
   * Renomeia (ou, com `rawNickname: null`, restaura o nome padrão de) uma
   * conta — apenas visual/interno, nunca toca `externalSellerId`,
   * `marketplace`, `status`, tokens ou `tokenVersion`. `null` pula toda
   * validação de conteúdo (representa "sem apelido", sempre válido); um
   * `string` é normalizado (trim + espaços colapsados) e validado antes de
   * checar duplicidade case-insensitive dentro do MESMO marketplace — outro
   * marketplace com o mesmo nome nunca conflita.
   *
   * A checagem de duplicidade em memória fecha a janela na maioria dos
   * casos, mas a fonte de verdade final é o índice único parcial do
   * Postgres (`UQ_marketplace_accounts_marketplace_nickname`, ver
   * migration) — duas renomeações concorrentes para o mesmo nome sempre
   * deixam exatamente uma delas presa na violação de índice, nunca as duas
   * "vencendo" silenciosamente.
   */
  async rename(
    id: string,
    rawNickname: string | null,
  ): Promise<MarketplaceAccount> {
    const account = await this.findByIdOrFail(id);

    if (rawNickname === null) {
      account.nickname = null;
      return this.repository.save(account);
    }

    const normalized = normalizeNickname(rawNickname);
    assertValidNickname(normalized);

    const duplicate = await this.repository
      .createQueryBuilder('account')
      .where('account.marketplace = :marketplace', {
        marketplace: account.marketplace,
      })
      .andWhere('account.id != :id', { id: account.id })
      .andWhere('lower(account.nickname) = lower(:nickname)', {
        nickname: normalized,
      })
      .getOne();
    if (duplicate) {
      throw new NicknameAlreadyInUseError();
    }

    account.nickname = normalized;
    try {
      return await this.repository.save(account);
    } catch (error) {
      if (this.isUniqueNicknameViolation(error)) {
        throw new NicknameAlreadyInUseError();
      }
      throw error;
    }
  }

  async findByIdOrFail(id: string): Promise<MarketplaceAccount> {
    const account = await this.repository.findOne({ where: { id } });
    if (!account) {
      throw new NotFoundException('Conta de marketplace não encontrada.');
    }
    return account;
  }

  async findByMarketplaceAndExternalSellerId(
    marketplace: Marketplace,
    externalSellerId: string,
  ): Promise<MarketplaceAccount | null> {
    return this.repository.findOne({
      where: { marketplace, externalSellerId },
    });
  }

  /**
   * CAS da conta para CONNECTED. Aceita opcionalmente um `QueryRunner` já
   * aberto por um chamador que precisa combinar esta escrita, na MESMA
   * transação, com outra tabela (Task 19's callback: esta escrita +
   * `oauth_authorization_requests` PROCESSING→SUCCESS têm que commitar ou
   * reverter juntas — design §6.2 passo 11). Quando um `QueryRunner`
   * externo é passado, este método NÃO chama `connect`/`startTransaction`/
   * `commitTransaction`/`rollbackTransaction`/`release` — só executa o
   * `UPDATE` e devolve o resultado; o chamador é dono do ciclo de vida da
   * transação. Sem um `QueryRunner` externo (uso normal, como nos testes
   * deste task), o método continua totalmente autocontido, como antes.
   */
  async applySuccessfulConnection(
    input: {
      id: string;
      expectedTokenVersion: number;
      externalSellerId: string;
      encryptedAccessToken: string;
      encryptedRefreshToken: string;
      tokenExpiresAt: Date;
      connectedByUserId: string | null;
    },
    externalQueryRunner?: QueryRunner,
  ): Promise<ApplySuccessfulConnectionOutcome> {
    const queryRunner =
      externalQueryRunner ?? this.dataSource.createQueryRunner();
    const ownsTransaction = !externalQueryRunner;

    // `connect()`/`startTransaction()` ficam DENTRO do `try` (não antes
    // dele): se `connect()` suceder mas `startTransaction()` lançar, o
    // `finally` abaixo ainda libera a conexão — evitando vazamento de
    // conexão que existiria se essas duas chamadas ficassem fora da
    // estrutura try/catch/finally.
    try {
      if (ownsTransaction) {
        await queryRunner.connect();
        await queryRunner.startTransaction();
      }

      const [rows] = (await queryRunner.query(
        `UPDATE marketplace_accounts
            SET encrypted_access_token = $1,
                encrypted_refresh_token = $2,
                token_expires_at = $3,
                external_seller_id = $4,
                status = 'CONNECTED',
                error_summary = NULL,
                failure_code = NULL,
                connected_by_user_id = $5,
                token_version = token_version + 1,
                updated_at = now()
          WHERE id = $6 AND token_version = $7
          RETURNING id`,
        [
          input.encryptedAccessToken,
          input.encryptedRefreshToken,
          input.tokenExpiresAt,
          input.externalSellerId,
          input.connectedByUserId,
          input.id,
          input.expectedTokenVersion,
        ],
      )) as [Array<{ id: string }>, number];

      if (ownsTransaction) await queryRunner.commitTransaction();
      return rows.length > 0 ? 'applied' : 'version_conflict';
    } catch (error) {
      // `isTransactionActive` cobre o caso em que `connect()` teve sucesso
      // mas `startTransaction()` lançou (nenhuma transação chegou a ficar
      // ativa) — chamar `rollbackTransaction()` nesse caso lançaria um erro
      // próprio do driver e mascararia o erro original.
      if (ownsTransaction && queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      if (this.isUniqueSellerIdViolation(error)) {
        return 'external_seller_conflict';
      }
      throw error;
    } finally {
      if (ownsTransaction) await queryRunner.release();
    }
  }

  /**
   * CAS genérico para o provisionamento interno de credenciais obtidas fora
   * do fluxo OAuth-callback (ex.: refresh token colado manualmente após a
   * autoautorização de uma aplicação privada — Fase 4, Amazon SP-API).
   * Diferente de `applySuccessfulConnection`, aceita `encryptedAccessToken`
   * ausente: o provisionamento normalmente só recebe um refresh token, nunca
   * um access token (que só existe após a primeira troca real com o
   * provedor) — por isso ele e `token_expires_at` são sempre zerados aqui,
   * forçando a próxima leitura a renovar via o fluxo normal de token.
   */
  async provisionCredentials(input: {
    id: string;
    expectedTokenVersion: number;
    externalSellerId: string;
    encryptedRefreshToken: string;
    connectedByUserId: string | null;
  }): Promise<ApplySuccessfulConnectionOutcome> {
    try {
      const rows = await this.queryReturning<{ id: string }>(
        `UPDATE marketplace_accounts
            SET external_seller_id = $1,
                encrypted_refresh_token = $2,
                encrypted_access_token = NULL,
                token_expires_at = NULL,
                status = 'CONNECTED',
                error_summary = NULL,
                failure_code = NULL,
                connected_by_user_id = $3,
                token_version = token_version + 1,
                updated_at = now()
          WHERE id = $4 AND token_version = $5
          RETURNING id`,
        [
          input.externalSellerId,
          input.encryptedRefreshToken,
          input.connectedByUserId,
          input.id,
          input.expectedTokenVersion,
        ],
      );
      return rows.length > 0 ? 'applied' : 'version_conflict';
    } catch (error) {
      if (this.isUniqueSellerIdViolation(error)) {
        return 'external_seller_conflict';
      }
      throw error;
    }
  }

  async markError(input: {
    id: string;
    expectedTokenVersion: number;
    failureCode: string;
    errorSummary: string;
  }): Promise<boolean> {
    const rows = await this.queryReturning<{ id: string }>(
      `UPDATE marketplace_accounts
          SET status = 'ERROR', failure_code = $2, error_summary = $3, updated_at = now()
        WHERE id = $1 AND token_version = $4
        RETURNING id`,
      [
        input.id,
        input.failureCode,
        input.errorSummary,
        input.expectedTokenVersion,
      ],
    );
    return rows.length > 0;
  }

  async applyRefreshedTokens(input: {
    id: string;
    expectedTokenVersion: number;
    encryptedAccessToken: string;
    encryptedRefreshToken: string;
    tokenExpiresAt: Date;
  }): Promise<boolean> {
    const rows = await this.queryReturning<{ id: string }>(
      `UPDATE marketplace_accounts
          SET encrypted_access_token = $1,
              encrypted_refresh_token = $2,
              token_expires_at = $3,
              status = 'CONNECTED',
              failure_code = NULL,
              error_summary = NULL,
              token_version = token_version + 1,
              refresh_failure_count = 0,
              refresh_retry_at = NULL,
              last_refresh_attempt_at = now(),
              updated_at = now()
        WHERE id = $4 AND token_version = $5
        RETURNING id`,
      [
        input.encryptedAccessToken,
        input.encryptedRefreshToken,
        input.tokenExpiresAt,
        input.id,
        input.expectedTokenVersion,
      ],
    );
    return rows.length > 0;
  }

  async markTokenExpired(input: {
    id: string;
    expectedTokenVersion: number;
    failureCode: string;
    errorSummary: string;
  }): Promise<boolean> {
    const rows = await this.queryReturning<{ id: string }>(
      `UPDATE marketplace_accounts
          SET status = 'TOKEN_EXPIRED', failure_code = $2, error_summary = $3,
              refresh_retry_at = NULL, last_refresh_attempt_at = now(),
              updated_at = now()
        WHERE id = $1 AND token_version = $4
        RETURNING id`,
      [
        input.id,
        input.failureCode,
        input.errorSummary,
        input.expectedTokenVersion,
      ],
    );
    return rows.length > 0;
  }

  /**
   * Falha RECUPERÁVEL de renovação (correção de resiliência OAuth):
   * `REFRESH_TEMPORARY_FAILURE`, `REFRESH_OUTCOME_UNKNOWN` ou
   * `ML_APP_CONFIGURATION_ERROR` — NUNCA muda `status` nem toca tokens
   * cifrados/`tokenVersion`. Só registra o motivo, incrementa o contador de
   * falhas consecutivas e agenda a próxima tentativa. O CAS por
   * `tokenVersion` garante que uma falha que chega atrasada nunca sobrescreve
   * uma renovação bem-sucedida concorrente (que já teria incrementado
   * `tokenVersion`) — quando o CAS falha aqui, a chamada é descartada em
   * silêncio pelo chamador, nunca reaplicada.
   */
  async markRefreshDeferred(input: {
    id: string;
    expectedTokenVersion: number;
    failureCode:
      | 'REFRESH_TEMPORARY_FAILURE'
      | 'REFRESH_OUTCOME_UNKNOWN'
      | 'ML_APP_CONFIGURATION_ERROR';
    errorSummary: string;
    refreshRetryAt: Date;
  }): Promise<boolean> {
    const rows = await this.queryReturning<{ id: string }>(
      `UPDATE marketplace_accounts
          SET failure_code = $2, error_summary = $3,
              refresh_failure_count = refresh_failure_count + 1,
              refresh_retry_at = $4,
              last_refresh_attempt_at = now(),
              updated_at = now()
        WHERE id = $1 AND token_version = $5
        RETURNING id`,
      [
        input.id,
        input.failureCode,
        input.errorSummary,
        input.refreshRetryAt,
        input.expectedTokenVersion,
      ],
    );
    return rows.length > 0;
  }

  async findConnectedDueForRenewal(
    dueBefore: Date,
    limit: number,
  ): Promise<MarketplaceAccount[]> {
    return this.repository.find({
      where: {
        status: MarketplaceAccountStatus.CONNECTED,
        tokenExpiresAt: LessThanOrEqual(dueBefore),
      },
      // Mais urgente primeiro: quando o lote é limitado por `limit`, as
      // contas cujo token expira mais cedo têm prioridade.
      order: { tokenExpiresAt: 'ASC' },
      take: limit,
    });
  }

  // A versão instalada do TypeORM (0.3.x, driver `pg`) devolve, para
  // `UPDATE/DELETE ... RETURNING` executado via `DataSource.query()`, a
  // tupla `[rows, affectedCount]` — não apenas `rows` como em um `SELECT`
  // simples (mesma particularidade já isolada em
  // `OAuthAuthorizationRequestsService.queryReturning`, Task 12).
  private async queryReturning<T>(
    query: string,
    parameters: unknown[] = [],
  ): Promise<T[]> {
    const [rows]: [T[], number] = await this.dataSource.query(
      query,
      parameters,
    );
    return rows;
  }

  // Mesmo padrão de Task 12's `isActiveAttemptConflict`: usa `code`/
  // `constraint` estruturados do driver `pg` (via `QueryFailedError`), nunca
  // texto de mensagem — o nome da constraint é definido em
  // `backend/src/database/migrations/1787837395713-init-schema.ts` (Fase 1,
  // já existente) e nunca muda por locale.
  private isUniqueSellerIdViolation(error: unknown): boolean {
    const pgError = this.extractPostgresError(error);
    return (
      pgError?.code === '23505' &&
      pgError.constraint ===
        'UQ_marketplace_accounts_marketplace_external_seller_id'
    );
  }

  private isUniqueNicknameViolation(error: unknown): boolean {
    const pgError = this.extractPostgresError(error);
    return (
      pgError?.code === '23505' &&
      pgError.constraint === 'UQ_marketplace_accounts_marketplace_nickname'
    );
  }

  private extractPostgresError(
    error: unknown,
  ): { code?: string; constraint?: string } | null {
    if (!(error instanceof Error)) return null;
    const candidate = error as Error & { code?: string; constraint?: string };
    return typeof candidate.code === 'string' ? candidate : null;
  }
}
