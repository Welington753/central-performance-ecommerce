import { describeIntervals } from "./DataCoverageBanner";
import { BACKFILL_ERROR_MESSAGES } from "@/lib/api";
import { formatCalendarDate, formatDateTimeSaoPaulo } from "@/lib/kpi-format";
import type {
  BackfillJobStatusValue,
  BackfillStatusDto,
} from "@/types/marketplace-backfill";

interface BackfillAccountPanelProps {
  label: string;
  status: BackfillStatusDto | null;
  loadError: boolean;
  /** Ação (start/pause/resume) em voo agora — desabilita os botões desta conta. */
  actionPending: boolean;
  /** Outra conta do lote está em ação agora (ex.: "Completar histórico de todas as lojas"). */
  disabled: boolean;
  errorMessage: string | null;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
}

const JOB_STATUS_LABELS: Record<BackfillJobStatusValue, string> = {
  QUEUED: "Na fila",
  RUNNING: "Buscando histórico...",
  RETRY_WAIT: "Aguardando nova tentativa",
  PAUSED: "Pausado",
  FAILED: "Falhou",
  SAFETY_LIMIT_REACHED: "Concluído (limite de segurança)",
};

const JOB_STATUS_COLORS: Record<BackfillJobStatusValue, string> = {
  QUEUED: "text-foreground/60",
  RUNNING: "text-amber-700",
  RETRY_WAIT: "text-amber-700",
  PAUSED: "text-foreground/60",
  FAILED: "text-red-700",
  SAFETY_LIMIT_REACHED: "text-green-700",
};

const ACTIVE_JOB_STATUSES: BackfillJobStatusValue[] = [
  "QUEUED",
  "RUNNING",
  "RETRY_WAIT",
];

/**
 * Lacunas entre intervalos sincronizados NÃO adjacentes (Fase 4, item 2) —
 * nunca entre o mais antigo sincronizado e a suposta "primeira venda", já
 * que essa fronteira pode simplesmente não ter sido alcançada pelo backfill
 * ainda (não é uma lacuna real, é histórico por buscar).
 */
function findGaps(
  intervals: BackfillStatusDto["synchronizedIntervals"],
): Array<{ from: string; to: string }> {
  const gaps: Array<{ from: string; to: string }> = [];
  for (let i = 1; i < intervals.length; i += 1) {
    gaps.push({ from: intervals[i - 1].to, to: intervals[i].from });
  }
  return gaps;
}

function formatDateTime(value: string | null): string {
  const formatted = formatDateTimeSaoPaulo(value);
  return formatted ? formatted.replace(", ", " às ") : "—";
}

/**
 * Texto de status em voz ATIVA (Fase 4, "clareza de status") — nunca afirma
 * "processando"/"segundo plano" quando `workerEnabled` é `false`: aí o job
 * fica `QUEUED` indefinidamente porque nenhum worker vai reivindicá-lo.
 */
function describeJobStatus(
  jobStatus: BackfillJobStatusValue,
  workerEnabled: boolean,
): string {
  if (jobStatus === "QUEUED") {
    return workerEnabled
      ? "Na fila — o histórico será processado em segundo plano."
      : "Aguardando — o processamento do histórico está desativado neste ambiente.";
  }
  if (jobStatus === "RUNNING") {
    return "Processando histórico em segundo plano.";
  }
  if (jobStatus === "PAUSED") {
    return "Histórico pausado.";
  }
  return JOB_STATUS_LABELS[jobStatus];
}

export function BackfillAccountPanel({
  label,
  status,
  loadError,
  actionPending,
  disabled,
  errorMessage,
  onStart,
  onPause,
  onResume,
}: BackfillAccountPanelProps) {
  const job = status?.job ?? null;
  const jobIsActive = job !== null && ACTIVE_JOB_STATUSES.includes(job.status);
  const jobIsResumable =
    job !== null && (job.status === "PAUSED" || job.status === "FAILED");
  const buttonsDisabled = disabled || actionPending;

  return (
    <div
      data-testid={`backfill-panel-${label}`}
      className="flex flex-col gap-2 rounded-lg border border-border-subtle p-4 text-sm"
    >
      <p className="font-medium">{label}</p>

      {loadError ? (
        <p className="text-red-700">
          Não foi possível carregar o status do histórico desta conta.
        </p>
      ) : !status ? (
        <p className="text-foreground/60">Carregando status do histórico...</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-foreground/70">
            <dt>Primeira venda registrada</dt>
            <dd>
              {status.firstOrderAt
                ? formatCalendarDate(status.firstOrderAt)
                : "—"}
            </dd>
            <dt>Última venda registrada</dt>
            <dd>
              {status.lastOrderAt ? formatCalendarDate(status.lastOrderAt) : "—"}
            </dd>
            <dt>Período já consultado</dt>
            <dd>
              {status.synchronizedIntervals.length > 0
                ? describeIntervals(status.synchronizedIntervals)
                : "nenhum ainda"}
            </dd>
            {findGaps(status.synchronizedIntervals).length > 0 ? (
              <>
                <dt>Lacunas encontradas</dt>
                <dd>{describeIntervals(findGaps(status.synchronizedIntervals))}</dd>
              </>
            ) : null}

            {job ? (
              <>
                <dt>Status do histórico</dt>
                <dd className={JOB_STATUS_COLORS[job.status]}>
                  {describeJobStatus(job.status, status.workerEnabled)}
                  {job.pauseRequested && job.status === "RUNNING"
                    ? " (pausando...)"
                    : ""}
                </dd>
                <dt>Blocos processados</dt>
                <dd>{job.chunksProcessed}</dd>
                <dt>Última atividade</dt>
                <dd>{formatDateTime(job.lastActivityAt)}</dd>
                {job.status === "RETRY_WAIT" ? (
                  <>
                    <dt>Próxima tentativa</dt>
                    <dd>{formatDateTime(job.nextAttemptAt)}</dd>
                  </>
                ) : null}
              </>
            ) : null}
          </dl>

          <p className="text-xs text-foreground/50">
            Inclui períodos consultados com sucesso, mesmo quando nenhuma
            venda foi encontrada.
          </p>

          {status.status === "NOT_STARTED" ? (
            <p className="text-xs text-foreground/60">
              Sincronize esta conta pelo menos uma vez (&quot;Sincronizar
              agora&quot;) antes de completar o histórico.
            </p>
          ) : null}

          {job?.status === "SAFETY_LIMIT_REACHED" ? (
            <p className="text-xs text-foreground/60">
              Histórico completo dentro do limite de segurança do sistema —
              isso não confirma que{" "}
              {status.oldestCoveredAt
                ? formatCalendarDate(status.oldestCoveredAt)
                : "esta data"}{" "}
              seja o início real do histórico desta conta.
            </p>
          ) : null}

          {job?.status === "FAILED" && job.lastErrorCode ? (
            <p role="alert" className="text-xs text-red-700">
              {BACKFILL_ERROR_MESSAGES[job.lastErrorCode] ??
                "Não foi possível continuar o histórico agora."}
            </p>
          ) : null}

          {errorMessage ? (
            <p role="alert" className="text-xs text-red-700">
              {errorMessage}
            </p>
          ) : null}

          <div className="mt-1 flex flex-wrap gap-2">
            {job === null || job.status === "FAILED" ? (
              <button
                type="button"
                onClick={onStart}
                disabled={
                  buttonsDisabled ||
                  status.status === "NOT_STARTED"
                }
                className="self-start rounded-md border border-border-subtle px-3 py-1.5 text-sm font-medium hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {job?.status === "FAILED"
                  ? "Tentar novamente"
                  : "Completar histórico"}
              </button>
            ) : null}

            {jobIsActive && job !== null && !job.pauseRequested ? (
              <button
                type="button"
                onClick={onPause}
                disabled={buttonsDisabled}
                className="self-start rounded-md border border-border-subtle px-3 py-1.5 text-sm font-medium hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Pausar
              </button>
            ) : null}

            {jobIsResumable ? (
              <button
                type="button"
                onClick={onResume}
                disabled={buttonsDisabled}
                className="self-start rounded-md border border-brand bg-brand/10 px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Continuar
              </button>
            ) : null}
          </div>

          {jobIsActive && status.workerEnabled ? (
            <p className="text-xs text-foreground/50" role="status">
              Processando em segundo plano no servidor — pode fechar esta
              página, o histórico continua.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
