import { EmptyStateIcon } from "@/components/EmptyState";
import type { SyncRun } from "@/types/sync-run";

const COLUMNS = [
  "Marketplace",
  "Conta",
  "Tipo",
  "Status",
  "Início",
  "Término",
  "Registros lidos",
  "Criados",
  "Atualizados",
  "Falhas",
] as const;

function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleString("pt-BR");
}

/**
 * Tabela genérica de sincronizações, reutilizável para qualquer marketplace
 * (não é específica de Mercado Livre, Amazon ou Shopee).
 */
export function SyncTable({ syncRuns }: { syncRuns: SyncRun[] }) {
  if (syncRuns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border-subtle bg-surface px-6 py-20 text-center">
        <EmptyStateIcon />
        <p className="text-sm text-foreground/60">
          Nenhuma sincronização registrada ainda.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-xs uppercase tracking-wide text-foreground/50">
            {COLUMNS.map((column) => (
              <th key={column} scope="col" className="px-4 py-3 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {syncRuns.map((run) => (
            <tr key={run.id} className="border-b border-border-subtle last:border-0">
              <td className="px-4 py-3">{run.marketplace}</td>
              <td className="px-4 py-3">{run.account}</td>
              <td className="px-4 py-3">{run.type}</td>
              <td className="px-4 py-3">{run.status}</td>
              <td className="px-4 py-3">{formatDateTime(run.startedAt)}</td>
              <td className="px-4 py-3">{formatDateTime(run.finishedAt)}</td>
              <td className="px-4 py-3">{run.recordsRead}</td>
              <td className="px-4 py-3">{run.recordsCreated}</td>
              <td className="px-4 py-3">{run.recordsUpdated}</td>
              <td className="px-4 py-3">{run.recordsFailed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
