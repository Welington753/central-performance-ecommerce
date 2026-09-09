"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

interface DashboardTab {
  href: string;
  label: string;
}

const TABS: DashboardTab[] = [
  { href: "/dashboard", label: "Visão Geral" },
  { href: "/dashboard/metas", label: "Metas e Ritmo" },
];

/**
 * Navegação por abas do dashboard (Checkpoint BI-1) — preserva TODOS os
 * query parameters existentes ao trocar de aba (marketplace, conta,
 * período, allTime, logisticsScope), mesmo que a aba de destino não os use
 * para sua própria busca de dados: é só para o usuário voltar à Visão Geral
 * exatamente como deixou. `aria-current="page"` na aba ativa; links nativos
 * (`<Link>`), então acessível por teclado (Tab/Enter) sem nenhum código
 * adicional.
 */
export function DashboardTabs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  return (
    <nav aria-label="Seções do dashboard">
      <ul className="flex gap-1 overflow-x-auto border-b border-border-subtle">
        {TABS.map((tab) => {
          const isActive = pathname === tab.href;
          const href = query ? `${tab.href}?${query}` : tab.href;
          return (
            <li key={tab.href}>
              <Link
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={
                  "inline-block whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors " +
                  (isActive
                    ? "border-brand text-brand"
                    : "border-transparent text-foreground/60 hover:border-border-subtle hover:text-foreground")
                }
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
