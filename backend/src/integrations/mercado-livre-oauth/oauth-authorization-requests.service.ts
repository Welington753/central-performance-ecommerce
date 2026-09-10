import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { Marketplace } from '../contracts/marketplace.enum';
import { generatePkcePair, generateState, hashState } from './pkce.util';
import type { OAuthAuthorizationRequest } from './oauth-authorization-request.entity';

const PENDING_TTL_MS = 10 * 60 * 1000;

export class OAuthConnectionInProgressError extends Error {
  constructor() {
    super('Já existe uma tentativa de conexão em andamento para esta conta.');
  }
}

export interface CreatedPendingRequest {
  id: string;
  state: string;
  codeChallenge: string;
}

/**
 * PKCE opcional (Checkpoint CP2B — Shopee não usa PKCE, só o Mercado Livre
 * usa). `codeChallenge` é `null` neste caso — nunca uma string vazia.
 */
export interface CreatedPendingRequestNoPkce {
  id: string;
  state: string;
  codeChallenge: null;
}

interface CreatePendingInput {
  marketplaceAccountId: string;
  initiatedByUserId: string;
  marketplace: Marketplace;
  usePkce?: boolean;
}

/**
 * Todas as escritas/leituras aqui usam SQL cru via `DataSource` (não um
 * `Repository<OAuthAuthorizationRequest>` injetado) — as operações desta
 * classe são exclusivamente `UPDATE ... RETURNING` atômicos e um `INSERT`
 * dentro de transação curta, exatamente como o design especifica; não há
 * nenhum uso de `Repository`/`QueryBuilder` a justificar essa injeção
 * adicional. `OAuthAuthorizationRequest` permanece importado apenas como
 * tipo, para tipar o retorno de `claimByState`.
 */
@Injectable()
export class OAuthAuthorizationRequestsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly encryptionService: EncryptionService,
  ) {}

  /**
   * PKCE opcional (Checkpoint CP2B) — retrocompatível: toda chamada
   * existente do Mercado Livre (sem `usePkce`) continua exatamente igual,
   * `codeChallenge: string`. Só uma chamada EXPLÍCITA com
   * `usePkce: false` (o caso Shopee — decisão confirmada: "não utilizar
   * PKCE no fluxo Shopee") grava `encrypted_code_verifier = NULL` e
   * devolve `codeChallenge: null`. `state`/`stateHash` continuam sempre
   * obrigatórios nos dois modos — PKCE opcional nunca implica CSRF
   * opcional. Nenhuma migration: `encrypted_code_verifier` já é nullable.
   */
  async createPending(
    input: CreatePendingInput & { usePkce?: true },
  ): Promise<CreatedPendingRequest>;
  async createPending(
    input: CreatePendingInput & { usePkce: false },
  ): Promise<CreatedPendingRequestNoPkce>;
  async createPending(
    input: CreatePendingInput,
  ): Promise<CreatedPendingRequest | CreatedPendingRequestNoPkce> {
    const usePkce = input.usePkce ?? true;
    const state = generateState();
    const stateHash = hashState(state);
    const expiresAt = new Date(Date.now() + PENDING_TTL_MS);
    const id = randomUUID();

    let encryptedCodeVerifier: string | null = null;
    let codeChallenge: string | null = null;
    if (usePkce) {
      const pkce = generatePkcePair();
      encryptedCodeVerifier = this.encryptionService.encrypt(pkce.codeVerifier);
      codeChallenge = pkce.codeChallenge;
    }

    // `connect()`/`startTransaction()` ficam DENTRO do try: se qualquer um
    // dos dois lançar, o `finally` abaixo ainda libera o QueryRunner
    // exatamente uma vez (item 1 da segunda revisão) — antes, uma falha em
    // `connect()`/`startTransaction()` pulava o `finally` e vazava a
    // conexão dedicada do pool.
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const processing = (await queryRunner.query(
        `SELECT id FROM oauth_authorization_requests
          WHERE marketplace_account_id = $1 AND status = 'PROCESSING' LIMIT 1`,
        [input.marketplaceAccountId],
      )) as Array<{ id: string }>;

      if (processing.length > 0) {
        throw new OAuthConnectionInProgressError();
      }

      await queryRunner.query(
        `UPDATE oauth_authorization_requests
            SET status = 'EXPIRED', completed_at = now(), encrypted_code_verifier = NULL
          WHERE marketplace_account_id = $1 AND status = 'PENDING'`,
        [input.marketplaceAccountId],
      );

      await queryRunner.query(
        `INSERT INTO oauth_authorization_requests
           (id, marketplace_account_id, initiated_by_user_id, marketplace,
            state_hash, encrypted_code_verifier, status, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7)`,
        [
          id,
          input.marketplaceAccountId,
          input.initiatedByUserId,
          input.marketplace,
          stateHash,
          encryptedCodeVerifier,
          expiresAt,
        ],
      );

      await queryRunner.commitTransaction();
    } catch (error) {
      // Só faz rollback se uma transação de fato chegou a ficar ativa — uma
      // falha em `connect()` ou `startTransaction()` nunca abre transação,
      // então não há o que reverter.
      if (queryRunner.isTransactionActive) {
        try {
          await queryRunner.rollbackTransaction();
        } catch {
          // Falha no próprio rollback não pode mascarar o erro original
          // que causou a falha da transação — ele é relançado abaixo mesmo
          // assim.
        }
      }

      if (error instanceof OAuthConnectionInProgressError) throw error;
      if (this.isActiveAttemptConflict(error)) {
        throw new OAuthConnectionInProgressError();
      }
      throw error;
    } finally {
      try {
        await queryRunner.release();
      } catch {
        // Idem: uma falha na liberação não pode suprimir o erro (ou o
        // resultado de sucesso) que já está sendo propagado/retornado.
      }
    }

    // O par de overloads acima é o contrato público (checado pelo
    // chamador); a assinatura de implementação só precisa ser compatível
    // com ambos — `codeChallenge` já foi calculado corretamente acima
    // conforme `usePkce`.
    return { id, state, codeChallenge };
  }

  /**
   * `expectedMarketplace` obrigatório (correção pós-CP2C): sem ele, um state
   * válido de OUTRO marketplace seria consumido e finalizado como FAILED por
   * este chamador — uma tentativa de um marketplace nunca pode ser alterada
   * por callback de outro. A condição `marketplace = $2` entra na MESMA
   * `UPDATE ... WHERE` atômica que já filtra `status`/`expires_at`, então um
   * state de outro marketplace simplesmente não casa com nenhuma linha —
   * equivalente, de fora, a state inexistente/expirado/já usado (nenhuma
   * segunda consulta que permita distinguir os casos).
   */
  async claimByState(
    state: string,
    expectedMarketplace: Marketplace,
  ): Promise<OAuthAuthorizationRequest | null> {
    const stateHash = hashState(state);
    // `RETURNING *` devolveria nomes de coluna em snake_case
    // (`marketplace_account_id`, `processing_started_at`, ...) e um cast
    // TypeScript não os renomeia para os campos camelCase que o chamador
    // (Task 19's `applyConnectionAndFinalizeAtomically`, o advisory lock)
    // realmente lê — por isso todo alias abaixo é explícito.
    const rows = await this.queryReturning<OAuthAuthorizationRequest>(
      `UPDATE oauth_authorization_requests
          SET status = 'PROCESSING', processing_started_at = now(), consumed_at = now()
        WHERE state_hash = $1 AND marketplace = $2 AND status = 'PENDING' AND expires_at > now()
        RETURNING
          id AS "id",
          marketplace_account_id AS "marketplaceAccountId",
          initiated_by_user_id AS "initiatedByUserId",
          marketplace AS "marketplace",
          state_hash AS "stateHash",
          encrypted_code_verifier AS "encryptedCodeVerifier",
          status AS "status",
          failure_code AS "failureCode",
          expires_at AS "expiresAt",
          processing_started_at AS "processingStartedAt",
          consumed_at AS "consumedAt",
          completed_at AS "completedAt",
          created_at AS "createdAt"`,
      [stateHash, expectedMarketplace],
    );

    return rows[0] ?? null;
  }

  async finalizeSuccess(id: string): Promise<boolean> {
    const rows = await this.queryReturning<{ id: string }>(
      `UPDATE oauth_authorization_requests
          SET status = 'SUCCESS', completed_at = now(), failure_code = NULL,
              encrypted_code_verifier = NULL
        WHERE id = $1 AND status = 'PROCESSING'
        RETURNING id`,
      [id],
    );
    return rows.length > 0;
  }

  /**
   * `failureCode` é `string` no limite genérico de persistência (Checkpoint
   * CP2A — generalização mínima): este serviço nunca importa o vocabulário
   * fechado de failureCode de nenhum marketplace concreto — cada chamador
   * continua restringindo seu próprio union type ao montar a chamada (ex.:
   * `mercado-livre-oauth.service.ts` só passa valores do vocabulário fechado
   * do Mercado Livre). A coluna no banco continua `varchar`, sem alteração
   * de comportamento (ver `shopee-architecture.spec.ts`).
   */
  async finalizeFailure(id: string, failureCode: string): Promise<boolean> {
    const rows = await this.queryReturning<{ id: string }>(
      `UPDATE oauth_authorization_requests
          SET status = 'FAILED', completed_at = now(), failure_code = $2,
              encrypted_code_verifier = NULL
        WHERE id = $1 AND status = 'PROCESSING'
        RETURNING id`,
      [id, failureCode],
    );
    return rows.length > 0;
  }

  async sweepExpiredPending(): Promise<number> {
    const rows = await this.queryReturning<{ id: string }>(
      `UPDATE oauth_authorization_requests
          SET status = 'EXPIRED', completed_at = now(), encrypted_code_verifier = NULL
        WHERE status = 'PENDING' AND expires_at <= now()
        RETURNING id`,
    );
    return rows.length;
  }

  async findStaleProcessingCandidates(
    cutoff: Date,
  ): Promise<Array<{ id: string; marketplaceAccountId: string }>> {
    // Mais antigas primeiro + lote limitado: sem isso, uma execução do cron
    // com muitas candidatas concorrendo por locks poderia ficar rodando por
    // vários minutos (item 9 da revisão). `failIfStillStaleProcessing` é
    // chamada por candidata em `recoverStaleProcessing` (Task 21), então um
    // lote de 50 é reavaliado a cada execução do cron até esvaziar.
    return this.dataSource.query(
      `SELECT id, marketplace_account_id AS "marketplaceAccountId"
         FROM oauth_authorization_requests
        WHERE status = 'PROCESSING' AND processing_started_at <= $1
        ORDER BY processing_started_at ASC
        LIMIT 50`,
      [cutoff],
    );
  }

  async failIfStillStaleProcessing(id: string, cutoff: Date): Promise<boolean> {
    const rows = await this.queryReturning<{ id: string }>(
      `UPDATE oauth_authorization_requests
          SET status = 'FAILED', completed_at = now(), failure_code = 'CALLBACK_RESULT_UNKNOWN',
              encrypted_code_verifier = NULL
        WHERE id = $1 AND status = 'PROCESSING' AND processing_started_at <= $2
        RETURNING id`,
      [id, cutoff],
    );
    return rows.length > 0;
  }

  // A versão instalada do TypeORM (0.3.x, driver `pg`) devolve, para
  // `UPDATE/DELETE ... RETURNING` executado via `DataSource.query()`, a
  // tupla `[rows, affectedCount]` — não apenas `rows` como em um `SELECT`
  // simples. Este helper isola essa particularidade em um único lugar, para
  // todo `UPDATE ... RETURNING` desta classe.
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

  // TypeORM's `QueryFailedError` copia as propriedades do erro do driver
  // `pg` (incluindo `code` e `constraint`) para a própria instância — não
  // depende de casar texto de mensagem, que varia por locale/versão do
  // PostgreSQL (item 7 da revisão). `23505` é o SQLSTATE de
  // `unique_violation`; só o índice `..._active_attempt` (Task 5) representa
  // uma tentativa concorrente legítima. Uma violação em
  // `UQ_oauth_authorization_requests_state_hash` (colisão de state
  // criptograficamente aleatório — praticamente impossível) NÃO deve virar
  // `OAuthConnectionInProgressError`: é um erro real, e deve propagar como
  // tal.
  private isActiveAttemptConflict(error: unknown): boolean {
    const pgError = this.extractPostgresError(error);
    return (
      pgError?.code === '23505' &&
      pgError.constraint === 'UQ_oauth_authorization_requests_active_attempt'
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
