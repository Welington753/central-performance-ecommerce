import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Marketplace } from '../contracts/marketplace.enum';

export enum MarketplaceAccountStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTED = 'CONNECTED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  ERROR = 'ERROR',
}

/**
 * Representa uma conta de um marketplace conectada (ou a conectar) à Central
 * de Performance. Nesta fase, nenhuma credencial real é obtida via OAuth —
 * os campos de token/credencial existem apenas como contrato de dados
 * preparado para as próximas fases.
 *
 * Unicidade condicional: duas contas do mesmo marketplace podem existir sem
 * `externalSellerId` (ainda não conectadas), mas duas contas com o mesmo
 * `(marketplace, externalSellerId)` não nulo são proibidas — ver o índice
 * único parcial abaixo e a migration correspondente.
 */
@Entity({ name: 'marketplace_accounts' })
@Index(
  'UQ_marketplace_accounts_marketplace_external_seller_id',
  ['marketplace', 'externalSellerId'],
  {
    unique: true,
    where: '"external_seller_id" IS NOT NULL',
  },
)
// Unicidade condicional do apelido: case-insensitive dentro do mesmo
// marketplace, só quando não nulo (múltiplas contas sem apelido coexistem
// livremente) — ver a migration correspondente para o índice real (usa
// `lower(nickname)`, não expressável neste decorator).
export class MarketplaceAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  marketplace!: Marketplace;

  @Column({ type: 'varchar', nullable: true })
  externalSellerId!: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  nickname!: string | null;

  @Column({ type: 'varchar', default: MarketplaceAccountStatus.DISCONNECTED })
  status!: MarketplaceAccountStatus;

  @Column({ type: 'text', nullable: true })
  encryptedAccessToken!: string | null;

  @Column({ type: 'text', nullable: true })
  encryptedRefreshToken!: string | null;

  @Column({ type: 'text', nullable: true })
  encryptedCredentialMetadata!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  tokenExpiresAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSuccessfulSyncAt!: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  errorSummary!: string | null;

  @Column({ type: 'varchar', nullable: true })
  failureCode!: string | null;

  @Column({ type: 'uuid', nullable: true })
  connectedByUserId!: string | null;

  @Column({ type: 'integer', default: 0 })
  tokenVersion!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
