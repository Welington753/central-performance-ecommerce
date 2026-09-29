import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Cache de motivo de claim (`GET /post-purchase/v1/claims/reasons/{reasonId}`
 * do Mercado Livre, generalizável a outros marketplaces). Chave composta
 * `(marketplace, site_id, reason_id)` — o mesmo `reason_id` pode significar
 * coisas diferentes em sites/marketplaces distintos.
 */
@Entity({ name: 'marketplace_problem_reasons' })
@Index(
  'UQ_marketplace_problem_reasons_marketplace_site_reason',
  ['marketplace', 'siteId', 'reasonId'],
  { unique: true },
)
export class MarketplaceProblemReason {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  marketplace!: string;

  @Column({ type: 'varchar' })
  siteId!: string;

  @Column({ type: 'varchar' })
  reasonId!: string;

  @Column({ type: 'varchar' })
  flow!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  detail!: string | null;

  @Column({ type: 'varchar' })
  status!: string;

  /** `settings.rules_engine_triage` do Mercado Livre — array, nunca escalar. */
  @Column({ type: 'text', array: true, default: '{}' })
  triage!: string[];

  @Column({ type: 'text', array: true, default: '{}' })
  allowedFlows!: string[];

  @Column({ type: 'text', array: true, default: '{}' })
  expectedResolutions!: string[];

  @Column({ type: 'timestamptz' })
  fetchedAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
