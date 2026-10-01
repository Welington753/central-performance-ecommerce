"use client";

export type ProblemsTabId = "monthly" | "reasons" | "cases" | "coverage";

export const PROBLEMS_TABS: Array<{ id: ProblemsTabId; label: string }> = [
  { id: "monthly", label: "Visão mensal" },
  { id: "reasons", label: "Motivos" },
  { id: "cases", label: "Casos" },
  { id: "coverage", label: "Cobertura" },
];

export const tabId = (id: ProblemsTabId): string => `problems-tab-${id}`;
export const panelId = (id: ProblemsTabId): string => `problems-panel-${id}`;

interface ProblemsTabsProps {
  active: ProblemsTabId;
  onChange: (tab: ProblemsTabId) => void;
}

export function ProblemsTabs({ active, onChange }: ProblemsTabsProps) {
  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const last = PROBLEMS_TABS.length - 1;
    const next =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : null;
    if (next === null) return;
    event.preventDefault();
    onChange(PROBLEMS_TABS[next].id);
    document.getElementById(tabId(PROBLEMS_TABS[next].id))?.focus();
  }

  return (
    <div role="tablist" aria-label="Seções de Problemas" className="flex gap-1 overflow-x-auto border-b border-border-subtle">
      {PROBLEMS_TABS.map((tab, index) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            id={tabId(tab.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId(tab.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${
              selected ? "border-brand text-brand" : "border-transparent text-foreground/70 hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
