import type { MercadoLivreClaimsHttpClient } from '../mercado-livre-claims/mercado-livre-claims-http.client';
import { toSearchPageOutcome } from './mercado-livre-claim-enrichment.util';
import type { FetchWindowPage } from './mercado-livre-claims-window.util';

/** Status de TODA sub-janela de criação (sem `status` = 400 em produção); `opened` primeiro: claim que fecha entre as buscas reaparece em `closed`. */
export const CREATION_WINDOW_STATUSES = ['opened', 'closed'] as const;

/**
 * Uma busca por status (`opened` e `closed`) para cada sub-janela — usada
 * tanto pela sincronização incremental quanto pelo backfill histórico, para
 * que as duas consultem SEMPRE os dois status em todas as janelas.
 */
export function buildCreationWindowFetchers(
  httpClient: MercadoLivreClaimsHttpClient,
  accessToken: string,
  externalSellerId: string,
): FetchWindowPage[] {
  return CREATION_WINDOW_STATUSES.map(
    (status): FetchWindowPage =>
      async (range, offset, limit) =>
        toSearchPageOutcome(
          await httpClient.searchClaims({
            accessToken,
            sellerUserId: externalSellerId,
            status,
            dateRange: { after: range.from, before: range.to },
            offset,
            limit,
            operation: `search_creation_${status}`,
          }),
        ),
  );
}
