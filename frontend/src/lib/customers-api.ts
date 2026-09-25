import { ApiFetchError, apiFetch } from "@/lib/api";
import type {
  BuyerEnrichmentStatusDto,
  CustomersFilters,
  CustomersSummaryDto,
} from "@/types/customers";

/** 403 dos endpoints de clientes — primeira versão exige administrador. */
export class CustomersForbiddenError extends ApiFetchError {}

const EXPORT_TIMEOUT_MS = 120_000;

export function customersFiltersToParams(
  filters: CustomersFilters,
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.allTime) {
    params.set("allTime", "true");
  } else {
    params.set("from", filters.from);
    params.set("to", filters.to);
  }
  if (filters.marketplace !== "ALL") params.set("marketplace", filters.marketplace);
  if (filters.accountId) params.set("accountId", filters.accountId);
  if (filters.customerType !== "ALL") params.set("customerType", filters.customerType);
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.product.trim()) params.set("product", filters.product.trim());
  if (filters.onlyWithEmail) params.set("onlyWithEmail", "true");
  if (filters.onlyWithRecipientPhone) params.set("onlyWithRecipientPhone", "true");
  return params;
}

async function ensureOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) return;
  if (response.status === 403) {
    throw new CustomersForbiddenError(
      "Acesso restrito a administradores.",
      "FORBIDDEN",
    );
  }
  if (response.status === 400) {
    throw new ApiFetchError("Filtro inválido. Revise os campos.", "INVALID_FILTER");
  }
  if (response.status === 409) {
    throw new ApiFetchError(
      "Completar histórico está em andamento nesta conta. Aguarde terminar para enriquecer os clientes.",
      "BACKFILL_JOB_MODE_CONFLICT",
    );
  }
  throw new ApiFetchError(fallback);
}

export async function fetchCustomersSummary(
  filters: CustomersFilters,
  page: number,
  pageSize: number,
): Promise<CustomersSummaryDto> {
  const params = customersFiltersToParams(filters);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  const response = await apiFetch(`/customers/summary?${params.toString()}`);
  await ensureOk(response, "Não foi possível carregar os clientes agora.");
  return (await response.json()) as CustomersSummaryDto;
}

function filenameFromDisposition(header: string | null): string {
  const match = header ? /filename="([^"]+)"/.exec(header) : null;
  return match ? match[1] : "clientes.xlsx";
}

/** Gerado sob demanda pelo backend e baixado direto — nunca uma URL pública. */
export async function downloadCustomersExport(
  filters: CustomersFilters,
  includePersonalData: boolean,
): Promise<{ blob: Blob; filename: string }> {
  const params = customersFiltersToParams(filters);
  params.set("includePersonalData", includePersonalData ? "true" : "false");
  const response = await apiFetch(
    `/customers/export.xlsx?${params.toString()}`,
    {},
    EXPORT_TIMEOUT_MS,
  );
  await ensureOk(response, "Não foi possível gerar o Excel agora.");
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response.headers.get("Content-Disposition")),
  };
}

export function saveBlobAsFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function fetchBuyerEnrichmentStatus(): Promise<BuyerEnrichmentStatusDto> {
  const response = await apiFetch("/customers/enrichment/status");
  await ensureOk(response, "Não foi possível carregar o enriquecimento histórico.");
  return (await response.json()) as BuyerEnrichmentStatusDto;
}

export async function startBuyerEnrichment(
  accountId?: string,
): Promise<BuyerEnrichmentStatusDto> {
  const response = await apiFetch("/customers/enrichment/start", {
    method: "POST",
    body: JSON.stringify(accountId ? { accountId } : {}),
  });
  await ensureOk(response, "Não foi possível iniciar o enriquecimento histórico.");
  return (await response.json()) as BuyerEnrichmentStatusDto;
}

export async function changeBuyerEnrichment(
  accountId: string,
  action: "pause" | "resume",
): Promise<BuyerEnrichmentStatusDto> {
  const response = await apiFetch(
    `/customers/enrichment/${accountId}/${action}`,
    { method: "POST" },
  );
  await ensureOk(response, "Não foi possível atualizar o enriquecimento histórico.");
  return (await response.json()) as BuyerEnrichmentStatusDto;
}
