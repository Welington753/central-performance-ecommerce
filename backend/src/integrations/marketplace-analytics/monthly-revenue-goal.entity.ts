import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Meta mensal CONSOLIDADA de faturamento (Checkpoint BI-1, "Metas e
 * Ritmo") — nunca por conta/marketplace individual; ver
 * `MonthlyRevenueGoalsController`. Uma única linha por
 * `(year, month, currencyId)`.
 */
@Entity({ name: 'monthly_revenue_goals' })
@Index('UQ_monthly_revenue_goals_year_month_currency', [
  'year',
  'month',
  'currencyId',
])
export class MonthlyRevenueGoal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'integer' })
  year!: number;

  @Column({ type: 'integer' })
  month!: number;

  @Column({ name: 'currency_id', type: 'varchar', length: 3 })
  currencyId!: string;

  @Column({ name: 'target_amount', type: 'numeric', precision: 14, scale: 2 })
  targetAmount!: string;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
