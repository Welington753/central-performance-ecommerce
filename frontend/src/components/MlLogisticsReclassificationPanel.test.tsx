import { render, screen } from "@testing-library/react";
import { MlLogisticsReclassificationPanel } from "./MlLogisticsReclassificationPanel";
import type { MlLogisticsReclassificationAccountStatusDto } from "@/types/ml-logistics-reclassification";

function status(
  overrides: Partial<MlLogisticsReclassificationAccountStatusDto> = {},
): MlLogisticsReclassificationAccountStatusDto {
  return {
    accountId: "ml-1",
    nickname: "Meli 1",
    status: "IDLE",
    initialUnknownCount: 0,
    remainingUnknownCount: 0,
    resolvedFullCount: 0,
    resolvedNotFullCount: 0,
    callsMadeCount: 0,
    lastActivityAt: null,
    nextAttemptAt: null,
    lastErrorCode: null,
    pauseRequested: false,
    workerEnabled: true,
    ...overrides,
  };
}

const NOOP = () => {};

describe("MlLogisticsReclassificationPanel", () => {
  it("disables Iniciar when there is nothing left to process (remainingUnknownCount = 0)", () => {
    render(
      <MlLogisticsReclassificationPanel
        label="Meli 1"
        status={status({ status: "IDLE", remainingUnknownCount: 0 })}
        loadError={false}
        actionPending={false}
        disabled={false}
        errorMessage={null}
        onStart={NOOP}
        onPause={NOOP}
        onResume={NOOP}
      />,
    );
    expect(screen.getByRole("button", { name: "Iniciar" })).toBeDisabled();
  });

  it("re-enables the retry action on a COMPLETED account when new UNKNOWN orders appeared", () => {
    render(
      <MlLogisticsReclassificationPanel
        label="Meli 1"
        status={status({ status: "COMPLETED", remainingUnknownCount: 5 })}
        loadError={false}
        actionPending={false}
        disabled={false}
        errorMessage={null}
        onStart={NOOP}
        onPause={NOOP}
        onResume={NOOP}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Tentar pendências novamente" }),
    ).toBeEnabled();
  });

  it('item 1 (fechamento pré-commit): COMPLETED with remainingUnknownCount > 0 shows "Concluído com pendências", never plain "Concluído"', () => {
    render(
      <MlLogisticsReclassificationPanel
        label="Meli 1"
        status={status({ status: "COMPLETED", remainingUnknownCount: 3 })}
        loadError={false}
        actionPending={false}
        disabled={false}
        errorMessage={null}
        onStart={NOOP}
        onPause={NOOP}
        onResume={NOOP}
      />,
    );
    expect(screen.getByText("Concluído com pendências")).toBeInTheDocument();
    expect(screen.queryByText("Concluído")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Tentar pendências novamente" }),
    ).toBeInTheDocument();
  });

  it('item 1: COMPLETED with remainingUnknownCount = 0 shows plain "Concluído" and disables the action', () => {
    render(
      <MlLogisticsReclassificationPanel
        label="Meli 1"
        status={status({ status: "COMPLETED", remainingUnknownCount: 0 })}
        loadError={false}
        actionPending={false}
        disabled={false}
        errorMessage={null}
        onStart={NOOP}
        onPause={NOOP}
        onResume={NOOP}
      />,
    );
    expect(screen.getByText("Concluído")).toBeInTheDocument();
    expect(
      screen.queryByText("Concluído com pendências"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar" })).toBeDisabled();
  });

  it("shows nextAttemptAt only while WAITING_RETRY", () => {
    render(
      <MlLogisticsReclassificationPanel
        label="Meli 1"
        status={status({
          status: "WAITING_RETRY",
          nextAttemptAt: "2026-09-01T12:00:00.000Z",
        })}
        loadError={false}
        actionPending={false}
        disabled={false}
        errorMessage={null}
        onStart={NOOP}
        onPause={NOOP}
        onResume={NOOP}
      />,
    );
    expect(screen.getByText("Próxima tentativa")).toBeInTheDocument();
  });

  it("never shows nextAttemptAt outside WAITING_RETRY", () => {
    render(
      <MlLogisticsReclassificationPanel
        label="Meli 1"
        status={status({ status: "RUNNING" })}
        loadError={false}
        actionPending={false}
        disabled={false}
        errorMessage={null}
        onStart={NOOP}
        onPause={NOOP}
        onResume={NOOP}
      />,
    );
    expect(screen.queryByText("Próxima tentativa")).not.toBeInTheDocument();
  });

  it("never claims background processing when the worker is disabled", () => {
    render(
      <MlLogisticsReclassificationPanel
        label="Meli 1"
        status={status({ status: "RUNNING", workerEnabled: false })}
        loadError={false}
        actionPending={false}
        disabled={false}
        errorMessage={null}
        onStart={NOOP}
        onPause={NOOP}
        onResume={NOOP}
      />,
    );
    expect(
      screen.queryByText(/pode hibernar por inatividade/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/processamento está desativado neste ambiente/i),
    ).toBeInTheDocument();
    // Nunca afirma "corrigindo"/"processando" — item 6, revisão crítica.
    expect(screen.queryByText("Corrigindo histórico...")).not.toBeInTheDocument();
  });

  it('item 6 (revisão crítica): disables "Iniciar" when workerEnabled is false, even with UNKNOWN pending', () => {
    render(
      <MlLogisticsReclassificationPanel
        label="Meli 1"
        status={status({
          status: "IDLE",
          workerEnabled: false,
          remainingUnknownCount: 10,
        })}
        loadError={false}
        actionPending={false}
        disabled={false}
        errorMessage={null}
        onStart={NOOP}
        onPause={NOOP}
        onResume={NOOP}
      />,
    );
    expect(screen.getByRole("button", { name: "Iniciar" })).toBeDisabled();
  });

  it('item 6: disables "Retomar" when workerEnabled is false', () => {
    render(
      <MlLogisticsReclassificationPanel
        label="Meli 1"
        status={status({ status: "PAUSED", workerEnabled: false })}
        loadError={false}
        actionPending={false}
        disabled={false}
        errorMessage={null}
        onStart={NOOP}
        onPause={NOOP}
        onResume={NOOP}
      />,
    );
    expect(screen.getByRole("button", { name: "Retomar" })).toBeDisabled();
  });

  it('item 6: "Pausar" is never disabled by workerEnabled = false — pausing is always safe', () => {
    render(
      <MlLogisticsReclassificationPanel
        label="Meli 1"
        status={status({
          status: "RUNNING",
          workerEnabled: false,
          pauseRequested: false,
        })}
        loadError={false}
        actionPending={false}
        disabled={false}
        errorMessage={null}
        onStart={NOOP}
        onPause={NOOP}
        onResume={NOOP}
      />,
    );
    expect(screen.getByRole("button", { name: "Pausar" })).toBeEnabled();
  });

  it('item 6: buttons stay enabled when workerEnabled is true', () => {
    render(
      <MlLogisticsReclassificationPanel
        label="Meli 1"
        status={status({
          status: "IDLE",
          workerEnabled: true,
          remainingUnknownCount: 10,
        })}
        loadError={false}
        actionPending={false}
        disabled={false}
        errorMessage={null}
        onStart={NOOP}
        onPause={NOOP}
        onResume={NOOP}
      />,
    );
    expect(screen.getByRole("button", { name: "Iniciar" })).toBeEnabled();
  });

  it("explains the Render free-tier sleep/resume behavior only while actually running with the worker enabled", () => {
    render(
      <MlLogisticsReclassificationPanel
        label="Meli 1"
        status={status({ status: "RUNNING", workerEnabled: true })}
        loadError={false}
        actionPending={false}
        disabled={false}
        errorMessage={null}
        onStart={NOOP}
        onPause={NOOP}
        onResume={NOOP}
      />,
    );
    expect(
      screen.getByText(/pode hibernar por inatividade/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/progresso já salvo é retomado automaticamente/i),
    ).toBeInTheDocument();
  });

  it("shows the load error message when loadError is true", () => {
    render(
      <MlLogisticsReclassificationPanel
        label="Meli 1"
        status={null}
        loadError={true}
        actionPending={false}
        disabled={false}
        errorMessage={null}
        onStart={NOOP}
        onPause={NOOP}
        onResume={NOOP}
      />,
    );
    expect(
      screen.getByText(/não foi possível carregar o status/i),
    ).toBeInTheDocument();
  });
});
