"use client";

import {
  PERIOD_OPTIONS,
  customPeriodError,
  type ProblemsPeriod,
  type ProblemsPeriodPreset,
} from "@/lib/problems-period";
import { accountDisplayName } from "@/lib/problems-format";
import type { MarketplaceAccountDto } from "@/types/marketplace";
import type { ProblemsFilters } from "@/types/problems";

interface ProblemsHeaderProps {
  period: ProblemsPeriod;
  marketplace: ProblemsFilters["marketplace"];
  accountId: string;
  accounts: MarketplaceAccountDto[];
  onPeriodChange: (period: ProblemsPeriod) => void;
  onMarketplaceChange: (marketplace: ProblemsFilters["marketplace"]) => void;
  onAccountChange: (accountId: string) => void;
}

const control = "rounded-md border border-border-subtle bg-background px-2 py-1.5 text-sm";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5 text-xs text-foreground/70">
      {label}
      {children}
    </label>
  );
}

/** Linha única de filtros globais (período, marketplace, conta) — os avançados vivem na aba Casos. */
export function ProblemsHeader({
  period,
  marketplace,
  accountId,
  accounts,
  onPeriodChange,
  onMarketplaceChange,
  onAccountChange,
}: ProblemsHeaderProps) {
  // Só o Mercado Livre tem problemas hoje; a lista de contas já vem restrita ao escopo do usuário.
  const mlAccounts = accounts.filter((account) => account.marketplace === "MERCADO_LIVRE");
  const error = customPeriodError(period);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface px-4 py-3">
      <div role="group" aria-label="Filtros globais" className="flex flex-wrap items-end gap-3">
        <Field label="Período">
          <select
            className={control}
            value={period.preset}
            onChange={(event) =>
              onPeriodChange({ ...period, preset: event.target.value as ProblemsPeriodPreset })
            }
          >
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        {period.preset === "custom" ? (
          <>
            <Field label="De">
              <input
                type="date"
                className={control}
                value={period.customFrom}
                onChange={(event) => onPeriodChange({ ...period, customFrom: event.target.value })}
              />
            </Field>
            <Field label="Até">
              <input
                type="date"
                className={control}
                value={period.customTo}
                onChange={(event) => onPeriodChange({ ...period, customTo: event.target.value })}
              />
            </Field>
          </>
        ) : null}
        <Field label="Marketplace">
          <select
            className={control}
            value={marketplace}
            onChange={(event) => {
              onMarketplaceChange(event.target.value as ProblemsFilters["marketplace"]);
              onAccountChange("");
            }}
          >
            <option value="ALL">Todos</option>
            <option value="MERCADO_LIVRE">Mercado Livre</option>
          </select>
        </Field>
        <Field label="Conta">
          <select className={control} value={accountId} onChange={(event) => onAccountChange(event.target.value)}>
            <option value="">Todas</option>
            {mlAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {accountDisplayName(account.nickname, account.marketplace)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      ) : null}
    </div>
  );
}
