import {
  GOAL_TIME_ZONE,
  buildDailyPace,
  classifyMonth,
  computeClosedDaysWindow,
  computeGoalProgress,
  zonedDateOnlyToUtcInstant,
} from './goal-pace.util';

// zonedDateOnly/zonedDateOnlyToUtcInstant/daysInMonth (primitivas de fuso
// horário puras) são testadas em sao-paulo-timezone.util.spec.ts;
// computeClosedDaysWindow/monthWindowExclusiveEnd em
// closed-days-window.util.spec.ts — aqui só o cálculo de progresso em si.

describe('classifyMonth', () => {
  const today = { year: 2026, month: 9, day: 15 };

  it('is CURRENT for the same year/month as today', () => {
    expect(classifyMonth(2026, 9, today)).toBe('CURRENT');
  });

  it('is PAST for an earlier month, same year', () => {
    expect(classifyMonth(2026, 8, today)).toBe('PAST');
  });

  it('is PAST for an earlier year entirely', () => {
    expect(classifyMonth(2025, 12, today)).toBe('PAST');
  });

  it('is FUTURE for a later month, same year', () => {
    expect(classifyMonth(2026, 10, today)).toBe('FUTURE');
  });

  it('is FUTURE for a later year entirely', () => {
    expect(classifyMonth(2027, 1, today)).toBe('FUTURE');
  });
});

describe('computeGoalProgress', () => {
  const currentMonthDay15Window = computeClosedDaysWindow(
    2026,
    9,
    zonedDateOnlyToUtcInstant({ year: 2026, month: 9, day: 15 }),
  ); // 14 dias completos, 30 no mes

  it('is UNAVAILABLE (null) for every goal-dependent field when there is no configured goal', () => {
    const result = computeGoalProgress({
      window: currentMonthDay15Window,
      targetAmountCents: null,
      liveEligibleRevenueCents: 500000n,
      closedDaysRevenueCents: 400000n,
    });

    expect(result.live.achievementPercentage).toBeNull();
    expect(result.live.remainingAmountCents).toBeNull();
    expect(result.closedDays.expectedRevenueCents).toBeNull();
    expect(result.closedDays.projectedRevenueCents).toBeNull();
    expect(result.closedDays.requiredDailyRevenueCents).toBeNull();
    // Faturamento realizado NUNCA depende de meta configurada.
    expect(result.live.eligibleRevenueCents).toBe(500000n);
    expect(result.closedDays.revenueCents).toBe(400000n);
  });

  it('computes every field with a configured goal on a normal mid-month day', () => {
    const result = computeGoalProgress({
      window: currentMonthDay15Window, // daysCompleted=14, daysInMonth=30
      targetAmountCents: 60000000n, // R$ 600.000,00
      liveEligibleRevenueCents: 32000000n, // R$ 320.000,00 (ao vivo, inclui hoje)
      closedDaysRevenueCents: 28000000n, // R$ 280.000,00 (só dias completos)
    });

    expect(result.live.achievementPercentage).toBeCloseTo(
      (32000000 / 60000000) * 100,
      2,
    );
    expect(result.live.remainingAmountCents).toBe(60000000n - 32000000n);
    expect(result.closedDays.currentDailyAverageCents).toBe(28000000n / 14n);
    expect(result.closedDays.expectedRevenueCents).toBe(
      (60000000n * 14n) / 30n,
    );
    expect(result.closedDays.projectedRevenueCents).toBe(
      (28000000n / 14n) * 30n,
    );
    expect(result.closedDays.requiredDailyRevenueCents).toBe(
      (60000000n - 28000000n) / (30n - 14n),
    );
  });

  it('achievementPercentage can exceed 100%', () => {
    const result = computeGoalProgress({
      window: currentMonthDay15Window,
      targetAmountCents: 10000n,
      liveEligibleRevenueCents: 25000n,
      closedDaysRevenueCents: 20000n,
    });
    expect(result.live.achievementPercentage).toBe(250);
  });

  it('remainingAmount never goes negative when the goal is already exceeded', () => {
    const result = computeGoalProgress({
      window: currentMonthDay15Window,
      targetAmountCents: 10000n,
      liveEligibleRevenueCents: 25000n,
      closedDaysRevenueCents: 20000n,
    });
    expect(result.live.remainingAmountCents).toBe(0n);
  });

  it('first day of the month: expectedRevenue is validly zero, average/projection are UNAVAILABLE, requiredDailyRevenue IS computable', () => {
    const window = computeClosedDaysWindow(
      2026,
      9,
      zonedDateOnlyToUtcInstant({ year: 2026, month: 9, day: 1 }),
    );
    const result = computeGoalProgress({
      window,
      targetAmountCents: 30000000n,
      liveEligibleRevenueCents: 0n,
      closedDaysRevenueCents: 0n,
    });

    expect(result.closedDays.expectedRevenueCents).toBe(0n);
    expect(result.closedDays.currentDailyAverageCents).toBeNull();
    expect(result.closedDays.projectedRevenueCents).toBeNull();
    // Dia 1: ainda restam TODOS os dias do mês — nunca UNAVAILABLE por isso sozinho.
    expect(result.closedDays.requiredDailyRevenueCents).toBe(30000000n / 30n);
  });

  it('past month: requiredDailyRevenue is UNAVAILABLE (no remaining days)', () => {
    const window = computeClosedDaysWindow(
      2026,
      8,
      zonedDateOnlyToUtcInstant({ year: 2026, month: 9, day: 15 }),
    );
    const result = computeGoalProgress({
      window,
      targetAmountCents: 30000000n,
      liveEligibleRevenueCents: 31000000n,
      closedDaysRevenueCents: 31000000n,
    });
    expect(result.closedDays.requiredDailyRevenueCents).toBeNull();
  });

  it('past month: projectedRevenue converges to the final realized amount (no special-casing needed)', () => {
    const window = computeClosedDaysWindow(
      2026,
      8,
      zonedDateOnlyToUtcInstant({ year: 2026, month: 9, day: 15 }),
    );
    const result = computeGoalProgress({
      window,
      targetAmountCents: 30000000n,
      liveEligibleRevenueCents: 31000000n,
      closedDaysRevenueCents: 31000000n,
    });
    expect(result.closedDays.projectedRevenueCents).toBe(31000000n);
  });

  it('future month: every closedDays KPI is UNAVAILABLE', () => {
    const window = computeClosedDaysWindow(
      2026,
      12,
      zonedDateOnlyToUtcInstant({ year: 2026, month: 9, day: 15 }),
    );
    const result = computeGoalProgress({
      window,
      targetAmountCents: 30000000n,
      liveEligibleRevenueCents: 0n,
      closedDaysRevenueCents: 0n,
    });
    expect(result.closedDays.currentDailyAverageCents).toBeNull();
    expect(result.closedDays.projectedRevenueCents).toBeNull();
    // Mes futuro (dezembro, 31 dias): todos os dias ainda estao por vir ->
    // computavel. 30_000_000 / 31, arredondado meio-para-cima = 967742.
    expect(result.closedDays.requiredDailyRevenueCents).toBe(967742n);
  });

  it('never divides by zero: a goal of zero cents is treated as no goal (achievementPercentage null)', () => {
    const result = computeGoalProgress({
      window: currentMonthDay15Window,
      targetAmountCents: 0n,
      liveEligibleRevenueCents: 1000n,
      closedDaysRevenueCents: 1000n,
    });
    expect(result.live.achievementPercentage).toBeNull();
  });
});

describe('buildDailyPace', () => {
  it('produces one point per day of the month, target line for every day, realized line only up to daysCompleted', () => {
    const window = computeClosedDaysWindow(
      2026,
      9,
      zonedDateOnlyToUtcInstant({ year: 2026, month: 9, day: 4 }), // 3 dias completos
    );
    const daily = new Map<number, bigint>([
      [1, 1000n],
      [2, 2000n],
      [3, 0n], // dia real sem venda -> 0n, nunca ausente
    ]);

    const points = buildDailyPace(2026, 9, window, 30000000n, daily);

    expect(points).toHaveLength(30);
    expect(points[0]).toMatchObject({ day: 1, realizedCumulativeCents: 1000n });
    expect(points[1]).toMatchObject({ day: 2, realizedCumulativeCents: 3000n });
    expect(points[2]).toMatchObject({ day: 3, realizedCumulativeCents: 3000n });
    // Dia 4 em diante: ainda não encerrado -> nunca um valor inventado.
    expect(points[3].realizedCumulativeCents).toBeNull();
    expect(points[29].realizedCumulativeCents).toBeNull();
  });

  it('targetCumulative line exists for every day even without any realized data (future month)', () => {
    const window = computeClosedDaysWindow(
      2026,
      12,
      zonedDateOnlyToUtcInstant({ year: 2026, month: 9, day: 15 }),
    );
    const points = buildDailyPace(2026, 12, window, 30000000n, new Map());
    expect(points.every((p) => p.realizedCumulativeCents === null)).toBe(true);
    expect(points.every((p) => p.targetCumulativeCents !== null)).toBe(true);
    expect(points[points.length - 1].targetCumulativeCents).toBe(30000000n);
  });

  it('targetCumulative is null throughout when there is no configured goal', () => {
    const window = computeClosedDaysWindow(
      2026,
      9,
      zonedDateOnlyToUtcInstant({ year: 2026, month: 9, day: 15 }),
    );
    const points = buildDailyPace(2026, 9, window, null, new Map());
    expect(points.every((p) => p.targetCumulativeCents === null)).toBe(true);
  });
});

describe('GOAL_TIME_ZONE', () => {
  it('is the IANA zone identifier, never a fixed offset', () => {
    expect(GOAL_TIME_ZONE).toBe('America/Sao_Paulo');
  });
});
