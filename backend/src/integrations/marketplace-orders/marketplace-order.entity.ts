import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Pedido normalizado, independente de marketplace — populado pelo conector
 * do Mercado Livre (Fase 3) e, desde o Checkpoint 4-B, também pelo conector
 * da Amazon. Nenhum dado pessoal do comprador é armazenado aqui — só a
 * referência opcional `marketplaceBuyerId` para `marketplace_buyers`
 * (função "Clientes", ML/Shopee). Nenhum payload bruto do provedor é
 * armazenado — apenas os campos normalizados listados abaixo.
 *
 * Unicidade `(marketplace_account_id, external_order_id)`: uma sincronização
 * repetida do mesmo período faz UPSERT, nunca duplica. O marketplace de um
 * pedido é sempre obtido via `JOIN` com `marketplace_accounts` — nunca
 * duplicado nesta tabela.
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

  /**
   * Status CANÔNICO (`paid`/`cancelled`/`pending`/`unfulfillable` — ver
   * `order-status.ts`), usado por toda agregação de KPI. O Mercado Livre
   * grava seu próprio status bruto diretamente aqui (coincide com o
   * canônico para `paid`/`cancelled`; os demais nunca entram em nenhum
   * filtro). A Amazon mapeia explicitamente antes de persistir — ver
   * `source_status` abaixo para o valor original preservado.
   */
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
   * `last_updated`/`lastUpdatedTime` do pedido NA FONTE (Mercado Livre ou
   * Amazon) — nunca confundir com `updatedAt` (interno, quando a Central de
   * Performance escreveu a linha). Também usado para impedir que uma
   * atualização antiga sobrescreva uma mais nova (ver
   * `marketplace-orders-persistence.service.ts`).
   */
  @Column({ type: 'timestamptz', nullable: true })
  marketplaceLastUpdated!: Date | null;

  /**
   * Status ORIGINAL do provedor, preservado separadamente do status
   * canônico acima (Checkpoint 4-B, auditoria de schema) — ex.: `UNSHIPPED`,
   * `PARTIALLY_SHIPPED` (Amazon). `null` para todo pedido Mercado Livre
   * (cujo status bruto já É o valor gravado em `status`) e para qualquer
   * linha anterior a este checkpoint.
   */
  @Column({ type: 'varchar', nullable: true })
  sourceStatus!: string | null;

  /**
   * Canal de fulfillment (Checkpoint 4-B): `AMAZON` (FBA — a Amazon
   * armazena/despacha) ou `MERCHANT` (FBM — o próprio vendedor despacha).
   * `null` para Mercado Livre (conceito que não existe naquele marketplace)
   * e para linhas anteriores a este checkpoint.
   */
  @Column({ type: 'varchar', nullable: true })
  fulfillmentChannel!: string | null;

  /**
   * `marketplaceId` do provedor (ex.: o identificador de marketplace da
   * Amazon, distinto do `Marketplace` enum interno do sistema) — Checkpoint
   * 4-B. `null` para Mercado Livre.
   */
  @Column({ type: 'varchar', nullable: true })
  externalMarketplaceId!: string | null;

  /**
   * Classificação logística CANÔNICA (Fase 4, "Mercado Livre Full"):
   * `MARKETPLACE_FULFILLED` (Full — o próprio Mercado Livre despacha),
   * `SELLER_FULFILLED` (inclui Flex/`self_service` — nunca tratado como
   * Full) ou `UNKNOWN` (nunca resolvido, ou pedido anterior a este recurso —
   * nunca inferido como `SELLER_FULFILLED`). Distinta de
   * `fulfillmentChannel` acima, que é semântica exclusiva da Amazon
   * (`AMAZON`/`MERCHANT`) — reaproveitá-la quebraria esse contrato.
   */
  @Column({ type: 'varchar', default: 'UNKNOWN' })
  logisticsClassification!: string;

  /**
   * Valor bruto original do provedor (`logistic_type` do Mercado Livre —
   * ex.: `fulfillment`, `drop_off`, `self_service`) preservado só para
   * auditoria. `null` quando `logisticsClassification` é `UNKNOWN` por falta
   * de consulta (nunca usado em nenhum filtro/agregação).
   */
  @Column({ type: 'varchar', nullable: true })
  logisticsType!: string | null;

  /**
   * `shipping.id` do Mercado Livre, preservado para permitir RECLASSIFICAR
   * depois um pedido que ficou `UNKNOWN` (teto de consultas atingido, 429,
   * timeout) sem precisar refazer o backfill de pedidos. `null` para
   * Amazon/Shopee (conceito inexistente ali), para pedidos sem envio e para
   * toda linha anterior à migration 1789000000000 — ausência aqui nunca é
   * inferida nem inventada: apenas exclui a linha da fila de reclassificação
   * automática, e ela é contada à parte no relatório.
   */
  @Column({ type: 'varchar', nullable: true })
  externalShipmentId!: string | null;

  /**
   * Campos financeiros confirmados do Mercado Livre (CP2K-7D) — mesma
   * convenção decimal de `totalAmount` (`numeric(14,2)`, string decimal,
   * nunca centavos nesta camada). Todos nullable, sem default: ausência
   * nunca significa zero, e nenhum pedido existente antes desta migration
   * precisou ser atualizado (ficam `NULL`, igual a qualquer pedido
   * Amazon/Shopee, que nunca preenche estas colunas). `buyerShippingCost`
   * é o frete COBRADO DO COMPRADOR — nunca o custo do vendedor.
   */
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  marketplaceFeeAmount!: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  buyerShippingCostAmount!: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  taxesAmount!: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  couponAmount!: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  refundedAmount!: string | null;

  /** Uma vez associado, nunca trocado por outro comprador (ver persistência). */
  @Column({ type: 'uuid', nullable: true })
  marketplaceBuyerId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
