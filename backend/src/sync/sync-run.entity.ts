import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Marketplace } from '../integrations/contracts/marketplace.enum';

export enum SyncRunType {
  INITIAL = 'INITIAL',
  INCREMENTAL = 'INCREMENTAL',
  RECONCILIATION = 'RECONCILIATION',
  MANUAL = 'MANUAL',
  ADS = 'ADS',
}

export enum SyncRunStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  SUCCESS = 'SUCCESS',
  PARTIAL = 'PARTIAL',
  FAILED = 'FAILED',
}

/**
 * Registro de uma execução de sincronização, por marketplace e por conta.
 * Desde a Fase 3, populada por sincronizações reais de pedidos do Mercado
 * Livre (ver `mercado-livre-orders-sync.service.ts`); o contrato de dados
 * segue genérico para acomodar futuras fases e marketplaces.
 */
@Entity({ name: 'sync_runs' })
export class SyncRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  marketplaceAccountId!: string | null;

  @Index()
  @Column({ type: 'varchar' })
  marketplace!: Marketplace;

  @Column({ type: 'varchar' })
  type!: SyncRunType;

  @Index()
  @Column({ type: 'varchar' })
  status!: SyncRunStatus;

  @Index()
  @Column({ type: 'timestamptz' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  dateFrom!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  dateTo!: Date | null;

  @Column({ type: 'int', default: 0 })
  recordsRead!: number;

  @Column({ type: 'int', default: 0 })
  recordsCreated!: number;

  @Column({ type: 'int', default: 0 })
  recordsUpdated!: number;

  @Column({ type: 'int', default: 0 })
  recordsFailed!: number;

  @Column({ type: 'varchar', nullable: true })
  errorCode!: string | null;

  /**
   * Fase 3 (Mercado Livre — sincronização de pedidos): quantas páginas de
   * `orders/search` foram consultadas e quantos itens de pedido foram
   * persistidos nesta execução. `0` por padrão para todo tipo de sync run
   * que não os usa (ex.: `ADS`, futuras fases).
   */
  @Column({ type: 'int', default: 0 })
  pagesFetched!: number;

  @Column({ type: 'int', default: 0 })
  itemsPersisted!: number;

  /**
   * Resumo de erro amigável, apenas para diagnóstico interno.
   *
   * NUNCA deve conter: tokens, senhas, CPF/CNPJ, endereços completos ou o
   * payload bruto de respostas de marketplaces. Sempre gravar aqui apenas
   * uma mensagem curta e já sanitizada (ex.: "timeout ao consultar pedidos"),
   * nunca o objeto de erro original ou dados pessoais de clientes.
   */
  @Column({ type: 'text', nullable: true })
  errorSummary!: string | null;

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
