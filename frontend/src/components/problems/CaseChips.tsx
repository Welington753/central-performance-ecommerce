import { Badge, type BadgeTone } from "@/components/problems/ProblemsBadges";
import { RESPONSIBILITY_LABELS, impactLabel, statusLabel } from "@/lib/problems-format";
import type { ProblemResponsibility } from "@/types/problems";

export function StatusChip({ status }: { status: string }) {
  return (
    <Badge tone={status === "closed" ? "neutral" : "notice"} symbol={status === "closed" ? "✓" : "●"}>
      {statusLabel(status)}
    </Badge>
  );
}

const IMPACT_STYLE: Record<string, { tone: BadgeTone; symbol: string }> = {
  affected: { tone: "negative", symbol: "▲" },
  not_affected: { tone: "positive", symbol: "✓" },
  not_applies: { tone: "neutral", symbol: "–" },
};

export function ImpactChip({ impact }: { impact: string | null }) {
  const style = (impact && IMPACT_STYLE[impact]) || { tone: "neutral" as const, symbol: "?" };
  return (
    <Badge tone={style.tone} symbol={style.symbol}>
      {impactLabel(impact)}
    </Badge>
  );
}

export function ResponsibilityChip({ responsibility }: { responsibility: ProblemResponsibility }) {
  return (
    <Badge tone="neutral" symbol={responsibility === "UNKNOWN" ? "?" : "◆"}>
      {RESPONSIBILITY_LABELS[responsibility]}
    </Badge>
  );
}
