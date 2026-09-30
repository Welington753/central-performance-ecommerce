"use client";

import { useState, type FormEvent } from "react";
import { accountDisplayName, RESPONSIBILITY_LABELS } from "@/lib/problems-format";
import type { MarketplaceAccountDto } from "@/types/marketplace";
import {
  EMPTY_PROBLEMS_FILTERS,
  type ProblemReasonOptionDto,
  type ProblemsFilters,
} from "@/types/problems";

interface ProblemsFiltersBarProps {
  value: ProblemsFilters;
  accounts: MarketplaceAccountDto[];
  reasons: ProblemReasonOptionDto[];
  onApply: (filters: ProblemsFilters) => void;
}

const inputClass = "rounded-md border border-border-subtle bg-background px-2 py-1.5 text-sm";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      {children}
    </label>
  );
}

export function ProblemsFiltersBar({ value, accounts, reasons, onApply }: ProblemsFiltersBarProps) {
  const [draft, setDraft] = useState<ProblemsFilters>(value);
  const [error, setError] = useState<string | null>(null);

  // Só o Mercado Livre tem problemas hoje; a lista de contas já vem restrita ao escopo do usuário.
  const mlAccounts = accounts.filter((account) => account.marketplace === "MERCADO_LIVRE");

  function update<K extends keyof ProblemsFilters>(key: K, next: ProblemsFilters[K]) {
    setDraft((current) => ({ ...current, [key]: next }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) {
      setError("A data inicial não pode ser posterior à data final.");
      return;
    }
    setError(null);
    onApply(draft);
  }

  return (
    <form
      onSubmit={submit}
      aria-label="Filtros de problemas"
      className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface px-5 py-4"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <Field label="Criado a partir de">
          <input type="date" className={inputClass} value={draft.from} onChange={(e) => update("from", e.target.value)} />
        </Field>
        <Field label="Criado até">
          <input type="date" className={inputClass} value={draft.to} onChange={(e) => update("to", e.target.value)} />
        </Field>
        <Field label="Marketplace">
          <select
            className={inputClass}
            value={draft.marketplace}
            onChange={(e) => {
              update("marketplace", e.target.value as ProblemsFilters["marketplace"]);
              update("accountId", "");
            }}
          >
            <option value="ALL">Todos</option>
            <option value="MERCADO_LIVRE">Mercado Livre</option>
          </select>
        </Field>
        <Field label="Conta">
          <select className={inputClass} value={draft.accountId} onChange={(e) => update("accountId", e.target.value)}>
            <option value="">Todas</option>
            {mlAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {accountDisplayName(account.nickname, account.marketplace)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select className={inputClass} value={draft.status} onChange={(e) => update("status", e.target.value as ProblemsFilters["status"])}>
            <option value="ALL">Todos</option>
            <option value="opened">Abertos</option>
            <option value="closed">Encerrados</option>
          </select>
        </Field>
        <Field label="Motivo">
          <select className={inputClass} value={draft.reasonId} onChange={(e) => update("reasonId", e.target.value)}>
            <option value="">Todos</option>
            {reasons.map((reason) => (
              <option key={reason.reasonId} value={reason.reasonId}>
                {`${reason.name ?? "Motivo sem descrição"} (${reason.count})`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Responsabilidade">
          <select
            className={inputClass}
            value={draft.responsibility}
            onChange={(e) => update("responsibility", e.target.value as ProblemsFilters["responsibility"])}
          >
            <option value="ALL">Todas</option>
            {Object.entries(RESPONSIBILITY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Impacto na reputação">
          <select
            className={inputClass}
            value={draft.reputationImpact}
            onChange={(e) => update("reputationImpact", e.target.value as ProblemsFilters["reputationImpact"])}
          >
            <option value="ALL">Todos</option>
            <option value="affected">Afeta a reputação</option>
            <option value="not_affected">Não afeta a reputação</option>
            <option value="not_applies">Não se aplica</option>
          </select>
        </Field>
        <Field label="Ação pendente">
          <select
            className={inputClass}
            value={draft.pendingAction}
            onChange={(e) => update("pendingAction", e.target.value as ProblemsFilters["pendingAction"])}
          >
            <option value="ALL">Todos</option>
            <option value="true">Com ação pendente</option>
          </select>
        </Field>
        <Field label="Vencimento da ação">
          <select
            className={inputClass}
            value={draft.actionDue}
            onChange={(e) => update("actionDue", e.target.value as ProblemsFilters["actionDue"])}
          >
            <option value="ALL">Todos</option>
            <option value="overdue">Vencida</option>
            <option value="next7days">Vence em até 7 dias</option>
          </select>
        </Field>
        <Field label="Pedido">
          <input
            type="text"
            className={inputClass}
            placeholder="Número do pedido"
            value={draft.orderId}
            onChange={(e) => update("orderId", e.target.value)}
          />
        </Field>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setDraft(EMPTY_PROBLEMS_FILTERS);
            setError(null);
            onApply(EMPTY_PROBLEMS_FILTERS);
          }}
          className="rounded-md border border-border-subtle px-3 py-1.5 text-sm"
        >
          Limpar filtros
        </button>
        <button type="submit" className="rounded-md border border-brand bg-brand px-3 py-1.5 text-sm font-medium text-white">
          Aplicar filtros
        </button>
      </div>
    </form>
  );
}
