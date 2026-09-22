import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductRankingTabs } from "./ProductRankingTabs";
import type { AnalyticsTopListing, AnalyticsTopProductBySku } from "@/types/marketplace-analytics";

const bySku: AnalyticsTopProductBySku[] = [
  {
    sku: "OPA300005PMA1",
    title: "Produto consolidado",
    distinctListings: 2,
    units: 10,
    grossRevenue: "500.00",
    unitsSharePct: 40,
    grossRevenueSharePct: 48.1,
  },
  {
    sku: null,
    title: "Produto sem SKU",
    distinctListings: 1,
    units: 3,
    grossRevenue: "90.00",
    unitsSharePct: 12,
    grossRevenueSharePct: 8.7,
  },
];

const byListing: AnalyticsTopListing[] = [
  {
    listingId: "MLB1:V1",
    marketplace: "MERCADO_LIVRE",
    accountId: "acc-1",
    sku: "OPA300005PMA1",
    title: "Anúncio 1",
    units: 6,
    grossRevenue: "300.00",
    grossRevenueSharePct: 28.9,
  },
  {
    listingId: "MLB2",
    marketplace: "MERCADO_LIVRE",
    accountId: "acc-1",
    sku: "OPA300005PMA1",
    title: "Anúncio 2",
    units: 4,
    grossRevenue: "200.00",
    grossRevenueSharePct: 19.3,
  },
];

function skuRow(overrides: Partial<AnalyticsTopProductBySku>): AnalyticsTopProductBySku {
  return {
    sku: null,
    title: "Produto",
    distinctListings: 1,
    units: 0,
    grossRevenue: "0.00",
    unitsSharePct: 0,
    grossRevenueSharePct: 0,
    ...overrides,
  };
}

describe("ProductRankingTabs", () => {
  it("shows the 'Por SKU' tab by default, with the same SKU appearing only once", () => {
    render(<ProductRankingTabs bySku={bySku} byListing={byListing} />);
    const skuCells = screen.getAllByText("OPA300005PMA1");
    expect(skuCells).toHaveLength(1);
    expect(screen.getByText("Produto consolidado")).toBeInTheDocument();
  });

  it("shows 'Sem SKU' for products without a SKU, never merging different no-SKU products", () => {
    render(<ProductRankingTabs bySku={bySku} byListing={byListing} />);
    expect(screen.getByText("Sem SKU")).toBeInTheDocument();
    expect(screen.getByText("Produto sem SKU")).toBeInTheDocument();
  });

  it("switches to the 'Por anúncio' tab, showing each listing separately even for the same SKU", async () => {
    const user = userEvent.setup();
    render(<ProductRankingTabs bySku={bySku} byListing={byListing} />);

    await user.click(screen.getByRole("tab", { name: "Por anúncio" }));

    expect(screen.getByText("MLB1:V1")).toBeInTheDocument();
    expect(screen.getByText("MLB2")).toBeInTheDocument();
    expect(screen.getAllByText("OPA300005PMA1")).toHaveLength(2);
  });

  it("filters by local search across SKU and title", async () => {
    const user = userEvent.setup();
    render(<ProductRankingTabs bySku={bySku} byListing={byListing} />);

    await user.type(
      screen.getByPlaceholderText(/buscar por sku ou nome/i),
      "sem sku",
    );

    expect(screen.getByText("Produto sem SKU")).toBeInTheDocument();
    expect(screen.queryByText("Produto consolidado")).not.toBeInTheDocument();
  });

  it("limits the visible rows to the selected Top N", async () => {
    const manyRows: AnalyticsTopProductBySku[] = Array.from(
      { length: 15 },
      (_, i) =>
        skuRow({
          sku: `SKU-${i}`,
          title: `Produto ${i}`,
          units: 1,
          grossRevenue: "10.00",
          unitsSharePct: 1,
        }),
    );
    const user = userEvent.setup();
    render(<ProductRankingTabs bySku={manyRows} byListing={[]} />);

    const rowsTop10 = screen.getAllByRole("row");
    // header + 10 linhas
    expect(rowsTop10).toHaveLength(11);

    await user.selectOptions(
      screen.getByLabelText(/quantidade de itens/i),
      "20",
    );
    expect(screen.getAllByRole("row")).toHaveLength(16);
  });

  it("shows the empty state when there is nothing to show for the current tab/search", () => {
    render(<ProductRankingTabs bySku={[]} byListing={[]} />);
    expect(
      screen.getByText(/nenhum produto vendido no período/i),
    ).toBeInTheDocument();
  });

  it("never exposes buyer data or order ids in the listing table", () => {
    render(<ProductRankingTabs bySku={bySku} byListing={byListing} />);
    const table = screen.getAllByRole("table")[0];
    expect(within(table).queryByText(/comprador|buyer|orderId/i)).not.toBeInTheDocument();
  });

  it("shows the new '% do valor bruto' column, formatted in pt-BR with one decimal, next to 'Valor bruto'", () => {
    render(<ProductRankingTabs bySku={bySku} byListing={byListing} />);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    const grossIndex = headers.findIndex((h) => h?.includes("Valor bruto"));
    const pctIndex = headers.findIndex((h) => h?.includes("% do valor bruto"));
    expect(pctIndex).toBe(grossIndex + 1);
    expect(screen.getByText("48,1%")).toBeInTheDocument();
  });

  describe("ordenação", () => {
    const rows: AnalyticsTopProductBySku[] = [
      skuRow({
        sku: "SKU-B",
        title: "Bruno",
        distinctListings: 2,
        units: 5,
        grossRevenue: "50.00",
        unitsSharePct: 10,
        grossRevenueSharePct: 10,
      }),
      skuRow({
        sku: "SKU-A",
        title: "Ana",
        distinctListings: 1,
        units: 20,
        grossRevenue: "200.00",
        unitsSharePct: 40,
        grossRevenueSharePct: 40,
      }),
      skuRow({
        sku: "SKU-C",
        title: "Carla",
        distinctListings: 3,
        units: 1,
        grossRevenue: "5.00",
        unitsSharePct: 2,
        grossRevenueSharePct: 2,
      }),
    ];

    function skuColumnOrder() {
      return screen
        .getAllByRole("row")
        .slice(1)
        .map((row) => within(row).getAllByRole("cell")[1].textContent);
    }

    it("preserves the default (backend) order on load — the '#' column reflects the original position, ascending", () => {
      render(<ProductRankingTabs bySku={rows} byListing={[]} />);
      expect(skuColumnOrder()).toEqual(["SKU-B", "SKU-A", "SKU-C"]);
      const positionHeader = screen.getByRole("columnheader", { name: /^#/ });
      expect(positionHeader).toHaveAttribute("aria-sort", "ascending");
    });

    it("sorts text columns (SKU) using pt-BR order, and toggles asc/desc on repeated clicks", async () => {
      const user = userEvent.setup();
      render(<ProductRankingTabs bySku={rows} byListing={[]} />);

      await user.click(screen.getByRole("button", { name: /^SKU/ }));
      expect(skuColumnOrder()).toEqual(["SKU-A", "SKU-B", "SKU-C"]);
      expect(screen.getByRole("columnheader", { name: /^SKU/ })).toHaveAttribute(
        "aria-sort",
        "ascending",
      );

      await user.click(screen.getByRole("button", { name: /^SKU/ }));
      expect(skuColumnOrder()).toEqual(["SKU-C", "SKU-B", "SKU-A"]);
      expect(screen.getByRole("columnheader", { name: /^SKU/ })).toHaveAttribute(
        "aria-sort",
        "descending",
      );
    });

    it("sorts money columns (Valor bruto) by the raw numeric value, not as text", async () => {
      const user = userEvent.setup();
      render(<ProductRankingTabs bySku={rows} byListing={[]} />);

      await user.click(screen.getByRole("button", { name: "Valor bruto" }));
      // Ascendente por valor numérico: 5.00 < 50.00 < 200.00 — nunca ordem de texto ("200.00" < "5.00" < "50.00").
      expect(skuColumnOrder()).toEqual(["SKU-C", "SKU-B", "SKU-A"]);
    });

    it("sorts percentage columns (% do valor bruto) by numeric value", async () => {
      const user = userEvent.setup();
      render(<ProductRankingTabs bySku={rows} byListing={[]} />);

      await user.click(screen.getByRole("button", { name: /% do valor bruto/ }));
      expect(skuColumnOrder()).toEqual(["SKU-C", "SKU-B", "SKU-A"]);
    });

    it("breaks ties stably by SKU when the sorted column has equal values", async () => {
      const tiedRows: AnalyticsTopProductBySku[] = [
        skuRow({ sku: "SKU-Z", title: "Zeta", units: 5, grossRevenue: "10.00" }),
        skuRow({ sku: "SKU-A", title: "Alfa", units: 5, grossRevenue: "10.00" }),
        skuRow({ sku: "SKU-M", title: "Meio", units: 5, grossRevenue: "10.00" }),
      ];
      const user = userEvent.setup();
      render(<ProductRankingTabs bySku={tiedRows} byListing={[]} />);

      await user.click(screen.getByRole("button", { name: "Unidades" }));
      expect(skuColumnOrder()).toEqual(["SKU-A", "SKU-M", "SKU-Z"]);
    });

    it("applies the sort before slicing to Top N — a row that only ranks inside Top N after sorting is not dropped", async () => {
      const manyRows: AnalyticsTopProductBySku[] = Array.from(
        { length: 12 },
        (_, i) =>
          skuRow({
            sku: `SKU-${String(i).padStart(2, "0")}`,
            title: `Produto ${i}`,
            units: i, // menor unidade primeiro na ordem original
            grossRevenue: "10.00",
          }),
      );
      const user = userEvent.setup();
      render(<ProductRankingTabs bySku={manyRows} byListing={[]} />);

      // Top 10 por posição original: SKU-00..SKU-09 (nunca SKU-10/SKU-11).
      expect(screen.queryByText("SKU-11")).not.toBeInTheDocument();

      // Ordenando por "Unidades" decrescente, SKU-11 (maior unidade) deve
      // aparecer no Top 10 — prova que a ordenação roda ANTES do corte.
      const unidadesHeader = screen.getByRole("button", { name: "Unidades" });
      await user.click(unidadesHeader);
      await user.click(unidadesHeader);
      expect(screen.getByText("SKU-11")).toBeInTheDocument();
      expect(screen.queryByText("SKU-00")).not.toBeInTheDocument();
    });

    it("sorts the 'Por anúncio' tab independently, by listingId (text) and by Valor bruto (numeric)", async () => {
      const listingRows: AnalyticsTopListing[] = [
        {
          listingId: "MLB2",
          marketplace: "MERCADO_LIVRE",
          accountId: "acc-1",
          sku: "SKU-B",
          title: "B",
          units: 1,
          grossRevenue: "20.00",
          grossRevenueSharePct: 20,
        },
        {
          listingId: "MLB1",
          marketplace: "MERCADO_LIVRE",
          accountId: "acc-1",
          sku: "SKU-A",
          title: "A",
          units: 1,
          grossRevenue: "5.00",
          grossRevenueSharePct: 5,
        },
      ];
      const user = userEvent.setup();
      render(<ProductRankingTabs bySku={[]} byListing={listingRows} />);
      await user.click(screen.getByRole("tab", { name: "Por anúncio" }));

      function listingColumnOrder() {
        return screen
          .getAllByRole("row")
          .slice(1)
          .map((row) => within(row).getAllByRole("cell")[1].textContent);
      }

      await user.click(screen.getByRole("button", { name: "Anúncio" }));
      expect(listingColumnOrder()).toEqual(["MLB1", "MLB2"]);

      await user.click(screen.getByRole("button", { name: "Valor bruto" }));
      expect(listingColumnOrder()).toEqual(["MLB1", "MLB2"]);
    });

    it("preserves search and Top N alongside sorting", async () => {
      const user = userEvent.setup();
      render(<ProductRankingTabs bySku={rows} byListing={[]} />);

      await user.type(
        screen.getByPlaceholderText(/buscar por sku ou nome/i),
        "a",
      );
      await user.click(screen.getByRole("button", { name: "Produto" }));
      // "a" casa com Ana e Carla (case-insensitive) — Bruno fica de fora.
      expect(skuColumnOrder().sort()).toEqual(["SKU-A", "SKU-C"].sort());
    });

    it("clicking the '#' header restores the original ranking order after sorting by another column", async () => {
      const user = userEvent.setup();
      render(<ProductRankingTabs bySku={rows} byListing={[]} />);

      expect(skuColumnOrder()).toEqual(["SKU-B", "SKU-A", "SKU-C"]);

      await user.click(screen.getByRole("button", { name: "Produto" }));
      expect(skuColumnOrder()).toEqual(["SKU-A", "SKU-B", "SKU-C"]);

      await user.click(screen.getByRole("button", { name: "#" }));
      expect(skuColumnOrder()).toEqual(["SKU-B", "SKU-A", "SKU-C"]);
      expect(screen.getByRole("columnheader", { name: /^#/ })).toHaveAttribute(
        "aria-sort",
        "ascending",
      );
    });

    it("sequência obrigatória busca -> ordenação -> Top N: uma linha só correspondida pela busca fora das primeiras posições nunca é descartada pelo corte do Top N", async () => {
      const manyRows: AnalyticsTopProductBySku[] = Array.from(
        { length: 15 },
        (_, i) =>
          skuRow({
            sku: `SKU-${String(i).padStart(2, "0")}`,
            title: i === 14 ? "Produto especial" : `Produto ${i}`,
            units: 1,
            grossRevenue: "10.00",
          }),
      );
      const user = userEvent.setup();
      // Top N padrão = 10; "Produto especial" está na posição 15 — fora do
      // Top 10 original.
      render(<ProductRankingTabs bySku={manyRows} byListing={[]} />);
      expect(screen.queryByText("Produto especial")).not.toBeInTheDocument();

      // A busca precisa rodar ANTES do corte do Top N — senão "Produto
      // especial" já teria sido descartado do array antes da busca rodar.
      await user.type(
        screen.getByPlaceholderText(/buscar por sku ou nome/i),
        "especial",
      );
      expect(screen.getByText("Produto especial")).toBeInTheDocument();

      // E a ordenação roda entre a busca e o corte: com só 1 resultado da
      // busca, ordenar por qualquer coluna nunca o removeria do Top N.
      await user.click(screen.getByRole("button", { name: "Produto" }));
      expect(screen.getByText("Produto especial")).toBeInTheDocument();
    });
  });

  describe("grossRevenueSharePct nunca é recalculado no frontend (valor vem pronto do backend)", () => {
    it("a participação de uma linha não muda ao trocar o Top N", async () => {
      const manyRows: AnalyticsTopProductBySku[] = Array.from(
        { length: 15 },
        (_, i) =>
          skuRow({
            sku: `SKU-${String(i).padStart(2, "0")}`,
            title: `Produto ${i}`,
            units: 1,
            grossRevenue: "10.00",
            grossRevenueSharePct: 6.7,
          }),
      );
      const user = userEvent.setup();
      render(<ProductRankingTabs bySku={manyRows} byListing={[]} />);

      expect(screen.getAllByText("6,7%")).toHaveLength(10);

      await user.selectOptions(
        screen.getByLabelText(/quantidade de itens/i),
        "20",
      );
      // Mais linhas visíveis, mas o valor de CADA linha continua o mesmo —
      // nunca recalculado a partir do subconjunto exibido.
      expect(screen.getAllByText("6,7%")).toHaveLength(15);
    });

    it("a participação de uma linha não muda com a busca ativa", async () => {
      const rowsWithFixedShare: AnalyticsTopProductBySku[] = [
        skuRow({ sku: "SKU-A", title: "Ana", grossRevenueSharePct: 33.3 }),
        skuRow({ sku: "SKU-B", title: "Bruno", grossRevenueSharePct: 33.3 }),
        skuRow({ sku: "SKU-C", title: "Carla", grossRevenueSharePct: 33.3 }),
      ];
      const user = userEvent.setup();
      render(<ProductRankingTabs bySku={rowsWithFixedShare} byListing={[]} />);
      expect(screen.getAllByText("33,3%")).toHaveLength(3);

      await user.type(
        screen.getByPlaceholderText(/buscar por sku ou nome/i),
        "Ana",
      );
      // Só 1 linha visível, mas o percentual dela continua 33,3% — nunca
      // recalculado como 100% sobre o subconjunto filtrado.
      expect(screen.getAllByText("33,3%")).toHaveLength(1);
    });
  });
});
