import { MarketplaceCard } from "@/components/MarketplaceCard";
import type { MarketplaceCardData } from "@/types/marketplace";

const MARKETPLACE_CARDS: MarketplaceCardData[] = [
  {
    id: "mercado-livre",
    name: "Mercado Livre",
    statusLabel: "Não conectado",
    description: "Primeira integração planejada",
    cta: {
      label: "Conectar Mercado Livre",
      disabled: true,
      tooltip: "Disponível na próxima etapa",
    },
  },
  {
    id: "amazon",
    name: "Amazon",
    statusLabel: "Disponível futuramente",
    description:
      "Integração planejada para uma etapa futura do roadmap multi-marketplace.",
  },
  {
    id: "shopee",
    name: "Shopee",
    statusLabel: "Disponível futuramente",
    description:
      "Integração planejada para uma etapa futura do roadmap multi-marketplace.",
  },
];

export default function IntegracoesPage() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integrações</h1>
        <p className="mt-1 text-sm text-foreground/60">
          Conecte marketplaces à Central de Performance. Nesta fase, nenhuma
          conexão real é realizada.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {MARKETPLACE_CARDS.map((card) => (
          <MarketplaceCard key={card.id} card={card} />
        ))}
      </div>
    </div>
  );
}
