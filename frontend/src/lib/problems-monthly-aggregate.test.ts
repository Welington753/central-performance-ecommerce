import {
  aggregateMonthly,
  buildMonthlySeries,
  compareAccounts,
  worstCoverage,
} from "./problems-monthly-aggregate";
import type { ProblemsMonthlyItemDto } from "@/types/problems";

function item(overrides: Partial<ProblemsMonthlyItemDto>): ProblemsMonthlyItemDto {
  return {
    yearMonth: "2026-03",
    accountId: "a1",
    accountNickname: "ML1",
    marketplace: "MERCADO_LIVRE",
    totalProblems: 10,
    openProblems: 4,
    resolvedProblems: 6,
    reputationImpactCount: 2,
    totalOrders: 100,
    problemsPer100Orders: 10,
    resolutionRate: 60,
    averageResolutionHours: 24,
    topReasons: [],
    coverage: "COMPLETE",
    rateDefinitive: true,
    quarantinedClaimsCount: 0,
    quarantinedClaimsInMonthCount: 0,
    quarantinedUnknownDateCount: 0,
    ...overrides,
  };
}

describe("aggregateMonthly", () => {
  it("taxa por 100 pedidos = soma dos problemas / soma dos pedidos (não a média das taxas)", () => {
    const totals = aggregateMonthly([
      item({ totalProblems: 1, totalOrders: 100, problemsPer100Orders: 1 }),
      item({ yearMonth: "2026-04", totalProblems: 9, totalOrders: 100, problemsPer100Orders: 9 }),
      item({ yearMonth: "2026-05", totalProblems: 30, totalOrders: 10, problemsPer100Orders: 300 }),
    ]);
    expect(totals.problemsPer100Orders).toBeCloseTo((40 / 210) * 100, 10);
    expect(totals.problemsPer100Orders).not.toBeCloseTo((1 + 9 + 300) / 3, 1);
  });

  it("nunca divide por zero: sem pedidos ou sem problemas vira null (N/D)", () => {
    const totals = aggregateMonthly([item({ totalOrders: 0, totalProblems: 0, resolvedProblems: 0 })]);
    expect(totals.problemsPer100Orders).toBeNull();
    expect(totals.resolutionRate).toBeNull();
    expect(totals.reputationImpactRate).toBeNull();
    expect(aggregateMonthly([]).problemsPer100Orders).toBeNull();
  });

  it("tempo médio ponderado pelos resolvidos; ignora linhas sem tempo e sem resolvidos", () => {
    const totals = aggregateMonthly([
      item({ resolvedProblems: 1, averageResolutionHours: 10 }),
      item({ yearMonth: "2026-04", resolvedProblems: 3, averageResolutionHours: 50 }),
      item({ yearMonth: "2026-05", resolvedProblems: 5, averageResolutionHours: null }),
      item({ yearMonth: "2026-06", resolvedProblems: 0, averageResolutionHours: 999 }),
    ]);
    expect(totals.averageResolutionHours).toBeCloseTo((10 * 1 + 50 * 3) / 4, 10);
    expect(aggregateMonthly([item({ resolvedProblems: 0, averageResolutionHours: null })]).averageResolutionHours).toBeNull();
  });

  it("partial quando qualquer linha não é COMPLETE", () => {
    expect(aggregateMonthly([item({})]).partial).toBe(false);
    expect(aggregateMonthly([item({}), item({ coverage: "UNKNOWN" })]).partial).toBe(true);
    expect(aggregateMonthly([item({ coverage: "PARTIAL" })]).partial).toBe(true);
  });
});

describe("worstCoverage", () => {
  it("pior cobertura vence; sem linhas = NO_DATA (nunca completo por omissão)", () => {
    expect(worstCoverage([])).toBe("NO_DATA");
    expect(worstCoverage([item({}), item({ coverage: "PARTIAL" })])).toBe("PARTIAL");
    expect(worstCoverage([item({ coverage: "PARTIAL" }), item({ coverage: "UNKNOWN" })])).toBe("UNKNOWN");
  });
});

describe("buildMonthlySeries", () => {
  it("meses em ordem cronológica, sem buracos, e mês ausente fica ausente (não zero)", () => {
    const series = buildMonthlySeries([
      item({ yearMonth: "2026-05" }),
      item({ yearMonth: "2025-12" }),
      item({ yearMonth: "2026-01", accountId: "a2", accountNickname: "ML2" }),
    ]);
    expect(series.months).toEqual(["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]);
    const ml1 = series.accounts.find((account) => account.label === "ML1")!;
    expect(ml1.byMonth.get("2026-02")).toBeUndefined();
    expect(series.accounts.map((account) => account.label)).toEqual(["ML1", "ML2"]);
  });

  it("compareAccounts agrega cada conta separadamente", () => {
    const rows = compareAccounts(
      buildMonthlySeries([
        item({ totalProblems: 10 }),
        item({ accountId: "a2", accountNickname: "ML2", totalProblems: 3, coverage: "PARTIAL" }),
      ]),
    );
    expect(rows.map((row) => [row.label, row.totals.totalProblems, row.coverage])).toEqual([
      ["ML1", 10, "COMPLETE"],
      ["ML2", 3, "PARTIAL"],
    ]);
  });
});
