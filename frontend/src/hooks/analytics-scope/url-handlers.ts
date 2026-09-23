import { marketplaceSupportsLogisticsScope } from "@/hooks/analytics-scope/params";
import type {
  LogisticsScopeFilter as LogisticsScopeValue,
  MarketplaceFilter,
} from "@/types/marketplace-analytics";

/** Só a parte do router usada aqui — evita depender de tipos internos do Next. */
interface ReplaceOnlyRouter {
  replace: (href: string, options?: { scroll?: boolean }) => void;
}

/**
 * Handlers de troca de filtro (período, marketplace/conta, filtro
 * logístico) — só constroem a próxima URL e delegam a navegação ao router;
 * extraídos do hook de orquestração para não inflar aquele arquivo.
 */
export function createScopeUrlHandlers(input: {
  router: ReplaceOnlyRouter;
  pathname: string;
  searchParams: URLSearchParams;
}) {
  const { router, pathname, searchParams } = input;

  function handlePeriodChange(range: { from: string; to: string }) {
    const params = new URLSearchParams(searchParams.toString());
    // Escolher um período explícito sempre sai de "Todo o período".
    params.delete("period");
    params.set("from", range.from);
    params.set("to", range.to);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function handleAllTimeChange() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", "all");
    params.delete("from");
    params.delete("to");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function handleScopeChange(next: { marketplace: MarketplaceFilter; accountId: string | null }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.marketplace === "ALL") {
      params.delete("marketplace");
    } else {
      params.set("marketplace", next.marketplace);
    }
    if (next.accountId) {
      params.set("accountId", next.accountId);
    } else {
      params.delete("accountId");
    }
    // Trocar para qualquer marketplace/escopo que não suporte o filtro
    // logístico (nem Mercado Livre nem Shopee) restaura "Tipo de venda"
    // para "Todas as vendas" (Fase 4, item 2) — nunca deixa
    // `logistics=FULL`/`NON_FULL` pendurado na URL fora do escopo em que
    // faz sentido.
    if (!marketplaceSupportsLogisticsScope(next.marketplace)) {
      params.delete("logistics");
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function handleLogisticsScopeChange(next: LogisticsScopeValue) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "ALL") {
      params.delete("logistics");
    } else {
      params.set("logistics", next);
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return {
    handlePeriodChange,
    handleAllTimeChange,
    handleScopeChange,
    handleLogisticsScopeChange,
  };
}
