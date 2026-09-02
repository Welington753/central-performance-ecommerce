import {
  formatBRL,
  formatDateTimeSaoPaulo,
  formatPercent,
} from "./kpi-format";

// Intl.NumberFormat('pt-BR', { style: 'currency' }) separa "R$" do valor com
// um espaço NÃO separável (U+00A0), não um espaço comum — formatação padrão
// do ICU para este locale/estilo, não um bug.
const NBSP = String.fromCharCode(160);

describe("formatBRL", () => {
  it("formats a decimal string as pt-BR currency", () => {
    expect(formatBRL("1234.56")).toBe(`R$${NBSP}1.234,56`);
  });

  it("formats zero correctly", () => {
    expect(formatBRL("0.00")).toBe(`R$${NBSP}0,00`);
  });

  it("formats a negative value with the minus sign before R$", () => {
    expect(formatBRL("-5.50")).toBe(`-R$${NBSP}5,50`);
  });
});

describe("formatPercent", () => {
  it("returns null (—) when the value is null", () => {
    expect(formatPercent(null)).toBeNull();
  });

  it("formats a positive change with a leading plus sign", () => {
    expect(formatPercent(12.3)).toBe("+12,3%");
  });

  it("formats a negative change with the minus sign", () => {
    expect(formatPercent(-8)).toBe("-8,0%");
  });

  it("formats exactly zero without a sign", () => {
    expect(formatPercent(0)).toBe("0,0%");
  });
});

describe("formatDateTimeSaoPaulo", () => {
  it("formats an ISO instant in America/Sao_Paulo, pt-BR", () => {
    // 2026-09-01T15:00:00Z = 2026-09-01T12:00:00 em America/Sao_Paulo (UTC-3)
    expect(formatDateTimeSaoPaulo("2026-09-01T15:00:00.000Z")).toBe(
      "01/09/2026, 12:00",
    );
  });

  it("returns null for a null input", () => {
    expect(formatDateTimeSaoPaulo(null)).toBeNull();
  });
});
