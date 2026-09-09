import { render, screen } from "@testing-library/react";
import { usePathname, useSearchParams } from "next/navigation";
import { DashboardTabs } from "./DashboardTabs";

jest.mock("next/navigation", () => ({
  usePathname: jest.fn(),
  useSearchParams: jest.fn(),
}));

function mockRoute(pathname: string, params: Record<string, string> = {}) {
  (usePathname as jest.Mock).mockReturnValue(pathname);
  (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams(params));
}

describe("DashboardTabs", () => {
  it("marks Visão Geral as the active tab on /dashboard", () => {
    mockRoute("/dashboard");
    render(<DashboardTabs />);
    expect(screen.getByRole("link", { name: "Visão Geral" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("link", { name: "Metas e Ritmo" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("marks Metas e Ritmo as the active tab on /dashboard/metas", () => {
    mockRoute("/dashboard/metas");
    render(<DashboardTabs />);
    expect(
      screen.getByRole("link", { name: "Metas e Ritmo" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("preserves existing query parameters when switching tabs", () => {
    mockRoute("/dashboard", { marketplace: "AMAZON", accountId: "acc-1" });
    render(<DashboardTabs />);
    const link = screen.getByRole("link", { name: "Metas e Ritmo" });
    expect(link).toHaveAttribute(
      "href",
      "/dashboard/metas?marketplace=AMAZON&accountId=acc-1",
    );
  });

  it("links to the bare path when there are no query parameters", () => {
    mockRoute("/dashboard/metas");
    render(<DashboardTabs />);
    expect(screen.getByRole("link", { name: "Visão Geral" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });
});
