import Link from "next/link";
import { formatBRL } from "@/lib/kpi-format";
import type {
  Marketplace,
  MarketplaceBreakdownEntry,
} from "@/types/marketplace-analytics";

interface MarketplacePanelProps {
  breakdown: MarketplaceBreakdownEntry[];
}

const MARKETPLACE_LABELS: Record<Marketplace, string> = {
  MERCADO_LIVRE: "Mercado Livre",
  AMAZON: "Amazon",
  SHOPEE: "Shopee",
};

const AVAILABILITY_LABELS: Record<MarketplaceBreakdownEntry["availability"], string> = {
  AVAILABLE: "Conectado",
  CONNECTED_NO_DATA: "Conectado — aguardando primeira sincronização",
  HISTORICAL_ONLY: "Conexão precisa de atenção",
  NOT_CONNECTED: "Não conectado",
};

/**
 * Painel resumido por marketplace (Checkpoint 3, "Painel por marketplace")
 * — Mercado Livre, Amazon e Shopee sempre lado a lado, independentemente do
 * filtro de escopo selecionado no restante do dashboard. Amazon/Shopee sem
 * conexão NUNCA mostram número nenhum (nem R$ 0,00, nem "0 pedidos") — só
 * "Não conectado" e um link para /integracoes.
 */
export function MarketplacePanel({ breakdown }: MarketplacePanelProps) {
  return (
    <div
      role="region"
      aria-label="Resumo por marketplace"
      className="grid grid-cols-1 gap-4 sm:grid-cols-3"
    >
      {breakdown.map((entry) => (
        <div
          key={entry.marketplace}
          data-testid={`marketplace-panel-${entry.marketplace}`}
          className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface px-5 py-4"
        >
          <p className="text-sm font-semibold">
            {MARKETPLACE_LABELS[entry.marketplace]}
          </p>
          <p className="text-xs text-foreground/60">
            {AVAILABILITY_LABELS[entry.availability]}
          </p>

          {entry.summary ? (
            <>
              <p className="text-lg font-semibold tracking-tight">
                {formatBRL(entry.summary.grossRevenue)}
              </p>
              <p className="text-xs text-foreground/60">
                {entry.summary.paidOrders} pedido
                {entry.summary.paidOrders === 1 ? "" : "s"} pago
                {entry.summary.paidOrders === 1 ? "" : "s"} · {entry.accountsIncluded}{" "}
                conta{entry.accountsIncluded === 1 ? "" : "s"} incluída
                {entry.accountsIncluded === 1 ? "" : "s"}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-foreground/40">Sem dados disponíveis.</p>
              <Link
                href="/integracoes"
                className="text-xs font-medium text-brand hover:underline"
              >
                Ir para integrações
              </Link>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
