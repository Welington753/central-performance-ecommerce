import { Suspense } from "react";
import { DashboardTabs } from "@/components/DashboardTabs";

/**
 * Layout compartilhado do dashboard (Checkpoint BI-1) — só a navegação por
 * abas; cada aba (Visão Geral em `page.tsx`, Metas e Ritmo em
 * `metas/page.tsx`) continua responsável pelos próprios dados/estado.
 * `DashboardTabs` usa `useSearchParams()` (Next.js exige Suspense em torno
 * de qualquer uso desse hook para não quebrar a renderização estática).
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<div className="h-11 border-b border-border-subtle" />}>
        <DashboardTabs />
      </Suspense>
      {children}
    </div>
  );
}
