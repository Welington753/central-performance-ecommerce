import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { RoleKey } from './permissions.catalog';

/**
 * Papel de usuário — presets do Checkpoint 1 (`ADMIN`/`ANALYST`/`VIEWER`),
 * semeados pela migration (`database/migrations/*-users-roles-permissions.ts`),
 * nunca criados pelo código da aplicação nesta etapa. `isSystem` distingue
 * presets protegidos (não deletáveis) de eventuais papéis futuros criados
 * por um admin — nenhum endpoint de criação existe ainda.
 */
@Entity({ name: 'roles' })
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('UQ_roles_key', { unique: true })
  @Column({ type: 'varchar' })
  key!: RoleKey;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ name: 'is_system', type: 'boolean', default: true })
  isSystem!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
