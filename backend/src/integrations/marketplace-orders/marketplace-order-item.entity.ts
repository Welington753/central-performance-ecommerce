import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Item de um pedido normalizado. A cada sincronização, os itens de um pedido
 * são inteiramente substituídos (delete + insert na mesma transação) — ver
 * `marketplace-orders-persistence.service.ts` — nunca duplicados.
 */
@Entity({ name: 'marketplace_order_items' })
@Index('IDX_marketplace_order_items_order_id', ['orderId'])
export class MarketplaceOrderItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  orderId!: string;

  @Column({ type: 'varchar' })
  externalItemId!: string;

  @Column({ type: 'varchar', nullable: true })
  variationId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  sellerSku!: string | null;

  @Column({ type: 'varchar' })
  title!: string;

  @Column({ type: 'integer' })
  quantity!: number;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  unitPrice!: string;

  @Column({ type: 'varchar', length: 3 })
  currencyId!: string;

  /** Comissão do Mercado Livre por item (CP2K-7D) — nullable, sem default. */
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  saleFeeAmount!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
