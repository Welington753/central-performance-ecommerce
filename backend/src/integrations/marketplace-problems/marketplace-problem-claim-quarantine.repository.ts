import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Vocabulário fechado de códigos sanitizados (a migration também restringe por
 * regex). Só falhas POR-CLAIM de `fetch_core` entram: 401, `invalid_response` e
 * falhas transitórias NUNCA viram quarentena (têm backoff próprio no job).
 */
export type QuarantineFailureCode = 'CORE_FORBIDDEN' | 'CORE_NOT_FOUND';

/** Backoff da próxima tentativa: `base * 2^(tentativas-1)`, limitado por `max`. */
export const QUARANTINE_RETRY_BASE_MS = 60 * 60 * 1000;
export const QUARANTINE_RETRY_MAX_MS = 24 * 60 * 60 * 1000;

const TABLE = 'marketplace_problem_claim_quarantine';
const TZ = 'America/Sao_Paulo';

export interface DueQuarantinedClaim {
  externalClaimId: string;
  /** Data de criação do claim vinda da busca (`null` em linha legada). */
  claimDateCreated: Date | null;
}

/** Pendências de UMA conta: total, as sem data conhecida e as por mês (America/Sao_Paulo, `YYYY-MM`). */
export interface PendingQuarantineSummary {
  total: number;
  unknownDate: number;
  byMonth: Map<string, number>;
}

/** Próxima tentativa com backoff exponencial a partir de `attempt_count` (valor ANTES do incremento). */
const backoffSql = (baseParam: string, maxParam: string): string =>
  `LEAST(${maxParam}::bigint, ${baseParam}::bigint * power(2, LEAST(${TABLE}.attempt_count, 20))) * interval '1 millisecond'`;

/**
 * Único ponto de leitura/escrita da quarentena de claims. Guarda SÓ o código
 * sanitizado, a data de criação do claim (resultado validado da busca) e
 * metadados de tentativa — nunca URL, token, payload, mensagem crua ou dado
 * pessoal. Não é problema sincronizado: nada aqui toca `marketplace_problems`.
 */
@Injectable()
export class MarketplaceProblemClaimQuarantineRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Registra (ou reincide) o claim: a primeira ocorrência cria a linha com 1
   * tentativa; as seguintes incrementam `attempt_count`, reagendam com backoff
   * exponencial e reabrem uma quarentena já resolvida. UPSERT único — nunca
   * duplica por `(conta, claim)`. Uma data conhecida nunca é apagada por uma
   * ocorrência sem data.
   */
  async record(
    accountId: string,
    externalClaimId: string,
    code: QuarantineFailureCode,
    now: Date,
    claimDateCreated: Date | null = null,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO ${TABLE}
          (marketplace_account_id, external_claim_id, failure_code, claim_date_created,
           first_seen_at, last_seen_at, attempt_count, next_attempt_at)
        VALUES ($1, $2, $3, $7::timestamptz, $4::timestamptz, $4::timestamptz, 1,
                $4::timestamptz + ($5::bigint * interval '1 millisecond'))
        ON CONFLICT (marketplace_account_id, external_claim_id) DO UPDATE SET
          failure_code = EXCLUDED.failure_code,
          claim_date_created = COALESCE(EXCLUDED.claim_date_created, ${TABLE}.claim_date_created),
          last_seen_at = EXCLUDED.last_seen_at,
          attempt_count = ${TABLE}.attempt_count + 1,
          next_attempt_at = $4::timestamptz + (${backoffSql('$5', '$6')}),
          resolved_at = NULL,
          updated_at = $4::timestamptz`,
      [
        accountId,
        externalClaimId,
        code,
        now,
        QUARANTINE_RETRY_BASE_MS,
        QUARANTINE_RETRY_MAX_MS,
        claimDateCreated,
      ],
    );
  }

  /**
   * Espera durável de uma quarentena PENDENTE cujo retry falhou por um motivo
   * que não vira quarentena (ex.: `invalid_response`): incrementa tentativas e
   * empurra `next_attempt_at` com backoff — sem isso o claim seria retentado a
   * cada tick. No-op para claim sem pendência.
   */
  async deferPending(
    accountId: string,
    externalClaimId: string,
    now: Date,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE ${TABLE}
          SET attempt_count = attempt_count + 1,
              last_seen_at = $3::timestamptz,
              next_attempt_at = $3::timestamptz + (${backoffSql('$4', '$5')}),
              updated_at = $3::timestamptz
        WHERE marketplace_account_id = $1 AND external_claim_id = $2
          AND resolved_at IS NULL`,
      [
        accountId,
        externalClaimId,
        now,
        QUARANTINE_RETRY_BASE_MS,
        QUARANTINE_RETRY_MAX_MS,
      ],
    );
  }

  /** Marca como resolvida a quarentena PENDENTE do claim (no-op se não houver). */
  async resolve(
    accountId: string,
    externalClaimId: string,
    now: Date,
  ): Promise<boolean> {
    const [rows] = await this.dataSource.query<[Array<{ id: string }>, number]>(
      `UPDATE ${TABLE}
          SET resolved_at = $3, updated_at = $3
        WHERE marketplace_account_id = $1 AND external_claim_id = $2
          AND resolved_at IS NULL
        RETURNING id`,
      [accountId, externalClaimId, now],
    );
    return rows.length > 0;
  }

  /** Claims pendentes cuja próxima tentativa já venceu, mais antigos primeiro. */
  async findDue(
    accountId: string,
    limit: number,
    now: Date,
  ): Promise<DueQuarantinedClaim[]> {
    if (limit <= 0) return [];
    const rows = await this.dataSource.query<
      Array<{ external_claim_id: string; claim_date_created: Date | null }>
    >(
      `SELECT external_claim_id, claim_date_created FROM ${TABLE}
        WHERE marketplace_account_id = $1 AND resolved_at IS NULL
          AND next_attempt_at <= $2
        ORDER BY next_attempt_at ASC, id ASC
        LIMIT $3`,
      [accountId, now, limit],
    );
    return rows.map((row) => ({
      externalClaimId: row.external_claim_id,
      claimDateCreated: row.claim_date_created,
    }));
  }

  /** Pendências (não resolvidas) por conta; contas sem pendência ficam fora do mapa. */
  async pendingSummaryByAccount(
    accountIds: string[],
  ): Promise<Map<string, PendingQuarantineSummary>> {
    const summaries = new Map<string, PendingQuarantineSummary>();
    if (accountIds.length === 0) return summaries;
    const rows = await this.dataSource.query<
      Array<{ marketplace_account_id: string; ym: string | null; n: number }>
    >(
      `SELECT marketplace_account_id,
              to_char(claim_date_created AT TIME ZONE '${TZ}', 'YYYY-MM') AS ym,
              count(*)::int AS n
         FROM ${TABLE}
        WHERE marketplace_account_id = ANY($1::uuid[]) AND resolved_at IS NULL
        GROUP BY 1, 2`,
      [accountIds],
    );
    for (const row of rows) {
      const summary = summaries.get(row.marketplace_account_id) ?? {
        total: 0,
        unknownDate: 0,
        byMonth: new Map<string, number>(),
      };
      summary.total += row.n;
      if (row.ym === null) summary.unknownDate += row.n;
      else summary.byMonth.set(row.ym, row.n);
      summaries.set(row.marketplace_account_id, summary);
    }
    return summaries;
  }

  /** Quantidade PENDENTE por conta; contas sem pendência ficam fora do mapa. */
  async countPendingByAccount(
    accountIds: string[],
  ): Promise<Map<string, number>> {
    const summaries = await this.pendingSummaryByAccount(accountIds);
    return new Map([...summaries].map(([id, s]) => [id, s.total]));
  }
}
