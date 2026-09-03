"use client";

import { useState } from "react";
import type { MarketplaceCardData } from "@/types/marketplace";

export function MarketplaceCard({ card }: { card: MarketplaceCardData }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.rename?.currentNickname ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setDraft(card.rename?.currentNickname ?? "");
    setError(null);
    setEditing(true);
  }

  function cancelEditing() {
    setError(null);
    setEditing(false);
  }

  async function persist(nickname: string | null) {
    if (!card.rename) return;
    setSaving(true);
    setError(null);
    try {
      await card.rename.onSave(nickname);
      setEditing(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Não foi possível renomear a conta.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      data-testid={`marketplace-account-${card.id}`}
      className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-6 shadow-sm"
    >
      <div className="flex flex-col gap-1">
        {editing ? (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={60}
              disabled={saving}
              aria-label={`Nome de exibição — ${card.name}`}
              className="rounded-md border border-border-subtle bg-surface px-2 py-1 text-sm"
              autoFocus
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void persist(draft.trim() === "" ? null : draft)}
                disabled={saving}
                className="rounded-md border border-border-subtle px-2 py-1 text-xs font-medium hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Salvando..." : "Salvar"}
              </button>
              <button
                type="button"
                onClick={cancelEditing}
                disabled={saving}
                className="text-xs font-medium text-foreground/60 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancelar
              </button>
              {card.rename?.currentNickname ? (
                <button
                  type="button"
                  onClick={() => void persist(null)}
                  disabled={saving}
                  className="text-xs font-medium text-foreground/60 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Restaurar nome padrão
                </button>
              ) : null}
            </div>
            {error ? (
              <p role="alert" className="text-xs text-red-600">
                {error}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">{card.name}</h2>
            {card.rename ? (
              <button
                type="button"
                onClick={startEditing}
                aria-label={`Renomear ${card.name}`}
                title="Renomear"
                className="text-foreground/40 hover:text-foreground"
              >
                ✎
              </button>
            ) : null}
          </div>
        )}
        {card.rename ? (
          <p className="text-xs text-foreground/40">{card.rename.secondaryLabel}</p>
        ) : null}
        <p className="text-sm text-foreground/60">Status: {card.statusLabel}</p>
      </div>

      <p className="flex-1 text-sm text-foreground/70">{card.description}</p>

      {card.cta ? (
        <div className="group relative w-full">
          <button
            type="button"
            disabled={card.cta.disabled}
            onClick={card.cta.onClick}
            aria-describedby={
              card.cta.tooltip ? `${card.id}-cta-tooltip` : undefined
            }
            className="w-full rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-foreground/10 disabled:text-foreground/40"
          >
            {card.cta.label}
          </button>
          {card.cta.tooltip ? (
            <p
              id={`${card.id}-cta-tooltip`}
              className="mt-2 text-center text-xs text-foreground/50"
            >
              {card.cta.tooltip}
            </p>
          ) : null}
        </div>
      ) : null}

      {card.secondaryCta ? (
        <button
          type="button"
          disabled={card.secondaryCta.disabled}
          onClick={card.secondaryCta.onClick}
          className="w-full rounded-md border border-border-subtle px-4 py-2 text-sm font-medium hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {card.secondaryCta.label}
        </button>
      ) : null}
    </div>
  );
}
