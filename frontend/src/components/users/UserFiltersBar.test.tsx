import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserFiltersBar } from "./UserFiltersBar";

describe("UserFiltersBar", () => {
  it("dispara onChange com o novo status", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(
      <UserFiltersBar value={{ status: "all", role: "all" }} onChange={onChange} />,
    );

    await user.selectOptions(screen.getByLabelText("Status"), "active");

    expect(onChange).toHaveBeenCalledWith({ status: "active", role: "all" });
  });

  it("dispara onChange com o novo papel", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(
      <UserFiltersBar value={{ status: "all", role: "all" }} onChange={onChange} />,
    );

    await user.selectOptions(screen.getByLabelText("Papel"), "VIEWER");

    expect(onChange).toHaveBeenCalledWith({ status: "all", role: "VIEWER" });
  });
});
