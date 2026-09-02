import { render, screen } from "@testing-library/react";
import { DataCoverageBanner } from "./DataCoverageBanner";

describe("DataCoverageBanner", () => {
  it("shows a neutral message when coverage is complete", () => {
    render(
      <DataCoverageBanner
        coverage={{
          status: "complete",
          synchronizedFrom: "2026-07-04",
          synchronizedTo: "2026-09-01",
          selectedPeriodComplete: true,
          comparisonPeriodComplete: true,
        }}
      />,
    );
    expect(screen.getByText(/04\/07\/2026/)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("warns when the account has never had a successful sync (unknown)", () => {
    render(
      <DataCoverageBanner
        coverage={{
          status: "unknown",
          synchronizedFrom: null,
          synchronizedTo: null,
          selectedPeriodComplete: false,
          comparisonPeriodComplete: false,
        }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/nunca há.*sincronização|não há nenhuma sincronização/i);
  });

  it("warns about a partial selected period without presenting it as complete", () => {
    render(
      <DataCoverageBanner
        coverage={{
          status: "partial",
          synchronizedFrom: "2026-08-20",
          synchronizedTo: "2026-09-01",
          selectedPeriodComplete: false,
          comparisonPeriodComplete: true,
        }}
      />,
    );
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/cobertura parcial/i);
    expect(banner).toHaveTextContent(/período selecionado não está totalmente sincronizado/i);
    expect(banner).not.toHaveTextContent(/período de comparação não está/i);
  });

  it("warns about a partial comparison period", () => {
    render(
      <DataCoverageBanner
        coverage={{
          status: "partial",
          synchronizedFrom: "2026-08-20",
          synchronizedTo: "2026-09-01",
          selectedPeriodComplete: true,
          comparisonPeriodComplete: false,
        }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /período de comparação não está totalmente sincronizado/i,
    );
  });
});
