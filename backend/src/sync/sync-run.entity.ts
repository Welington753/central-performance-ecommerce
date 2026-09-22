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

  /**
   * Checkpoint CP2K-5C-1: até onde a janela (`dateFrom`/`dateTo`) foi de
   * fato ENUMERADA POR INTEIRO quando um safety cap interrompe a
   * sincronização (`status = 'PARTIAL'`) — `null` quando nenhum prefixo foi
   * provado (cap antes de concluir qualquer bloco) ou quando o status não é
   * `PARTIAL`. Nunca a janela requisitada inteira; nunca usado por `SUCCESS`
   * (que usa `dateTo` diretamente) nem por `FAILED`/`RUNNING`.
   */
  @Column({ type: 'timestamptz', nullable: true })
  coveredThrough!: Date | null;

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

  /**
   * Diagnóstico sanitizado da classificação logística `Marketplace Full`
   * (correção da auditoria Full, migration 1789000000000) — só contagens,
   * vocabulário de chaves fechado (ver
   * `logistics-classification-diagnostics.ts`), nunca token/URL/id de
   * pedido/envio/dado de comprador. `null` para toda execução anterior à
   * migration e para qualquer marketplace/tipo de run que não classifica
   * logística. Revisão crítica: antes desta coluna existir no ENTITY, o
   * valor já era gravado pela persistência (SQL cru), mas ficava invisível
   * para `GET /sync-runs` — mapeá-la aqui é o que o torna de fato
   * consultável, sem inventar nenhum endpoint novo.
   */
  @Column({ type: 'jsonb', nullable: true })
  logisticsDiagnostics!: Record<string, number> | null;

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
