import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateRangeFilter } from "./DateRangeFilter";
import { dateOnlyToString, resolvePreset } from "@/lib/date-range";

describe("DateRangeFilter", () => {
  it("highlights the matching preset button for the current range", () => {
    const last30 = resolvePreset("last30");
    render(
      <DateRangeFilter
        from={dateOnlyToString(last30.from)}
        to={dateOnlyToString(last30.to)}
        onChange={jest.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Últimos 30 dias" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it.each([
    ["Hoje"],
    ["Ontem"],
    ["Últimos 7 dias"],
    ["Últimos 30 dias"],
    ["Mês atual"],
    ["Mês anterior"],
  ])("clicking the '%s' shortcut calls onChange with a valid range", async (label) => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(<DateRangeFilter from="2026-08-01" to="2026-08-31" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: label }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const [range] = onChange.mock.calls[0] as [{ from: string; to: string }];
    expect(range.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(range.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("opens the custom period fields when 'Personalizado' is clicked", async () => {
    const user = userEvent.setup();
    render(<DateRangeFilter from="2026-08-01" to="2026-08-31" onChange={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: "Personalizado" }));

    expect(screen.getByLabelText("Data inicial")).toBeInTheDocument();
    expect(screen.getByLabelText("Data final")).toBeInTheDocument();
  });

  it("applies a valid custom range", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(<DateRangeFilter from="2026-08-01" to="2026-08-31" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Personalizado" }));
    const fromInput = screen.getByLabelText("Data inicial");
    const toInput = screen.getByLabelText("Data final");
    await user.clear(fromInput);
    await user.type(fromInput, "2026-07-01");
    await user.clear(toInput);
    await user.type(toInput, "2026-07-15");
    await user.click(screen.getByRole("button", { name: "Aplicar" }));

    expect(onChange).toHaveBeenCalledWith({ from: "2026-07-01", to: "2026-07-15" });
  });

  it("shows an accessible validation error for an invalid custom range (from > to) and does not call onChange", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(<DateRangeFilter from="2026-08-01" to="2026-08-31" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Personalizado" }));
    const fromInput = screen.getByLabelText("Data inicial");
    const toInput = screen.getByLabelText("Data final");
    await user.clear(fromInput);
    await user.type(fromInput, "2026-08-20");
    await user.clear(toInput);
    await user.type(toInput, "2026-08-01");
    await user.click(screen.getByRole("button", { name: "Aplicar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/data inicial/i);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("'Limpar' resets to the last 30 days", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(<DateRangeFilter from="2026-08-01" to="2026-08-05" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Personalizado" }));
    await user.click(
      screen.getByRole("button", { name: /limpar.*30 dias/i }),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    const [range] = onChange.mock.calls[0] as [{ from: string; to: string }];
    const last30 = resolvePreset("last30");
    expect(range).toEqual({
      from: dateOnlyToString(last30.from),
      to: dateOnlyToString(last30.to),
    });
  });
});
