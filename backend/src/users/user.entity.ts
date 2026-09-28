import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AccountScopeMode } from './account-scope-mode.enum';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar', unique: true })
  email!: string;

  /**
   * Hash argon2 da senha. NUNCA deve ser exposto em uma resposta HTTP.
   * Marcado com @Exclude como defesa extra caso a entidade seja serializada
   * diretamente; os controllers desta API sempre retornam um DTO explícito
   * (`UserResponseDto`) que nem inclui este campo.
   */
  @Exclude({ toPlainOnly: true })
  @Column({ type: 'varchar' })
  passwordHash!: string;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  /**
   * Checkpoint BI-1: primeiro conceito de papel do sistema — só controla,
   * por ora, quem pode criar/alterar a meta mensal consolidada
   * (`MonthlyRevenueGoalsController`). Nunca promovido automaticamente por
   * seed/migration (ver `UsersIsAdmin1788600000000`).
   */
  @Column({ name: 'is_admin', type: 'boolean', default: false })
  isAdmin!: boolean;

  /**
   * Papel do usuário — `roles.id`. NOT NULL desde o Checkpoint 3: todo
   * caminho que cria usuário (seed, `UsersService.createUser`,
   * `UsersManagementService.create`) é obrigado a atribuir um papel válido.
   * Usuários preexistentes já vinham preenchidos pelo backfill da migration
   * a partir de `is_admin` antes da própria migration aplicar o NOT NULL.
   * Guards resolvem a partir da PERMISSÃO efetiva (papel +
   * `user_permission_overrides`), nunca comparando `role.key` diretamente.
   */
  @Column({ name: 'role_id', type: 'uuid' })
  roleId!: string;

  /**
   * Fail-closed por definição (ver `AccountScopeMode`): ausência de linhas
   * em `user_account_scope` NUNCA equivale a `ALL`. Novo usuário nasce
   * `NONE` pelo default da coluna; usuários preexistentes são migrados para
   * `ALL` (preserva a visão que já tinham antes do RBAC).
   */
  @Column({
    name: 'account_scope_mode',
    type: 'varchar',
    default: AccountScopeMode.NONE,
  })
  accountScopeMode!: AccountScopeMode;

  @Column({ name: 'must_change_password', type: 'boolean', default: false })
  mustChangePassword!: boolean;

  @Column({ name: 'password_changed_at', type: 'timestamptz', nullable: true })
  passwordChangedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
