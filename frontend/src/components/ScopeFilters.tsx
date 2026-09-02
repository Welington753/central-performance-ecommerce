"use client";

import type {
  AccountBreakdownEntry,
  MarketplaceFilter,
} from "@/types/marketplace-analytics";

interface ScopeFiltersProps {
  marketplace: MarketplaceFilter;
  accountId: string | null;
  accounts: AccountBreakdownEntry[];
  onChange: (next: { marketplace: MarketplaceFilter; accountId: string | null }) => void;
}

const MARKETPLACE_OPTIONS: Array<{ value: MarketplaceFilter; label: string }> = [
  { value: "ALL", label: "Todos" },
  { value: "MERCADO_LIVRE", label: "Mercado Livre" },
  { value: "AMAZON", label: "Amazon" },
  { value: "SHOPEE", label: "Shopee" },
];

function accountLabel(account: AccountBreakdownEntry): string {
  if (account.nickname) return account.nickname;
  if (account.externalSellerId) return `Conta ${account.externalSellerId}`;
  return `Conta ${account.accountId.slice(0, 8)}`;
}

/**
 * Filtros de escopo (Checkpoint 3, "Filtros") — marketplace e conta.
 * Trocar o marketplace sempre reseta a conta selecionada: uma conta
 * escolhida sob um marketplace pode não pertencer ao novo marketplace, e
 * nunca deixamos uma seleção inválida "grudada" silenciosamente.
 */
export function ScopeFilters({
  marketplace,
  accountId,
  accounts,
  onChange,
}: ScopeFiltersProps) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-foreground/60">Marketplace</span>
        <select
          aria-label="Marketplace"
          value={marketplace}
          onChange={(event) =>
            onChange({
              marketplace: event.target.value as MarketplaceFilter,
              accountId: null,
            })
          }
          className="rounded-md border border-border-subtle bg-surface px-3 py-1.5"
        >
          {MARKETPLACE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-foreground/60">Conta</span>
        <select
          aria-label="Conta"
          value={accountId ?? ""}
          onChange={(event) =>
            onChange({
              marketplace,
              accountId: event.target.value === "" ? null : event.target.value,
            })
          }
          className="rounded-md border border-border-subtle bg-surface px-3 py-1.5"
        >
          <option value="">Todas as contas</option>
          {accounts.map((account) => (
            <option key={account.accountId} value={account.accountId}>
              {accountLabel(account)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
