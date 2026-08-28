import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Marketplace } from '../contracts/marketplace.enum';
import type { MercadoLivreOAuthFailureCode } from './mercado-livre-oauth-failure-code';
import { OAuthAuthorizationRequestStatus } from './oauth-authorization-request-status.enum';

/**
 * Rastreia uma tentativa de conexão OAuth (design §4/§6). Todos os índices,
 * FKs e a migration ficam em
 * `database/migrations/1787900000000-mercado-livre-oauth.ts` (Task 5) — esta
 * classe só declara o mapeamento TypeORM, `synchronize` é sempre `false`.
 */
@Entity({ name: 'oauth_authorization_requests' })
export class OAuthAuthorizationRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  marketplaceAccountId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  initiatedByUserId!: string | null;

  @Column({ type: 'varchar' })
  marketplace!: Marketplace;

  @Column({ type: 'varchar', length: 64 })
  stateHash!: string;

  @Column({ type: 'text', nullable: true })
  encryptedCodeVerifier!: string | null;

  @Column({
    type: 'varchar',
    default: OAuthAuthorizationRequestStatus.PENDING,
  })
  status!: OAuthAuthorizationRequestStatus;

  @Column({ type: 'varchar', nullable: true })
  failureCode!: MercadoLivreOAuthFailureCode | null;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  processingStartedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
