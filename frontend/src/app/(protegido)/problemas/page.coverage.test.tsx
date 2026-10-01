import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProblemasPage from "./page";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  ML1_ID,
  ML2_ID,
  callsTo,
  coverageAccount,
  installApi,
  syncStatus,
  uuidPattern,
  type SetupOptions,
} from "./problems-test-utils";

jest.mock("../../../lib/api", () => {
  const actual = jest.requireActual("../../../lib/api");
  return { ...actual, apiFetch: jest.fn(), fetchMarketplaceAccounts: jest.fn() };
});
jest.mock("../../../hooks/useCurrentUser", () => ({
  useCurrentUser: jest.fn(),
  hasPermission: jest.requireActual("../../../hooks/useCurrentUser").hasPermission,
}));

const api = jest.requireMock("../../../lib/api") as { apiFetch: jest.Mock; fetchMarketplaceAccounts: jest.Mock };

const setup = (options: SetupOptions = {}) =>
  installApi({ ...api, useCurrentUser: useCurrentUser as jest.Mock }, options);

async function openCoverage() {
  const user = userEvent.setup();
  render(<ProblemasPage />);
  await user.click(await screen.findByRole("tab", { name: "Cobertura" }));
  return user;
}

beforeEach(() => jest.clearAllMocks());

describe("/problemas — Cobertura", () => {
  it("mostra todos os campos da conta, explica a direção do histórico e a quarentena sem IDs", async () => {
    setup();
    await openCoverage();
    const card = await screen.findByRole("article", { name: "Cobertura de ML1" });
    for (const label of [
      "Status incremental",
      "Coberto incrementalmente até",
      "Histórico coberto desde",
      "Alvo histórico",
      "Concluído em",
      "Última atividade",
      "Último erro incremental",
      "Último erro histórico",
    ]) {
      expect(within(card).getByText(label)).toBeInTheDocument();
    }
    expect(within(card).getByText("O histórico está sendo buscado do período mais recente para o mais antigo.")).toBeInTheDocument();
    expect(within(card).getByText("Reclamações temporariamente inacessíveis ao sistema.")).toBeInTheDocument();
    expect(within(card).getByText("Em andamento")).toBeInTheDocument();
    expect(within(card).getByText("Parcial")).toBeInTheDocument(); // histórico incompleto + quarentena
    // Datas em America/Sao_Paulo (12:00 UTC = 09:00 em SP).
    expect(within(card).getByText("15/09/2026, 09:00")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(uuidPattern);
  });

  it("barra de progresso só com início e alvo válidos; sem datas não inventa porcentagem", async () => {
    setup({
      coverage: [
        coverageAccount(),
        coverageAccount({
          accountId: ML2_ID,
          accountNickname: "ML2",
          historicalTargetFrom: null,
          historicalStatus: "NO_TARGET",
          quarantinedClaimsCount: 0,
        }),
      ],
    });
    await openCoverage();
    const ml1 = await screen.findByRole("article", { name: "Cobertura de ML1" });
    const bar = within(ml1).getByRole("progressbar");
    // (15/09 − 01/06) / (15/09 − 01/03) ≈ 53%.
    expect(Number(bar.getAttribute("aria-valuenow"))).toBeGreaterThan(50);
    expect(Number(bar.getAttribute("aria-valuenow"))).toBeLessThan(70);

    const ml2 = screen.getByRole("article", { name: "Cobertura de ML2" });
    expect(within(ml2).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(within(ml2).getByText("Sem alvo")).toBeInTheDocument();
    expect(within(ml2).queryByText("Parcial")).not.toBeInTheDocument();
  });

  it("badges COMPLETE / PAUSED / FAILED (Completo, Pausado, Erro)", async () => {
    setup({
      coverage: [
        coverageAccount({ historicalStatus: "COMPLETED", historicalCompletedAt: "2026-09-01T12:00:00.000Z", quarantinedClaimsCount: 0 }),
        coverageAccount({ accountId: ML2_ID, accountNickname: "ML2", historicalStatus: "PAUSED", quarantinedClaimsCount: 0 }),
        coverageAccount({
          accountId: "66666666-6666-4666-8666-666666666666",
          accountNickname: "ML3",
          historicalStatus: "FAILED",
          historicalLastErrorCode: "SAFETY_LIMIT_REACHED",
          quarantinedClaimsCount: 0,
        }),
      ],
    });
    await openCoverage();
    const ok = await screen.findByRole("article", { name: "Cobertura de ML1" });
    expect(within(ok).getByText("Completo")).toBeInTheDocument();
    expect(within(ok).queryByText("Parcial")).not.toBeInTheDocument();
    expect(within(ok).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(within(screen.getByRole("article", { name: "Cobertura de ML2" })).getByText("Pausado")).toBeInTheDocument();
    const failed = screen.getByRole("article", { name: "Cobertura de ML3" });
    expect(within(failed).getByText("Erro")).toBeInTheDocument();
    expect(within(failed).getByText("Volume acima do limite de segurança")).toBeInTheDocument();
  });

  it("sem problems.sync: nenhum botão de controle (nem desabilitado) e nenhuma consulta de status", async () => {
    const calls = setup();
    await openCoverage();
    const card = await screen.findByRole("article", { name: "Cobertura de ML1" });
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
    expect(callsTo(calls, "/problems/sync/status")).toHaveLength(0);
  });

  it("com problems.sync: histórico Pausar chama o endpoint histórico correto após confirmação", async () => {
    const calls = setup({ permissions: ["problems.view", "problems.sync"] });
    const user = await openCoverage();
    const card = await screen.findByRole("article", { name: "Cobertura de ML1" });
    await user.click(await within(card).findByRole("button", { name: "Pausar histórico de ML1" }));

    // Antes de confirmar nada é enviado.
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(/Pausar a busca do histórico de ML1/);
    await user.click(within(dialog).getByRole("button", { name: "Confirmar" }));

    await waitFor(() =>
      expect(calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual([
        `/problems/sync/accounts/${ML1_ID}/historical/pause`,
      ]),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    // Atualiza o status após o sucesso (nova consulta de resumo) e nunca dispara outro endpoint.
    await waitFor(() => expect(callsTo(calls, "/problems/summary").length).toBeGreaterThan(1));
  });

  it("histórico pausado oferece Retomar; cancelar não envia nada", async () => {
    const calls = setup({
      permissions: ["problems.view", "problems.sync"],
      coverage: [coverageAccount({ historicalStatus: "PAUSED" })],
      statuses: [syncStatus({ historicalStatus: "PAUSED" })],
    });
    const user = await openCoverage();
    const card = await screen.findByRole("article", { name: "Cobertura de ML1" });
    await user.click(await within(card).findByRole("button", { name: "Retomar histórico de ML1" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    await user.click(within(card).getByRole("button", { name: "Retomar histórico de ML1" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Confirmar" }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === "POST")?.path).toBe(`/problems/sync/accounts/${ML1_ID}/historical/resume`),
    );
  });

  it("controle incremental existente: Pausar sincronização usa /pause", async () => {
    const calls = setup({ permissions: ["problems.view", "problems.sync"] });
    const user = await openCoverage();
    const card = await screen.findByRole("article", { name: "Cobertura de ML1" });
    await user.click(await within(card).findByRole("button", { name: "Pausar sincronização de ML1" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Confirmar" }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === "POST")?.path).toBe(`/problems/sync/accounts/${ML1_ID}/pause`),
    );
  });

  it("botão fica bloqueado durante a requisição (sem duplo envio)", async () => {
    const calls = setup({ permissions: ["problems.view", "problems.sync"] });
    const original = api.apiFetch.getMockImplementation()!;
    let release: () => void = () => undefined;
    api.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") await new Promise<void>((resolve) => (release = resolve));
      return original(path, init);
    });
    const user = await openCoverage();
    const card = await screen.findByRole("article", { name: "Cobertura de ML1" });
    await user.click(await within(card).findByRole("button", { name: "Pausar histórico de ML1" }));
    const confirm = within(screen.getByRole("alertdialog")).getByRole("button", { name: "Confirmar" });
    await user.click(confirm);
    await waitFor(() => expect(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Aguarde..." })).toBeDisabled());
    expect(within(card).getByRole("button", { name: "Pausar histórico de ML1" })).toBeDisabled();
    release();
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(1));
  });

  it("falha de API na cobertura: mensagem segura e tentar novamente", async () => {
    setup();
    const original = api.apiFetch.getMockImplementation()!;
    let fail = true;
    api.apiFetch.mockImplementation(async (path: string, init?: RequestInit) =>
      path.startsWith("/problems/summary") && fail ? { ok: false, status: 500, json: async () => ({}), headers: { get: () => null } } : original(path, init),
    );
    const user = await openCoverage();
    expect(await screen.findByText("Não foi possível carregar o resumo agora.")).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByRole("article", { name: "Cobertura de ML1" })).toBeInTheDocument();
  });
});
