"use client";

import { useState, type FormEvent } from "react";
import { RESPONSIBILITY_LABELS } from "@/lib/problems-format";
import type {
  ProblemReasonOptionDto,
  ProblemSortField,
  ProblemsFilters,
  SortDirection,
} from "@/types/problems";

/** Só os filtros próprios da aba Casos; período, marketplace e conta vivem no topo. */
export type CaseFilters = Pick<
  ProblemsFilters,
  "status" | "reasonId" | "responsibility" | "reputationImpact" | "pendingAction" | "actionDue" | "orderId"
>;

export const EMPTY_CASE_FILTERS: CaseFilters = {
  status: "ALL",
  reasonId: "",
  responsibility: "ALL",
  reputationImpact: "ALL",
  pendingAction: "ALL",
  actionDue: "ALL",
  orderId: "",
};

interface CasesFiltersProps {
  value: CaseFilters;
  reasons: ProblemReasonOptionDto[];
  sortBy: ProblemSortField;
  sortDir: SortDirection;
  onApply: (filters: CaseFilters) => void;
  onSort: (field: ProblemSortField) => void;
  onToggleDirection: () => void;
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

const SORT_OPTIONS: Array<{ value: ProblemSortField; label: string }> = [
  { value: "dateCreated", label: "Data de criação" },
  { value: "lastUpdated", label: "Última atualização" },
  { value: "nextActionDueDate", label: "Prazo da ação" },
];

export function CasesFilters({
  value,
  reasons,
  sortBy,
  sortDir,
  onApply,
  onSort,
  onToggleDirection,
}: CasesFiltersProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CaseFilters>(value);

  function update<K extends keyof CaseFilters>(key: K, next: CaseFilters[K]) {
    setDraft((current) => ({ ...current, [key]: next }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onApply(draft);
  }

  const activeReason = value.reasonId
    ? reasons.find((reason) => reason.reasonId === value.reasonId)
    : undefined;

  return (
    <form onSubmit={submit} aria-label="Filtros de casos" className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface px-4 py-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Pedido">
          <input
            type="text"
            className={control}
            placeholder="Número do pedido"
            value={draft.orderId}
            onChange={(event) => update("orderId", event.target.value)}
          />
        </Field>
        <button type="submit" className="rounded-md border border-brand bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground">
          Buscar
        </button>
        <Field label="Ordenar por">
          <select className={control} value={sortBy} onChange={(event) => onSort(event.target.value as ProblemSortField)}>
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <button type="button" onClick={onToggleDirection} className="rounded-md border border-border-subtle px-3 py-1.5 text-sm">
          {sortDir === "asc" ? "Crescente ▲" : "Decrescente ▼"}
        </button>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="cases-advanced-filters"
          onClick={() => setOpen((current) => !current)}
          className="ml-auto rounded-md border border-border-subtle px-3 py-1.5 text-sm"
        >
          Filtros avançados
        </button>
      </div>
      {value.reasonId ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-foreground/70">Motivo:</span>
          <strong>{activeReason ? activeReason.reasonLabel : "selecionado"}</strong>
          <button
            type="button"
            onClick={() => {
              const next = { ...draft, reasonId: "" };
              setDraft(next);
              onApply(next);
            }}
            className="rounded-md border border-border-subtle px-2 py-0.5 text-xs"
          >
            Remover filtro de motivo
          </button>
        </p>
      ) : null}
      {open ? (
        <div id="cases-advanced-filters" className="grid grid-cols-1 gap-3 border-t border-border-subtle pt-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Status">
            <select className={control} value={draft.status} onChange={(e) => update("status", e.target.value as CaseFilters["status"])}>
              <option value="ALL">Todos</option>
              <option value="opened">Abertos</option>
              <option value="closed">Encerrados</option>
            </select>
          </Field>
          <Field label="Motivo">
            <select className={control} value={draft.reasonId} onChange={(e) => update("reasonId", e.target.value)}>
              <option value="">Todos</option>
              {reasons.map((reason) => (
                <option key={reason.reasonId} value={reason.reasonId}>
                  {`${reason.reasonLabel} (${reason.count})`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Responsabilidade">
            <select className={control} value={draft.responsibility} onChange={(e) => update("responsibility", e.target.value as CaseFilters["responsibility"])}>
              <option value="ALL">Todas</option>
              {Object.entries(RESPONSIBILITY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Impacto na reputação">
            <select className={control} value={draft.reputationImpact} onChange={(e) => update("reputationImpact", e.target.value as CaseFilters["reputationImpact"])}>
              <option value="ALL">Todos</option>
              <option value="affected">Afeta a reputação</option>
              <option value="not_affected">Não afeta a reputação</option>
              <option value="not_applies">Não se aplica</option>
            </select>
          </Field>
          <Field label="Ação pendente">
            <select className={control} value={draft.pendingAction} onChange={(e) => update("pendingAction", e.target.value as CaseFilters["pendingAction"])}>
              <option value="ALL">Todos</option>
              <option value="true">Com ação pendente</option>
            </select>
          </Field>
          <Field label="Vencimento da ação">
            <select className={control} value={draft.actionDue} onChange={(e) => update("actionDue", e.target.value as CaseFilters["actionDue"])}>
              <option value="ALL">Todos</option>
              <option value="overdue">Vencida</option>
              <option value="next7days">Vence em até 7 dias</option>
            </select>
          </Field>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-3 lg:justify-end">
            <button
              type="button"
              onClick={() => {
                setDraft(EMPTY_CASE_FILTERS);
                onApply(EMPTY_CASE_FILTERS);
              }}
              className="rounded-md border border-border-subtle px-3 py-1.5 text-sm"
            >
              Limpar filtros
            </button>
            <button type="submit" className="rounded-md border border-brand bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground">
              Aplicar filtros
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
