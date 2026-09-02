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

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export class ApiFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiFetchError";
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
): Promise<MarketplaceAccountDto> {
  const response = await apiFetch("/marketplace-accounts", {
    method: "POST",
    body: JSON.stringify({ marketplace }),
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

export async function syncMercadoLivreOrders(
  accountId: string,
): Promise<MercadoLivreSyncSummary> {
  const response = await apiFetch(
    `/marketplace-accounts/${accountId}/mercado-livre/sync-orders`,
    { method: "POST" },
  );
  if (!response.ok) {
    throw new ApiFetchError("Não foi possível sincronizar agora. Tente novamente.");
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
