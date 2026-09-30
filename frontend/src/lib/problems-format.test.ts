import { jobErrorLabel } from "./problems-format";

describe("jobErrorLabel — 401/403 por operação", () => {
  it("só TOKEN_EXPIRED diz token expirado e manda reconectar", () => {
    expect(jobErrorLabel("TOKEN_EXPIRED")).toBe("Token expirado — reconecte a conta");
  });

  it.each([
    "SEARCH_UNAUTHORIZED",
    "CORE_UNAUTHORIZED",
    "DETAIL_UNAUTHORIZED",
    "REPUTATION_UNAUTHORIZED",
    "REASON_UNAUTHORIZED",
    "TERMINAL_AUTH_ERROR",
  ])("%s: a API recusou a autorização (sem afirmar token expirado)", (code) => {
    expect(jobErrorLabel(code)).toBe("A API recusou a autorização da conta");
  });

  it.each([
    ["SEARCH_FORBIDDEN", "O Mercado Livre negou acesso à busca de reclamações desta conta"],
    ["CORE_FORBIDDEN", "O Mercado Livre negou acesso a uma reclamação específica"],
  ])("%s: texto seguro, sem mandar reconectar", (code, text) => {
    expect(jobErrorLabel(code)).toBe(text);
    expect(jobErrorLabel(code)).not.toMatch(/reconect|expirad|token/i);
  });

  it("nenhum 401/403 da API fala em token expirado", () => {
    for (const code of [
      "TERMINAL_AUTH_ERROR",
      "SEARCH_UNAUTHORIZED",
      "SEARCH_FORBIDDEN",
      "CORE_UNAUTHORIZED",
      "CORE_FORBIDDEN",
    ]) {
      expect(jobErrorLabel(code)).not.toMatch(/token|expirad/i);
    }
  });
});
