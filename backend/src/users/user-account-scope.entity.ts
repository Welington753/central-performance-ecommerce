import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Contas de marketplace liberadas para um usuário quando
 * `users.account_scope_mode = 'SELECTED'`. Só tem efeito nesse modo — em
 * `ALL`/`NONE` estas linhas (se existirem) são ignoradas pela resolução do
 * escopo (implementada no service do próximo checkpoint). Nunca deduplica
 * conta por usuário (índice único `user_id + marketplace_account_id`).
 */
@Entity({ name: 'user_account_scope' })
@Index(
  'UQ_user_account_scope_user_id_marketplace_account_id',
  ['userId', 'marketplaceAccountId'],
  { unique: true },
)
export class UserAccountScope {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'marketplace_account_id', type: 'uuid' })
  marketplaceAccountId!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
