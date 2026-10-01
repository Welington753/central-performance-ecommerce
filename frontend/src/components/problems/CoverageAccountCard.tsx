import { Badge } from "@/components/problems/ProblemsBadges";
import { HistoricalStatusBadge } from "@/components/problems/ProblemsCoverageBadges";
import { historicalProgress, isCoveragePartial, type CoverageControl } from "@/lib/problems-coverage";
import { accountDisplayName, formatDateTime, jobErrorLabel, jobStatusLabel } from "@/lib/problems-format";
import { formatInteger } from "@/lib/problems-monthly-format";
import type { ProblemsCoverageAccountDto } from "@/types/problems";

interface CoverageAccountCardProps {
  account: ProblemsCoverageAccountDto;
  /** Vazio para quem não tem `problems.sync`: nenhum botão (nem desabilitado) é renderizado. */
  controls: CoverageControl[];
  busy: boolean;
  workerDisabled: boolean;
  onControl: (control: CoverageControl) => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs uppercase tracking-wide text-foreground/70">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

const NONE = "Nenhum";

export function CoverageAccountCard({ account, controls, busy, workerDisabled, onControl }: CoverageAccountCardProps) {
  const name = accountDisplayName(account.accountNickname, account.marketplace);
  const progress = historicalProgress(account);
  // O histórico FAILED já mostra "Erro" no próprio selo de status; este cobre só os erros dos códigos.
  const hasError = account.historicalStatus !== "FAILED" && (account.lastErrorCode !== null || account.historicalLastErrorCode !== null);
  return (
    <article aria-label={`Cobertura de ${name}`} className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{name}</h3>
        <div className="flex flex-wrap gap-1.5">
          <HistoricalStatusBadge status={account.historicalStatus} />
          {isCoveragePartial(account) ? <Badge tone="notice" symbol="◐">Parcial</Badge> : null}
          {hasError ? <Badge tone="negative" symbol="!">Erro</Badge> : null}
        </div>
      </header>
      <p className="text-xs text-foreground/70">
        O histórico está sendo buscado do período mais recente para o mais antigo.
      </p>
      {progress !== null ? (
        <div className="flex flex-col gap-1">
          <div
            role="progressbar"
            aria-label={`Progresso do histórico de ${name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            className="h-2.5 rounded bg-foreground/10"
          >
            <div className="h-2.5 rounded bg-brand" style={{ width: `${progress}%` }} />
          </div>
          <span className="text-xs text-foreground/70">{progress}% do período coberto</span>
        </div>
      ) : null}
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Row label="Status incremental">{jobStatusLabel(account.jobStatus)}</Row>
        <Row label="Coberto incrementalmente até">{formatDateTime(account.incrementalCoveredThrough)}</Row>
        <Row label="Histórico coberto desde">{formatDateTime(account.historicalCoveredFrom)}</Row>
        <Row label="Alvo histórico">
          {account.historicalTargetFrom ? formatDateTime(account.historicalTargetFrom) : "Sem alvo (nenhum pedido)"}
        </Row>
        <Row label="Concluído em">{formatDateTime(account.historicalCompletedAt)}</Row>
        <Row label="Última atividade">{formatDateTime(account.lastActivityAt)}</Row>
        <Row label="Reclamações temporariamente inacessíveis">
          {formatInteger(account.quarantinedClaimsCount)}
          <span className="block text-xs text-foreground/70">
            Reclamações temporariamente inacessíveis ao sistema.
          </span>
        </Row>
        <Row label="Último erro incremental">{jobErrorLabel(account.lastErrorCode) ?? NONE}</Row>
        <Row label="Último erro histórico">{jobErrorLabel(account.historicalLastErrorCode) ?? NONE}</Row>
      </dl>
      {controls.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
          {workerDisabled ? (
            <p role="note" className="rounded-md border border-notice/40 bg-notice/10 px-3 py-2 text-xs text-notice">
              O job de sincronização está preparado, mas o servidor ainda não vai processá-lo. Ele só começa a rodar quando a
              sincronização automática de problemas for ativada no servidor.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {controls.map((control) => (
              <button
                key={`${control.scope}-${control.action}`}
                type="button"
                disabled={busy}
                onClick={() => onControl(control)}
                className="rounded-md border border-border-subtle px-3 py-1.5 text-sm disabled:opacity-50"
                aria-label={`${control.label} de ${name}`}
              >
                {control.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}
