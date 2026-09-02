const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";

const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** `value` é uma string decimal (`"1234.56"`) vinda direto do DTO do backend. */
export function formatBRL(value: string): string {
  return brlFormatter.format(Number(value));
}

/** `null` quando não há base de comparação (backend já resolveu isso). */
export function formatPercent(value: number | null): string | null {
  if (value === null) return null;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: SAO_PAULO_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTimeSaoPaulo(value: string | null): string | null {
  if (value === null) return null;
  return dateTimeFormatter.format(new Date(value));
}
