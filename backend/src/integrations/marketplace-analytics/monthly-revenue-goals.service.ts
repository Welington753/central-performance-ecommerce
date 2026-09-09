import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { MonthlyRevenueGoal } from './monthly-revenue-goal.entity';

interface MonthlyRevenueGoalRawRow {
  id: string;
  year: number;
  month: number;
  currency_id: string;
  target_amount: string;
  created_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: MonthlyRevenueGoalRawRow): MonthlyRevenueGoal {
  return {
    id: row.id,
    year: row.year,
    month: row.month,
    currencyId: row.currency_id,
    targetAmount: row.target_amount,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface UpsertMonthlyRevenueGoalInput {
  year: number;
  month: number;
  currencyId: string;
  /** Já convertido para string decimal de 2 casas pelo controller — nunca `number` cru até aqui. */
  targetAmount: string;
  createdByUserId: string | null;
}

/**
 * Único ponto de leitura/escrita de `monthly_revenue_goals` (Checkpoint
 * BI-1) — SQL bruto via `DataSource`, mesma convenção de
 * `BackfillJobsPersistenceService`/`MarketplaceOrdersPersistenceService`,
 * para controle total sobre o `ON CONFLICT` atômico do upsert. Nunca toca
 * em `marketplace_orders`/`marketplace_order_items`.
 */
@Injectable()
export class MonthlyRevenueGoalsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async findByYearMonth(
    year: number,
    month: number,
    currencyId: string,
  ): Promise<MonthlyRevenueGoal | null> {
    const rows = await this.dataSource.query<MonthlyRevenueGoalRawRow[]>(
      `SELECT * FROM monthly_revenue_goals
        WHERE year = $1 AND month = $2 AND currency_id = $3`,
      [year, month, currencyId],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  /**
   * Cria a meta consolidada do mês/moeda, ou atualiza `target_amount` de uma
   * já existente — nunca duplica (índice único `year, month, currency_id`).
   * `created_at`/`created_by_user_id` são preservados intactos numa
   * atualização (nunca sobrescritos pelo `ON CONFLICT`); só `target_amount`
   * e `updated_at` mudam.
   */
  async upsert(
    input: UpsertMonthlyRevenueGoalInput,
  ): Promise<MonthlyRevenueGoal> {
    const rows = await this.dataSource.query<MonthlyRevenueGoalRawRow[]>(
      `INSERT INTO monthly_revenue_goals
          (year, month, currency_id, target_amount, created_by_user_id)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (year, month, currency_id) DO UPDATE
          SET target_amount = EXCLUDED.target_amount,
              updated_at = now()
        RETURNING *`,
      [
        input.year,
        input.month,
        input.currencyId,
        input.targetAmount,
        input.createdByUserId,
      ],
    );
    return mapRow(rows[0]);
  }
}
