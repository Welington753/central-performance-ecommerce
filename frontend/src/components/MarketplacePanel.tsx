import Link from "next/link";
import { formatBRL } from "@/lib/kpi-format";
import type {
  AccountBreakdownEntry,
  Marketplace,
  MarketplaceBreakdownEntry,
} from "@/types/marketplace-analytics";

interface MarketplacePanelProps {
  breakdown: MarketplaceBreakdownEntry[];
  /**
   * Contas do Mercado Livre (Fase 4, "cartões por conta") — um cartão POR
   * CONTA, nunca o consolidado. Vem de `breakdownByAccountUnscoped`
   * (nunca `breakdownByAccount`, que é filtrado pelo escopo selecionado no
   * resto do dashboard) — as mesmas garantias de sempre-visível de
   * `breakdown` valem aqui.
   */
  mercadoLivreAccounts: AccountBreakdownEntry[];
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

function sortByNicknameThenAccountId(
  accounts: readonly AccountBreakdownEntry[],
): AccountBreakdownEntry[] {
  return [...accounts].sort((a, b) =>
    (a.nickname ?? a.accountId).localeCompare(b.nickname ?? b.accountId, "pt-BR"),
  );
}

function CardShell({
  testId,
  title,
  availabilityLabel,
  summary,
  extraLine,
}: {
  testId: string;
  title: string;
  availabilityLabel: string;
  summary: { grossRevenue: string; paidOrders: number } | null;
  extraLine: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface px-5 py-4"
    >
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-xs text-foreground/60">{availabilityLabel}</p>

      {summary ? (
        <>
          <p className="text-lg font-semibold tracking-tight">
            {formatBRL(summary.grossRevenue)}
          </p>
          <p className="text-xs text-foreground/60">
            {summary.paidOrders} pedido
            {summary.paidOrders === 1 ? "" : "s"} pago
            {summary.paidOrders === 1 ? "" : "s"} · {extraLine}
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
  );
}

/**
 * Painel resumido por marketplace (Checkpoint 3, "Painel por marketplace";
 * Fase 4, "cartões por conta Mercado Livre") — um cartão POR CONTA do
 * Mercado Livre (nunca mais um único cartão consolidado), seguido de
 * Amazon e Shopee, sempre lado a lado, independentemente do filtro de
 * escopo selecionado no restante do dashboard. Amazon/Shopee sem conexão
 * NUNCA mostram número nenhum (nem R$ 0,00, nem "0 pedidos") — só "Não
 * conectado" e um link para /integracoes; uma conta ML conectada sem pedido
 * no período mostra R$ 0,00/0 pedidos normalmente (`summary` não-nulo com
 * zeros — nunca esse estado "sem dados"), porque o backend só devolve
 * `summary: null` para conta nunca sincronizada/desconectada.
 */
export function MarketplacePanel({
  breakdown,
  mercadoLivreAccounts,
}: MarketplacePanelProps) {
  const otherMarketplaces = breakdown.filter(
    (entry) => entry.marketplace !== "MERCADO_LIVRE",
  );
  const sortedMlAccounts = sortByNicknameThenAccountId(mercadoLivreAccounts);

  return (
    <div
      role="region"
      aria-label="Resumo por marketplace"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {sortedMlAccounts.map((account) => (
        <CardShell
          key={account.accountId}
          testId={`marketplace-account-panel-${account.accountId}`}
          title={account.nickname ?? "Mercado Livre"}
          availabilityLabel={AVAILABILITY_LABELS[account.availability]}
          summary={account.summary}
          extraLine="1 conta"
        />
      ))}

      {otherMarketplaces.map((entry) => (
        <CardShell
          key={entry.marketplace}
          testId={`marketplace-panel-${entry.marketplace}`}
          title={MARKETPLACE_LABELS[entry.marketplace]}
          availabilityLabel={AVAILABILITY_LABELS[entry.availability]}
          summary={entry.summary}
          extraLine={`${entry.accountsIncluded} conta${entry.accountsIncluded === 1 ? "" : "s"} incluída${entry.accountsIncluded === 1 ? "" : "s"}`}
        />
      ))}
    </div>
  );
}
