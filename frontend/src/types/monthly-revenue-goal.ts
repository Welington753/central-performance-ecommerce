// Espelha o contrato do backend (Checkpoint BI-1, "Metas e Ritmo")
// exatamente — ver monthly-revenue-goal(-progress)-response.dto.ts.

export type RefundCoverage = "COMPLETE" | "PARTIAL" | "UNAVAILABLE";

export interface MonthlyRevenueGoalLookupDto {
  configured: boolean;
  year: number;
  month: number;
  currencyId: string;
  targetAmount: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface MonthlyRevenueGoalDto {
  year: number;
  month: number;
  currencyId: string;
  targetAmount: string;
  createdAt: string;
  updatedAt: string;
}

export interface MonthlyRevenueGoalProgressGoal {
  configured: boolean;
  targetAmount: string | null;
}

export interface MonthlyRevenueGoalProgressLive {
  eligibleRevenue: string;
  achievementPercentage: number | null;
  remainingAmount: string | null;
}

export interface MonthlyRevenueGoalProgressClosedDays {
  cutoffDate: string;
  daysCompleted: number;
  daysInMonth: number;
  revenue: string;
  currentDailyAverage: string | null;
  expectedRevenue: string | null;
  projectedRevenue: string | null;
  requiredDailyRevenue: string | null;
}

export interface MonthlyRevenueGoalProgressRefunds {
  partiallyRefundedOrders: number;
  partiallyRefundedGrossAmount: string;
  coverage: RefundCoverage;
}

export interface MonthlyRevenueGoalDailyPacePoint {
  day: number;
  date: string;
  targetCumulative: string | null;
  realizedCumulative: string | null;
}

export interface MonthlyRevenueGoalProgressDto {
  year: number;
  month: number;
  currencyId: string;
  goal: MonthlyRevenueGoalProgressGoal;
  live: MonthlyRevenueGoalProgressLive;
  closedDays: MonthlyRevenueGoalProgressClosedDays;
  refunds: MonthlyRevenueGoalProgressRefunds;
  dailyPace: MonthlyRevenueGoalDailyPacePoint[];
}
