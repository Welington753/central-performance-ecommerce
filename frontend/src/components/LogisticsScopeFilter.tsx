import type { LogisticsScopeFilter as LogisticsScopeValue } from "@/types/marketplace-analytics";

interface LogisticsScopeFilterProps {
  value: LogisticsScopeValue;
  onChange: (next: LogisticsScopeValue) => void;
}

const OPTIONS: Array<{ value: LogisticsScopeValue; label: string }> = [
  { value: "ALL", label: "Todas as vendas" },
  { value: "FULL", label: "Somente Full" },
  { value: "NON_FULL", label: "Vendas sem Full" },
];

/**
 * Filtro "Tipo de venda" (Fase 4, item 2) — só faz sentido dentro do escopo
 * Mercado Livre; o chamador (dashboard) é responsável por só renderizar
 * este componente quando `marketplace === "MERCADO_LIVRE"` e por restaurar
 * o valor para `ALL` ao trocar de marketplace.
 */
export function LogisticsScopeFilter({ value, onChange }: LogisticsScopeFilterProps) {
  return (
    <fieldset className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface px-5 py-4">
      <legend className="px-1 text-sm font-medium text-foreground/70">
        Tipo de venda
      </legend>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
              value === option.value
                ? "border-brand bg-brand/10 text-brand"
                : "border-border-subtle hover:bg-foreground/5"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
