import { render, screen } from "@testing-library/react";
import DashboardPage from "@/app/(protegido)/dashboard/page";

describe("DashboardPage", () => {
  it("exibe exatamente as mensagens de estado vazio, sem KPIs", () => {
    render(<DashboardPage />);

    expect(
      screen.getByText("Central de Performance E-commerce"),
    ).toBeInTheDocument();
    expect(screen.getByText("Nenhum marketplace conectado")).toBeInTheDocument();
    expect(screen.getByText("Ainda não sincronizado")).toBeInTheDocument();
  });

  it("não exibe nenhum valor monetário ou percentual fictício", () => {
    render(<DashboardPage />);

    const html = document.body.innerHTML;
    expect(html).not.toMatch(/R\$\s?\d/);
    expect(html).not.toMatch(/\d+([.,]\d+)?\s?%/);
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    expect(document.querySelector("canvas")).not.toBeInTheDocument();
    expect(document.querySelector("svg[data-chart]")).not.toBeInTheDocument();
  });
});
