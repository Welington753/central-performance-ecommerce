import { formatMonthYearLabel } from "@/lib/goal-format";

interface MonthSelectorProps {
  year: number;
  month: number;
  onChange: (next: { year: number; month: number }) => void;
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const zeroBased = (year * 12 + (month - 1)) + delta;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

/** Seletor de mês (design §7) — botões nativos, acessíveis por teclado sem código adicional. */
export function MonthSelector({ year, month, onChange }: MonthSelectorProps) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        aria-label="Mês anterior"
        onClick={() => onChange(addMonths(year, month, -1))}
        className="rounded-md border border-border-subtle px-3 py-1.5 text-sm hover:bg-foreground/5"
      >
        ←
      </button>
      <span className="min-w-[10rem] text-center text-sm font-medium capitalize">
        {formatMonthYearLabel(year, month)}
      </span>
      <button
        type="button"
        aria-label="Próximo mês"
        onClick={() => onChange(addMonths(year, month, 1))}
        className="rounded-md border border-border-subtle px-3 py-1.5 text-sm hover:bg-foreground/5"
      >
        →
      </button>
    </div>
  );
}
