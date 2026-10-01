import { coverageControls, historicalProgress, isCoveragePartial } from "./problems-coverage";
import {
  formatDecimal,
  formatDuration,
  formatInteger,
  formatPercent,
  formatYearMonth,
} from "./problems-monthly-format";
import { formatDate, formatDateTime } from "./problems-format";
import type { ProblemsSyncStatusDto } from "@/types/problems";
import { syncStatus } from "@/app/(protegido)/problemas/problems-test-utils";

const base = {
  incrementalCoveredThrough: "2026-09-01T00:00:00.000Z",
  historicalCoveredFrom: "2026-06-01T00:00:00.000Z",
  historicalTargetFrom: "2026-03-01T00:00:00.000Z",
} as const;

describe("historicalProgress", () => {
  it("proporcional entre alvo e cobertura incremental; nunca 100% sem COMPLETED", () => {
    const percent = historicalProgress({ ...base, historicalStatus: "RUNNING" });
    expect(percent).toBeGreaterThan(40);
    expect(percent).toBeLessThan(60);
    expect(historicalProgress({ ...base, historicalCoveredFrom: "2026-03-01T00:00:00.000Z", historicalStatus: "RUNNING" })).toBe(99);
    expect(historicalProgress({ ...base, historicalStatus: "COMPLETED" })).toBe(100);
  });

  it("sem início, alvo ou ponto incremental: null (não inventa porcentagem)", () => {
    expect(historicalProgress({ ...base, historicalTargetFrom: null, historicalStatus: "RUNNING" })).toBeNull();
    expect(historicalProgress({ ...base, historicalCoveredFrom: null, historicalStatus: "RUNNING" })).toBeNull();
    expect(historicalProgress({ ...base, incrementalCoveredThrough: null, historicalStatus: "RUNNING" })).toBeNull();
    expect(
      historicalProgress({ ...base, historicalTargetFrom: "2026-09-02T00:00:00.000Z", historicalStatus: "RUNNING" }),
    ).toBeNull();
  });
});

describe("isCoveragePartial", () => {
  it("COMPLETED/NO_TARGET sem quarentena = completo; o resto é parcial", () => {
    expect(isCoveragePartial({ historicalStatus: "COMPLETED", quarantinedClaimsCount: 0 })).toBe(false);
    expect(isCoveragePartial({ historicalStatus: "NO_TARGET", quarantinedClaimsCount: 0 })).toBe(false);
    expect(isCoveragePartial({ historicalStatus: "COMPLETED", quarantinedClaimsCount: 1 })).toBe(true);
    expect(isCoveragePartial({ historicalStatus: "RUNNING", quarantinedClaimsCount: 0 })).toBe(true);
  });
});

describe("coverageControls", () => {
  it("histórico: RUNNING pausa; PAUSED/FAILED retomam; completo não oferece nada", () => {
    const histories = (historicalStatus: Partial<ProblemsSyncStatusDto>) =>
      coverageControls(syncStatus(historicalStatus), "ML1").filter((control) => control.scope === "historical");
    expect(histories({ historicalStatus: "RUNNING" }).map((c) => c.action)).toEqual(["pause"]);
    expect(histories({ historicalStatus: "PAUSED" }).map((c) => c.action)).toEqual(["resume"]);
    expect(histories({ historicalStatus: "FAILED" }).map((c) => c.action)).toEqual(["resume"]);
    expect(histories({ historicalStatus: "COMPLETED" })).toEqual([]);
    expect(histories({ historicalStatus: "NO_TARGET" })).toEqual([]);
  });

  it("job nunca iniciado só oferece iniciar; pausa pedida esconde 'Pausar'", () => {
    expect(coverageControls(syncStatus({ jobStatus: "NOT_STARTED", historicalStatus: "NOT_STARTED" }), "ML1").map((c) => c.action)).toEqual(["start"]);
    expect(coverageControls(syncStatus({ pauseRequested: true, historicalStatus: "COMPLETED" }), "ML1")).toEqual([]);
  });
});

describe("formatação pt-BR e fuso", () => {
  it("números, percentuais (≤ 2 casas), duração e N/D", () => {
    expect(formatInteger(1234567)).toBe("1.234.567");
    expect(formatDecimal(12.3456)).toBe("12,35");
    expect(formatPercent(33.3333)).toBe("33,33%");
    expect(formatPercent(null)).toBe("N/D");
    expect(formatDecimal(null)).toBe("N/D");
    expect(formatDuration(30)).toBe("30 h");
    expect(formatDuration(72)).toBe("3 dias");
    expect(formatDuration(null)).toBe("N/D");
  });

  it("mês abreviado sem Date e datas em America/Sao_Paulo", () => {
    expect(formatYearMonth("2026-05")).toBe("mai/2026");
    expect(formatYearMonth("2025-12")).toBe("dez/2025");
    // 01/06 02:30 UTC é 31/05 23:30 em São Paulo.
    expect(formatDate("2026-06-01T02:30:00.000Z")).toBe("31/05/2026");
    expect(formatDateTime("2026-06-01T02:30:00.000Z")).toBe("31/05/2026, 23:30");
  });
});
