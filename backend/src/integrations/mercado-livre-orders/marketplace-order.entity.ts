import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Pedido normalizado, independente de marketplace na FORMA (mas hoje
 * populado exclusivamente pelo conector do Mercado Livre — Fase 3). Nenhum
 * dado de comprador é armazenado aqui (design "Dados permitidos" — proibido
 * nome/ID/apelido/e-mail/telefone/endereço/documentos do comprador).
 *
 * Unicidade `(marketplace_account_id, external_order_id)`: uma sincronização
 * repetida do mesmo período faz UPSERT, nunca duplica.
 */
@Entity({ name: 'marketplace_orders' })
@Index(
  'UQ_marketplace_orders_account_external_order_id',
  ['marketplaceAccountId', 'externalOrderId'],
  { unique: true },
)
@Index('IDX_marketplace_orders_account_date_created', [
  'marketplaceAccountId',
  'dateCreated',
])
export class MarketplaceOrder {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  marketplaceAccountId!: string;

  @Column({ type: 'varchar' })
  externalOrderId!: string;

  @Column({ type: 'varchar' })
  status!: string;

  @Column({ type: 'varchar', length: 3 })
  currencyId!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  totalAmount!: string;

  @Column({ type: 'varchar', nullable: true })
  packId!: string | null;

  @Column({ type: 'timestamptz' })
  dateCreated!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  dateClosed!: Date | null;

  /**
   * `last_updated` do pedido NO Mercado Livre — nunca confundir com
   * `updatedAt` (interno, quando a Central de Performance escreveu a linha).
   */
  @Column({ type: 'timestamptz', nullable: true })
  marketplaceLastUpdated!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
