import {
  UnauthorizedAnalyticsApiError,
  fetchMarketplaceAnalyticsKpis,
} from "@/lib/api";
import type {
  LogisticsScopeFilter as LogisticsScopeValue,
  MarketplaceAnalyticsKpisDto,
  MarketplaceFilter,
} from "@/types/marketplace-analytics";

/**
 * Busca de um escopo de KPIs + tratamento de erro — isola o
 * try/catch/`UnauthorizedAnalyticsApiError` usado tanto pelo slot "sem
 * conta" quanto pelo slot "com conta" do hook de orquestração.
 */

export type ScopeFetchOutcome =
  | { data: MarketplaceAnalyticsKpisDto }
  | { authError: boolean };

export async function fetchScopeOutcome(input: {
  from: string | null;
  to: string | null;
  marketplace: MarketplaceFilter;
  accountId?: string;
  allTime: boolean;
  logisticsScope: LogisticsScopeValue;
}): Promise<ScopeFetchOutcome> {
  try {
    const data = await fetchMarketplaceAnalyticsKpis(
      input.allTime
        ? {
            marketplace: input.marketplace,
            ...(input.accountId ? { accountId: input.accountId } : {}),
            allTime: true,
            logisticsScope: input.logisticsScope,
          }
        : {
            from: input.from as string,
            to: input.to as string,
            marketplace: input.marketplace,
            ...(input.accountId ? { accountId: input.accountId } : {}),
            logisticsScope: input.logisticsScope,
          },
    );
    return { data };
  } catch (error) {
    return { authError: error instanceof UnauthorizedAnalyticsApiError };
  }
}
