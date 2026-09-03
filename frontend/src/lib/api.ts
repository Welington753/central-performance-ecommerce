/**
 * Cliente HTTP central para chamadas ao backend.
 *
 * - Sempre envia `credentials: 'include'` para que os cookies HttpOnly de
 *   sessão emitidos pelo backend (login/refresh) sejam enviados/recebidos
 *   corretamente pelo navegador.
 * - Usa `NEXT_PUBLIC_API_URL` como base da API. Nenhum segredo é lido ou
 *   embutido aqui — apenas a URL pública do backend.
 */

import type { MarketplaceAccountDto } from "@/types/marketplace";
import type {
  MercadoLivreKpisDto,
  MercadoLivreSyncSummary,
} from "@/types/mercado-livre-kpis";
import type {
  MarketplaceAnalyticsKpisDto,
  MarketplaceFilter,
} from "@/types/marketplace-analytics";
import type {
  AmazonSetupStatusDto,
  AmazonVerifyConnectionDto,
} from "@/types/amazon-connection";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export class ApiFetchError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiFetchError";
  }
}

/**
 * Extrai o código de erro sanitizado do corpo de uma resposta de erro do
 * backend (`{ message: CODE, ... }`, ver `HttpException`/vocabulário
 * fechado nos serviços) — nunca lança, nunca repassa nada além dessa única
 * string já validada, nunca o corpo bruto.
 */
async function parseSanitizedErrorCode(
  response: Response,
): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { message?: unknown };
    return typeof body.message === "string" ? body.message : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Executa um fetch contra o backend, já configurado com a base URL e
 * `credentials: 'include'`. Não lança em respostas HTTP de erro (4xx/5xx) —
 * quem chamar deve checar `response.ok`. Lança apenas em falhas de rede
 * (backend indisponível, DNS, CORS bloqueado, etc.), para que o chamador
 * trate esse caso separadamente sem expor detalhes internos na UI.
 */
export async function apiFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${API_BASE_URL}${path}`;

  try {
    return await fetch(url, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });
  } catch {
    throw new ApiFetchError(
      "Não foi possível se comunicar com o servidor. Tente novamente mais tarde.",
    );
  }
}

export async function fetchMarketplaceAccounts(): Promise<
  MarketplaceAccountDto[]
> {
  const response = await apiFetch("/marketplace-accounts");
  if (!response.ok) {
    throw new ApiFetchError(
      "Não foi possível carregar as contas de marketplace.",
    );
  }
  return (await response.json()) as MarketplaceAccountDto[];
}

export async function createMarketplaceAccount(
  marketplace: MarketplaceAccountDto["marketplace"],
  nickname?: string,
): Promise<MarketplaceAccountDto> {
  const response = await apiFetch("/marketplace-accounts", {
    method: "POST",
    body: JSON.stringify(
      nickname ? { marketplace, nickname } : { marketplace },
    ),
  });
  if (!response.ok) {
    throw new ApiFetchError("Não foi possível criar a conta de marketplace.");
  }
  return (await response.json()) as MarketplaceAccountDto;
}

export async function connectMercadoLivre(
  accountId: string,
): Promise<{ authorizationUrl: string }> {
  const response = await apiFetch(
    `/marketplace-accounts/${accountId}/mercado-livre/connect`,
    { method: "POST" },
  );
  if (!response.ok) {
    throw new ApiFetchError(
      "Não foi possível iniciar a conexão com o Mercado Livre.",
    );
  }
  return (await response.json()) as { authorizationUrl: string };
}

export class InvalidKpiPeriodApiError extends ApiFetchError {}

export async function fetchMercadoLivreKpis(
  accountId: string,
  period?: { from: string; to: string },
): Promise<MercadoLivreKpisDto> {
  const query = period
    ? `?from=${encodeURIComponent(period.from)}&to=${encodeURIComponent(period.to)}`
    : "";
  const response = await apiFetch(
    `/marketplace-accounts/${accountId}/mercado-livre/kpis${query}`,
  );
  if (response.status === 400) {
    throw new InvalidKpiPeriodApiError("Período inválido.");
  }
  if (!response.ok) {
    throw new ApiFetchError("Não foi possível carregar os KPIs agora.");
  }
  return (await response.json()) as MercadoLivreKpisDto;
}

export class InvalidAnalyticsFilterApiError extends ApiFetchError {}

export interface MarketplaceAnalyticsQuery {
  from: string;
  to: string;
  marketplace?: MarketplaceFilter;
  accountId?: string;
}

export async function fetchMarketplaceAnalyticsKpis(
  query: MarketplaceAnalyticsQuery,
): Promise<MarketplaceAnalyticsKpisDto> {
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.marketplace && query.marketplace !== "ALL") {
    params.set("marketplace", query.marketplace);
  }
  if (query.accountId) params.set("accountId", query.accountId);

  const response = await apiFetch(`/marketplace-analytics/kpis?${params.toString()}`);
  if (response.status === 400) {
    throw new InvalidAnalyticsFilterApiError("Filtro inválido.");
  }
  if (!response.ok) {
    throw new ApiFetchError("Não foi possível carregar os KPIs agora.");
  }
  return (await response.json()) as MarketplaceAnalyticsKpisDto;
}

export async function fetchAmazonSetupStatus(): Promise<AmazonSetupStatusDto> {
  const response = await apiFetch("/integrations/amazon/setup-status");
  if (!response.ok) {
    throw new ApiFetchError(
      "Não foi possível carregar o status da configuração Amazon.",
    );
  }
  return (await response.json()) as AmazonSetupStatusDto;
}

/**
 * Envia o Selling Partner ID e o refresh token para o backend, que os
 * criptografa imediatamente (Checkpoint 4-C). Nunca inclui o LWA Client
 * Secret — essa credencial de aplicação nunca sai do `.env` do backend.
 */
export async function provisionAmazonAccount(
  accountId: string,
  credentials: { sellingPartnerId: string; refreshToken: string },
): Promise<MarketplaceAccountDto> {
  const response = await apiFetch(
    `/marketplace-accounts/${accountId}/amazon/provision`,
    { method: "POST", body: JSON.stringify(credentials) },
  );
  if (!response.ok) {
    throw new ApiFetchError(
      "Não foi possível salvar as credenciais da conta Amazon.",
    );
  }
  return (await response.json()) as MarketplaceAccountDto;
}

export async function verifyAmazonConnection(
  accountId: string,
): Promise<AmazonVerifyConnectionDto> {
  const response = await apiFetch(
    `/marketplace-accounts/${accountId}/amazon/verify`,
    { method: "POST" },
  );
  if (!response.ok) {
    throw new ApiFetchError(
      "Não foi possível testar a conexão com a Amazon agora.",
    );
  }
  return (await response.json()) as AmazonVerifyConnectionDto;
}

export interface AmazonSyncSummary {
  syncRunId: string;
  status: "SUCCESS";
  dateFrom: string;
  dateTo: string;
  pagesFetched: number;
  ordersFetched: number;
  ordersUpserted: number;
  itemsUpserted: number;
}

export async function syncAmazonOrders(
  accountId: string,
): Promise<AmazonSyncSummary> {
  const response = await apiFetch(
    `/marketplace-accounts/${accountId}/amazon/orders/sync`,
    { method: "POST" },
  );
  if (!response.ok) {
    throw new ApiFetchError(
      "Não foi possível sincronizar agora. Tente novamente.",
    );
  }
  return (await response.json()) as AmazonSyncSummary;
}

export async function syncMercadoLivreOrders(
  accountId: string,
): Promise<MercadoLivreSyncSummary> {
  const response = await apiFetch(
    `/marketplace-accounts/${accountId}/mercado-livre/sync-orders`,
    { method: "POST" },
  );
  if (!response.ok) {
    const code = await parseSanitizedErrorCode(response);
    throw new ApiFetchError(
      "Não foi possível sincronizar agora. Tente novamente.",
      code,
    );
  }
  return (await response.json()) as MercadoLivreSyncSummary;
}

/**
 * Redireciona o navegador para `url`. Extraído como função nomeada (em vez
 * de `window.location.href = url` inline na página) — divergência mínima
 * do plano: o jsdom instalado (26.x) tornou `window.location`/`.href`
 * propriedades genuinamente não configuráveis (correto — casa com o
 * comportamento real de navegadores segundo o WHATWG), então
 * `Object.defineProperty`/`delete` sobre `window.location` não funcionam
 * mais para simular navegação em teste (`Cannot redefine property:
 * location`). Espiar esta função nomeada contorna a limitação do ambiente
 * de teste sem mudar o comportamento real: em qualquer navegador de
 * verdade, ela continua fazendo exatamente `window.location.href = url`.
 */
export function redirectTo(url: string): void {
  window.location.href = url;
}
