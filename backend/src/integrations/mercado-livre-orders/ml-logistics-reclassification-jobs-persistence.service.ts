import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export type MlLogisticsReclassificationJobStatus =
  'IDLE' | 'RUNNING' | 'PAUSED' | 'WAITING_RETRY' | 'COMPLETED' | 'FAILED_AUTH';

export interface MlLogisticsReclassificationJobRow {
  id: string;
  marketplaceAccountId: string;
  status: MlLogisticsReclassificationJobStatus;
  initialUnknownCount: number;
  remainingUnknownCount: number;
  resolvedFullCount: number;
  resolvedNotFullCount: number;
  callsMadeCount: number;
  /**
   * Cursor durável das duas filas do serviço reaproveitado — correção "sem
   * starvation" (revisão crítica). Ver doc da migration
   * `1789200000000-ml-logistics-reclassification-jobs.ts`.
   */
  queue1CursorId: string | null;
  queue2CursorId: string | null;
  /** Resoluções (Full/não Full) acumuladas desde que os cursores voltaram a `null` (passada atual). */
  passResolvedCount: number;
  lastActivityAt: Date | null;
  nextAttemptAt: Date;
  lastErrorCode: string | null;
  pauseRequested: boolean;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  version: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MlLogisticsReclassificationJobCommitUpdate {
  status: MlLogisticsReclassificationJobStatus;
  remainingUnknownCount: number;
  resolvedFullDelta: number;
  resolvedNotFullDelta: number;
  callsMadeDelta: number;
  /**
   * Valor EXPLÍCITO e definitivo (nunca "mantenha o atual" implícito) — o
   * chamador (worker) sempre resolve o valor correto antes de commitar:
   * ecoa o cursor anterior quando a fila não rodou neste tick, avança para
   * o novo cursor quando rodou, ou `null` numa nova passada.
   */
  queue1CursorId: string | null;
  queue2CursorId: string | null;
  /** Substitui o valor acumulado (não é delta) — o worker decide se reseta a 0 (nova passada) ou soma manualmente antes de chamar. */
  passResolvedCount: number;
  nextAttemptAt: Date;
  lastActivityAt: Date;
  completedAt: Date | null;
  lastErrorCode: string | null;
  pauseRequested: boolean;
  /** `true`: libera o lease — a linha volta a ficar reivindicável pela claim query (se o status ainda for ativo). */
  releaseLease: boolean;
}

interface JobRawRow {
  id: string;
  marketplace_account_id: string;
  status: MlLogisticsReclassificationJobStatus;
  initial_unknown_count: number;
  remaining_unknown_count: number;
  resolved_full_count: number;
  resolved_not_full_count: number;
  calls_made_count: number;
  queue1_cursor_id: string | null;
  queue2_cursor_id: string | null;
  pass_resolved_count: number;
  last_activity_at: Date | null;
  next_attempt_at: Date;
  last_error_code: string | null;
  pause_requested: boolean;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  version: number;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: JobRawRow): MlLogisticsReclassificationJobRow {
  return {
    id: row.id,
    marketplaceAccountId: row.marketplace_account_id,
    status: row.status,
    initialUnknownCount: row.initial_unknown_count,
    remainingUnknownCount: row.remaining_unknown_count,
    resolvedFullCount: row.resolved_full_count,
    resolvedNotFullCount: row.resolved_not_full_count,
    callsMadeCount: row.calls_made_count,
    queue1CursorId: row.queue1_cursor_id,
    queue2CursorId: row.queue2_cursor_id,
    passResolvedCount: row.pass_resolved_count,
    lastActivityAt: row.last_activity_at,
    nextAttemptAt: row.next_attempt_at,
    lastErrorCode: row.last_error_code,
    pauseRequested: row.pause_requested,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    version: row.version,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `
  id, marketplace_account_id, status, initial_unknown_count,
  remaining_unknown_count, resolved_full_count, resolved_not_full_count,
  calls_made_count, queue1_cursor_id, queue2_cursor_id, pass_resolved_count,
  last_activity_at, next_attempt_at, last_error_code,
  pause_requested, lease_owner, lease_expires_at, version, started_at,
  completed_at, created_at, updated_at
`;

/** Estados considerados "ativos" para fins de polling do frontend/round-robin do worker. */
export const ACTIVE_ML_RECLASSIFICATION_STATUSES: readonly MlLogisticsReclassificationJobStatus[] =
  ['RUNNING', 'WAITING_RETRY'];

/**
 * Único ponto de leitura/escrita de `ml_logistics_reclassification_jobs`
 * (correção da auditoria Full, Render free sem Shell) — MESMA convenção de
 * `BackfillJobsPersistenceService`: SQL bruto via `DataSource`, nunca
 * repositório TypeORM, para controle total sobre `FOR UPDATE SKIP LOCKED` e
 * updates condicionados por CAS (`version` + `lease_owner`). Nunca chama
 * rede — todo fetch/classificação continua em
 * `MercadoLivreLogisticsReclassificationService.apply`, reaproveitado sem
 * cópia pelo worker.
 */
@Injectable()
export class MlLogisticsReclassificationJobsPersistenceService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async findByAccountId(
    accountId: string,
  ): Promise<MlLogisticsReclassificationJobRow | null> {
    const rows = await this.dataSource.query<JobRawRow[]>(
      `SELECT ${SELECT_COLUMNS} FROM ml_logistics_reclassification_jobs
        WHERE marketplace_account_id = $1`,
      [accountId],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async findAll(): Promise<MlLogisticsReclassificationJobRow[]> {
    const rows = await this.dataSource.query<JobRawRow[]>(
      `SELECT ${SELECT_COLUMNS} FROM ml_logistics_reclassification_jobs
        ORDER BY created_at ASC`,
    );
    return rows.map(mapRow);
  }

  /**
   * Cria a linha `RUNNING` desta conta, com o snapshot inicial de `UNKNOWN`
   * já calculado pelo chamador (`countPendingByAccount`, reaproveitado —
   * nunca uma segunda consulta duplicada). Idempotente: se a linha já
   * existe, devolve-a SEM TOCAR em nada (o `ON CONFLICT DO NOTHING` +
   * `RETURNING` vazio sinaliza isso) — o chamador então relê e devolve o
   * estado atual, seja ele qual for. `initial_unknown_count` nunca é
   * sobrescrito por uma criação repetida.
   */
  async createIfAbsent(
    accountId: string,
    initialUnknownCount: number,
    now: Date,
  ): Promise<MlLogisticsReclassificationJobRow> {
    const rows = await this.dataSource.query<JobRawRow[]>(
      `INSERT INTO ml_logistics_reclassification_jobs
          (marketplace_account_id, status, initial_unknown_count,
           remaining_unknown_count, next_attempt_at, started_at, last_activity_at)
        VALUES ($1, 'RUNNING', $2, $2, $3, $3, $3)
        ON CONFLICT (marketplace_account_id) DO NOTHING
        RETURNING ${SELECT_COLUMNS}`,
      [accountId, initialUnknownCount, now],
    );
    if (rows[0]) return mapRow(rows[0]);
    const existing = await this.findByAccountId(accountId);
    if (!existing) {
      throw new Error('ML_LOGISTICS_RECLASSIFICATION_JOB_CREATE_RACE');
    }
    return existing;
  }

  /**
   * Reabre uma linha `COMPLETED`/`FAILED_AUTH` para uma nova rodada (ex.:
   * novos pedidos `UNKNOWN` surgiram depois de uma sincronização normal, ou
   * a conta foi reconectada após `FAILED_AUTH`) — nunca mexe em
   * `initial_unknown_count` (o snapshot é sempre o da PRIMEIRA vez que este
   * job existiu) nem nos contadores acumulados (`resolved_*`/`calls_made`,
   * que continuam somando ao longo de toda a vida da conta). Sem efeito
   * (devolve a linha como está) para qualquer outro status — nunca reabre
   * um job já `RUNNING`/`WAITING_RETRY`/`PAUSED`.
   *
   * `queue1_cursor_id`/`queue2_cursor_id`/`pass_resolved_count` VOLTAM a
   * `null`/`0` — uma passada nova começa do início (correção "sem
   * starvation"): pedidos cujo `external_shipment_id` só foi recuperado
   * tarde demais para a passada anterior, ou pedidos permanentemente
   * inválidos que o usuário quer que sejam reexaminados após uma correção
   * externa, entram de novo na varredura.
   */
  async restart(
    accountId: string,
    now: Date,
  ): Promise<MlLogisticsReclassificationJobRow | null> {
    const [rows] = await this.dataSource.query<[JobRawRow[], number]>(
      `UPDATE ml_logistics_reclassification_jobs
          SET status = 'RUNNING',
              pause_requested = false,
              queue1_cursor_id = NULL,
              queue2_cursor_id = NULL,
              pass_resolved_count = 0,
              next_attempt_at = $2,
              last_activity_at = $2,
              completed_at = NULL,
              last_error_code = NULL,
              version = version + 1,
              updated_at = $2
        WHERE marketplace_account_id = $1
          AND status IN ('COMPLETED', 'FAILED_AUTH')
        RETURNING ${SELECT_COLUMNS}`,
      [accountId, now],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  /**
   * Mesma semântica de `BackfillJobsPersistenceService.requestPause`: se a
   * linha ainda não foi reivindicada por um worker (`WAITING_RETRY`), pausa
   * IMEDIATAMENTE. Se está `RUNNING` com lease ativo (um worker pode estar
   * no meio de um tick agora), só marca `pause_requested` — o worker
   * consulta essa flag ao final do tick e transiciona para `PAUSED` ele
   * mesmo (nunca interrompe uma chamada HTTP em voo). Sem efeito para
   * `IDLE` (nunca existiu)/`COMPLETED`/`FAILED_AUTH`.
   */
  async requestPause(
    accountId: string,
  ): Promise<MlLogisticsReclassificationJobRow | null> {
    const [rows] = await this.dataSource.query<[JobRawRow[], number]>(
      `UPDATE ml_logistics_reclassification_jobs
          SET status = CASE WHEN status = 'WAITING_RETRY' THEN 'PAUSED' ELSE status END,
              pause_requested = CASE WHEN status = 'RUNNING' THEN true ELSE pause_requested END,
              updated_at = now(),
              version = version + 1
        WHERE marketplace_account_id = $1
          AND status IN ('RUNNING', 'WAITING_RETRY', 'PAUSED')
        RETURNING ${SELECT_COLUMNS}`,
      [accountId],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  /**
   * Retoma uma linha `PAUSED` ou `FAILED_AUTH` (usuário reconectou a conta e
   * pediu para tentar de novo) — nunca toca em `WAITING_RETRY`/`RUNNING`
   * (já ativos) nem em `COMPLETED` (usar `restart`, chamado pelo serviço
   * quando há `UNKNOWN` novo).
   */
  async resume(
    accountId: string,
    now: Date,
  ): Promise<MlLogisticsReclassificationJobRow | null> {
    const [rows] = await this.dataSource.query<[JobRawRow[], number]>(
      `UPDATE ml_logistics_reclassification_jobs
          SET status = 'RUNNING',
              pause_requested = false,
              next_attempt_at = $2,
              last_error_code = NULL,
              version = version + 1,
              updated_at = $2
        WHERE marketplace_account_id = $1
          AND status IN ('PAUSED', 'FAILED_AUTH')
        RETURNING ${SELECT_COLUMNS}`,
      [accountId, now],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  /**
   * Claim transacional — MESMA técnica de `BackfillJobsPersistenceService.claimJobs`
   * (`FOR UPDATE SKIP LOCKED`): elegível é `RUNNING`/`WAITING_RETRY` com
   * `next_attempt_at <= now()` E sem lease ativo (lease nulo ou expirado —
   * cobre tanto "nunca foi pego" quanto "worker anterior caiu no meio do
   * tick", sem rotina de recuperação separada). `ORDER BY next_attempt_at
   * ASC, last_activity_at ASC NULLS FIRST` garante round-robin entre contas
   * (Meli 1 x Meli 2): a conta processada há mais tempo (ou nunca) sempre
   * vai para o fim da fila após cada tick, então uma nunca monopoliza o
   * worker sob concorrência restrita. A transação cobre SÓ o claim — nunca
   * uma chamada HTTP.
   */
  async claim(
    workerId: string,
    limit: number,
    leaseMs: number,
  ): Promise<MlLogisticsReclassificationJobRow[]> {
    if (limit <= 0) return [];
    return this.dataSource.transaction(async (manager) => {
      const candidates = await manager.query<Array<{ id: string }>>(
        `SELECT id FROM ml_logistics_reclassification_jobs
          WHERE status IN ('RUNNING', 'WAITING_RETRY')
            AND next_attempt_at <= now()
            AND (lease_owner IS NULL OR lease_expires_at < now())
          ORDER BY next_attempt_at ASC, last_activity_at ASC NULLS FIRST
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [limit],
      );
      if (candidates.length === 0) return [];

      const ids = candidates.map((row) => row.id);
      const [rows] = await manager.query<[JobRawRow[], number]>(
        `UPDATE ml_logistics_reclassification_jobs
            SET status = 'RUNNING',
                lease_owner = $2,
                lease_expires_at = now() + ($3 || ' milliseconds')::interval,
                version = version + 1,
                updated_at = now()
          WHERE id = ANY($1::uuid[])
          RETURNING ${SELECT_COLUMNS}`,
        [ids, workerId, leaseMs],
      );
      // Preserva a ordem de prioridade decidida pelo SELECT acima — o
      // UPDATE...RETURNING não garante ordem própria.
      const byId = new Map(rows.map((row) => [row.id, mapRow(row)]));
      return ids
        .map((id) => byId.get(id))
        .filter((r): r is MlLogisticsReclassificationJobRow => r !== undefined);
    });
  }

  /**
   * Persiste o resultado de UM tick. Guardado por CAS (`version` +
   * `lease_owner`): se outro worker já reivindicou esta linha de novo
   * (lease expirou e foi roubado), o `UPDATE` afeta zero linhas e devolve
   * `false` — o chamador descarta seu resultado de bookkeeping sem
   * re-tentar (seguro: a classificação em si já foi persistida de forma
   * condicional e idempotente por `LogisticsReclassificationRepository`
   * ANTES desta chamada, nunca aqui). `resolved_*_delta`/`calls_made_delta`
   * são SOMADOS ao acumulado existente (`+ $N`), nunca substituídos —
   * contadores de vida inteira da conta, não deste tick isolado.
   * `queue1_cursor_id`/`queue2_cursor_id`/`pass_resolved_count` são
   * SUBSTITUÍDOS (valor definitivo já resolvido pelo chamador), nunca
   * somados — não são contadores de vida inteira, são o estado da PASSADA
   * atual (ver doc da migration).
   */
  async commit(
    id: string,
    expectedVersion: number,
    workerId: string,
    update: MlLogisticsReclassificationJobCommitUpdate,
  ): Promise<boolean> {
    const [rows] = await this.dataSource.query<[Array<{ id: string }>, number]>(
      `UPDATE ml_logistics_reclassification_jobs
          SET status = $4,
              remaining_unknown_count = $5,
              resolved_full_count = resolved_full_count + $6,
              resolved_not_full_count = resolved_not_full_count + $7,
              calls_made_count = calls_made_count + $8,
              queue1_cursor_id = $9,
              queue2_cursor_id = $10,
              pass_resolved_count = $11,
              next_attempt_at = $12,
              last_activity_at = $13,
              completed_at = $14,
              last_error_code = $15,
              pause_requested = $16,
              lease_owner = CASE WHEN $17::boolean THEN NULL ELSE lease_owner END,
              lease_expires_at = CASE WHEN $17::boolean THEN NULL ELSE lease_expires_at END,
              version = version + 1,
              updated_at = now()
        WHERE id = $1 AND version = $2 AND lease_owner = $3
        RETURNING id`,
      [
        id,
        expectedVersion,
        workerId,
        update.status,
        update.remainingUnknownCount,
        update.resolvedFullDelta,
        update.resolvedNotFullDelta,
        update.callsMadeDelta,
        update.queue1CursorId,
        update.queue2CursorId,
        update.passResolvedCount,
        update.nextAttemptAt,
        update.lastActivityAt,
        update.completedAt,
        update.lastErrorCode,
        update.pauseRequested,
        update.releaseLease,
      ],
    );
    return rows.length === 1;
  }
}
