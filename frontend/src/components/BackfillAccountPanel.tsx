import { describeIntervals } from "./DataCoverageBanner";
import { formatCalendarDate } from "@/lib/kpi-format";
import type { BackfillStatusDto } from "@/types/marketplace-backfill";

export interface BackfillProgress {
  chunksProcessed: number;
  oldestReached: string | null;
}

interface BackfillAccountPanelProps {
  label: string;
  status: BackfillStatusDto | null;
  loadError: boolean;
  progress: BackfillProgress | null;
  isRunning: boolean;
  disabled: boolean;
  errorMessage: string | null;
  onStart: () => void;
}

const STATUS_LABELS: Record<BackfillStatusDto["status"], string> = {
  NOT_STARTED: "Não iniciado",
  IN_PROGRESS: "Parcial",
  SAFETY_LIMIT_REACHED: "Concluído (limite de segurança)",
  ERROR: "Erro",
};

const STATUS_COLORS: Record<BackfillStatusDto["status"], string> = {
  NOT_STARTED: "text-foreground/60",
  IN_PROGRESS: "text-amber-700",
  SAFETY_LIMIT_REACHED: "text-green-700",
  ERROR: "text-red-700",
};

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

function actionLabel(status: BackfillStatusDto): string {
  if (status.status === "ERROR") return "Tentar novamente";
  if (status.lastProcessedChunk === null) return "Completar histórico";
  return "Continuar histórico";
}

export function BackfillAccountPanel({
  label,
  status,
  loadError,
  progress,
  isRunning,
  disabled,
  errorMessage,
  onStart,
}: BackfillAccountPanelProps) {
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
            <dt>Intervalos sincronizados</dt>
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
            <dt>Último bloco histórico processado</dt>
            <dd>
              {status.lastProcessedChunk
                ? `${formatCalendarDate(status.lastProcessedChunk.from)} a ${formatCalendarDate(status.lastProcessedChunk.to)} (${status.lastProcessedChunk.ordersFetched} pedido(s))`
                : "nenhum ainda"}
            </dd>
            <dt>Status</dt>
            <dd className={STATUS_COLORS[status.status]}>
              {STATUS_LABELS[status.status]}
            </dd>
          </dl>

          {status.status === "NOT_STARTED" ? (
            <p className="text-xs text-foreground/60">
              Sincronize esta conta pelo menos uma vez (&quot;Sincronizar
              agora&quot;) antes de completar o histórico.
            </p>
          ) : null}

          {status.status === "SAFETY_LIMIT_REACHED" ? (
            <p className="text-xs text-foreground/60">
              Histórico completo dentro do limite de segurança do sistema —
              isto não é uma confirmação de que{" "}
              {status.oldestCoveredAt
                ? formatCalendarDate(status.oldestCoveredAt)
                : "esta data"}{" "}
              é o início real do histórico desta conta no Mercado Livre.
            </p>
          ) : null}

          {isRunning && progress ? (
            <p className="text-xs text-foreground/60" role="status">
              Buscando histórico — {progress.chunksProcessed} bloco(s)
              processado(s)
              {progress.oldestReached
                ? `, período mais antigo alcançado: ${formatCalendarDate(progress.oldestReached)}`
                : ""}
              .
            </p>
          ) : null}

          {errorMessage ? (
            <p role="alert" className="text-xs text-red-700">
              {errorMessage}
            </p>
          ) : null}

          {status.status !== "SAFETY_LIMIT_REACHED" &&
          status.status !== "NOT_STARTED" ? (
            <button
              type="button"
              onClick={onStart}
              disabled={disabled || isRunning}
              className="mt-1 self-start rounded-md border border-border-subtle px-3 py-1.5 text-sm font-medium hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRunning ? "Buscando histórico..." : actionLabel(status)}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
