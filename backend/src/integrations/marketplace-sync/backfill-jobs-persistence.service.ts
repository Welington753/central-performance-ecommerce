import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Marketplace } from '../contracts/marketplace.enum';

export type BackfillJobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'RETRY_WAIT'
  | 'PAUSED'
  | 'FAILED'
  | 'SAFETY_LIMIT_REACHED'
  | 'COMPLETED';

/**
 * `HISTORY`: backfill histórico original (avança para antes da cobertura).
 * `BUYER_ENRICHMENT`: reprocessa, do mais recente ao pedido mais antigo já
 * persistido, janelas já cobertas para associar compradores (cursor próprio
 * em `cursor_before`). Uma conta nunca tem dois jobs ativos, de qualquer modo.
 */
export type BackfillJobMode = 'HISTORY' | 'BUYER_ENRICHMENT';

/** Estados que contam como "job ativo" para a conta (índice único parcial). */
export const ACTIVE_BACKFILL_JOB_STATUSES: readonly BackfillJobStatus[] = [
  'QUEUED',
  'RUNNING',
  'RETRY_WAIT',
  'PAUSED',
];

export class BackfillJobActiveConflictError extends Error {}

export interface BackfillJobRow {
  id: string;
  marketplaceAccountId: string;
  marketplace: Marketplace;
  mode: BackfillJobMode;
  cursorBefore: Date | null;
  status: BackfillJobStatus;
  chunksProcessed: number;
  attemptCount: number;
  requestedAt: Date;
  startedAt: Date | null;
  lastActivityAt: Date | null;
  nextAttemptAt: Date;
  completedAt: Date | null;
  lastErrorCode: string | null;
  pauseRequested: boolean;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BackfillJobStateUpdate {
  status: BackfillJobStatus;
  chunksProcessed: number;
  attemptCount: number;
  nextAttemptAt: Date;
  lastActivityAt: Date;
  completedAt: Date | null;
  lastErrorCode: string | null;
  pauseRequested: boolean;
  /** `true`: libera o lease (o job volta a ficar reivindicável pela claim query, se seu status ainda for ativo). Sempre `true` no fluxo normal (um chunk por claim) — mantido explícito só para clareza/testes. */
  releaseLease: boolean;
  /** Só `BUYER_ENRICHMENT`: novo cursor após um chunk concluído; ausente preserva o atual. */
  cursorBefore?: Date;
}

interface BackfillJobRawRow {
  id: string;
  marketplace_account_id: string;
  marketplace: Marketplace;
  mode: BackfillJobMode;
  cursor_before: Date | null;
  status: BackfillJobStatus;
  chunks_processed: number;
  attempt_count: number;
  requested_at: Date;
  started_at: Date | null;
  last_activity_at: Date | null;
  next_attempt_at: Date;
  completed_at: Date | null;
  last_error_code: string | null;
  pause_requested: boolean;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: BackfillJobRawRow): BackfillJobRow {
  return {
    id: row.id,
    marketplaceAccountId: row.marketplace_account_id,
    marketplace: row.marketplace,
    mode: row.mode,
    cursorBefore: row.cursor_before,
    status: row.status,
    chunksProcessed: row.chunks_processed,
    attemptCount: row.attempt_count,
    requestedAt: row.requested_at,
    startedAt: row.started_at,
    lastActivityAt: row.last_activity_at,
    nextAttemptAt: row.next_attempt_at,
    completedAt: row.completed_at,
    lastErrorCode: row.last_error_code,
    pauseRequested: row.pause_requested,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `
  id, marketplace_account_id, marketplace, mode, cursor_before, status, chunks_processed,
  attempt_count, requested_at, started_at, last_activity_at, next_attempt_at,
  completed_at, last_error_code, pause_requested, lease_owner,
  lease_expires_at, version, created_at, updated_at
`;

/**
 * Único ponto de leitura/escrita da tabela `marketplace_backfill_jobs`
 * (Fase 4, "Backfill durável") — mesma convenção de `sync_runs`
 * (`MarketplaceOrdersPersistenceService`): SQL bruto via `DataSource`, nunca
 * repositório TypeORM, para ter controle total sobre `FOR UPDATE SKIP
 * LOCKED` e updates condicionados (CAS por `version`+`lease_owner`). Nunca
 * chama rede — todo fetch/persistência de pedidos continua em
 * `MarketplaceBackfillService.runNextChunk`, reaproveitado sem cópia.
 */
@Injectable()
export class BackfillJobsPersistenceService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Cria um job `QUEUED` para a conta. O índice único parcial
   * `UQ_marketplace_backfill_jobs_active_per_account` garante, mesmo sob
   * concorrência real entre processos/cliques, que uma segunda tentativa
   * simultânea vire `BackfillJobActiveConflictError` em vez de um segundo
   * job — o chamador (`MarketplaceBackfillService.startBackfill`) trata isso
   * buscando e devolvendo o job já ativo (idempotência do `start`).
   */
  async createJob(
    accountId: string,
    marketplace: Marketplace,
    mode: BackfillJobMode = 'HISTORY',
    cursorBefore: Date | null = null,
  ): Promise<BackfillJobRow> {
    try {
      const rows = await this.dataSource.query<BackfillJobRawRow[]>(
        `INSERT INTO marketplace_backfill_jobs
            (marketplace_account_id, marketplace, mode, cursor_before, status, next_attempt_at)
          VALUES ($1, $2, $3, $4, 'QUEUED', now())
          RETURNING ${SELECT_COLUMNS}`,
        [accountId, marketplace, mode, cursorBefore],
      );
      return mapRow(rows[0]);
    } catch (error) {
      if (this.isActiveJobConflict(error)) {
        throw new BackfillJobActiveConflictError();
      }
      throw error;
    }
  }

  async findActiveJob(accountId: string): Promise<BackfillJobRow | null> {
    const rows = await this.dataSource.query<BackfillJobRawRow[]>(
      `SELECT ${SELECT_COLUMNS} FROM marketplace_backfill_jobs
        WHERE marketplace_account_id = $1
          AND status IN ('QUEUED', 'RUNNING', 'RETRY_WAIT', 'PAUSED')
        LIMIT 1`,
      [accountId],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  /** Job mais recente da conta NO MODO pedido, ativo ou terminal — usado pelo `status` e por `resume`. */
  async findLatestJob(
    accountId: string,
    mode: BackfillJobMode = 'HISTORY',
  ): Promise<BackfillJobRow | null> {
    const rows = await this.dataSource.query<BackfillJobRawRow[]>(
      `SELECT ${SELECT_COLUMNS} FROM marketplace_backfill_jobs
        WHERE marketplace_account_id = $1 AND mode = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [accountId, mode],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  /**
   * Marca pausa. Se o job ainda não foi reivindicado por um worker
   * (`QUEUED`/`RETRY_WAIT`), pausa IMEDIATAMENTE. Se está `RUNNING` (um
   * worker está no meio de um chunk agora), só marca `pause_requested` — o
   * worker consulta essa flag depois de terminar o chunk atual e transiciona
   * para `PAUSED` ele mesmo (nunca interrompe um chunk em voo). Idempotente:
   * chamar de novo com o job já `PAUSED` não faz nada.
   */
  async requestPause(
    accountId: string,
    mode: BackfillJobMode = 'HISTORY',
  ): Promise<BackfillJobRow | null> {
    // `UPDATE ... RETURNING` via `DataSource.query()` devolve `[rows,
    // rowCount]` — ver comentário em `commitJobState`.
    const [rows] = await this.dataSource.query<[BackfillJobRawRow[], number]>(
      `UPDATE marketplace_backfill_jobs
          SET status = CASE WHEN status IN ('QUEUED', 'RETRY_WAIT') THEN 'PAUSED' ELSE status END,
              pause_requested = CASE WHEN status = 'RUNNING' THEN true ELSE pause_requested END,
              updated_at = now(),
              version = version + 1
        WHERE marketplace_account_id = $1 AND mode = $2
          AND status IN ('QUEUED', 'RUNNING', 'RETRY_WAIT', 'PAUSED')
        RETURNING ${SELECT_COLUMNS}`,
      [accountId, mode],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  /**
   * Retoma um job `PAUSED` ou reinicia a fila de tentativas de um job
   * `FAILED` (o usuário pediu explicitamente — reseta `attempt_count` para
   * dar um orçamento de backoff limpo). Sem efeito (retorna o job como
   * está) para qualquer outro status — nunca reabre um job já
   * `SAFETY_LIMIT_REACHED` nem interfere em um job já ativo.
   */
  async resumeJob(
    accountId: string,
    mode: BackfillJobMode = 'HISTORY',
  ): Promise<BackfillJobRow | null> {
    // Reativar um job deste modo com OUTRO modo já ativo na conta viola o
    // índice único "um job ativo por conta" → `BackfillJobActiveConflictError`
    // (409 no chamador), nunca um 500 cru.
    let rows: BackfillJobRawRow[];
    try {
      [rows] = await this.dataSource.query<[BackfillJobRawRow[], number]>(
        `UPDATE marketplace_backfill_jobs
          SET status = 'QUEUED',
              pause_requested = false,
              attempt_count = 0,
              next_attempt_at = now(),
              updated_at = now(),
              version = version + 1
        WHERE id = (
          SELECT id FROM marketplace_backfill_jobs
           WHERE marketplace_account_id = $1 AND mode = $2
           ORDER BY created_at DESC
           LIMIT 1
        )
          AND status IN ('PAUSED', 'FAILED')
        RETURNING ${SELECT_COLUMNS}`,
        [accountId, mode],
      );
    } catch (error) {
      if (this.isActiveJobConflict(error)) {
        throw new BackfillJobActiveConflictError();
      }
      throw error;
    }
    if (rows[0]) return mapRow(rows[0]);
    return this.findLatestJob(accountId, mode);
  }

  /**
   * Quantos jobs estão `RUNNING` com lease ainda válido AGORA — usado pelo
   * worker para respeitar um teto de concorrência GLOBAL (todas as
   * instâncias do backend, não só a que está perguntando), já que a query é
   * contra o Postgres, não estado em memória de um processo.
   */
  async countCurrentlyRunning(): Promise<number> {
    const rows = await this.dataSource.query<Array<{ count: string }>>(
      `SELECT COUNT(*)::int AS count FROM marketplace_backfill_jobs
        WHERE status = 'RUNNING' AND lease_expires_at >= now()`,
    );
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Claim transacional (Fase 4, "Backfill durável"): `FOR UPDATE SKIP
   * LOCKED` garante que, mesmo com múltiplos processos chamando isto ao
   * mesmo tempo, cada job elegível é reivindicado por NO MÁXIMO um worker —
   * os demais simplesmente pulam as linhas já travadas em vez de esperar ou
   * duplicar. A transação cobre SÓ o claim (um `UPDATE` rápido) — nunca uma
   * chamada de rede — para nunca segurar uma transação de banco aberta
   * durante o chunk real (`runNextChunk`), que acontece DEPOIS, fora desta
   * transação.
   *
   * Elegível para claim: `QUEUED`/`RETRY_WAIT` prontos (`next_attempt_at <=
   * now()`), OU `RUNNING` com lease EXPIRADO — este último é exatamente a
   * recuperação de job abandonado após um processo cair/reiniciar no meio
   * de um chunk, sem precisar de uma rotina de recuperação separada.
   */
  async claimJobs(
    workerId: string,
    limit: number,
    leaseMs: number,
  ): Promise<BackfillJobRow[]> {
    if (limit <= 0) return [];
    return this.dataSource.transaction(async (manager) => {
      const candidates = await manager.query<Array<{ id: string }>>(
        `SELECT id FROM marketplace_backfill_jobs
          WHERE (status IN ('QUEUED', 'RETRY_WAIT') AND next_attempt_at <= now())
             OR (status = 'RUNNING' AND lease_expires_at < now())
          ORDER BY next_attempt_at ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [limit],
      );
      if (candidates.length === 0) return [];

      const ids = candidates.map((row) => row.id);
      const [rows] = await manager.query<[BackfillJobRawRow[], number]>(
        `UPDATE marketplace_backfill_jobs
            SET status = 'RUNNING',
                lease_owner = $2,
                lease_expires_at = now() + ($3 || ' milliseconds')::interval,
                last_activity_at = now(),
                started_at = COALESCE(started_at, now()),
                version = version + 1,
                updated_at = now()
          WHERE id = ANY($1::uuid[])
          RETURNING ${SELECT_COLUMNS}`,
        [ids, workerId, leaseMs],
      );
      return rows.map(mapRow);
    });
  }

  /**
   * Persiste o resultado de UM chunk processado (sucesso, falha transitória
   * agendando retry, pausa consumida, ou terminal). Guardado por CAS
   * (`version` + `lease_owner`) — se outro worker já reivindicou este job
   * de novo (lease expirou e foi roubado, ex.: este worker ficou lento
   * demais), o `UPDATE` afeta zero linhas e devolve `false`: o chamador
   * simplesmente descarta seu resultado de bookkeeping sem re-tentar
   * escrevê-lo. Isso é seguro porque `runNextChunk` já persistiu os pedidos
   * de forma idempotente (UPSERT) ANTES desta chamada — perder a corrida
   * pelo controle do job nunca perde nem duplica dado de pedido, só a
   * contabilidade de progresso deste job específico (que o próximo claim já
   * corrige, recalculando tudo a partir de `sync_runs`/coverage real).
   */
  async commitJobState(
    id: string,
    expectedVersion: number,
    workerId: string,
    update: BackfillJobStateUpdate,
  ): Promise<boolean> {
    // `UPDATE ... RETURNING` via `DataSource.query()` (driver `pg`) devolve
    // a tupla `[rows, rowCount]` — mesma convenção já usada por
    // `recoverStaleRunningRuns` acima, nunca o array de linhas puro (isso é
    // só para `INSERT ... RETURNING`).
    const [rows] = await this.dataSource.query<[Array<{ id: string }>, number]>(
      `UPDATE marketplace_backfill_jobs
          SET status = $4,
              chunks_processed = $5,
              attempt_count = $6,
              next_attempt_at = $7,
              last_activity_at = $8,
              completed_at = $9,
              last_error_code = $10,
              pause_requested = $11,
              lease_owner = CASE WHEN $12::boolean THEN NULL ELSE lease_owner END,
              lease_expires_at = CASE WHEN $12::boolean THEN NULL ELSE lease_expires_at END,
              cursor_before = COALESCE($13::timestamptz, cursor_before),
              version = version + 1,
              updated_at = now()
        WHERE id = $1 AND version = $2 AND lease_owner = $3
        RETURNING id`,
      [
        id,
        expectedVersion,
        workerId,
        update.status,
        update.chunksProcessed,
        update.attemptCount,
        update.nextAttemptAt,
        update.lastActivityAt,
        update.completedAt,
        update.lastErrorCode,
        update.pauseRequested,
        update.releaseLease,
        update.cursorBefore ?? null,
      ],
    );
    return rows.length === 1;
  }

  private isActiveJobConflict(error: unknown): boolean {
    const pgError = this.extractPostgresError(error);
    return (
      pgError?.code === '23505' &&
      pgError.constraint === 'UQ_marketplace_backfill_jobs_active_per_account'
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
