import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type {
  ProblemActionInput,
  UpsertProblemInput,
} from './mercado-livre-claim-to-problem.mapper';

export interface UpsertProblemResult {
  accepted: boolean;
  id: string | null;
  inserted: boolean;
}

/**
 * Único ponto de escrita de `marketplace_problems`/`marketplace_problem_actions`
 * (CP2-A) — mesma convenção de `MarketplaceOrdersPersistenceService`: SQL
 * bruto via `QueryRunner`, transação única por chamada, nunca chama rede.
 *
 * Idempotência por `(marketplace_account_id, external_claim_id)` e proteção
 * contra evento antigo (`WHERE EXCLUDED.last_updated >= ...`) num ÚNICO
 * `INSERT ... ON CONFLICT DO UPDATE`: quando a `WHERE` bloqueia, a função
 * retorna imediatamente (`accepted:false`) sem tocar associação de pedido
 * nem actions — um evento antigo rejeitado nunca altera NADA, nem
 * `last_checked_at`.
 *
 * `responsibility`/`responsibility_confidence`/`responsibility_source`/
 * `responsibility_overridden_by_user_id`/`responsibility_overridden_at`/
 * `responsibility_override_reason` NUNCA aparecem em nenhuma cláusula desta
 * classe — omissão total, para nunca sobrescrever uma correção manual futura
 * (CP3) nem o `DEFAULT` da criação (`UNKNOWN`/`NONE`/`NULL`).
 */
@Injectable()
export class MarketplaceProblemsPersistenceService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async upsertProblem(input: UpsertProblemInput): Promise<UpsertProblemResult> {
    if (
      !(input.lastUpdated instanceof Date) ||
      Number.isNaN(input.lastUpdated.getTime())
    ) {
      throw new Error(
        'UpsertProblemInput.lastUpdated precisa ser uma Date válida.',
      );
    }

    const applyDetail = input.detail.fetched;
    const detailValue =
      applyDetail && input.detail.fetched ? input.detail.value : null;
    const applyReputation = input.reputation.fetched;
    const reputationValue =
      applyReputation && input.reputation.fetched
        ? input.reputation.value
        : null;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const rows = (await queryRunner.query(
        `INSERT INTO marketplace_problems
            (marketplace_account_id, external_claim_id, resource, resource_id, status,
             type, stage, site_id, reason_id, parent_claim_id, fulfilled, quantity_type,
             claim_version, resolution_reason, resolution_benefited_roles,
             resolution_closed_by, resolution_applied_coverage, resolution_date,
             detail_due_date, detail_responsible, detail_title, detail_description, detail_problem,
             reputation_impact, reputation_has_incentive, reputation_due_date,
             date_created, last_updated, last_checked_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                   $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, now(), now())
          ON CONFLICT (marketplace_account_id, external_claim_id) DO UPDATE SET
            resource = EXCLUDED.resource,
            resource_id = EXCLUDED.resource_id,
            status = EXCLUDED.status,
            type = EXCLUDED.type,
            stage = EXCLUDED.stage,
            site_id = EXCLUDED.site_id,
            reason_id = EXCLUDED.reason_id,
            parent_claim_id = EXCLUDED.parent_claim_id,
            fulfilled = EXCLUDED.fulfilled,
            quantity_type = EXCLUDED.quantity_type,
            claim_version = EXCLUDED.claim_version,
            resolution_reason = EXCLUDED.resolution_reason,
            resolution_benefited_roles = EXCLUDED.resolution_benefited_roles,
            resolution_closed_by = EXCLUDED.resolution_closed_by,
            resolution_applied_coverage = EXCLUDED.resolution_applied_coverage,
            resolution_date = EXCLUDED.resolution_date,
            detail_due_date = CASE WHEN $29 THEN EXCLUDED.detail_due_date ELSE marketplace_problems.detail_due_date END,
            detail_responsible = CASE WHEN $29 THEN EXCLUDED.detail_responsible ELSE marketplace_problems.detail_responsible END,
            detail_title = CASE WHEN $29 THEN EXCLUDED.detail_title ELSE marketplace_problems.detail_title END,
            detail_description = CASE WHEN $29 THEN EXCLUDED.detail_description ELSE marketplace_problems.detail_description END,
            detail_problem = CASE WHEN $29 THEN EXCLUDED.detail_problem ELSE marketplace_problems.detail_problem END,
            reputation_impact = CASE WHEN $30 THEN EXCLUDED.reputation_impact ELSE marketplace_problems.reputation_impact END,
            reputation_has_incentive = CASE WHEN $30 THEN EXCLUDED.reputation_has_incentive ELSE marketplace_problems.reputation_has_incentive END,
            reputation_due_date = CASE WHEN $30 THEN EXCLUDED.reputation_due_date ELSE marketplace_problems.reputation_due_date END,
            date_created = EXCLUDED.date_created,
            last_updated = EXCLUDED.last_updated,
            last_checked_at = now(),
            updated_at = now()
          WHERE EXCLUDED.last_updated >= marketplace_problems.last_updated
          RETURNING id, (xmax = 0) AS inserted`,
        [
          input.marketplaceAccountId,
          input.externalClaimId,
          input.resource,
          input.resourceId,
          input.status,
          input.type,
          input.stage,
          input.siteId,
          input.reasonId,
          input.parentClaimId,
          input.fulfilled,
          input.quantityType,
          input.claimVersion,
          input.resolutionReason,
          input.resolutionBenefitedRoles,
          input.resolutionClosedBy,
          input.resolutionAppliedCoverage,
          input.resolutionDate,
          detailValue?.dueDate ?? null,
          detailValue?.responsible ?? null,
          detailValue?.title ?? null,
          detailValue?.description ?? null,
          detailValue?.problem ?? null,
          reputationValue?.impact ?? null,
          reputationValue?.hasIncentive ?? null,
          reputationValue?.dueDate ?? null,
          input.dateCreated,
          input.lastUpdated,
          applyDetail,
          applyReputation,
        ],
      )) as Array<{ id: string; inserted: boolean }>;

      if (rows.length === 0) {
        // Evento antigo: bloqueado pela cláusula WHERE. Nada mais é tocado
        // nesta transação — nem associação de pedido, nem actions, nem
        // `last_checked_at` (ele só existe na linha acima, que não rodou).
        await queryRunner.commitTransaction();
        return { accepted: false, id: null, inserted: false };
      }

      const { id, inserted } = rows[0];

      if (input.resource === 'order') {
        const [order] = (await queryRunner.query(
          `SELECT id FROM marketplace_orders
             WHERE marketplace_account_id = $1 AND external_order_id = $2`,
          [input.marketplaceAccountId, input.resourceId],
        )) as Array<{ id: string }>;
        if (order) {
          await queryRunner.query(
            `UPDATE marketplace_problems
                SET marketplace_order_id = COALESCE(marketplace_order_id, $2)
              WHERE id = $1`,
            [id, order.id],
          );
        }
      }

      if (applyDetail) {
        await queryRunner.query(
          `DELETE FROM marketplace_problem_actions WHERE marketplace_problem_id = $1`,
          [id],
        );
        const actions: ProblemActionInput[] = detailValue?.actions ?? [];
        for (const action of actions) {
          await queryRunner.query(
            `INSERT INTO marketplace_problem_actions
                (marketplace_problem_id, player_role, player_type, action_code, mandatory, due_date)
              VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              id,
              action.playerRole,
              action.playerType,
              action.actionCode,
              action.mandatory,
              action.dueDate,
            ],
          );
        }
      }

      await queryRunner.commitTransaction();
      return { accepted: true, id, inserted };
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Fila de refresh do CP2-B (`MercadoLivreProblemsSyncService.
   * refreshNonTerminalBatch`) — usa o índice
   * `IX_marketplace_problems_refresh_queue` do CP2-A, sem cursor persistido:
   * todo `upsertProblem` aceito grava `last_checked_at = now()`, o que já
   * manda o registro para o fim da fila sozinho.
   */
  async findProblemsNeedingRefresh(
    accountId: string,
    limit: number,
  ): Promise<Array<{ externalClaimId: string; dateCreated: Date }>> {
    // Claim com pendência de quarentena AINDA NÃO vencida espera o backoff
    // (senão ficaria sempre na frente da fila, já que seu `last_checked_at` não anda).
    return this.dataSource.query(
      `SELECT p.external_claim_id AS "externalClaimId", p.date_created AS "dateCreated"
         FROM marketplace_problems p
        WHERE p.marketplace_account_id = $1 AND p.resolution_date IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM marketplace_problem_claim_quarantine q
             WHERE q.marketplace_account_id = p.marketplace_account_id
               AND q.external_claim_id = p.external_claim_id
               AND q.resolved_at IS NULL AND q.next_attempt_at > now())
        ORDER BY p.last_checked_at ASC NULLS FIRST, p.id ASC
        LIMIT $2`,
      [accountId, limit],
    );
  }
}
