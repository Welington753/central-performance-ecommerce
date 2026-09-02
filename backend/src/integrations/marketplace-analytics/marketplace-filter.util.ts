import { Marketplace } from '../contracts/marketplace.enum';

export const MARKETPLACE_FILTER_ALL = 'ALL' as const;

/**
 * `ALL` é só um valor de FILTRO desta camada de analytics — nunca é
 * adicionado ao enum persistido `Marketplace` (Checkpoint 3, "Endpoint
 * genérico": "ALL é apenas um valor de filtro; não deve ser adicionado ao
 * enum persistido Marketplace").
 */
export type MarketplaceFilter = typeof MARKETPLACE_FILTER_ALL | Marketplace;

export type MarketplaceAnalyticsErrorCode =
  'INVALID_MARKETPLACE' | 'INVALID_ACCOUNT_ID' | 'ACCOUNT_MARKETPLACE_CONFLICT';

/**
 * Vocabulário fechado de erro — a mensagem da exceção É o código; nunca
 * inclui a query string bruta recebida (Checkpoint 3: "nunca inclua query
 * string bruta na mensagem ou log").
 */
export class MarketplaceAnalyticsFilterError extends Error {
  constructor(public readonly code: MarketplaceAnalyticsErrorCode) {
    super(code);
  }
}

const VALID_MARKETPLACE_VALUES: ReadonlySet<string> = new Set([
  MARKETPLACE_FILTER_ALL,
  ...Object.values(Marketplace),
]);

/**
 * `marketplace` ausente ou vazio significa `ALL` (Checkpoint 3, "Endpoint
 * genérico").
 */
export function parseMarketplaceFilter(
  raw: string | undefined,
): MarketplaceFilter {
  if (raw === undefined || raw === '') return MARKETPLACE_FILTER_ALL;
  if (!VALID_MARKETPLACE_VALUES.has(raw)) {
    throw new MarketplaceAnalyticsFilterError('INVALID_MARKETPLACE');
  }
  return raw as MarketplaceFilter;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** `undefined` quando `raw` está ausente/vazio — `accountId` é opcional. */
export function parseAccountIdFilter(raw: string | undefined): string | null {
  if (raw === undefined || raw === '') return null;
  if (!UUID_PATTERN.test(raw)) {
    throw new MarketplaceAnalyticsFilterError('INVALID_ACCOUNT_ID');
  }
  return raw;
}

/**
 * Verifica conflito entre `accountId` e `marketplace` quando ambos foram
 * informados e a conta existe: `accountId` de uma conta Mercado Livre com
 * `marketplace=AMAZON`, por exemplo, é um conflito fechado — nunca
 * silenciosamente ignorado nem silenciosamente resolvido a favor de um dos
 * dois.
 */
export function assertNoAccountMarketplaceConflict(
  marketplaceFilter: MarketplaceFilter,
  accountMarketplace: Marketplace,
): void {
  if (
    marketplaceFilter !== MARKETPLACE_FILTER_ALL &&
    marketplaceFilter !== accountMarketplace
  ) {
    throw new MarketplaceAnalyticsFilterError('ACCOUNT_MARKETPLACE_CONFLICT');
  }
}
