import { Notice } from "@/components/problems/ProblemsStates";
import { accountDisplayName } from "@/lib/problems-format";
import { formatYearMonth } from "@/lib/problems-monthly-format";
import type { ProblemsMonthlyItemDto } from "@/types/problems";

const MAX_LISTED = 4;

/** Aviso compacto quando algum mês/conta não é COMPLETE — nunca deixa dado parcial passar por completo. */
export function ProblemsPartialNotice({ items }: { items: ProblemsMonthlyItemDto[] }) {
  const incomplete = items.filter((item) => item.coverage !== "COMPLETE");
  if (incomplete.length === 0) return null;
  const listed = incomplete
    .slice(0, MAX_LISTED)
    .map(
      (item) =>
        `${formatYearMonth(item.yearMonth)} (${accountDisplayName(item.accountNickname, item.marketplace)})`,
    )
    .join(", ");
  const rest = incomplete.length - MAX_LISTED;
  return (
    <Notice tone="warn">
      Dados parciais ou indeterminados em {incomplete.length} {incomplete.length === 1 ? "mês/conta" : "meses/contas"}:{" "}
      {listed}
      {rest > 0 ? ` e mais ${rest}` : ""}. Veja a aba Cobertura.
    </Notice>
  );
}
