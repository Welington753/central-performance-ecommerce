import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
