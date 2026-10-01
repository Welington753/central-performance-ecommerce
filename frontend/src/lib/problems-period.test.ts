import { DEFAULT_PERIOD, PERIOD_OPTIONS, customPeriodError, periodRange } from "./problems-period";

const NOW = new Date("2026-09-15T12:00:00.000Z");
const preset = (value: (typeof PERIOD_OPTIONS)[number]["value"]) => ({ ...DEFAULT_PERIOD, preset: value });

describe("periodRange", () => {
  it("padrão é Últimos 12 meses e oferece as 6 opções pedidas", () => {
    expect(DEFAULT_PERIOD.preset).toBe("12m");
    expect(PERIOD_OPTIONS.map((option) => option.label)).toEqual([
      "Últimos 3 meses",
      "Últimos 6 meses",
      "Últimos 12 meses",
      "Ano atual",
      "Todo o histórico",
      "Personalizado",
    ]);
  });

  it("janelas em meses cheios contando o mês corrente", () => {
    expect(periodRange(preset("3m"), NOW)).toEqual({ dateFrom: "2026-07-01", dateTo: "" });
    expect(periodRange(preset("6m"), NOW)).toEqual({ dateFrom: "2026-04-01", dateTo: "" });
    expect(periodRange(preset("12m"), NOW)).toEqual({ dateFrom: "2025-10-01", dateTo: "" });
    expect(periodRange(preset("year"), NOW)).toEqual({ dateFrom: "2026-01-01", dateTo: "" });
  });

  it("atravessa a virada de ano", () => {
    expect(periodRange(preset("3m"), new Date("2026-01-20T12:00:00Z"))).toEqual({ dateFrom: "2025-11-01", dateTo: "" });
  });

  it("usa America/Sao_Paulo, não o fuso do navegador (01/10 00:30 UTC ainda é 30/09 em SP)", () => {
    expect(periodRange(preset("3m"), new Date("2026-10-01T00:30:00Z"))).toEqual({ dateFrom: "2026-07-01", dateTo: "" });
  });

  it("Todo o histórico não manda datas; Personalizado usa as informadas", () => {
    expect(periodRange(preset("all"), NOW)).toEqual({ dateFrom: "", dateTo: "" });
    expect(
      periodRange({ preset: "custom", customFrom: "2026-02-01", customTo: "2026-03-31" }, NOW),
    ).toEqual({ dateFrom: "2026-02-01", dateTo: "2026-03-31" });
  });
});

describe("customPeriodError", () => {
  it("só personalizado invertido é inválido", () => {
    expect(customPeriodError({ preset: "custom", customFrom: "2026-03-02", customTo: "2026-03-01" })).toMatch(/inicial/);
    expect(customPeriodError({ preset: "custom", customFrom: "2026-03-01", customTo: "" })).toBeNull();
    expect(customPeriodError(preset("12m"))).toBeNull();
  });
});

describe("periodRange — contrato dos meses (America/Sao_Paulo)", () => {
  const monthsBetween = (from: string, now: Date): number => {
    const [fy, fm] = from.split("-").map(Number);
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" })
      .format(now)
      .split("-")
      .map(Number);
    return (parts[0] - fy) * 12 + (parts[1] - fm) + 1; // inclui o mês corrente
  };

  it.each([
    ["3m", 3],
    ["6m", 6],
    ["12m", 12],
  ] as const)("%s = mês corrente + %i-1 anteriores (exatamente %i meses cheios)", (value, months) => {
    for (const now of [NOW, new Date("2026-01-01T03:00:00Z"), new Date("2026-12-31T23:59:00-03:00")]) {
      const { dateFrom } = periodRange(preset(value), now);
      expect(dateFrom.endsWith("-01")).toBe(true);
      expect(monthsBetween(dateFrom, now)).toBe(months);
    }
  });

  it("Últimos 12 meses em 15/09/2026 = out/2025 … set/2026 (o mês corrente entra)", () => {
    expect(periodRange(preset("12m"), NOW).dateFrom).toBe("2025-10-01");
  });

  it("virada de ano: em janeiro, 12 meses começam em fevereiro do ano anterior; Ano atual começa em 01/01", () => {
    const january = new Date("2026-01-15T12:00:00Z");
    expect(periodRange(preset("12m"), january).dateFrom).toBe("2025-02-01");
    expect(periodRange(preset("year"), january).dateFrom).toBe("2026-01-01");
  });

  it("fronteira do fuso: 01/01 00:30 UTC ainda é 31/12 em São Paulo (Ano atual = ano anterior)", () => {
    expect(periodRange(preset("year"), new Date("2026-01-01T00:30:00Z")).dateFrom).toBe("2025-01-01");
  });

  it("Personalizado repassa os dias como informados (inclusivos), sem deslocar por fuso", () => {
    expect(periodRange({ preset: "custom", customFrom: "2026-03-01", customTo: "2026-03-31" }, NOW)).toEqual({
      dateFrom: "2026-03-01",
      dateTo: "2026-03-31",
    });
    expect(periodRange({ preset: "custom", customFrom: "", customTo: "2026-03-31" }, NOW)).toEqual({
      dateFrom: "",
      dateTo: "2026-03-31",
    });
  });
});
