import { Marketplace } from '../contracts/marketplace.enum';
import {
  LOGISTICS_MARKETPLACE_FULFILLED,
  LOGISTICS_SELLER_FULFILLED,
} from '../marketplace-orders/logistics-classification';
import {
  MarketplaceAnalyticsFilterError,
  type MarketplaceFilter,
} from './marketplace-filter.util';

export const LOGISTICS_SCOPE_ALL = 'ALL' as const;
export const LOGISTICS_SCOPE_FULL = 'FULL' as const;
export const LOGISTICS_SCOPE_NON_FULL = 'NON_FULL' as const;

export type LogisticsScopeFilter =
  | typeof LOGISTICS_SCOPE_ALL
  | typeof LOGISTICS_SCOPE_FULL
  | typeof LOGISTICS_SCOPE_NON_FULL;

const VALID_LOGISTICS_SCOPE_VALUES: ReadonlySet<string> = new Set([
  LOGISTICS_SCOPE_ALL,
  LOGISTICS_SCOPE_FULL,
  LOGISTICS_SCOPE_NON_FULL,
]);

/** `logisticsScope` ausente/vazio significa `ALL` — compatível com o comportamento antes deste filtro existir. */
export function parseLogisticsScopeFilter(
  raw: string | undefined,
): LogisticsScopeFilter {
  if (raw === undefined || raw === '') return LOGISTICS_SCOPE_ALL;
  if (!VALID_LOGISTICS_SCOPE_VALUES.has(raw)) {
    throw new MarketplaceAnalyticsFilterError('INVALID_LOGISTICS_SCOPE');
  }
  return raw as LogisticsScopeFilter;
}

/**
 * `FULL`/`NON_FULL` só existem para o Mercado Livre — nunca aceitos com
 * `marketplace=ALL`/`AMAZON`/`SHOPEE` (o frontend já restaura o filtro para
 * `ALL` ao trocar de marketplace; esta é a validação de defesa em
 * profundidade no backend).
 */
export function assertLogisticsScopeRequiresMercadoLivre(
  logisticsScope: LogisticsScopeFilter,
  marketplaceFilter: MarketplaceFilter,
): void {
  if (
    logisticsScope !== LOGISTICS_SCOPE_ALL &&
    marketplaceFilter !== Marketplace.MERCADO_LIVRE
  ) {
    throw new MarketplaceAnalyticsFilterError('INVALID_LOGISTICS_SCOPE');
  }
}

/**
 * Traduz o filtro visual para os valores CANÔNICOS de
 * `logistics_classification` aceitos em `= ANY(...)`. `null` significa "sem
 * filtro" (`ALL`) — nunca usado como allowlist vazia.
 */
export function classificationValuesForScope(
  scope: LogisticsScopeFilter,
): string[] | null {
  if (scope === LOGISTICS_SCOPE_FULL) return [LOGISTICS_MARKETPLACE_FULFILLED];
  if (scope === LOGISTICS_SCOPE_NON_FULL) return [LOGISTICS_SELLER_FULFILLED];
  return null;
}
