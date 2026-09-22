export type SortDirection = "asc" | "desc";

export interface SortState<C extends string> {
  column: C;
  direction: SortDirection;
}

/**
 * Posição original do ranking (ordem que vem do backend, por `grossRevenue`
 * desc) — campo fixo, calculado uma única vez a partir do array original.
 * Nunca recalculado a partir do índice de exibição: se fosse, ordenar por
 * outra coluna e depois restaurar a ordem pela coluna "#" seria impossível.
 */
export interface WithPosition {
  position: number;
}

export function withPositions<T>(rows: T[]): (T & WithPosition)[] {
  return rows.map((row, index) => ({ ...row, position: index + 1 }));
}

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  return String(a).localeCompare(String(b), "pt-BR", {
    sensitivity: "base",
    numeric: true,
  });
}

/**
 * Ordena por `column` (respeitando o tipo do valor: numérico para
 * números/moeda/percentual, pt-BR para texto), com empate resolvido de
 * forma estável por `getSecondaryKey` — sempre na mesma direção (nunca
 * invertida pelo `direction` da coluna principal), para o resultado do
 * empate ser sempre previsível.
 */
export function sortRows<T, C extends string>(
  rows: T[],
  column: C,
  direction: SortDirection,
  getValue: (row: T, column: C) => string | number,
  getSecondaryKey: (row: T) => string,
): T[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary = compareValues(getValue(a, column), getValue(b, column));
    if (primary !== 0) return primary * sign;
    return getSecondaryKey(a).localeCompare(getSecondaryKey(b), "pt-BR", {
      sensitivity: "base",
      numeric: true,
    });
  });
}

export function toggleSort<C extends string>(
  current: SortState<C>,
  column: C,
): SortState<C> {
  if (current.column !== column) return { column, direction: "asc" };
  return {
    column,
    direction: current.direction === "asc" ? "desc" : "asc",
  };
}

export function ariaSortFor<C extends string>(
  sort: SortState<C>,
  column: C,
): "ascending" | "descending" | "none" {
  if (sort.column !== column) return "none";
  return sort.direction === "asc" ? "ascending" : "descending";
}
