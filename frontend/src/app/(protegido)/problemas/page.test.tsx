import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProblemasPage from "./page";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { PROBLEMS_COVERAGE_TEXT } from "@/components/problems/ProblemsCoverageBanner";
import { WORKER_DISABLED_TEXT } from "@/components/problems/ProblemsSyncPanel";
import type { PermissionKey } from "@/types/users";
import type {
  ProblemDetailDto,
  ProblemsPageDto,
  ProblemsSummaryDto,
  ProblemsSyncStatusDto,
} from "@/types/problems";

// Caminho relativo real (não o alias `@/*`) — mesma ressalva dos demais testes de página.
jest.mock("../../../lib/api", () => {
  const actual = jest.requireActual("../../../lib/api");
  return { ...actual, apiFetch: jest.fn(), fetchMarketplaceAccounts: jest.fn() };
});
jest.mock("../../../hooks/useCurrentUser", () => ({
  useCurrentUser: jest.fn(),
  hasPermission: jest.requireActual("../../../hooks/useCurrentUser").hasPermission,
}));

const api = jest.requireMock("../../../lib/api") as {
  apiFetch: jest.Mock;
  fetchMarketplaceAccounts: jest.Mock;
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: () => null },
  } as unknown as Response;
}

const SUMMARY: ProblemsSummaryDto = {
  total: 4,
  open: 3,
  resolved: 1,
  reputationAffected: 1,
  pendingAction: 2,
  overdueAction: 1,
  unknownResponsibility: 3,
  byResponsibility: [
    { responsibility: "UNKNOWN", count: 3 },
    { responsibility: "SELLER", count: 1 },
  ],
  topReasons: [{ reasonId: "R1", name: "Produto não recebido", count: 3 }],
  coverage: [
    {
      accountId: "acc-1",
      accountNickname: "Conta A",
      marketplace: "MERCADO_LIVRE",
      problemsTotal: 4,
      problemsOpen: 3,
      jobStatus: "NOT_STARTED",
      windowCursorAt: null,
      lastCompleteCensusAt: null,
    },
  ],
};

const LIST: ProblemsPageDto = {
  items: [
    {
      id: "prob-1",
      marketplace: "MERCADO_LIVRE",
      accountId: "acc-1",
      accountNickname: "Conta A",
      orderExternalId: "ORD-A1",
      status: "opened",
      stage: "claim",
      type: "mediations",
      reasonId: "R1",
      reasonName: "Produto não recebido",
      dateCreated: "2026-05-10T15:00:00.000Z",
      lastUpdated: "2026-05-11T15:00:00.000Z",
      resolutionDate: null,
      reputationImpact: "affected",
      nextActionCode: "send_proof",
      nextActionDueDate: "2026-05-12T15:00:00.000Z",
      pendingActionsCount: 1,
      responsibility: "UNKNOWN",
      responsibilityConfidence: "NONE",
    },
    {
      id: "prob-2",
      marketplace: "MERCADO_LIVRE",
      accountId: "acc-1",
      accountNickname: "Conta A",
      orderExternalId: null,
      status: "closed",
      stage: "dispute",
      type: "returns",
      reasonId: null,
      reasonName: null,
      dateCreated: "2026-05-20T15:00:00.000Z",
      lastUpdated: "2026-05-21T15:00:00.000Z",
      resolutionDate: "2026-05-21T15:00:00.000Z",
      reputationImpact: "not_affected",
      nextActionCode: null,
      nextActionDueDate: null,
      pendingActionsCount: 0,
      responsibility: "SELLER",
      responsibilityConfidence: "MANUAL",
    },
  ],
  page: 1,
  pageSize: 25,
  total: 40,
  totalPages: 2,
};

const DETAIL: ProblemDetailDto = {
  ...LIST.items[0],
  externalClaimId: "5001234567",
  reasonFlow: "mediations",
  reasonDetail: null,
  detailTitle: "Título do problema",
  detailProblem: null,
  detailResponsible: null,
  detailDueDate: null,
  reputationHasIncentive: null,
  reputationDueDate: null,
  resolutionReason: null,
  resolutionClosedBy: null,
  lastCheckedAt: null,
  actions: [
    { playerRole: "respondent", actionCode: "send_proof", mandatory: true, dueDate: "2026-05-12T15:00:00.000Z" },
  ],
  order: { externalOrderId: "ORD-A1", status: "paid" },
  responsibilitySource: null,
  responsibilityOverriddenAt: null,
  responsibilityOverrideReason: null,
};

function syncStatus(overrides: Partial<ProblemsSyncStatusDto> = {}): ProblemsSyncStatusDto {
  return {
    accountId: "acc-1",
    accountNickname: "Conta A",
    jobStatus: "NOT_STARTED",
    windowCursorAt: null,
    lastCompleteCensusAt: null,
    lastActivityAt: null,
    nextAttemptAt: null,
    attemptCount: 0,
    lastErrorCode: null,
    pauseRequested: false,
    claimsProcessedCount: 0,
    workerEnabled: false,
    ...overrides,
  };
}

interface Options {
  permissions?: PermissionKey[];
  list?: ProblemsPageDto | Error;
  sync?: ProblemsSyncStatusDto[];
}

function setup(options: Options = {}) {
  const calls: Array<{ path: string; method: string; body?: string }> = [];
  (useCurrentUser as jest.Mock).mockReturnValue({
    user: {
      id: "u1",
      name: "Ana",
      email: "ana@example.com",
      isAdmin: false,
      role: "ANALYST",
      permissions: options.permissions ?? ["problems.view"],
      accountScope: { mode: "ALL" },
      mustChangePassword: false,
    },
    isLoading: false,
    status: "ready",
  });
  api.fetchMarketplaceAccounts.mockResolvedValue([
    { id: "acc-1", marketplace: "MERCADO_LIVRE", nickname: "Conta A" },
    { id: "acc-shopee", marketplace: "SHOPEE", nickname: "Loja Shopee" },
  ]);
  let syncList = options.sync ?? [syncStatus()];
  api.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ path, method, body: init?.body as string | undefined });
    if (path.startsWith("/problems/summary")) return jsonResponse(SUMMARY);
    if (path.startsWith("/problems/reasons")) {
      return jsonResponse([{ reasonId: "R1", name: "Produto não recebido", count: 3 }]);
    }
    if (path.startsWith("/problems/sync/status")) return jsonResponse(syncList);
    const syncAction = /^\/problems\/sync\/accounts\/([^/]+)\/(start|pause|resume)$/.exec(path);
    if (syncAction) {
      const next = syncStatus({
        jobStatus: syncAction[2] === "pause" ? "PAUSED" : "RUNNING",
      });
      syncList = [next];
      return jsonResponse(next);
    }
    if (/^\/problems\/prob-1\/responsibility$/.test(path)) {
      const body = JSON.parse(init?.body as string) as { responsibility: "SELLER" };
      return jsonResponse({
        ...DETAIL,
        responsibility: body.responsibility,
        responsibilityConfidence: "MANUAL",
        responsibilityOverriddenAt: "2026-06-01T12:00:00.000Z",
        responsibilityOverrideReason: "Cliente devolveu errado",
      });
    }
    if (/^\/problems\/prob-1$/.test(path)) return jsonResponse(DETAIL);
    if (path.startsWith("/problems")) {
      if (options.list instanceof Error) return jsonResponse({}, 500);
      return jsonResponse(options.list ?? LIST);
    }
    return jsonResponse({}, 404);
  });
  return calls;
}

const listCalls = (calls: ReturnType<typeof setup>) =>
  calls.filter((c) => /^\/problems\?/.test(c.path) || c.path === "/problems");

beforeEach(() => jest.clearAllMocks());

describe("/problemas", () => {
  it("sem problems.view: mostra aviso de permissão e nunca consulta a API", async () => {
    const calls = setup({ permissions: [] });
    render(<ProblemasPage />);
    expect(await screen.findByText("Você não tem permissão para ver os problemas.")).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it("mostra banner de cobertura honesto, cards do resumo, filtros e tabela com as 8 colunas", async () => {
    setup();
    render(<ProblemasPage />);

    expect(await screen.findByText(PROBLEMS_COVERAGE_TEXT)).toBeInTheDocument();
    expect(PROBLEMS_COVERAGE_TEXT).toBe(
      "Cobertura inicial: últimos 60 dias e todos os problemas atualmente abertos. O histórico encerrado anterior a esse período ainda não foi processado.",
    );
    const cards = await screen.findByRole("region", { name: "Resumo de problemas" });
    for (const label of [
      "Total de problemas",
      "Abertos",
      "Resolvidos",
      "Impacto na reputação",
      "Ação pendente",
      "Ação vencida",
      "Responsabilidade desconhecida",
    ]) {
      expect(within(cards).getByText(label)).toBeInTheDocument();
    }
    expect(within(cards).getByText("Por responsabilidade")).toBeInTheDocument();
    expect(within(cards).getByText("Cobertura por conta")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Filtros de problemas" })).toBeInTheDocument();

    const table = await screen.findByRole("table");
    for (const header of ["Data", "Marketplace / conta", "Pedido", "Status / etapa", "Motivo", "Reputação", "Próxima ação / prazo", "Responsabilidade"]) {
      expect(within(table).getByRole("columnheader", { name: new RegExp(header) })).toBeInTheDocument();
    }
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1]).getByText("ORD-A1")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Enviar comprovante")).toBeInTheDocument();
    expect(within(rows[1]).getByText(/Vencida em/)).toBeInTheDocument();
    expect(within(rows[1]).getByText("Afeta a reputação")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Motivo não informado")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Sem ação pendente")).toBeInTheDocument();
    // Nenhum ID técnico (uuid/claim) na tabela.
    expect(table.textContent).not.toContain("prob-1");
    expect(table.textContent).not.toContain("acc-1");
  });

  it("filtros: aplicar envia os parâmetros e limpar volta ao estado vazio; motivos sem o próprio filtro de motivo", async () => {
    const calls = setup();
    const user = userEvent.setup();
    render(<ProblemasPage />);
    await screen.findByRole("table");

    await user.selectOptions(screen.getByLabelText("Status"), "opened");
    await user.selectOptions(screen.getByLabelText("Impacto na reputação"), "affected");
    await user.selectOptions(screen.getByLabelText("Vencimento da ação"), "overdue");
    await user.selectOptions(screen.getByLabelText("Motivo"), "R1");
    await user.click(screen.getByRole("button", { name: "Aplicar filtros" }));

    await waitFor(() => {
      const last = listCalls(calls).at(-1)!;
      const params = new URL(last.path, "http://x").searchParams;
      expect(params.get("status")).toBe("opened");
      expect(params.get("reputationImpact")).toBe("affected");
      expect(params.get("actionDue")).toBe("overdue");
      expect(params.get("reasonId")).toBe("R1");
      expect(params.get("page")).toBe("1");
    });
    const reasonCalls = calls.filter((c) => c.path.startsWith("/problems/reasons"));
    expect(new URL(reasonCalls.at(-1)!.path, "http://x").searchParams.has("reasonId")).toBe(false);
    // Só o Mercado Livre aparece como opção de conta.
    const accountSelect = screen.getByLabelText("Conta");
    expect(within(accountSelect).queryByText("Loja Shopee")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Limpar filtros" }));
    await waitFor(() => {
      const params = new URL(listCalls(calls).at(-1)!.path, "http://x").searchParams;
      expect(params.has("status")).toBe(false);
      expect(params.has("reasonId")).toBe(false);
    });
  });

  it("período invertido é bloqueado no formulário", async () => {
    setup();
    const user = userEvent.setup();
    render(<ProblemasPage />);
    await screen.findByRole("table");
    await user.type(screen.getByLabelText("Criado a partir de"), "2026-06-10");
    await user.type(screen.getByLabelText("Criado até"), "2026-06-01");
    await user.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(await screen.findByText("A data inicial não pode ser posterior à data final.")).toBeInTheDocument();
  });

  it("paginação e ordenação disparam nova consulta", async () => {
    const calls = setup();
    const user = userEvent.setup();
    render(<ProblemasPage />);
    await screen.findByRole("table");
    expect(screen.getByText(/40 problemas · página 1 de 2/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => {
      expect(new URL(listCalls(calls).at(-1)!.path, "http://x").searchParams.get("page")).toBe("2");
    });

    await user.click(screen.getByRole("button", { name: /^Data/ }));
    await waitFor(() => {
      const params = new URL(listCalls(calls).at(-1)!.path, "http://x").searchParams;
      expect(params.get("sortBy")).toBe("dateCreated");
      expect(params.get("sortDir")).toBe("asc");
      expect(params.get("page")).toBe("1");
    });
  });

  it("estado vazio, erro com tentar novamente e carregando", async () => {
    setup({ list: { ...LIST, items: [], total: 0, totalPages: 0 } });
    const { unmount } = render(<ProblemasPage />);
    expect(screen.getByText("Carregando problemas...")).toBeInTheDocument();
    expect(await screen.findByText("Nenhum problema encontrado para os filtros selecionados.")).toBeInTheDocument();
    unmount();

    const calls = setup({ list: new Error("falha") });
    const user = userEvent.setup();
    render(<ProblemasPage />);
    expect(await screen.findByText("Não foi possível carregar os problemas agora.")).toBeInTheDocument();
    const before = listCalls(calls).length;
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(listCalls(calls).length).toBeGreaterThan(before));
  });

  describe("detalhe e edição manual", () => {
    it("abre o detalhe com motivo, impacto, pedido e ações; sem problems.manage NÃO há formulário", async () => {
      setup();
      const user = userEvent.setup();
      render(<ProblemasPage />);
      await screen.findByRole("table");
      await user.click(screen.getAllByRole("button", { name: /Ver detalhes/ })[0]);

      const dialog = await screen.findByRole("dialog", { name: "Detalhes do problema" });
      expect(await within(dialog).findByText("5001234567")).toBeInTheDocument();
      expect(within(dialog).getByText("Título do problema")).toBeInTheDocument();
      expect(within(dialog).getByText(/Pedido ORD-A1/)).toBeInTheDocument();
      expect(within(dialog).getByText(/Enviar comprovante \(obrigatória\)/)).toBeInTheDocument();
      expect(within(dialog).queryByRole("form", { name: "Corrigir responsabilidade" })).not.toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Fechar" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("com problems.manage: exige motivo, envia PATCH e recarrega lista e resumo", async () => {
      const calls = setup({ permissions: ["problems.view", "problems.manage"] });
      const user = userEvent.setup();
      render(<ProblemasPage />);
      await screen.findByRole("table");
      await user.click(screen.getAllByRole("button", { name: /Ver detalhes/ })[0]);
      const form = await screen.findByRole("form", { name: "Corrigir responsabilidade" });

      await user.click(within(form).getByRole("button", { name: "Salvar correção" }));
      expect(await within(form).findByText(/Informe o motivo da alteração/)).toBeInTheDocument();
      expect(calls.some((c) => c.method === "PATCH")).toBe(false);

      const listsBefore = listCalls(calls).length;
      await user.selectOptions(within(form).getByLabelText("Responsável"), "SELLER");
      await user.type(within(form).getByLabelText("Motivo da alteração"), "Cliente devolveu errado");
      await user.click(within(form).getByRole("button", { name: "Salvar correção" }));

      await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
      const patch = calls.find((c) => c.method === "PATCH")!;
      expect(JSON.parse(patch.body!)).toEqual({ responsibility: "SELLER", reason: "Cliente devolveu errado" });
      expect(await screen.findByText(/definida manualmente/)).toBeInTheDocument();
      await waitFor(() => expect(listCalls(calls).length).toBeGreaterThan(listsBefore));
    });

    it("detalhe com erro mostra mensagem e permite tentar novamente", async () => {
      setup();
      api.apiFetch.mockImplementationOnce(async () => jsonResponse(SUMMARY)); // summary
      const user = userEvent.setup();
      render(<ProblemasPage />);
      await screen.findByRole("table");
      const original = api.apiFetch.getMockImplementation()!;
      api.apiFetch.mockImplementation(async (path: string, init?: RequestInit) =>
        path === "/problems/prob-1" ? jsonResponse({}, 500) : original(path, init),
      );
      await user.click(screen.getAllByRole("button", { name: /Ver detalhes/ })[0]);
      const dialog = await screen.findByRole("dialog");
      expect(await within(dialog).findByText("Não foi possível carregar o detalhe agora.")).toBeInTheDocument();
      api.apiFetch.mockImplementation(original);
      await user.click(within(dialog).getByRole("button", { name: "Tentar novamente" }));
      expect(await within(dialog).findByText("5001234567")).toBeInTheDocument();
    });
  });

  describe("painel de sincronização", () => {
    it("sem problems.sync: painel não existe", async () => {
      setup();
      render(<ProblemasPage />);
      await screen.findByRole("table");
      expect(screen.queryByRole("region", { name: "Sincronização de problemas" })).not.toBeInTheDocument();
    });

    it("com problems.sync e worker desabilitado: explica que o job está preparado mas não processará; start/pause/resume", async () => {
      const calls = setup({ permissions: ["problems.view", "problems.sync"] });
      const user = userEvent.setup();
      render(<ProblemasPage />);
      const panel = await screen.findByRole("region", { name: "Sincronização de problemas" });
      expect(await within(panel).findByText(WORKER_DISABLED_TEXT)).toBeInTheDocument();
      expect(within(panel).getByText("Conta A")).toBeInTheDocument();
      expect(within(panel).getByText("Não iniciada")).toBeInTheDocument();

      await user.click(within(panel).getByRole("button", { name: "Iniciar sincronização de Conta A" }));
      expect(await within(panel).findByText(/^Ativa/)).toBeInTheDocument();
      expect(calls.some((c) => c.path === "/problems/sync/accounts/acc-1/start" && c.method === "POST")).toBe(true);

      await user.click(within(panel).getByRole("button", { name: "Pausar sincronização de Conta A" }));
      expect(await within(panel).findByText(/^Pausada/)).toBeInTheDocument();
      await user.click(within(panel).getByRole("button", { name: "Retomar sincronização de Conta A" }));
      expect(await within(panel).findByText(/^Ativa/)).toBeInTheDocument();
      expect(calls.filter((c) => c.path.includes("/sync/accounts/")).map((c) => c.path.split("/").pop())).toEqual([
        "start",
        "pause",
        "resume",
      ]);
    });

    it("worker habilitado: sem o aviso; falha mostra causa em português e oferece retomar", async () => {
      setup({
        permissions: ["problems.view", "problems.sync"],
        sync: [syncStatus({ workerEnabled: true, jobStatus: "FAILED_AUTH", lastErrorCode: "TOKEN_EXPIRED" })],
      });
      render(<ProblemasPage />);
      const panel = await screen.findByRole("region", { name: "Sincronização de problemas" });
      expect(await within(panel).findByText(/^Autorização necessária/)).toBeInTheDocument();
      expect(within(panel).getByText("Autorização expirada — reconecte a conta")).toBeInTheDocument();
      expect(within(panel).getByRole("button", { name: /Retomar/ })).toBeInTheDocument();
      expect(within(panel).queryByText(WORKER_DISABLED_TEXT)).not.toBeInTheDocument();
    });
  });
});
