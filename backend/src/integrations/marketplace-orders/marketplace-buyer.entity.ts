import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Comprador de uma venda PRÓPRIA, sempre escopado à conta:
 * `(marketplaceAccountId, externalBuyerId)` é a identidade — nunca
 * deduplicado por nome/e-mail/telefone/endereço/documento, nem entre contas.
 * Campos pessoais (`*Encrypted`) ficam no formato do `EncryptionService`;
 * nenhum documento, endereço completo ou payload bruto é armazenado.
 */
@Entity({ name: 'marketplace_buyers' })
@Index(
  'UQ_marketplace_buyers_account_external_buyer_id',
  ['marketplaceAccountId', 'externalBuyerId'],
  { unique: true },
)
export class MarketplaceBuyer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  marketplaceAccountId!: string;

  @Column({ type: 'varchar' })
  externalBuyerId!: string;

  @Column({ type: 'varchar', nullable: true })
  username!: string | null;

  /** Nome do COMPRADOR (só Mercado Livre o fornece). */
  @Column({ type: 'text', nullable: true })
  buyerNameEncrypted!: string | null;

  /** Nome do DESTINATÁRIO da entrega (Shopee) — pode não ser o comprador. */
  @Column({ type: 'text', nullable: true })
  recipientNameEncrypted!: string | null;

  @Column({ type: 'text', nullable: true })
  emailEncrypted!: string | null;

  /** Telefone do DESTINATÁRIO da entrega (Shopee) — pode não ser o comprador. */
  @Column({ type: 'text', nullable: true })
  recipientPhoneEncrypted!: string | null;

  /** Cidade/UF/CEP do endereço de ENTREGA. */
  @Column({ type: 'varchar', nullable: true })
  city!: string | null;

  @Column({ type: 'varchar', nullable: true })
  state!: string | null;

  @Column({ type: 'text', nullable: true })
  postalCodeEncrypted!: string | null;

  /** `has*`: presente e não mascarado — derivados na escrita, nunca PII. */
  @Column({ type: 'boolean', default: false })
  hasBuyerName!: boolean;

  @Column({ type: 'boolean', default: false })
  hasRecipientName!: boolean;

  @Column({ type: 'boolean', default: false })
  hasEmail!: boolean;

  @Column({ type: 'boolean', default: false })
  hasRecipientPhone!: boolean;

  @Column({ type: 'varchar' })
  dataSource!: string;

  /** Instante NA FONTE do dado pessoal mais recente aplicado — impede regressão por evento antigo. */
  @Column({ type: 'timestamptz', nullable: true })
  personalDataLastUpdatedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
