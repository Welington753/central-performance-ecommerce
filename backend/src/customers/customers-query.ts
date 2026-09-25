import { Marketplace } from '../integrations/contracts/marketplace.enum';
import {
  InvalidKpiPeriodError,
  resolveKpiPeriod,
} from '../integrations/marketplace-orders/period.util';

export type CustomerMarketplaceFilter = 'ALL' | 'MERCADO_LIVRE' | 'SHOPEE';
export type CustomerTypeFilter = 'ALL' | 'NEW' | 'RECURRING';

export const CUSTOMER_MARKETPLACES: readonly Marketplace[] = [
  Marketplace.MERCADO_LIVRE,
  Marketplace.SHOPEE,
];

export interface CustomersPeriod {
  from: Date;
  /** Exclusivo (dia seguinte a `toLabel`, meia-noite de São Paulo). */
  to: Date;
  fromLabel: string;
  toLabel: string;
}

export interface CustomersFilter {
  marketplace: CustomerMarketplaceFilter;
  accountId: string | null;
  /** `null` = todo o período. */
  period: CustomersPeriod | null;
  customerType: CustomerTypeFilter;
  /** Casa SÓ id externo e username — nomes são criptografados e nunca pesquisados. */
  search: string | null;
  product: string | null;
  onlyWithEmail: boolean;
  onlyWithRecipientPhone: boolean;
}

export interface CustomersPagination {
  page: number;
  pageSize: number;
}

export type CustomersQueryErrorCode =
  | 'INVALID_MARKETPLACE'
  | 'INVALID_ACCOUNT_ID'
  | 'INVALID_CUSTOMER_TYPE'
  | 'INVALID_PAGINATION'
  | 'INVALID_FILTER_TEXT'
  | 'INVALID_BOOLEAN'
  | 'INVALID_PERIOD';

export class CustomersQueryError extends Error {
  constructor(public readonly code: CustomersQueryErrorCode) {
    super(code);
  }
}

export type RawCustomersQuery = Partial<Record<string, string | undefined>>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_FILTER_TEXT_LENGTH = 120;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;
// Sem teto prático (mesma convenção do "todo o período" das análises).
const NO_PRACTICAL_RANGE_CAP_DAYS = 36500;

function parseBoolean(value: string | undefined): boolean {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  throw new CustomersQueryError('INVALID_BOOLEAN');
}

function parseText(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_FILTER_TEXT_LENGTH) {
    throw new CustomersQueryError('INVALID_FILTER_TEXT');
  }
  return trimmed;
}

function parsePeriod(
  query: RawCustomersQuery,
  now: Date,
): CustomersPeriod | null {
  const hasRange = Boolean(query.from) || Boolean(query.to);
  if (query.allTime === 'true' || !hasRange) return null;
  try {
    const { current } = resolveKpiPeriod(
      { from: query.from, to: query.to },
      now,
      NO_PRACTICAL_RANGE_CAP_DAYS,
    );
    return {
      from: current.from,
      to: current.to,
      fromLabel: query.from as string,
      toLabel: query.to as string,
    };
  } catch (error) {
    if (error instanceof InvalidKpiPeriodError) {
      throw new CustomersQueryError('INVALID_PERIOD');
    }
    throw error;
  }
}

/** Padrão: "Todo o período" (sem `from`/`to`, ou `allTime=true`). */
export function parseCustomersFilter(
  query: RawCustomersQuery,
  now: Date,
): CustomersFilter {
  const marketplace = query.marketplace ?? 'ALL';
  if (!['ALL', 'MERCADO_LIVRE', 'SHOPEE'].includes(marketplace)) {
    throw new CustomersQueryError('INVALID_MARKETPLACE');
  }
  const accountId = query.accountId || null;
  if (accountId !== null && !UUID_PATTERN.test(accountId)) {
    throw new CustomersQueryError('INVALID_ACCOUNT_ID');
  }
  const customerType = query.customerType ?? 'ALL';
  if (!['ALL', 'NEW', 'RECURRING'].includes(customerType)) {
    throw new CustomersQueryError('INVALID_CUSTOMER_TYPE');
  }
  return {
    marketplace: marketplace as CustomerMarketplaceFilter,
    accountId,
    period: parsePeriod(query, now),
    customerType: customerType as CustomerTypeFilter,
    search: parseText(query.search),
    product: parseText(query.product),
    onlyWithEmail: parseBoolean(query.onlyWithEmail),
    onlyWithRecipientPhone: parseBoolean(query.onlyWithRecipientPhone),
  };
}

export function parseCustomersPagination(
  query: RawCustomersQuery,
): CustomersPagination {
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize =
    query.pageSize === undefined ? DEFAULT_PAGE_SIZE : Number(query.pageSize);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAX_PAGE_SIZE
  ) {
    throw new CustomersQueryError('INVALID_PAGINATION');
  }
  return { page, pageSize };
}

export function marketplacesForFilter(
  filter: Pick<CustomersFilter, 'marketplace'>,
): Marketplace[] {
  return filter.marketplace === 'ALL'
    ? [...CUSTOMER_MARKETPLACES]
    : [filter.marketplace as Marketplace];
}

export function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
