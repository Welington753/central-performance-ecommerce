import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProblemasPage from "./page";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  REASONS,
  callsTo,
  jsonResponse,
  installApi,
  monthlyItem,
  MONTHLY_ITEMS,
  paramsOf,
  uuidPattern,
  type SetupOptions,
} from "./problems-test-utils";

// Caminho relativo real (não o alias `@/*`) — mesma ressalva dos demais testes de página.
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

/** Congela só o relógio (`Date`): 15/09/2026 — os timers reais seguem funcionando. */
const REAL_TIMERS = [
  "setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate",
  "nextTick", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame",
  "requestIdleCallback", "cancelIdleCallback", "performance", "hrtime",
] as const;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date("2026-09-15T12:00:00.000Z"), doNotFake: [...REAL_TIMERS] });
});
afterEach(() => jest.useRealTimers());

const cards = () => screen.findByRole("region", { name: "Resumo do período" });

describe("/problemas — estrutura, período e permissões", () => {
  it("sem problems.view: aviso de permissão e nenhuma chamada à API", async () => {
    const calls = setup({ permissions: [] });
    render(<ProblemasPage />);
    expect(await screen.findByText("Você não tem permissão para ver os problemas.")).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it("tem as 4 abas e remove o banner fixo de 60 dias", async () => {
    setup();
    render(<ProblemasPage />);
    await cards();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Visão mensal",
      "Motivos",
      "Casos",
      "Cobertura",
    ]);
    expect(screen.queryByText(/últimos 60 dias/i)).not.toBeInTheDocument();
  });

  it("padrão: Últimos 12 meses (meses cheios, a partir do dia 1) e filtros de conta/marketplace visíveis", async () => {
    const calls = setup();
    render(<ProblemasPage />);
    await cards();
    expect(screen.getByLabelText("Período")).toHaveValue("12m");
    expect(screen.getByLabelText("Marketplace")).toBeVisible();
    expect(screen.getByLabelText("Conta")).toBeVisible();
    const params = paramsOf(callsTo(calls, "/problems/monthly")[0]);
    expect(Object.fromEntries(params)).toEqual({ dateFrom: "2025-10-01" });
    // Só contas do Mercado Livre aparecem como opção.
    expect(within(screen.getByLabelText("Conta")).queryByText("Loja Shopee")).not.toBeInTheDocument();
  });

  it("Todo o histórico: nenhuma data na consulta; Personalizado exige datas coerentes", async () => {
    const calls = setup();
    const user = userEvent.setup();
    render(<ProblemasPage />);
    await cards();

    await user.selectOptions(screen.getByLabelText("Período"), "all");
    await waitFor(() => expect(paramsOf(callsTo(calls, "/problems/monthly").at(-1)!).toString()).toBe(""));

    await user.selectOptions(screen.getByLabelText("Período"), "custom");
    await user.type(screen.getByLabelText("De"), "2026-06-10");
    await user.type(screen.getByLabelText("Até"), "2026-06-01");
    expect(await screen.findByText("A data inicial não pode ser posterior à data final.")).toBeInTheDocument();
  });

  it("filtros de conta e marketplace viram parâmetros da análise mensal", async () => {
    const calls = setup();
    const user = userEvent.setup();
    render(<ProblemasPage />);
    await cards();
    await user.selectOptions(screen.getByLabelText("Marketplace"), "MERCADO_LIVRE");
    await user.selectOptions(screen.getByLabelText("Conta"), "ML2");
    await waitFor(() => {
      const params = paramsOf(callsTo(calls, "/problems/monthly").at(-1)!);
      expect(params.get("marketplace")).toBe("MERCADO_LIVRE");
      expect(params.get("accountId")).toMatch(uuidPattern);
    });
  });
});

describe("/problemas — Visão mensal", () => {
  it("agrega por soma: problemas por 100 pedidos = soma/soma (nunca média das taxas)", async () => {
    setup();
    render(<ProblemasPage />);
    const region = await cards();
    const card = (label: string) => within(region).getByText(label).parentElement!;
    expect(card("Total de problemas")).toHaveTextContent("45");
    expect(card("Total de pedidos")).toHaveTextContent("300");
    // 45 / 300 × 100 = 15 (média simples das taxas mensais daria 12,5).
    expect(card("Problemas por 100 pedidos")).toHaveTextContent("15");
    expect(card("Problemas por 100 pedidos")).not.toHaveTextContent("12,5");
    expect(card("Taxa de resolução")).toHaveTextContent("51,11%");
    expect(card("Impactaram a reputação")).toHaveTextContent("8");
    expect(card("Problemas em aberto")).toHaveTextContent("22");
    // Tempo médio ponderado pelos resolvidos: (24×6 + 48×10 + 12×3 + 36×4) / 23 ≈ 35 h.
    expect(card("Tempo médio de resolução")).toHaveTextContent("35 h");
  });

  it("cobertura parcial: aviso compacto, 'Dados parciais' e taxa não definitiva", async () => {
    setup();
    render(<ProblemasPage />);
    const region = await cards();
    expect(within(region).getByText("Dados parciais")).toBeInTheDocument();
    expect(within(region).getAllByText("Provisória — dados parciais")).toHaveLength(2);
    const warning = screen.getAllByRole("status").find((el) => /Dados parciais ou indeterminados/.test(el.textContent ?? ""));
    expect(warning).toBeDefined();
    expect(warning).toHaveTextContent("mai/2026 (ML1)");
    expect(warning).toHaveTextContent("mai/2026 (ML2)");
  });

  it("tudo COMPLETE: sem aviso e sem selo de dados parciais", async () => {
    setup({ monthly: [monthlyItem({}), monthlyItem({ yearMonth: "2026-04", accountId: "x", accountNickname: "ML2" })] });
    render(<ProblemasPage />);
    const region = await cards();
    expect(within(region).queryByText("Dados parciais")).not.toBeInTheDocument();
    expect(screen.queryByText(/Dados parciais ou indeterminados/)).not.toBeInTheDocument();
  });

  it("sem pedidos no período: taxa N/D (nunca zero nem divisão por zero)", async () => {
    setup({ monthly: [monthlyItem({ totalOrders: 0, problemsPer100Orders: null })] });
    render(<ProblemasPage />);
    const region = await cards();
    expect(within(region).getByText("Problemas por 100 pedidos").parentElement).toHaveTextContent("N/D");
  });

  it("ML1 e ML2 aparecem separadas (legenda, comparativo) e o seletor filtra os gráficos", async () => {
    setup();
    const user = userEvent.setup();
    render(<ProblemasPage />);
    await cards();
    const legend = screen.getAllByRole("list", { name: "Legenda" })[0];
    expect(within(legend).getByText("ML1")).toBeInTheDocument();
    expect(within(legend).getByText("ML2")).toBeInTheDocument();

    const table = within(screen.getByRole("region", { name: "Comparativo por conta" }));
    const ml1 = table.getByRole("row", { name: /ML1/ });
    const ml2 = table.getByRole("row", { name: /ML2/ });
    expect(ml1).toHaveTextContent("35"); // 10+20+5 problemas
    expect(ml2).toHaveTextContent("10"); // 4+6 problemas

    await user.selectOptions(screen.getByLabelText("Contas nos gráficos"), "ML1");
    expect(within(screen.getAllByRole("list", { name: "Legenda" })[0]).queryByText("ML2")).not.toBeInTheDocument();
  });

  it("mês ausente não vira zero falso; mês sem pedidos não desenha ponto e mostra 'sem dados'", async () => {
    setup();
    render(<ProblemasPage />);
    await cards();
    const bars = within(screen.getByRole("list", { name: "Problemas por mês" }));
    const april = bars.getByRole("listitem", { name: /abr\/2026/ });
    expect(april).toHaveAccessibleName(/ML2: sem dados/);
    expect(april).not.toHaveAccessibleName(/ML2: 0 problemas/);

    const rates = within(screen.getByRole("list", { name: "Taxa de problemas por mês" }));
    expect(rates.getByRole("listitem", { name: /mai\/2026/ })).toHaveAccessibleName(/ML1: N\/D \(sem pedidos\)/);
    expect(rates.getByRole("listitem", { name: /mai\/2026/ })).toHaveAccessibleName(/ML2: 10 por 100 pedidos \(provisória\)/);
  });

  it("mês PARTIAL/UNKNOWN é identificado no rótulo acessível e no tooltip", async () => {
    setup();
    render(<ProblemasPage />);
    await cards();
    const may = within(screen.getByRole("list", { name: "Problemas por mês" })).getByRole("listitem", { name: /mai\/2026/ });
    expect(may).toHaveAccessibleName(/Cobertura: Indeterminado/);
    expect(within(may).getByRole("tooltip")).toHaveTextContent("Indeterminado");
    const march = within(screen.getByRole("list", { name: "Problemas por mês" })).getByRole("listitem", { name: /mar\/2026/ });
    expect(march).toHaveAccessibleName(/Cobertura: Completo/);
  });

  it("impacto na reputação: total e percentual sobre os problemas do mês", async () => {
    setup();
    render(<ProblemasPage />);
    await cards();
    const list = within(screen.getByRole("list", { name: "Impacto na reputação por mês" }));
    // Março: (2 + 0) / (10 + 4) = 14,29%.
    expect(list.getByText(/2 · 14,29% dos problemas/)).toBeInTheDocument();
  });

  it("estados: carregando (skeleton), erro com tentar novamente, vazio", async () => {
    setup({ monthly: new Error("x") });
    const user = userEvent.setup();
    const first = render(<ProblemasPage />);
    expect(screen.getByRole("status", { name: "Carregando análise mensal" })).toBeInTheDocument();
    expect(await screen.findByText("Não foi possível carregar a análise mensal agora.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Resumo do período" })).not.toBeInTheDocument();
    first.unmount();

    const calls = setup({ monthly: new Error("x") });
    render(<ProblemasPage />);
    await screen.findByText("Não foi possível carregar a análise mensal agora.");
    const before = callsTo(calls, "/problems/monthly").length;
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(callsTo(calls, "/problems/monthly").length).toBeGreaterThan(before));
  });

  it("sem dados mensais: estado vazio claro", async () => {
    setup({ monthly: [] });
    render(<ProblemasPage />);
    expect(await screen.findByText("Nenhum dado mensal para o período e as contas selecionados.")).toBeInTheDocument();
  });

  it("nenhum UUID aparece na interface (texto, rótulos acessíveis e títulos)", async () => {
    setup();
    render(<ProblemasPage />);
    await cards();
    const attributes = [...document.querySelectorAll("[aria-label],[title]")].map(
      (el) => `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""}`,
    );
    expect(document.body.textContent).not.toMatch(uuidPattern);
    expect(attributes.join(" ")).not.toMatch(uuidPattern);
  });
});

describe("/problemas — Motivos", () => {
  it("distribuição COMPLETA (7 motivos, sem top 5): rótulo PT-BR, quantidade, % do período e ML1 × ML2", async () => {
    const calls = setup();
    const user = userEvent.setup();
    render(<ProblemasPage />);
    await cards();
    await user.click(screen.getByRole("tab", { name: "Motivos" }));

    const section = await screen.findByRole("region", { name: "Distribuição de motivos" });
    expect(within(section).getAllByRole("button")).toHaveLength(REASONS.length);
    expect(within(section).getByRole("button", { name: "Arrependimento do comprador" })).toBeInTheDocument();
    expect(within(section).getByText("20 · 40%")).toBeInTheDocument();
    expect(within(section).getByText("2 · 4%")).toBeInTheDocument(); // o 7º motivo também aparece
    const perAccount = within(within(section).getByRole("list", { name: "Arrependimento do comprador por conta" }));
    expect(perAccount.getByText(/ML1: 12/)).toBeInTheDocument();
    expect(perAccount.getByText(/ML2: 8/)).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Mystery code" })).toBeInTheDocument();
    // O código original é só um detalhe pequeno.
    expect(within(section).getAllByText("repentant_buyer")[0]).toHaveClass("text-[11px]");
    // Usa o endpoint de motivos com o período (não o top 5 mensal).
    const params = paramsOf(callsTo(calls, "/problems/reasons").at(-1)!);
    expect(params.get("from")).toBe("2025-10-01");
  });

  it("cobertura parcial: aviso na aba; falha da consulta: erro com tentar novamente e nenhum zero inventado", async () => {
    setup({ reasons: new Error("x") });
    const user = userEvent.setup();
    const first = render(<ProblemasPage />);
    await cards();
    await user.click(screen.getByRole("tab", { name: "Motivos" }));
    expect(await screen.findByText("Não foi possível carregar os motivos agora.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Distribuição de motivos" })).not.toBeInTheDocument();
    expect(screen.queryByText(/ · 0%/)).not.toBeInTheDocument();
    first.unmount();

    setup();
    render(<ProblemasPage />);
    await cards();
    await user.click(screen.getByRole("tab", { name: "Motivos" }));
    expect(await screen.findByText(/Cobertura parcial: a distribuição considera só/)).toBeInTheDocument();
  });

  it("clicar num motivo abre Casos filtrando pelo reasonId (nunca pelo rótulo)", async () => {
    const calls = setup();
    const user = userEvent.setup();
    render(<ProblemasPage />);
    await cards();
    await user.click(screen.getByRole("tab", { name: "Motivos" }));
    await user.click(await screen.findByRole("button", { name: "Produto faltando" }));

    expect(screen.getByRole("tab", { name: "Casos", selected: true })).toBeInTheDocument();
    await waitFor(() => expect(paramsOf(callsTo(calls, "/problems").at(-1)!).get("reasonId")).toBe("missing_item"));
    expect(screen.getByText("Remover filtro de motivo")).toBeInTheDocument();
    expect(paramsOf(callsTo(calls, "/problems").at(-1)!).toString()).not.toContain("Produto");
  });
});

describe("/problemas — filtros, erros antigos e respostas fora de ordem", () => {
  it("trocar o filtro limpa o erro anterior na hora e volta ao skeleton", async () => {
    setup({ monthly: new Error("x") });
    const user = userEvent.setup();
    render(<ProblemasPage />);
    expect(await screen.findByText("Não foi possível carregar a análise mensal agora.")).toBeInTheDocument();

    // Próxima consulta fica pendente: o erro velho NÃO pode aparecer junto do filtro novo.
    const original = api.apiFetch.getMockImplementation()!;
    let release: () => void = () => undefined;
    api.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/problems/monthly")) {
        await new Promise<void>((resolve) => (release = resolve));
        return jsonResponse({ timezone: "America/Sao_Paulo", items: MONTHLY_ITEMS });
      }
      return original(path, init);
    });
    await user.selectOptions(screen.getByLabelText("Período"), "6m");
    expect(screen.queryByText("Não foi possível carregar a análise mensal agora.")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Carregando análise mensal" })).toBeInTheDocument();
    release();
    expect(await cards()).toBeInTheDocument();
  });

  it("resposta atrasada de um filtro antigo nunca sobrescreve o mais recente (e a antiga é abortada)", async () => {
    setup();
    const user = userEvent.setup();
    render(<ProblemasPage />);
    await cards();

    const original = api.apiFetch.getMockImplementation()!;
    const pending: Array<{ from: string; release: () => void; signal?: AbortSignal | null }> = [];
    api.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/problems/monthly")) {
        const from = paramsOf({ path, method: "GET" }).get("dateFrom") ?? "all";
        await new Promise<void>((resolve) => pending.push({ from, release: resolve, signal: init?.signal }));
        const total = from === "all" ? 7 : 1;
        return jsonResponse({
          timezone: "America/Sao_Paulo",
          items: [monthlyItem({ totalProblems: total, openProblems: total, resolvedProblems: 0 })],
        });
      }
      return original(path, init);
    });

    await user.selectOptions(screen.getByLabelText("Período"), "6m"); // consulta antiga (pendente)
    await user.selectOptions(screen.getByLabelText("Período"), "all"); // consulta recente
    await waitFor(() => expect(pending.map((p) => p.from)).toEqual(["2026-04-01", "all"]));
    expect(pending[0].signal?.aborted).toBe(true);

    pending[1].release(); // a recente responde primeiro (7)…
    const region = await cards();
    await waitFor(() => expect(within(region).getByText("Total de problemas").parentElement).toHaveTextContent("7"));
    pending[0].release(); // …e a antiga chega atrasada (1): é descartada.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(within(await cards()).getByText("Total de problemas").parentElement).toHaveTextContent("7");
  });
});
