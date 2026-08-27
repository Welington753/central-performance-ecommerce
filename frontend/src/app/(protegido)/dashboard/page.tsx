import { EmptyStateIcon } from "@/components/EmptyState";

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Central de Performance E-commerce
        </h1>
        <p className="mt-1 text-sm text-foreground/60">
          Visão geral consolidada dos seus marketplaces.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border-subtle bg-surface px-6 py-20 text-center">
        <EmptyStateIcon />
        <div className="flex flex-col gap-1">
          <p className="text-base font-medium">Nenhum marketplace conectado</p>
          <p className="text-sm text-foreground/60">Ainda não sincronizado</p>
        </div>
      </div>
    </div>
  );
}
