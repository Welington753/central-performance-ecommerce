import { formatDateTimeSaoPaulo } from "@/lib/kpi-format";
import type { MlLogisticsReclassificationAccountStatusDto } from "@/types/ml-logistics-reclassification";

interface MlLogisticsReclassificationPanelProps {
  label: string;
  status: MlLogisticsReclassificationAccountStatusDto | null;
  loadError: boolean;
  /** Ação (start/pause/resume) em voo agora — desabilita os botões desta conta. */
  actionPending: boolean;
  /** Uma ação global ("todas as contas") está em voo agora. */
  disabled: boolean;
  errorMessage: string | null;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
}

const STATUS_LABELS: Record<
  MlLogisticsReclassificationAccountStatusDto["status"],
  string
> = {
  IDLE: "Não iniciado",
  RUNNING: "Corrigindo histórico...",
  PAUSED: "Pausado",
  WAITING_RETRY: "Aguardando nova tentativa",
  COMPLETED: "Concluído",
  FAILED_AUTH: "Falha de autenticação — reconecte a conta",
};

/**
 * Texto em voz ATIVA (item 6, revisão crítica) — nunca afirma
 * "corrigindo"/"processando" quando `workerEnabled` é `false`: aí o job
 * fica preso indefinidamente porque nenhum worker vai reivindicá-lo. Mesmo
 * padrão de `describeJobStatus` em `BackfillAccountPanel`.
 *
 * Fechamento pré-commit (item 1): `COMPLETED` com `remainingUnknownCount>0`
 * nunca é "Concluído" puro — a fila processável se esgotou (itens
 * permanentemente inválidos), mas ainda há `UNKNOWN` sem resposta. Só
 * `remainingUnknownCount===0` é "Concluído" de verdade.
 */
function describeStatusLabel(
  status: MlLogisticsReclassificationAccountStatusDto,
): string {
  if (
    !status.workerEnabled &&
    (status.status === "RUNNING" || status.status === "WAITING_RETRY")
  ) {
    return "Pausado (processamento desativado neste ambiente)";
  }
  if (status.status === "COMPLETED" && status.remainingUnknownCount > 0) {
    return "Concluído com pendências";
  }
  return STATUS_LABELS[status.status];
}

const STATUS_COLORS: Record<
  MlLogisticsReclassificationAccountStatusDto["status"],
  string
> = {
  IDLE: "text-foreground/60",
  RUNNING: "text-amber-700",
  PAUSED: "text-foreground/60",
  WAITING_RETRY: "text-amber-700",
  COMPLETED: "text-green-700",
  FAILED_AUTH: "text-red-700",
};

/** Estados "ativos" para fins de polling/desabilitar Iniciar — mesma população usada pela página. */
export const ACTIVE_ML_RECLASSIFICATION_STATUSES: MlLogisticsReclassificationAccountStatusDto["status"][] =
  ["RUNNING", "WAITING_RETRY"];

function formatDateTime(value: string | null): string {
  const formatted = formatDateTimeSaoPaulo(value);
  return formatted ? formatted.replace(", ", " às ") : "—";
}

function progressPct(
  status: MlLogisticsReclassificationAccountStatusDto,
): number {
  if (status.initialUnknownCount <= 0) return 100;
  const done = status.initialUnknownCount - status.remainingUnknownCount;
  return Math.max(
    0,
    Math.min(100, Math.round((done / status.initialUnknownCount) * 100)),
  );
}

/**
 * Painel "Corrigir histórico Full do Mercado Livre" — MESMO padrão visual de
 * `BackfillAccountPanel`, mas para um fluxo INDEPENDENTE (nunca dispara
 * `syncMercadoLivreOrders`/backfill, nunca compartilha estado com eles). Um
 * painel por conta (Meli 1, Meli 2, ...).
 */
export function MlLogisticsReclassificationPanel({
  label,
  status,
  loadError,
  actionPending,
  disabled,
  errorMessage,
  onStart,
  onPause,
  onResume,
}: MlLogisticsReclassificationPanelProps) {
  const workerEnabled = status?.workerEnabled ?? true;
  // Item 6 (revisão crítica): nunca deixa o usuário clicar Iniciar/Retomar
  // sabendo que o backend vai recusar com `WORKER_DISABLED` — desabilita
  // ANTES da tentativa, com a mesma mensagem explicando o motivo. Pausar
  // nunca é afetado (sempre seguro, mesmo com o worker desligado).
  const buttonsDisabled = disabled || actionPending;
  const startOrResumeDisabled = buttonsDisabled || !workerEnabled;

  return (
    <div
      data-testid={`ml-logistics-reclassification-panel-${label}`}
      className="flex flex-col gap-2 rounded-lg border border-border-subtle p-4 text-sm"
    >
      <p className="font-medium">{label}</p>

      {loadError ? (
        <p className="text-red-700">
          Não foi possível carregar o status da correção de histórico Full
          desta conta.
        </p>
      ) : !status ? (
        <p className="text-foreground/60">Carregando status...</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-foreground/70">
            <dt>Status</dt>
            <dd className={STATUS_COLORS[status.status]}>
              {describeStatusLabel(status)}
              {status.pauseRequested && status.status === "RUNNING"
                ? " (pausando...)"
                : ""}
            </dd>
            <dt>Progresso</dt>
            <dd>{progressPct(status)}%</dd>
            <dt>UNKNOWN inicial</dt>
            <dd>{status.initialUnknownCount}</dd>
            <dt>UNKNOWN restante</dt>
            <dd>{status.remainingUnknownCount}</dd>
            <dt>Full identificados</dt>
            <dd>{status.resolvedFullCount}</dd>
            <dt>Vendas sem Full identificadas</dt>
            <dd>{status.resolvedNotFullCount}</dd>
            <dt>Última atividade</dt>
            <dd>{formatDateTime(status.lastActivityAt)}</dd>
            {status.status === "WAITING_RETRY" ? (
              <>
                <dt>Próxima tentativa</dt>
                <dd>{formatDateTime(status.nextAttemptAt)}</dd>
              </>
            ) : null}
          </dl>

          {!status.workerEnabled ? (
            <p role="status" className="text-xs text-foreground/60">
              O processamento está desativado neste ambiente — Iniciar/Retomar
              ficam indisponíveis até ser reativado.
            </p>
          ) : null}

          {status.status === "FAILED_AUTH" ? (
            <p role="alert" className="text-xs text-red-700">
              Esta conta perdeu o acesso ao Mercado Livre. Reconecte-a em
              Integrações e depois clique em &quot;Retomar&quot;.
            </p>
          ) : null}

          {errorMessage ? (
            <p role="alert" className="text-xs text-red-700">
              {errorMessage}
            </p>
          ) : null}

          <div className="mt-1 flex flex-wrap gap-2">
            {status.status === "IDLE" || status.status === "COMPLETED" ? (
              <button
                type="button"
                onClick={onStart}
                disabled={
                  startOrResumeDisabled || status.remainingUnknownCount === 0
                }
                className="self-start rounded-md border border-border-subtle px-3 py-1.5 text-sm font-medium hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status.status === "COMPLETED" &&
                status.remainingUnknownCount > 0
                  ? "Tentar pendências novamente"
                  : "Iniciar"}
              </button>
            ) : null}

            {status.status === "RUNNING" && !status.pauseRequested ? (
              <button
                type="button"
                onClick={onPause}
                disabled={buttonsDisabled}
                className="self-start rounded-md border border-border-subtle px-3 py-1.5 text-sm font-medium hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Pausar
              </button>
            ) : null}

            {status.status === "PAUSED" || status.status === "FAILED_AUTH" ? (
              <button
                type="button"
                onClick={onResume}
                disabled={startOrResumeDisabled}
                className="self-start rounded-md border border-brand bg-brand/10 px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Retomar
              </button>
            ) : null}
          </div>

          {(status.status === "RUNNING" || status.status === "WAITING_RETRY") &&
          status.workerEnabled ? (
            <p className="text-xs text-foreground/50" role="status">
              Processando em segundo plano no servidor. O plano gratuito do
              Render pode hibernar por inatividade se esta página ficar
              fechada — o progresso já salvo é retomado automaticamente
              quando o serviço acordar. Manter esta página aberta ajuda o
              serviço a continuar ativo.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
