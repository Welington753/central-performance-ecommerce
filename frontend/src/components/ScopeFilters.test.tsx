import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScopeFilters } from "./ScopeFilters";
import type { AccountBreakdownEntry } from "@/types/marketplace-analytics";

function account(overrides: Partial<AccountBreakdownEntry> = {}): AccountBreakdownEntry {
  return {
    accountId: "acc-1",
    marketplace: "MERCADO_LIVRE",
    nickname: "Loja Principal",
    externalSellerId: "123",
    status: "CONNECTED",
    availability: "AVAILABLE",
    summary: null,
    lastSync: null,
    ...overrides,
  };
}

describe("ScopeFilters", () => {
  it("has accessible labels for both selects", () => {
    render(
      <ScopeFilters marketplace="ALL" accountId={null} accounts={[]} onChange={jest.fn()} />,
    );
    expect(screen.getByLabelText("Marketplace")).toBeInTheDocument();
    expect(screen.getByLabelText("Conta")).toBeInTheDocument();
  });

  it('defaults to "Todos" / "Todas as contas"', () => {
    render(
      <ScopeFilters marketplace="ALL" accountId={null} accounts={[]} onChange={jest.fn()} />,
    );
    expect(screen.getByLabelText("Marketplace")).toHaveValue("ALL");
    expect(screen.getByLabelText("Conta")).toHaveValue("");
  });

  it("lists the eligible accounts passed in", () => {
    render(
      <ScopeFilters
        marketplace="ALL"
        accountId={null}
        accounts={[account({ accountId: "acc-1", nickname: "Loja A" }), account({ accountId: "acc-2", nickname: "Loja B" })]}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByRole("option", { name: "Loja A" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Loja B" })).toBeInTheDocument();
  });

  it("changing the marketplace resets the account selection", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(
      <ScopeFilters
        marketplace="ALL"
        accountId="acc-1"
        accounts={[account()]}
        onChange={onChange}
      />,
    );
    await user.selectOptions(screen.getByLabelText("Marketplace"), "AMAZON");
    expect(onChange).toHaveBeenCalledWith({ marketplace: "AMAZON", accountId: null });
  });

  it("selecting a specific account keeps the current marketplace", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(
      <ScopeFilters
        marketplace="MERCADO_LIVRE"
        accountId={null}
        accounts={[account({ accountId: "acc-1", nickname: "Loja A" })]}
        onChange={onChange}
      />,
    );
    await user.selectOptions(screen.getByLabelText("Conta"), "acc-1");
    expect(onChange).toHaveBeenCalledWith({ marketplace: "MERCADO_LIVRE", accountId: "acc-1" });
  });

  it("selecting back to 'Todas as contas' clears the account filter", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(
      <ScopeFilters
        marketplace="MERCADO_LIVRE"
        accountId="acc-1"
        accounts={[account({ accountId: "acc-1", nickname: "Loja A" })]}
        onChange={onChange}
      />,
    );
    await user.selectOptions(screen.getByLabelText("Conta"), "Todas as contas");
    expect(onChange).toHaveBeenCalledWith({ marketplace: "MERCADO_LIVRE", accountId: null });
  });
});
