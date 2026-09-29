import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Ação disponível para um player de um problema/claim (`players[].available_actions`
 * do Mercado Livre) — relação 1:N, nunca assume só uma ação por problema.
 */
@Entity({ name: 'marketplace_problem_actions' })
@Index('IDX_marketplace_problem_actions_marketplace_problem_id', [
  'marketplaceProblemId',
])
export class MarketplaceProblemAction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  marketplaceProblemId!: string;

  @Column({ type: 'varchar' })
  playerRole!: string;

  @Column({ type: 'varchar' })
  playerType!: string;

  @Column({ type: 'varchar' })
  actionCode!: string;

  @Column({ type: 'boolean', default: false })
  mandatory!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  dueDate!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
