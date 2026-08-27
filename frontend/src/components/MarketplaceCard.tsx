import type { MarketplaceCardData } from "@/types/marketplace";

export function MarketplaceCard({ card }: { card: MarketplaceCardData }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-6 shadow-sm">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{card.name}</h2>
        <p className="text-sm text-foreground/60">Status: {card.statusLabel}</p>
      </div>

      <p className="flex-1 text-sm text-foreground/70">{card.description}</p>

      {card.cta ? (
        <div className="group relative w-full">
          <button
            type="button"
            disabled={card.cta.disabled}
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
    </div>
  );
}
