import {
  PAID_ORDER_STATUS,
  PARTIALLY_REFUNDED_ORDER_STATUS,
} from '../integrations/marketplace-orders/order-status';
import { marketplacesForFilter, type CustomersFilter } from './customers-query';

// SQL da função "Clientes" (montagem pura, sem acesso a banco) — usado por
// `CustomersRepository` e pela sessão de exportação por cursor.

/**
 * Pedido "válido" para recorrência/unidades/primeira-última compra: pago ou
 * pago com estorno parcial. Faturamento/ticket seguem a semântica do KPI
 * financeiro (`status = 'paid'` apenas). Cancelados/pendentes só aparecem no
 * detalhamento.
 */
export const VALID_PURCHASE_STATUSES = [
  PAID_ORDER_STATUS,
  PARTIALLY_REFUNDED_ORDER_STATUS,
];

/** Numeração posicional (`$1`, `$2`, ...) de parâmetros montados sob demanda. */
export class SqlParams {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

function escapeLikePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export const BUYER_ORDER_SQL = `sort_at DESC, marketplace_account_id ASC, external_buyer_id COLLATE "C" ASC`;

/**
 * CTEs `scoped` (pedidos do escopo com comprador), `agg` (uma linha por
 * comprador — contagens por PEDIDO, nunca por item) e `filtered` (todos os
 * filtros em SQL). Busca textual SÓ em id externo/username: nomes ficam
 * criptografados e nunca são pesquisados (nem descriptografados em massa).
 */
export function filteredBuyersCte(
  filter: CustomersFilter,
  p: SqlParams,
): string {
  const marketplaces = p.add(marketplacesForFilter(filter));
  const account = p.add(filter.accountId);
  const from = p.add(filter.period?.from ?? null);
  const to = p.add(filter.period?.to ?? null);
  const valid = p.add(VALID_PURCHASE_STATUSES);
  const paid = p.add(PAID_ORDER_STATUS);

  const conditions = ['true'];
  if (filter.customerType === 'NEW') conditions.push('agg.valid_orders = 1');
  if (filter.customerType === 'RECURRING') {
    conditions.push('agg.valid_orders >= 2');
  }
  if (filter.search !== null) {
    const search = p.add(escapeLikePattern(filter.search));
    conditions.push(
      `(b.external_buyer_id ILIKE ${search} OR b.username ILIKE ${search})`,
    );
  }
  if (filter.onlyWithEmail) conditions.push('b.has_email');
  if (filter.onlyWithRecipientPhone) conditions.push('b.has_recipient_phone');
  if (filter.product !== null) {
    const product = p.add(escapeLikePattern(filter.product));
    conditions.push(`EXISTS (
      SELECT 1 FROM scoped ps
        JOIN marketplace_order_items pi ON pi.order_id = ps.id
       WHERE ps.marketplace_buyer_id = b.id
         AND (pi.title ILIKE ${product} OR pi.seller_sku ILIKE ${product}
              OR pi.external_item_id ILIKE ${product}))`);
  }

  return `WITH scoped AS (
      SELECT o.id, o.marketplace_buyer_id, o.status, o.total_amount,
             o.refunded_amount, o.date_created
        FROM marketplace_orders o
        JOIN marketplace_accounts a ON a.id = o.marketplace_account_id
       WHERE o.marketplace_buyer_id IS NOT NULL
         AND a.marketplace = ANY(${marketplaces}::varchar[])
         AND (${account}::uuid IS NULL OR o.marketplace_account_id = ${account}::uuid)
         AND (${from}::timestamptz IS NULL OR o.date_created >= ${from}::timestamptz)
         AND (${to}::timestamptz IS NULL OR o.date_created < ${to}::timestamptz)
    ), units AS (
      SELECT i.order_id, SUM(i.quantity)::bigint AS units
        FROM marketplace_order_items i
        JOIN scoped s ON s.id = i.order_id
       GROUP BY i.order_id
    ), agg AS (
      SELECT s.marketplace_buyer_id AS buyer_id,
             COUNT(*)::int AS total_orders,
             COUNT(*) FILTER (WHERE s.status = ANY(${valid}::varchar[]))::int AS valid_orders,
             COUNT(*) FILTER (WHERE s.status = ${paid})::int AS paid_orders,
             COALESCE(SUM(s.total_amount) FILTER (WHERE s.status = ${paid}), 0) AS paid_revenue,
             SUM(s.refunded_amount) AS refunded_amount,
             COALESCE(SUM(u.units) FILTER (WHERE s.status = ANY(${valid}::varchar[])), 0) AS units,
             MIN(s.date_created) FILTER (WHERE s.status = ANY(${valid}::varchar[])) AS first_purchase_at,
             MAX(s.date_created) FILTER (WHERE s.status = ANY(${valid}::varchar[])) AS last_purchase_at,
             MAX(s.date_created) AS last_order_at
        FROM scoped s
        LEFT JOIN units u ON u.order_id = s.id
       GROUP BY s.marketplace_buyer_id
    ), filtered AS (
      SELECT agg.*, b.marketplace_account_id, a.marketplace,
             a.nickname AS account_nickname, b.external_buyer_id, b.username,
             b.buyer_name_encrypted, b.recipient_name_encrypted, b.email_encrypted,
             b.recipient_phone_encrypted, b.city, b.state, b.postal_code_encrypted,
             b.has_buyer_name, b.has_recipient_name, b.has_email, b.has_recipient_phone,
             COALESCE(agg.last_purchase_at, agg.last_order_at) AS sort_at
        FROM agg
        JOIN marketplace_buyers b ON b.id = agg.buyer_id
        JOIN marketplace_accounts a ON a.id = b.marketplace_account_id
       WHERE ${conditions.join(' AND ')}
    )`;
}

export const BUYER_COLUMNS_SQL = `buyer_id, marketplace_account_id, marketplace, account_nickname,
  external_buyer_id, username, buyer_name_encrypted, recipient_name_encrypted,
  email_encrypted, recipient_phone_encrypted, city, state, postal_code_encrypted,
  total_orders, valid_orders, paid_orders, paid_revenue::text AS paid_revenue,
  refunded_amount::text AS refunded_amount, units::text AS units,
  first_purchase_at, last_purchase_at, last_order_at`;

/**
 * Produto mais comprado (pedidos válidos) SÓ dos compradores do lote — via
 * índice de `marketplace_buyer_id`, sem reagregar o escopo inteiro. Maior
 * soma de unidades por anúncio+SKU; desempate por `external_item_id` e SKU.
 */
export function topProductsQuery(
  filter: CustomersFilter,
  buyerIds: string[],
): { sql: string; params: unknown[] } {
  return {
    sql: `WITH per_product AS (
         SELECT o.marketplace_buyer_id AS buyer_id, i.external_item_id,
                COALESCE(i.seller_sku, '') AS sku_key, MAX(i.seller_sku) AS seller_sku,
                MAX(i.title) AS title, SUM(i.quantity)::bigint AS units
           FROM marketplace_orders o
           JOIN marketplace_accounts a ON a.id = o.marketplace_account_id
           JOIN marketplace_order_items i ON i.order_id = o.id
          WHERE o.marketplace_buyer_id = ANY($5::uuid[])
            AND o.status = ANY($6::varchar[])
            AND ${ORDER_SCOPE_SQL}
          GROUP BY o.marketplace_buyer_id, i.external_item_id, COALESCE(i.seller_sku, '')
       )
       SELECT DISTINCT ON (buyer_id) buyer_id, external_item_id, seller_sku, title,
              units::text AS units
         FROM per_product
        ORDER BY buyer_id, units DESC, external_item_id ASC, sku_key ASC`,
    params: [...scopeParams(filter), buyerIds, VALID_PURCHASE_STATUSES],
  };
}

/** `$1..$4` = marketplaces, conta, início e fim (exclusivo) do período. */
export const ORDER_SCOPE_SQL = `a.marketplace = ANY($1::varchar[])
  AND ($2::uuid IS NULL OR o.marketplace_account_id = $2::uuid)
  AND ($3::timestamptz IS NULL OR o.date_created >= $3::timestamptz)
  AND ($4::timestamptz IS NULL OR o.date_created < $4::timestamptz)`;

export function scopeParams(filter: CustomersFilter): unknown[] {
  return [
    marketplacesForFilter(filter),
    filter.accountId,
    filter.period?.from ?? null,
    filter.period?.to ?? null,
  ];
}

/** Todos os pedidos do escopo (com ou sem comprador) — base de cobertura. */
export const ACCOUNT_COVERAGE_SQL = `
  SELECT a.id AS account_id, a.marketplace, a.nickname AS account_nickname,
         COUNT(o.id)::int AS total_orders,
         COUNT(o.marketplace_buyer_id)::int AS orders_with_buyer
    FROM marketplace_accounts a
    LEFT JOIN marketplace_orders o
      ON o.marketplace_account_id = a.id
     AND ($3::timestamptz IS NULL OR o.date_created >= $3::timestamptz)
     AND ($4::timestamptz IS NULL OR o.date_created < $4::timestamptz)
   WHERE a.marketplace = ANY($1::varchar[])
     AND ($2::uuid IS NULL OR a.id = $2::uuid)
   GROUP BY a.id
   ORDER BY a.marketplace, a.nickname NULLS LAST, a.id`;
