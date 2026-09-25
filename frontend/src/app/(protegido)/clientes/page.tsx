"use client";

import { useEffect, useState } from "react";
import { BuyerEnrichmentPanel } from "@/components/customers/BuyerEnrichmentPanel";
import { CustomerFiltersBar } from "@/components/customers/CustomerFiltersBar";
import { CustomerSummaryCards } from "@/components/customers/CustomerSummaryCards";
import { CustomersTable } from "@/components/customers/CustomersTable";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { fetchMarketplaceAccounts } from "@/lib/api";
import {
  CustomersForbiddenError,
  downloadCustomersExport,
  fetchCustomersSummary,
  saveBlobAsFile,
} from "@/lib/customers-api";
import { dateOnlyToString, todaySaoPaulo, addDays } from "@/lib/date-range";
import type { MarketplaceAccountDto } from "@/types/marketplace";
import type { CustomersFilters, CustomersSummaryDto } from "@/types/customers";

const PAGE_SIZE = 25;

function initialFilters(): CustomersFilters {
  const today = todaySaoPaulo();
  return {
    marketplace: "ALL",
    accountId: "",
    allTime: true,
    from: dateOnlyToString(addDays(today, -29)),
    to: dateOnlyToString(today),
    customerType: "ALL",
    search: "",
    product: "",
    onlyWithEmail: false,
    onlyWithRecipientPhone: false,
  };
}

const header = (
  <div>
    <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
    <p className="mt-1 text-sm text-foreground/60">
      Compradores das nossas vendas no Mercado Livre e na Shopee, sempre separados por conta.
    </p>
  </div>
);

function Notice({ tone, children }: { tone: "error" | "info"; children: React.ReactNode }) {
  const classes =
    tone === "error"
      ? "border-red-500/40 bg-red-500/10 text-red-700"
      : "border-border-subtle bg-surface text-foreground/60";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-md border px-4 py-3 text-sm ${classes}`}>
      {children}
    </div>
  );
}

function CustomersContent() {
  const [filters, setFilters] = useState<CustomersFilters>(initialFilters);
  const [page, setPage] = useState(1);
  const [accounts, setAccounts] = useState<MarketplaceAccountDto[]>([]);
  const [data, setData] = useState<CustomersSummaryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [includePersonalData, setIncludePersonalData] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    fetchMarketplaceAccounts()
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, []);

  useEffect(() => {
    let active = true;
    fetchCustomersSummary(filters, page, PAGE_SIZE)
      .then((next) => {
        if (!active) return;
        setData(next);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof CustomersForbiddenError) setForbidden(true);
        setError(caught instanceof Error ? caught.message : "Falha ao carregar clientes.");
      });
    return () => {
      active = false;
    };
  }, [filters, page]);

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const { blob, filename } = await downloadCustomersExport(filters, includePersonalData);
      saveBlobAsFile(blob, filename);
    } catch (caught) {
      setExportError(caught instanceof Error ? caught.message : "Falha ao gerar o Excel.");
    } finally {
      setExporting(false);
    }
  }

  if (forbidden) {
    return <Notice tone="error">Acesso restrito a administradores.</Notice>;
  }

  return (
    <>
      <CustomerFiltersBar
        value={filters}
        accounts={accounts}
        onApply={(next) => {
          setPage(1);
          setFilters(next);
        }}
      />

      <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={includePersonalData}
            onChange={(e) => setIncludePersonalData(e.target.checked)}
          />
          Incluir dados pessoais completos no Excel
        </label>
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={exporting}
          className="rounded-md border border-brand bg-brand px-3 py-1.5 font-medium text-white disabled:opacity-50"
        >
          {exporting ? "Gerando Excel..." : "Baixar Excel"}
        </button>
      </div>
      {exportError ? <Notice tone="error">{exportError}</Notice> : null}

      {error ? <Notice tone="error">{error}</Notice> : null}
      {!data && !error ? <Notice tone="info">Carregando clientes...</Notice> : null}
      {data ? (
        <>
          <CustomerSummaryCards cards={data.cards} />
          <CustomersTable
            customers={data.customers}
            page={data.page}
            totalPages={data.totalPages}
            totalCustomers={data.totalCustomers}
            onPageChange={setPage}
          />
        </>
      ) : null}

      <BuyerEnrichmentPanel />
    </>
  );
}

export default function ClientesPage() {
  const { user, isLoading } = useCurrentUser();

  return (
    <div className="flex flex-col gap-6">
      {header}
      {isLoading ? (
        <Notice tone="info">Carregando...</Notice>
      ) : user?.isAdmin ? (
        <CustomersContent />
      ) : (
        <Notice tone="error">Acesso restrito a administradores.</Notice>
      )}
    </div>
  );
}
