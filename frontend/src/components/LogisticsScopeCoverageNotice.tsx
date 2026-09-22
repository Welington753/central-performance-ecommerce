import type {
  LogisticsScopeFilter as LogisticsScopeValue,
  MarketplaceAnalyticsFull,
} from "@/types/marketplace-analytics";

interface LogisticsScopeCoverageNoticeProps {
  logisticsScope: LogisticsScopeValue;
  full: MarketplaceAnalyticsFull | null;
}

/**
 * Aviso de cobertura JUNTO AO FILTRO (correção da auditoria Full). Antes, o
 * único aviso sobre pedidos não classificados ficava lá embaixo, dentro da
 * seção "Mercado Livre Full" — quem selecionava "Somente Full" ou "Vendas
 * sem Full" via os cartões principais mudarem sem nenhuma indicação de que
 * pedidos `UNKNOWN` tinham ficado de fora dos dois lados.
 *
 * Só aparece quando o filtro logístico está ativo E existem pedidos ainda
 * não classificados. Nunca apresenta `UNKNOWN` como "sem Full", como zero
 * nem como `SELLER_FULFILLED`: o texto diz explicitamente que esses pedidos
 * ficaram FORA do filtro, dos dois lados.
 */
export function LogisticsScopeCoverageNotice({
  logisticsScope,
  full,
}: LogisticsScopeCoverageNoticeProps) {
  if (logisticsScope === "ALL") return null;
  if (!full || full.unclassifiedOrders === 0) return null;

  const scopeLabel =
    logisticsScope === "FULL" ? "Somente Full" : "Vendas sem Full";

  return (
    <div
      role="status"
      data-testid="logistics-scope-coverage-notice"
      className="flex flex-col gap-1 rounded-md border border-notice/40 bg-notice/10 px-4 py-3 text-sm text-notice"
    >
      <p>
        {full.unclassifiedOrders} pedido(s) deste período ainda não têm a
        modalidade logística identificada e ficaram FORA do filtro &quot;
        {scopeLabel}&quot;.
      </p>
      <p>
        Pedido não classificado não é o mesmo que &quot;sem Full&quot;: ele não
        entra nem em &quot;Somente Full&quot; nem em &quot;Vendas sem Full&quot;,
        e nunca é contado como zero. Use &quot;Todas as vendas&quot; para ver o
        total sem recorte.
      </p>
    </div>
  );
}
