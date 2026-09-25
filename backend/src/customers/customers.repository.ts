import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type QueryRunner } from 'typeorm';
import type { Marketplace } from '../integrations/contracts/marketplace.enum';
import type { CustomersFilter } from './customers-query';
import {
  ACCOUNT_COVERAGE_SQL,
  BUYER_COLUMNS_SQL,
  BUYER_ORDER_SQL,
  ORDER_SCOPE_SQL,
  SqlParams,
  filteredBuyersCte,
  scopeParams,
  topProductsQuery,
} from './customers.sql';

/** Comprador já agregado e filtrado (dados pessoais ainda criptografados). */
export interface BuyerAggregateRow {
  buyer_id: string;
  marketplace_account_id: string;
  marketplace: Marketplace;
  account_nickname: string | null;
  external_buyer_id: string;
  username: string | null;
  buyer_name_encrypted: string | null;
  recipient_name_encrypted: string | null;
  email_encrypted: string | null;
  recipient_phone_encrypted: string | null;
  city: string | null;
  state: string | null;
  postal_code_encrypted: string | null;
  total_orders: number;
  valid_orders: number;
  paid_orders: number;
  paid_revenue: string;
  refunded_amount: string | null;
  units: string;
  first_purchase_at: Date | null;
  last_purchase_at: Date | null;
  last_order_at: Date;
}

export interface CustomerCardsRow {
  identified: number;
  with_valid_purchase: number;
  recurring: number;
  paid_revenue: string;
  paid_orders: number;
  units: string;
  with_buyer_name: number;
  with_recipient_name: number;
  with_email: number;
  with_recipient_phone: number;
}

export interface TopProductRow {
  buyer_id: string;
  external_item_id: string;
  seller_sku: string | null;
  title: string;
  units: string;
}

/** Uma linha por item — só identificação do comprador, nenhum dado pessoal criptografado. */
export interface DetailRow {
  marketplace: Marketplace;
  account_nickname: string | null;
  buyer_id: string;
  external_buyer_id: string;
  username: string | null;
  external_order_id: string;
  date_created: Date;
  status: string;
  source_status: string | null;
  total_amount: string;
  refunded_amount: string | null;
  logistics_classification: string;
  seller_sku: string | null;
  title: string;
  external_item_id: string;
  variation_id: string | null;
  quantity: number;
  unit_price: string;
}

export interface AccountCoverageRow {
  account_id: string;
  marketplace: Marketplace;
  account_nickname: string | null;
  total_orders: number;
  orders_with_buyer: number;
}

export interface ExportAuditInput {
  userId: string;
  filters: Record<string, unknown>;
  includedPersonalData: boolean;
}

/** Linhas lidas por `FETCH` — teto de memória da exportação. */
export const EXPORT_BUYERS_BATCH_SIZE = 500;
export const EXPORT_DETAILS_BATCH_SIZE = 1000;

/**
 * Leitura da exportação dentro de UMA transação `REPEATABLE READ READ ONLY`
 * (as três abas enxergam o mesmo instante) com cursores do servidor: nunca
 * uma consulta que traga todos os compradores ou todos os itens para a
 * memória — cada `FETCH` devolve no máximo o tamanho do lote. `close()`
 * sempre libera a conexão (inclusive quando o download é abortado).
 */
export class CustomersExportSession {
  private closed = false;

  constructor(
    private readonly queryRunner: QueryRunner,
    private readonly filter: CustomersFilter,
  ) {}

  async open(): Promise<void> {
    await this.queryRunner.query(
      'START TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );
    const buyers = new SqlParams();
    await this.queryRunner.query(
      `DECLARE customers_export_buyers NO SCROLL CURSOR FOR
       ${filteredBuyersCte(this.filter, buyers)}
       SELECT ${BUYER_COLUMNS_SQL} FROM filtered ORDER BY ${BUYER_ORDER_SQL}`,
      buyers.values,
    );
    const details = new SqlParams();
    await this.queryRunner.query(
      `DECLARE customers_export_details NO SCROLL CURSOR FOR
       ${filteredBuyersCte(this.filter, details)}
       SELECT f.marketplace, f.account_nickname, f.buyer_id, f.external_buyer_id,
              f.username, o.external_order_id, o.date_created, o.status,
              o.source_status, o.total_amount::text AS total_amount,
              o.refunded_amount::text AS refunded_amount, o.logistics_classification,
              i.seller_sku, i.title, i.external_item_id, i.variation_id, i.quantity,
              i.unit_price::text AS unit_price
         FROM filtered f
         JOIN scoped s ON s.marketplace_buyer_id = f.buyer_id
         JOIN marketplace_orders o ON o.id = s.id
         JOIN marketplace_order_items i ON i.order_id = o.id
        ORDER BY f.sort_at DESC, f.marketplace_account_id ASC,
                 f.external_buyer_id COLLATE "C" ASC, o.date_created ASC,
                 o.external_order_id ASC, i.external_item_id ASC, i.id ASC`,
      details.values,
    );
  }

  fetchBuyers(): Promise<BuyerAggregateRow[]> {
    return this.queryRunner.query(
      `FETCH ${EXPORT_BUYERS_BATCH_SIZE} FROM customers_export_buyers`,
    ) as Promise<BuyerAggregateRow[]>;
  }

  fetchDetails(): Promise<DetailRow[]> {
    return this.queryRunner.query(
      `FETCH ${EXPORT_DETAILS_BATCH_SIZE} FROM customers_export_details`,
    ) as Promise<DetailRow[]>;
  }

  findTopProducts(buyerIds: string[]): Promise<TopProductRow[]> {
    const { sql, params } = topProductsQuery(this.filter, buyerIds);
    return this.queryRunner.query(sql, params) as Promise<TopProductRow[]>;
  }

  findAccountCoverage(): Promise<AccountCoverageRow[]> {
    return this.queryRunner.query(
      ACCOUNT_COVERAGE_SQL,
      scopeParams(this.filter),
    ) as Promise<AccountCoverageRow[]>;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      // Só leitura: encerrar a transação fecha os cursores.
      await this.queryRunner.query('ROLLBACK');
    } catch {
      // Conexão já perdida (ex.: queda no meio do download) — `release`
      // abaixo devolve/descarta a conexão do mesmo jeito.
    } finally {
      await this.queryRunner.release();
    }
  }
}

/**
 * Único ponto de leitura SQL da função "Clientes" (controllers nunca acessam
 * TypeORM). Identidade do comprador sempre `marketplace_buyers.id` (=
 * conta + id externo) — agregação nunca cruza contas. Filtro, ordenação,
 * paginação e cards acontecem no banco: a tela só descriptografa a página
 * pedida (no máximo 100 compradores).
 */
@Injectable()
export class CustomersRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  findBuyerPage(
    filter: CustomersFilter,
    limit: number,
    offset: number,
  ): Promise<BuyerAggregateRow[]> {
    const p = new SqlParams();
    const cte = filteredBuyersCte(filter, p);
    return this.dataSource.query<BuyerAggregateRow[]>(
      `${cte} SELECT ${BUYER_COLUMNS_SQL} FROM filtered
        ORDER BY ${BUYER_ORDER_SQL}
        LIMIT ${p.add(limit)} OFFSET ${p.add(offset)}`,
      p.values,
    );
  }

  async findCards(filter: CustomersFilter): Promise<CustomerCardsRow> {
    const p = new SqlParams();
    const cte = filteredBuyersCte(filter, p);
    const [row] = await this.dataSource.query<CustomerCardsRow[]>(
      `${cte} SELECT COUNT(*)::int AS identified,
              COUNT(*) FILTER (WHERE valid_orders > 0)::int AS with_valid_purchase,
              COUNT(*) FILTER (WHERE valid_orders >= 2)::int AS recurring,
              COALESCE(SUM(paid_revenue), 0)::text AS paid_revenue,
              COALESCE(SUM(paid_orders), 0)::int AS paid_orders,
              COALESCE(SUM(units), 0)::text AS units,
              COUNT(*) FILTER (WHERE has_buyer_name)::int AS with_buyer_name,
              COUNT(*) FILTER (WHERE has_recipient_name)::int AS with_recipient_name,
              COUNT(*) FILTER (WHERE has_email)::int AS with_email,
              COUNT(*) FILTER (WHERE has_recipient_phone)::int AS with_recipient_phone
         FROM filtered`,
      p.values,
    );
    return row;
  }

  findTopProducts(
    filter: CustomersFilter,
    buyerIds: string[],
  ): Promise<TopProductRow[]> {
    if (buyerIds.length === 0) return Promise.resolve([]);
    const { sql, params } = topProductsQuery(filter, buyerIds);
    return this.dataSource.query<TopProductRow[]>(sql, params);
  }

  /** Pedidos (uma linha por item) de UM comprador, no escopo de conta/período. */
  findBuyerOrderLines(
    filter: CustomersFilter,
    buyerId: string,
  ): Promise<DetailRow[]> {
    return this.dataSource.query<DetailRow[]>(
      `SELECT a.marketplace, a.nickname AS account_nickname, b.id AS buyer_id,
              b.external_buyer_id, b.username, o.external_order_id, o.date_created,
              o.status, o.source_status, o.total_amount::text AS total_amount,
              o.refunded_amount::text AS refunded_amount, o.logistics_classification,
              i.seller_sku, i.title, i.external_item_id, i.variation_id, i.quantity,
              i.unit_price::text AS unit_price
         FROM marketplace_orders o
         JOIN marketplace_accounts a ON a.id = o.marketplace_account_id
         JOIN marketplace_buyers b ON b.id = o.marketplace_buyer_id
         JOIN marketplace_order_items i ON i.order_id = o.id
        WHERE b.id = $5::uuid AND ${ORDER_SCOPE_SQL}
        ORDER BY o.date_created, o.external_order_id, i.external_item_id, i.id`,
      [...scopeParams(filter), buyerId],
    );
  }

  async openExportSession(
    filter: CustomersFilter,
  ): Promise<CustomersExportSession> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    const session = new CustomersExportSession(queryRunner, filter);
    try {
      await session.open();
    } catch (error) {
      await session.close();
      throw error;
    }
    return session;
  }

  async insertExportAudit(input: ExportAuditInput): Promise<string> {
    const [row] = await this.dataSource.query<Array<{ id: string }>>(
      `INSERT INTO customer_export_audits (user_id, filters, included_personal_data)
        VALUES ($1, $2, $3)
        RETURNING id`,
      [input.userId, JSON.stringify(input.filters), input.includedPersonalData],
    );
    return row.id;
  }

  async completeExportAudit(
    auditId: string,
    counts: { buyersCount: number; detailRowsCount: number },
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE customer_export_audits
          SET buyers_count = $2, detail_rows_count = $3, completed_at = now()
        WHERE id = $1`,
      [auditId, counts.buyersCount, counts.detailRowsCount],
    );
  }
}
