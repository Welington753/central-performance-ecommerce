import { render, screen } from "@testing-library/react";
import { DataCoverageBanner } from "./DataCoverageBanner";

describe("DataCoverageBanner", () => {
  it("shows a neutral message when coverage is complete", () => {
    render(
      <DataCoverageBanner
        coverage={{
          status: "complete",
          synchronizedIntervals: [{ from: "2026-07-04", to: "2026-09-01" }],
          selectedPeriodComplete: true,
          comparisonPeriodComplete: true,
        }}
      />,
    );
    expect(screen.getByText(/04\/07\/2026/)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("warns when no source has ever had a successful sync (unknown)", () => {
    render(
      <DataCoverageBanner
        coverage={{
          status: "unknown",
          synchronizedIntervals: [],
          selectedPeriodComplete: false,
          comparisonPeriodComplete: false,
        }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /nenhuma sincronização concluída/i,
    );
  });

  it("warns about a partial selected period without presenting it as complete", () => {
    render(
      <DataCoverageBanner
        coverage={{
          status: "partial",
          synchronizedIntervals: [{ from: "2026-08-20", to: "2026-09-01" }],
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
          synchronizedIntervals: [{ from: "2026-08-20", to: "2026-09-01" }],
          selectedPeriodComplete: true,
          comparisonPeriodComplete: false,
        }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /período de comparação não está totalmente sincronizado/i,
    );
  });

  it("describes two disjoint intervals separately — never as a single continuous range", () => {
    render(
      <DataCoverageBanner
        coverage={{
          status: "partial",
          synchronizedIntervals: [
            { from: "2026-07-02", to: "2026-07-10" },
            { from: "2026-08-20", to: "2026-09-01" },
          ],
          selectedPeriodComplete: false,
          comparisonPeriodComplete: false,
        }}
      />,
    );
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("02/07/2026");
    expect(banner).toHaveTextContent("10/07/2026");
    expect(banner).toHaveTextContent("20/08/2026");
    expect(banner).toHaveTextContent("01/09/2026");
    // Nunca deve sugerir um único período contínuo de julho a setembro.
    expect(banner).not.toHaveTextContent("02/07/2026 a 01/09/2026");
  });
});
