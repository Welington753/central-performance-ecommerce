import {
  RESPONSIBILITY_LABELS,
  accountDisplayName,
  formatDateTime,
  jobStatusLabel,
} from "@/lib/problems-format";
import type { ProblemsSummaryDto } from "@/types/problems";

function Card({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "warn";
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border-subtle bg-surface px-4 py-3">
      <span className="text-xs font-medium uppercase tracking-wide text-foreground/60">
        {label}
      </span>
      <span
        className={`text-xl font-semibold ${tone === "warn" && value > 0 ? "text-red-700" : ""}`}
      >
        {value.toLocaleString("pt-BR")}
      </span>
      {hint ? <span className="text-xs text-foreground/50">{hint}</span> : null}
    </div>
  );
}

function ListCard({
  title,
  empty,
  children,
}: {
  title: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border-subtle bg-surface px-4 py-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {empty ? (
        <p className="mt-2 text-sm text-foreground/60">Sem dados no recorte atual.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1 text-sm">{children}</ul>
      )}
    </div>
  );
}

/** Cards do resumo + divisões (responsabilidade, motivos) e cobertura por conta — só dados devolvidos pelo backend. */
export function ProblemsSummaryCards({ summary }: { summary: ProblemsSummaryDto }) {
  return (
    <section aria-label="Resumo de problemas" className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Card label="Total de problemas" value={summary.total} />
        <Card label="Abertos" value={summary.open} hint="não resolvidos" />
        <Card label="Resolvidos" value={summary.resolved} />
        <Card label="Impacto na reputação" value={summary.reputationAffected} tone="warn" />
        <Card label="Ação pendente" value={summary.pendingAction} hint="ação do vendedor" />
        <Card label="Ação vencida" value={summary.overdueAction} tone="warn" />
        <Card
          label="Responsabilidade desconhecida"
          value={summary.unknownResponsibility}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <ListCard title="Por responsabilidade" empty={summary.byResponsibility.length === 0}>
          {summary.byResponsibility.map((item) => (
            <li key={item.responsibility} className="flex justify-between">
              <span>{RESPONSIBILITY_LABELS[item.responsibility]}</span>
              <span className="font-medium">{item.count.toLocaleString("pt-BR")}</span>
            </li>
          ))}
        </ListCard>
        <ListCard title="Principais motivos" empty={summary.topReasons.length === 0}>
          {summary.topReasons.map((reason) => (
            <li key={reason.reasonId} className="flex justify-between gap-3">
              <span>{reason.name ?? "Motivo sem descrição"}</span>
              <span className="font-medium">{reason.count.toLocaleString("pt-BR")}</span>
            </li>
          ))}
        </ListCard>
      </div>

      {summary.coverage.length > 0 ? (
        <ListCard title="Cobertura por conta" empty={false}>
          {summary.coverage.map((account) => (
            <li key={account.accountId} className="flex flex-wrap justify-between gap-2">
              <span>{accountDisplayName(account.accountNickname, account.marketplace)}</span>
              <span className="text-foreground/60">
                {jobStatusLabel(account.jobStatus)}
                {account.jobStatus !== "NOT_STARTED"
                  ? ` · varrido até ${formatDateTime(account.windowCursorAt)}`
                  : ""}
                {` · ${account.problemsTotal.toLocaleString("pt-BR")} problemas`}
              </span>
            </li>
          ))}
        </ListCard>
      ) : null}
    </section>
  );
}
