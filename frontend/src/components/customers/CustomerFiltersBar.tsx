"use client";

import { useState, type FormEvent } from "react";
import { validateDateRangeStrings, DATE_RANGE_ERROR_MESSAGES } from "@/lib/date-range";
import type { MarketplaceAccountDto } from "@/types/marketplace";
import type { CustomersFilters } from "@/types/customers";

const MARKETPLACE_LABEL: Record<string, string> = {
  MERCADO_LIVRE: "Mercado Livre",
  SHOPEE: "Shopee",
};

export function accountLabel(account: Pick<MarketplaceAccountDto, "nickname" | "marketplace" | "id">): string {
  return account.nickname ?? `${MARKETPLACE_LABEL[account.marketplace]} ${account.id.slice(0, 8)}`;
}

interface CustomerFiltersBarProps {
  value: CustomersFilters;
  accounts: MarketplaceAccountDto[];
  onApply: (filters: CustomersFilters) => void;
}

const inputClass =
  "rounded-md border border-border-subtle bg-background px-2 py-1.5 text-sm";

export function CustomerFiltersBar({ value, accounts, onApply }: CustomerFiltersBarProps) {
  const [draft, setDraft] = useState<CustomersFilters>(value);
  const [error, setError] = useState<string | null>(null);

  const visibleAccounts = accounts.filter(
    (account) =>
      account.marketplace !== "AMAZON" &&
      (draft.marketplace === "ALL" || account.marketplace === draft.marketplace),
  );

  function update<K extends keyof CustomersFilters>(key: K, next: CustomersFilters[K]) {
    setDraft((current) => ({ ...current, [key]: next }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.allTime) {
      const result = validateDateRangeStrings(draft.from, draft.to);
      if (!result.valid) {
        setError(DATE_RANGE_ERROR_MESSAGES[result.error]);
        return;
      }
    }
    setError(null);
    onApply(draft);
  }

  return (
    <form
      onSubmit={submit}
      aria-label="Filtros de clientes"
      className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface px-5 py-4"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          Marketplace
          <select
            className={inputClass}
            value={draft.marketplace}
            onChange={(e) => {
              update("marketplace", e.target.value as CustomersFilters["marketplace"]);
              update("accountId", "");
            }}
          >
            <option value="ALL">Todos</option>
            <option value="MERCADO_LIVRE">Mercado Livre</option>
            <option value="SHOPEE">Shopee</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Conta
          <select
            className={inputClass}
            value={draft.accountId}
            onChange={(e) => update("accountId", e.target.value)}
          >
            <option value="">Todas</option>
            {visibleAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {accountLabel(account)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Tipo de cliente
          <select
            className={inputClass}
            value={draft.customerType}
            onChange={(e) =>
              update("customerType", e.target.value as CustomersFilters["customerType"])
            }
          >
            <option value="ALL">Todos</option>
            <option value="NEW">Novos</option>
            <option value="RECURRING">Recorrentes</option>
          </select>
        </label>
      </div>

      <fieldset className="flex flex-wrap items-end gap-3">
        <legend className="mb-1 text-sm">Período</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="customers-period"
            checked={draft.allTime}
            onChange={() => update("allTime", true)}
          />
          Todo o período
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="customers-period"
            checked={!draft.allTime}
            onChange={() => update("allTime", false)}
          />
          Intervalo personalizado
        </label>
        {!draft.allTime ? (
          <>
            <label className="flex flex-col gap-1 text-sm">
              De
              <input
                type="date"
                className={inputClass}
                value={draft.from}
                onChange={(e) => update("from", e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Até
              <input
                type="date"
                className={inputClass}
                value={draft.to}
                onChange={(e) => update("to", e.target.value)}
              />
            </label>
          </>
        ) : null}
      </fieldset>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1 text-sm">
          <label className="flex flex-col gap-1">
            Buscar cliente
            <input
              type="search"
              className={inputClass}
              placeholder="ID ou username do comprador"
              aria-describedby="customers-search-hint"
              maxLength={120}
              value={draft.search}
              onChange={(e) => update("search", e.target.value)}
            />
          </label>
          <span id="customers-search-hint" className="text-xs text-foreground/50">
            Nomes ficam criptografados e não são pesquisáveis nesta versão.
          </span>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          Produto/SKU
          <input
            type="search"
            className={inputClass}
            placeholder="Título, SKU ou anúncio"
            maxLength={120}
            value={draft.product}
            onChange={(e) => update("product", e.target.value)}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.onlyWithEmail}
            onChange={(e) => update("onlyWithEmail", e.target.checked)}
          />
          Somente com e-mail
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.onlyWithRecipientPhone}
            onChange={(e) => update("onlyWithRecipientPhone", e.target.checked)}
          />
          Somente com telefone do destinatário
        </label>
        <button
          type="submit"
          className="ml-auto rounded-md border border-brand bg-brand/10 px-3 py-1.5 font-medium text-brand hover:bg-brand/20"
        >
          Aplicar filtros
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </form>
  );
}
