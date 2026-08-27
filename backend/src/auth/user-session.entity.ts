import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Sessão de refresh token de um usuário interno (login/senha).
 *
 * O refresh token em texto puro NUNCA é persistido — apenas o hash SHA-256
 * dele (`refreshTokenHash`). A rotação (`POST /auth/refresh`) revoga a
 * sessão atual (`revokedAt`) e cria uma nova linha.
 */
@Entity({ name: 'user_sessions' })
export class UserSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Index()
  @Column({ type: 'varchar' })
  refreshTokenHash!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'varchar', nullable: true })
  ip!: string | null;

  @Column({ type: 'varchar', nullable: true })
  userAgent!: string | null;
}
