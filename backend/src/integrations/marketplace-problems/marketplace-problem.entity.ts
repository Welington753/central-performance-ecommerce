import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Problema/claim normalizado, independente de marketplace (CP1 — só o
 * conector Mercado Livre popula esta tabela por enquanto). Nenhum payload
 * bruto do provedor é armazenado, nenhuma mensagem/evidência/anexo/PII —
 * apenas os campos normalizados abaixo. Unicidade
 * `(marketplace_account_id, external_claim_id)`: uma sincronização repetida
 * faz UPSERT, nunca duplica (repository fica para o CP2).
 *
 * `responsibility`/`responsibilityConfidence` sempre nascem `UNKNOWN`/`NONE`
 * neste checkpoint — nenhuma classificação automática é implementada aqui; o
 * CHECK de `responsibilityConfidence` só declara o vocabulário fechado para
 * quando a classificação (heurística ou manual) existir.
 */
@Entity({ name: 'marketplace_problems' })
@Index(
  'UQ_marketplace_problems_account_external_claim_id',
  ['marketplaceAccountId', 'externalClaimId'],
  { unique: true },
)
@Index('IDX_marketplace_problems_account_status', [
  'marketplaceAccountId',
  'status',
])
@Index('IDX_marketplace_problems_account_date_created', [
  'marketplaceAccountId',
  'dateCreated',
])
@Index('IDX_marketplace_problems_reason_id', ['reasonId'])
@Index('IDX_marketplace_problems_reputation_impact', ['reputationImpact'])
@Index('IDX_marketplace_problems_marketplace_order_id', ['marketplaceOrderId'])
export class MarketplaceProblem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  marketplaceAccountId!: string;

  @Column({ type: 'uuid', nullable: true })
  marketplaceOrderId!: string | null;

  @Column({ type: 'varchar' })
  externalClaimId!: string;

  @Column({ type: 'varchar' })
  resource!: string;

  @Column({ type: 'varchar' })
  resourceId!: string;

  @Column({ type: 'varchar' })
  status!: string;

  @Column({ type: 'varchar' })
  type!: string;

  @Column({ type: 'varchar' })
  stage!: string;

  @Column({ type: 'varchar' })
  siteId!: string;

  @Column({ type: 'varchar', nullable: true })
  reasonId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  parentClaimId!: string | null;

  @Column({ type: 'boolean', nullable: true })
  fulfilled!: boolean | null;

  @Column({ type: 'varchar', nullable: true })
  quantityType!: string | null;

  /** Versão semântica (`'1'`, `'1.0'`, `'1.5'`, `'2.0'`) — nunca numeric/integer. */
  @Column({ type: 'varchar', nullable: true })
  claimVersion!: string | null;

  @Column({ type: 'varchar', nullable: true })
  resolutionReason!: string | null;

  @Column({ type: 'text', array: true, default: '{}' })
  resolutionBenefitedRoles!: string[];

  @Column({ type: 'varchar', nullable: true })
  resolutionClosedBy!: string | null;

  @Column({ type: 'boolean', nullable: true })
  resolutionAppliedCoverage!: boolean | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolutionDate!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  detailDueDate!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  detailResponsible!: string | null;

  @Column({ type: 'varchar', nullable: true })
  detailTitle!: string | null;

  @Column({ type: 'text', nullable: true })
  detailDescription!: string | null;

  @Column({ type: 'varchar', nullable: true })
  detailProblem!: string | null;

  /** `affected` | `not_affected` | `not_applies`. */
  @Column({ type: 'varchar', nullable: true })
  reputationImpact!: string | null;

  @Column({ type: 'boolean', nullable: true })
  reputationHasIncentive!: boolean | null;

  @Column({ type: 'timestamptz', nullable: true })
  reputationDueDate!: Date | null;

  @Column({ type: 'varchar', default: 'UNKNOWN' })
  responsibility!: string;

  /** `NONE` | `HEURISTIC_TRIAGE` | `MANUAL` — ver CHECK na migration. */
  @Column({ type: 'varchar', default: 'NONE' })
  responsibilityConfidence!: string;

  /** Sempre `null` neste checkpoint — nenhuma classificação automática existe ainda. */
  @Column({ type: 'varchar', nullable: true })
  responsibilitySource!: string | null;

  @Column({ type: 'uuid', nullable: true })
  responsibilityOverriddenByUserId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  responsibilityOverriddenAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  responsibilityOverrideReason!: string | null;

  @Column({ type: 'timestamptz' })
  dateCreated!: Date;

  @Column({ type: 'timestamptz' })
  lastUpdated!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
