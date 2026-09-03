import {
  dateOnlyToString,
  parseDateOnly,
  resolvePreset,
  validateDateRangeStrings,
} from "./date-range";

// 2026-09-01T02:00:00Z ainda é 31/08 em São Paulo (UTC-3).
const REF_STILL_AUG31 = new Date("2026-09-01T02:00:00.000Z");
// 2026-09-01T12:00:00Z já é 01/09 em São Paulo.
const REF_SEP1 = new Date("2026-09-01T12:00:00.000Z");

describe("resolvePreset", () => {
  it("today", () => {
    const { from, to } = resolvePreset("today", REF_SEP1);
    expect(dateOnlyToString(from)).toBe("2026-09-01");
    expect(dateOnlyToString(to)).toBe("2026-09-01");
  });

  it("yesterday", () => {
    const { from, to } = resolvePreset("yesterday", REF_SEP1);
    expect(dateOnlyToString(from)).toBe("2026-08-31");
    expect(dateOnlyToString(to)).toBe("2026-08-31");
  });

  it("last7 includes today and the previous 6 days", () => {
    const { from, to } = resolvePreset("last7", REF_SEP1);
    expect(dateOnlyToString(from)).toBe("2026-08-26");
    expect(dateOnlyToString(to)).toBe("2026-09-01");
  });

  it("last30 includes today and the previous 29 days", () => {
    const { from, to } = resolvePreset("last30", REF_SEP1);
    expect(dateOnlyToString(from)).toBe("2026-08-03");
    expect(dateOnlyToString(to)).toBe("2026-09-01");
  });

  it("thisMonth spans day 1 through today", () => {
    const { from, to } = resolvePreset("thisMonth", REF_SEP1);
    expect(dateOnlyToString(from)).toBe("2026-09-01");
    expect(dateOnlyToString(to)).toBe("2026-09-01");
  });

  it("lastMonth spans the full previous calendar month", () => {
    const { from, to } = resolvePreset("lastMonth", REF_SEP1);
    expect(dateOnlyToString(from)).toBe("2026-08-01");
    expect(dateOnlyToString(to)).toBe("2026-08-31");
  });

  it("uses the São Paulo calendar day, not the raw UTC day", () => {
    const { from, to } = resolvePreset("today", REF_STILL_AUG31);
    expect(dateOnlyToString(from)).toBe("2026-08-31");
    expect(dateOnlyToString(to)).toBe("2026-08-31");
  });
});

describe("validateDateRangeStrings", () => {
  it("accepts a valid range", () => {
    const result = validateDateRangeStrings(
      "2026-08-01",
      "2026-08-31",
      REF_SEP1,
    );
    expect(result.valid).toBe(true);
  });

  it("rejects an invalid format", () => {
    const result = validateDateRangeStrings(
      "01/08/2026",
      "2026-08-31",
      REF_SEP1,
    );
    expect(result).toEqual({ valid: false, error: "INVALID_FORMAT" });
  });

  it("rejects from > to", () => {
    const result = validateDateRangeStrings(
      "2026-08-31",
      "2026-08-01",
      REF_SEP1,
    );
    expect(result).toEqual({ valid: false, error: "FROM_AFTER_TO" });
  });

  it("rejects a future `to`", () => {
    const result = validateDateRangeStrings(
      "2026-08-25",
      "2026-09-02",
      REF_SEP1,
    );
    expect(result).toEqual({ valid: false, error: "TO_IN_FUTURE" });
  });

  // Fase 4 ("Todo o período"): o limite artificial de ~1 ano no personalizado
  // foi removido — um intervalo de mais de 366 dias agora é válido.
  it("accepts a custom range longer than 366 days", () => {
    const result = validateDateRangeStrings(
      "2025-01-01",
      "2026-01-02",
      REF_SEP1,
    );
    expect(result.valid).toBe(true);
  });

  it("still rejects an absurdly long range (RANGE_TOO_LONG is a sanity cap, not gone entirely)", () => {
    const result = validateDateRangeStrings(
      "1900-01-01",
      "2026-09-01",
      REF_SEP1,
    );
    expect(result).toEqual({ valid: false, error: "RANGE_TOO_LONG" });
  });
});

describe("parseDateOnly", () => {
  it("returns null for a nonexistent calendar date", () => {
    expect(parseDateOnly("2026-02-30")).toBeNull();
  });

  it("parses a valid date", () => {
    expect(parseDateOnly("2026-08-01")).toEqual({
      year: 2026,
      month: 8,
      day: 1,
    });
  });
});
