import { Badge, type BadgeTone } from "@/components/problems/ProblemsBadges";
import {
  COVERAGE_LABELS,
  HISTORICAL_STATUS_LABELS,
  type MonthCoverageLabel,
} from "@/lib/problems-monthly-format";
import type { ProblemsHistoricalStatus } from "@/types/problems";

const COVERAGE_STYLE: Record<MonthCoverageLabel, { tone: BadgeTone; symbol: string }> = {
  COMPLETE: { tone: "positive", symbol: "✓" },
  PARTIAL: { tone: "notice", symbol: "◐" },
  UNKNOWN: { tone: "notice", symbol: "?" },
  NO_DATA: { tone: "neutral", symbol: "–" },
};

export function CoverageBadge({ coverage }: { coverage: MonthCoverageLabel }) {
  const style = COVERAGE_STYLE[coverage];
  return (
    <Badge tone={style.tone} symbol={style.symbol}>
      {COVERAGE_LABELS[coverage]}
    </Badge>
  );
}

const HISTORICAL_STYLE: Record<ProblemsHistoricalStatus, { tone: BadgeTone; symbol: string }> = {
  COMPLETED: { tone: "positive", symbol: "✓" },
  RUNNING: { tone: "neutral", symbol: "▶" },
  PAUSED: { tone: "notice", symbol: "‖" },
  NO_TARGET: { tone: "neutral", symbol: "–" },
  FAILED: { tone: "negative", symbol: "!" },
  NOT_STARTED: { tone: "neutral", symbol: "○" },
};

export function HistoricalStatusBadge({ status }: { status: ProblemsHistoricalStatus }) {
  const style = HISTORICAL_STYLE[status];
  return (
    <Badge tone={style.tone} symbol={style.symbol}>
      {HISTORICAL_STATUS_LABELS[status]}
    </Badge>
  );
}
