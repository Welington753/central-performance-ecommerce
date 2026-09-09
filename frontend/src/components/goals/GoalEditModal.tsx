"use client";

import { useState } from "react";
import { ApiFetchError } from "@/lib/api";
import { upsertMonthlyGoal } from "@/lib/goals-api";
import { formatMonthYearLabel } from "@/lib/goal-format";

interface GoalEditModalProps {
  year: number;
  month: number;
  currentTargetAmount: string | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Formulário de cadastro/alteração da meta mensal (design §7) — só
 * renderizado pela página quando `useCurrentUser().isAdmin` é `true`;
 * mesmo assim, o backend (`AdminGuard`) é quem realmente impede a escrita —
 * este componente nunca é a única proteção.
 */
export function GoalEditModal({
  year,
  month,
  currentTargetAmount,
  onClose,
  onSaved,
}: GoalEditModalProps) {
  const [amountInput, setAmountInput] = useState(currentTargetAmount ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const normalized = amountInput.replace(",", ".");
    const targetAmount = Number(normalized);
    if (!Number.isFinite(targetAmount) || targetAmount <= 0) {
      setError("Informe um valor de meta maior que zero.");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await upsertMonthlyGoal({ year, month, currencyId: "BRL", targetAmount });
      onSaved();
    } catch (err) {
      setError(
        err instanceof ApiFetchError
          ? err.message
          : "Não foi possível salvar a meta agora.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="goal-edit-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-6"
      >
        <h2 id="goal-edit-title" className="text-lg font-semibold">
          Meta de {formatMonthYearLabel(year, month)}
        </h2>
        <p className="text-xs text-foreground/50">
          Meta consolidada — todas as contas e marketplaces.
        </p>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-foreground/60">Valor da meta (BRL)</span>
          <input
            type="text"
            inputMode="decimal"
            autoFocus
            value={amountInput}
            onChange={(event) => setAmountInput(event.target.value)}
            className="rounded-md border border-border-subtle bg-surface px-3 py-1.5"
            placeholder="0,00"
          />
        </label>

        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-md border border-border-subtle px-4 py-1.5 text-sm disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-brand-foreground disabled:opacity-50"
          >
            {isSaving ? "Salvando..." : "Salvar meta"}
          </button>
        </div>
      </form>
    </div>
  );
}
