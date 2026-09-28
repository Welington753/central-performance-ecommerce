import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { UserAuditAction } from './user-audit-action.enum';

/**
 * Auditoria de gestão de usuários (criação, alteração, desativação,
 * redefinição de senha, mudança de permissões). `changes` é JSON já
 * sanitizado pelo chamador (service do próximo checkpoint) — este schema
 * NUNCA exige nem reserva coluna para dado pessoal ou segredo; a proibição
 * de senha/hash/cookie/token em `changes` é responsabilidade de quem grava
 * (nunca do banco).
 *
 * Sem FK para `users` (mesmo padrão de `customer_export_audits.user_id`,
 * ver `1789300000000-marketplace-buyers.ts`): a trilha de auditoria nunca
 * deve depender do ciclo de vida do usuário ator/alvo.
 */
@Entity({ name: 'user_audit_logs' })
@Index('IDX_user_audit_logs_created_at', ['createdAt'])
export class UserAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'actor_user_id', type: 'uuid' })
  actorUserId!: string;

  @Index('IDX_user_audit_logs_target_user_id')
  @Column({ name: 'target_user_id', type: 'uuid' })
  targetUserId!: string;

  @Column({ type: 'varchar' })
  action!: UserAuditAction;

  @Column({ type: 'jsonb', default: {} })
  changes!: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
