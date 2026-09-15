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
  LogisticsScopeFilter,
  MarketplaceAnalyticsKpisDto,
  MarketplaceFilter,
} from "@/types/marketplace-analytics";
import type {
  AmazonSetupStatusDto,
  AmazonVerifyConnectionDto,
} from "@/types/amazon-connection";
import type {
  BackfillChunkResultDto,
  BackfillStatusDto,
} from "@/types/marketplace-backfill";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export class ApiFetchError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    /** Presente apenas em 429 — segundos a aguardar antes de tentar de novo. */
    public readonly retryAfterSeconds?: number,
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

const RENAME_ERROR_MESSAGES: Record<string, string> = {
  INVALID_NICKNAME:
    "Nome inválido. Use até 60 caracteres (letras, números, espaços, hífen e pontuação simples).",
  NICKNAME_ALREADY_IN_USE: "Já existe uma conta com esse nome neste marketplace.",
};

export async function renameMarketplaceAccount(
  accountId: string,
  nickname: string | null,
): Promise<MarketplaceAccountDto> {
  const response = await apiFetch(`/marketplace-accounts/${accountId}/nickname`, {
    method: "PATCH",
    body: JSON.stringify({ nickname }),
  });
  if (!response.ok) {
    const code = await parseSanitizedErrorCode(response);
    throw new ApiFetchError(
      (code && RENAME_ERROR_MESSAGES[code]) ||
        "Não foi possível renomear a conta. Tente novamente.",
      code,
    );
  }
  return (await response.json()) as MarketplaceAccountDto;
}

export interface RecoverConnectionResult {
  outcome:
    | "RECOVERED"
    | "PENDING_RETRY"
    | "RECONNECT_REQUIRED"
    | "CONFIGURATION_ERROR";
}

export async function recoverMercadoLivreConnection(
  accountId: string,
): Promise<RecoverConnectionResult> {
  const response = await apiFetch(
    `/marketplace-accounts/${accountId}/mercado-livre/recover`,
    { method: "POST" },
  );
  if (!response.ok) {
    const code = await parseSanitizedErrorCode(response);
    throw new ApiFetchError(
      "Não foi possível verificar a conexão agora. Tente novamente.",
      code,
    );
  }
  return (await response.json()) as RecoverConnectionResult;
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

export async function connectShopee(
  accountId: string,
): Promise<{ authorizationUrl: string }> {
  const response = await apiFetch(
    `/marketplace-accounts/${accountId}/shopee/connect`,
    { method: "POST" },
  );
  if (!response.ok) {
    throw new ApiFetchError(
      "Não foi possível iniciar a conexão com a Shopee.",
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

/** 401/403 no endpoint de KPIs — sessão expirada ou sem permissão para o escopo pedido. */
export class UnauthorizedAnalyticsApiError extends ApiFetchError {}

export interface MarketplaceAnalyticsQuery {
  // Ausentes quando `allTime` é true — o backend ignora `from`/`to` nesse
  // modo (Fase 4, "Todo o período").
  from?: string;
  to?: string;
  marketplace?: MarketplaceFilter;
  accountId?: string;
  allTime?: boolean;
  /** Ausente/`ALL` preserva compatibilidade — ver `LogisticsScopeFilter`. */
  logisticsScope?: LogisticsScopeFilter;
}

export async function fetchMarketplaceAnalyticsKpis(
  query: MarketplaceAnalyticsQuery,
): Promise<MarketplaceAnalyticsKpisDto> {
  const params = new URLSearchParams();
  if (query.allTime) {
    params.set("allTime", "true");
  } else {
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
  }
  if (query.marketplace && query.marketplace !== "ALL") {
    params.set("marketplace", query.marketplace);
  }
  if (query.accountId) params.set("accountId", query.accountId);
  if (query.logisticsScope && query.logisticsScope !== "ALL") {
    params.set("logisticsScope", query.logisticsScope);
  }

  const response = await apiFetch(`/marketplace-analytics/kpis?${params.toString()}`);
  if (response.status === 401 || response.status === 403) {
    throw new UnauthorizedAnalyticsApiError(
      "Sessão expirada ou sem permissão para este escopo. Entre novamente.",
    );
  }
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

export interface ShopeeSyncSummary {
  syncRunId: string;
  status: "SUCCESS" | "INCOMPLETE";
  periodFrom: string;
  periodTo: string;
  pagesFetched: number;
  ordersFetched: number;
  ordersCreated: number;
  ordersUpdated: number;
  itemsPersisted: number;
}

export async function syncShopeeOrders(
  accountId: string,
): Promise<ShopeeSyncSummary> {
  const response = await apiFetch(
    `/marketplace-accounts/${accountId}/shopee/sync-orders`,
    { method: "POST" },
  );
  if (!response.ok) {
    const code = await parseSanitizedErrorCode(response);
    throw new ApiFetchError(
      "Não foi possível sincronizar agora. Tente novamente.",
      code,
    );
  }
  return (await response.json()) as ShopeeSyncSummary;
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

export const BACKFILL_ERROR_MESSAGES: Record<string, string> = {
  ACCOUNT_NOT_CONNECTED:
    "Esta conta não está mais conectada. Reconecte-a em Integrações.",
  MARKETPLACE_NOT_SUPPORTED:
    "Este marketplace ainda não tem histórico completo disponível.",
  NO_INITIAL_SYNC_YET:
    "Sincronize esta conta pelo menos uma vez antes de completar o histórico.",
  BACKFILL_ALREADY_RUNNING: "Conta temporariamente ocupada.",
  AMAZON_NOT_CONFIGURED: "Integração Amazon não configurada no servidor.",
  SYNC_FAILED: "Falha ao consultar o marketplace. Tente novamente.",
  TOKEN_EXPIRED:
    "O marketplace encerrou o acesso desta conta. Reconecte-a em Integrações.",
  ACCOUNT_BUSY:
    "Esta conta está processando outra operação agora. Tente novamente em instantes.",
  TOKEN_REFRESH_PENDING:
    "Renovação de acesso temporariamente indisponível. Nova tentativa automática agendada.",
  ML_APP_CONFIGURATION_ERROR:
    "Credenciais da aplicação estão inválidas. Contate o suporte.",
  PROVIDER_RATE_LIMITED:
    "O marketplace limitou as requisições no momento. Tente novamente em alguns minutos.",
};

/**
 * Normaliza a resposta de status do backfill (Fase 4, correção de
 * regressão) — nunca deixa `synchronizedIntervals`/campos opcionais
 * ausentes/`undefined` chegarem ao componente. Existe para tolerar uma
 * resposta de um backend ainda não reiniciado com o contrato antigo
 * (`{ oldestCoveredAt, historyComplete }`, sem os campos novos) durante um
 * deploy — nunca para mascarar um bug real de contrato; o servidor atual
 * SEMPRE devolve o formato completo (`getAccountSyncCoverage` nunca retorna
 * `intervals` ausente).
 */
function normalizeBackfillStatus(raw: unknown): BackfillStatusDto {
  const value = (raw && typeof raw === "object" ? raw : {}) as Partial<
    Record<keyof BackfillStatusDto, unknown>
  >;
  const oldestCoveredAt =
    typeof value.oldestCoveredAt === "string" ? value.oldestCoveredAt : null;
  return {
    status:
      typeof value.status === "string"
        ? (value.status as BackfillStatusDto["status"])
        : oldestCoveredAt
          ? "IN_PROGRESS"
          : "NOT_STARTED",
    oldestCoveredAt,
    firstOrderAt:
      typeof value.firstOrderAt === "string" ? value.firstOrderAt : null,
    lastOrderAt:
      typeof value.lastOrderAt === "string" ? value.lastOrderAt : null,
    synchronizedIntervals: Array.isArray(value.synchronizedIntervals)
      ? (value.synchronizedIntervals as BackfillStatusDto["synchronizedIntervals"])
      : [],
    lastProcessedChunk:
      value.lastProcessedChunk &&
      typeof value.lastProcessedChunk === "object"
        ? (value.lastProcessedChunk as BackfillStatusDto["lastProcessedChunk"])
        : null,
    lastRunErrorCode:
      typeof value.lastRunErrorCode === "string"
        ? value.lastRunErrorCode
        : null,
    job:
      value.job && typeof value.job === "object"
        ? (value.job as BackfillStatusDto["job"])
        : null,
    // Padrão seguro (`false`) contra um backend ainda não reiniciado sem
    // este campo — nunca afirma "processando em segundo plano" por engano.
    workerEnabled: value.workerEnabled === true,
  };
}

export async function fetchBackfillStatus(
  accountId: string,
): Promise<BackfillStatusDto> {
  const response = await apiFetch(
    `/marketplace-accounts/${accountId}/backfill/status`,
  );
  if (!response.ok) {
    throw new ApiFetchError(
      "Não foi possível carregar o status do histórico.",
    );
  }
  return normalizeBackfillStatus(await response.json());
}

async function postBackfillJobAction(
  accountId: string,
  action: "start" | "pause" | "resume",
): Promise<BackfillStatusDto> {
  const response = await apiFetch(
    `/marketplace-accounts/${accountId}/backfill/${action}`,
    { method: "POST" },
  );
  if (!response.ok) {
    const code = await parseSanitizedErrorCode(response);
    throw new ApiFetchError(
      (code && BACKFILL_ERROR_MESSAGES[code]) ||
        "Não foi possível iniciar o histórico.",
      code,
    );
  }
  return normalizeBackfillStatus(await response.json());
}

/**
 * Cria (ou, idempotentemente, devolve) o job durável de backfill desta
 * conta (Fase 4, "Backfill durável") — o worker do BACKEND processa dali em
 * diante, mesmo com a aba fechada. Chamar de novo com um job já ativo NUNCA
 * cria um segundo job — o backend garante isso via índice único.
 */
export async function startBackfill(
  accountId: string,
): Promise<BackfillStatusDto> {
  return postBackfillJobAction(accountId, "start");
}

export async function pauseBackfill(
  accountId: string,
): Promise<BackfillStatusDto> {
  return postBackfillJobAction(accountId, "pause");
}

export async function resumeBackfill(
  accountId: string,
): Promise<BackfillStatusDto> {
  return postBackfillJobAction(accountId, "resume");
}

/**
 * Executa UM chunk do backfill histórico (Fase 4, "Completar histórico") —
 * o chamador decide quando parar de repetir com base em `hasMoreHistory`
 * (ver `MarketplaceBackfillService.runNextChunk` no backend).
 */
export async function runBackfillNextChunk(
  accountId: string,
): Promise<BackfillChunkResultDto> {
  let response: Response;
  try {
    response = await apiFetch(
      `/marketplace-accounts/${accountId}/backfill/next-chunk`,
      { method: "POST" },
    );
  } catch {
    throw new ApiFetchError(
      "Falha de conexão. O histórico poderá ser retomado.",
    );
  }

  if (response.status === 401) {
    throw new ApiFetchError("Sessão expirada. Entre novamente.", "UNAUTHENTICATED");
  }
  if (response.status === 429) {
    const retryAfterHeader = response.headers.get("Retry-After");
    const retryAfterSeconds = retryAfterHeader
      ? Number(retryAfterHeader)
      : undefined;
    throw new ApiFetchError(
      "Limite de chamadas atingido. Nova tentativa em breve.",
      "RATE_LIMITED",
      Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 60,
    );
  }
  if (!response.ok) {
    const code = await parseSanitizedErrorCode(response);
    throw new ApiFetchError(
      (code && BACKFILL_ERROR_MESSAGES[code]) ||
        "Não foi possível iniciar o histórico.",
      code,
    );
  }
  return (await response.json()) as BackfillChunkResultDto;
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
