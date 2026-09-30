import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type {
  MarketplaceProblemsSyncJobCommitUpdate,
  MarketplaceProblemsSyncJobRow,
  MarketplaceProblemsSyncJobStatus,
} from './marketplace-problems-sync-jobs.types';

/** Janela inicial (dias antes de `now`) do cursor de criação de um job novo. */
export const INITIAL_WINDOW_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const TABLE = 'marketplace_problems_sync_jobs';

interface JobRawRow {
  id: string;
  marketplace_account_id: string;
  status: MarketplaceProblemsSyncJobStatus;
  window_cursor_at: Date;
  claims_processed_count: string;
  claims_persisted_count: string;
  claims_failed_count: string;
  calls_made_count: string;
  attempt_count: number;
  next_attempt_at: Date;
  last_error_code: string | null;
  pause_requested: boolean;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  version: number;
  last_activity_at: Date | null;
  last_census_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: JobRawRow): MarketplaceProblemsSyncJobRow {
  return {
    id: row.id,
    marketplaceAccountId: row.marketplace_account_id,
    status: row.status,
    windowCursorAt: row.window_cursor_at,
    // `bigint` chega como string do driver — contadores nunca chegam perto de 2^53.
    claimsProcessedCount: Number(row.claims_processed_count),
    claimsPersistedCount: Number(row.claims_persisted_count),
    claimsFailedCount: Number(row.claims_failed_count),
    callsMadeCount: Number(row.calls_made_count),
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    lastErrorCode: row.last_error_code,
    pauseRequested: row.pause_requested,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    version: row.version,
    lastActivityAt: row.last_activity_at,
    lastCompleteCensusAt: row.last_census_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `
  id, marketplace_account_id, status, window_cursor_at,
  claims_processed_count, claims_persisted_count, claims_failed_count,
  calls_made_count, attempt_count, next_attempt_at, last_error_code,
  pause_requested, lease_owner, lease_expires_at, version, last_activity_at,
  last_census_at, created_at, updated_at
`;

const LEASE_ACTIVE = `(lease_owner IS NOT NULL AND lease_expires_at >= now())`;

/**
 * Único ponto de leitura/escrita de `marketplace_problems_sync_jobs` (CP2-C) —
 * MESMA convenção de `BackfillJobsPersistenceService` e
 * `MlLogisticsReclassificationJobsPersistenceService`: SQL bruto via
 * `DataSource`, `FOR UPDATE SKIP LOCKED` no claim e updates condicionados por
 * CAS (`id` + `version` + `lease_owner`). Nunca chama rede nem mantém
 * transação aberta durante HTTP — a única transação é a do claim.
 */
@Injectable()
export class MarketplaceProblemsSyncJobsPersistenceService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async findByAccountId(
    accountId: string,
  ): Promise<MarketplaceProblemsSyncJobRow | null> {
    const rows = await this.dataSource.query<JobRawRow[]>(
      `SELECT ${SELECT_COLUMNS} FROM ${TABLE} WHERE marketplace_account_id = $1`,
      [accountId],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  /** Jobs das contas informadas (leitura para o painel; nunca cria nada). */
  async findByAccountIds(
    accountIds: string[],
  ): Promise<MarketplaceProblemsSyncJobRow[]> {
    if (accountIds.length === 0) return [];
    const rows = await this.dataSource.query<JobRawRow[]>(
      `SELECT ${SELECT_COLUMNS} FROM ${TABLE}
        WHERE marketplace_account_id = ANY($1::uuid[])`,
      [accountIds],
    );
    return rows.map(mapRow);
  }

  /**
   * Cria a linha `RUNNING` desta conta com cursor inicial
   * `now - initialWindowDays`. Idempotente: se a linha já existe, devolve-a
   * SEM TOCAR em nada (`ON CONFLICT DO NOTHING`) — o cursor nunca é
   * sobrescrito por uma criação repetida.
   */
  async createIfAbsent(
    accountId: string,
    now: Date,
    initialWindowDays: number = INITIAL_WINDOW_DAYS,
  ): Promise<MarketplaceProblemsSyncJobRow> {
    const initialCursor = new Date(now.getTime() - initialWindowDays * DAY_MS);
    const rows = await this.dataSource.query<JobRawRow[]>(
      `INSERT INTO ${TABLE} (marketplace_account_id, window_cursor_at, next_attempt_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (marketplace_account_id) DO NOTHING
        RETURNING ${SELECT_COLUMNS}`,
      [accountId, initialCursor, now],
    );
    if (rows[0]) return mapRow(rows[0]);
    const existing = await this.findByAccountId(accountId);
    if (!existing) {
      throw new Error('MARKETPLACE_PROBLEMS_SYNC_JOB_CREATE_RACE');
    }
    return existing;
  }

  /**
   * Sem lease ativo (job ocioso entre ticks, ou `WAITING_RETRY`): pausa
   * IMEDIATAMENTE. Com lease ativo (um worker pode estar no meio de um tick):
   * só marca `pause_requested` e NÃO altera `version` — o commit do tick em
   * voo continua válido (CAS) e o próprio `commit` converte em `PAUSED`
   * (nunca interrompe uma chamada HTTP em voo, nunca perde o bookkeeping).
   */
  async requestPause(
    accountId: string,
  ): Promise<MarketplaceProblemsSyncJobRow | null> {
    const idleNow = `(status IN ('RUNNING', 'WAITING_RETRY') AND NOT ${LEASE_ACTIVE})`;
    const [rows] = await this.dataSource.query<[JobRawRow[], number]>(
      `UPDATE ${TABLE}
          SET status = CASE WHEN ${idleNow} THEN 'PAUSED' ELSE status END,
              pause_requested = CASE
                WHEN status = 'RUNNING' AND ${LEASE_ACTIVE} THEN true
                ELSE pause_requested END,
              lease_owner = CASE WHEN ${idleNow} THEN NULL ELSE lease_owner END,
              lease_expires_at = CASE WHEN ${idleNow} THEN NULL ELSE lease_expires_at END,
              version = CASE WHEN ${idleNow} THEN version + 1 ELSE version END,
              updated_at = now()
        WHERE marketplace_account_id = $1
          AND status IN ('RUNNING', 'WAITING_RETRY', 'PAUSED')
        RETURNING ${SELECT_COLUMNS}`,
      [accountId],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  /**
   * Retoma `PAUSED`/`FAILED`/`FAILED_AUTH` (o usuário reconectou a conta ou
   * corrigiu a causa) — zera tentativas e erro; nunca toca em `RUNNING`/
   * `WAITING_RETRY` (já ativos). Não mexe no cursor nem nos contadores.
   */
  async resume(
    accountId: string,
    now: Date,
  ): Promise<MarketplaceProblemsSyncJobRow | null> {
    const [rows] = await this.dataSource.query<[JobRawRow[], number]>(
      `UPDATE ${TABLE}
          SET status = 'RUNNING',
              pause_requested = false,
              attempt_count = 0,
              next_attempt_at = $2,
              last_error_code = NULL,
              version = version + 1,
              updated_at = $2
        WHERE marketplace_account_id = $1
          AND status IN ('PAUSED', 'FAILED', 'FAILED_AUTH')
        RETURNING ${SELECT_COLUMNS}`,
      [accountId, now],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  /**
   * Claim transacional — MESMA técnica de `BackfillJobsPersistenceService.claimJobs`:
   * elegível é `RUNNING`/`WAITING_RETRY` com `next_attempt_at <= now()` E sem
   * lease ativo (nulo ou expirado — cobre "worker anterior caiu no meio do
   * tick" sem rotina de recuperação separada). Ordem determinística:
   * `next_attempt_at ASC, last_activity_at ASC NULLS FIRST, id ASC`
   * (round-robin: a conta atendida há mais tempo passa primeiro). A transação
   * cobre SÓ o claim.
   */
  async claim(
    workerId: string,
    limit: number,
    leaseMs: number,
  ): Promise<MarketplaceProblemsSyncJobRow[]> {
    if (limit <= 0) return [];
    return this.dataSource.transaction(async (manager) => {
      const candidates = await manager.query<Array<{ id: string }>>(
        `SELECT id FROM ${TABLE}
          WHERE status IN ('RUNNING', 'WAITING_RETRY')
            AND next_attempt_at <= now()
            AND (lease_owner IS NULL OR lease_expires_at < now())
          ORDER BY next_attempt_at ASC, last_activity_at ASC NULLS FIRST, id ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [limit],
      );
      if (candidates.length === 0) return [];

      const ids = candidates.map((row) => row.id);
      const [rows] = await manager.query<[JobRawRow[], number]>(
        `UPDATE ${TABLE}
            SET status = 'RUNNING',
                lease_owner = $2,
                lease_expires_at = now() + ($3 || ' milliseconds')::interval,
                version = version + 1,
                updated_at = now()
          WHERE id = ANY($1::uuid[])
          RETURNING ${SELECT_COLUMNS}`,
        [ids, workerId, leaseMs],
      );
      // O UPDATE...RETURNING não garante ordem — preserva a do SELECT.
      const byId = new Map(rows.map((row) => [row.id, mapRow(row)]));
      return ids
        .map((id) => byId.get(id))
        .filter((r): r is MarketplaceProblemsSyncJobRow => r !== undefined);
    });
  }

  /**
   * Persiste o resultado de UM tick, guardado por CAS (`id` + `version` +
   * `lease_owner`): se outro worker já reivindicou a linha, o `UPDATE` afeta
   * zero linhas e devolve `false` — nunca sobrescreve o novo dono. Deltas
   * são SOMADOS (contadores de vida inteira); cursor e `attempt_count` são
   * SUBSTITUÍDOS (valor definitivo do chamador). Sempre libera o lease. Se
   * `pause_requested` foi marcado durante o tick, converte `RUNNING`/
   * `WAITING_RETRY` em `PAUSED` e limpa a flag na mesma escrita.
   */
  async commit(
    id: string,
    expectedVersion: number,
    workerId: string,
    update: MarketplaceProblemsSyncJobCommitUpdate,
  ): Promise<boolean> {
    const pauses = `(pause_requested AND $4::varchar IN ('RUNNING', 'WAITING_RETRY'))`;
    const [rows] = await this.dataSource.query<[Array<{ id: string }>, number]>(
      `UPDATE ${TABLE}
          SET status = CASE WHEN ${pauses} THEN 'PAUSED' ELSE $4::varchar END,
              pause_requested = CASE WHEN ${pauses} THEN false ELSE pause_requested END,
              window_cursor_at = $5,
              claims_processed_count = claims_processed_count + $6,
              claims_persisted_count = claims_persisted_count + $7,
              claims_failed_count = claims_failed_count + $8,
              calls_made_count = calls_made_count + $9,
              attempt_count = $10,
              next_attempt_at = $11,
              last_activity_at = $12,
              last_error_code = $13,
              last_census_at = COALESCE($14, last_census_at),
              lease_owner = NULL,
              lease_expires_at = NULL,
              version = version + 1,
              updated_at = now()
        WHERE id = $1 AND version = $2 AND lease_owner = $3
        RETURNING id`,
      [
        id,
        expectedVersion,
        workerId,
        update.status,
        update.windowCursorAt,
        update.claimsProcessedDelta,
        update.claimsPersistedDelta,
        update.claimsFailedDelta,
        update.callsMadeDelta,
        update.attemptCount,
        update.nextAttemptAt,
        update.lastActivityAt,
        update.lastErrorCode,
        update.lastCompleteCensusAt,
      ],
    );
    return rows.length === 1;
  }
}
