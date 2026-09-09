/**
 * Cálculos temporais de "Metas e Ritmo" (Checkpoint BI-1) — funções puras,
 * sem acesso a rede/banco, para serem testáveis isoladamente. Primitivas de
 * fuso horário em `sao-paulo-timezone.util.ts` (reaproveitáveis fora do
 * contexto de meta); aqui só a semântica de "dias completos"/progresso.
 */
import {
  SAO_PAULO_IANA_TIME_ZONE,
  addDaysToDateOnly,
  dateOnlyToString,
  daysInMonth,
  zonedDateOnly,
  zonedDateOnlyToUtcInstant,
  type DateOnly,
} from './sao-paulo-timezone.util';

export { daysInMonth, zonedDateOnly, zonedDateOnlyToUtcInstant, type DateOnly };
export const GOAL_TIME_ZONE = SAO_PAULO_IANA_TIME_ZONE;

export type MonthKind = 'PAST' | 'CURRENT' | 'FUTURE';

export function classifyMonth(
  year: number,
  month: number,
  today: DateOnly,
): MonthKind {
  if (year === today.year && month === today.month) return 'CURRENT';
  if (year < today.year || (year === today.year && month < today.month)) {
    return 'PAST';
  }
  return 'FUTURE';
}

export interface ClosedDaysWindow {
  monthKind: MonthKind;
  daysInMonth: number;
  /**
   * Mês atual: dias encerrados ANTES do início de hoje (nunca inclui hoje).
   * Mês passado: todos os dias do mês. Mês futuro: zero.
   */
  daysCompleted: number;
  /** Último dia encerrado, ou o dia anterior ao início do mês quando `daysCompleted === 0` (nunca "dia 0"). */
  cutoffDate: string;
  /** Início do mês (dia 1, meia-noite `America/Sao_Paulo`), como instante UTC. */
  windowFromUtc: Date;
  /** Fim EXCLUSIVO da janela de dias completos — nunca inclui o dia corrente num mês atual. */
  windowToExclusiveUtc: Date;
}

/**
 * Janela de "dias completos" do mês selecionado, relativa a `referenceNow`
 * (o "agora" real, convertido para `America/Sao_Paulo`). Início inclusivo,
 * fim exclusivo — mesmo padrão já usado pelo resto do sistema
 * (`period.util.ts`).
 */
export function computeClosedDaysWindow(
  year: number,
  month: number,
  referenceNow: Date,
  timeZone: string = GOAL_TIME_ZONE,
): ClosedDaysWindow {
  const today = zonedDateOnly(referenceNow, timeZone);
  const totalDays = daysInMonth(year, month);
  const monthKind = classifyMonth(year, month, today);

  const daysCompleted =
    monthKind === 'PAST'
      ? totalDays
      : monthKind === 'FUTURE'
        ? 0
        : today.day - 1;

  const windowFromUtc = zonedDateOnlyToUtcInstant(
    { year, month, day: 1 },
    timeZone,
  );
  const windowToExclusiveUtc =
    daysCompleted === 0
      ? windowFromUtc
      : zonedDateOnlyToUtcInstant(
          { year, month, day: daysCompleted + 1 },
          timeZone,
        );

  const cutoffDate =
    daysCompleted === 0
      ? dateOnlyToString(addDaysToDateOnly({ year, month, day: 1 }, -1))
      : dateOnlyToString({ year, month, day: daysCompleted });

  return {
    monthKind,
    daysInMonth: totalDays,
    daysCompleted,
    cutoffDate,
    windowFromUtc,
    windowToExclusiveUtc,
  };
}

/**
 * Fim EXCLUSIVO do mês inteiro (início do mês seguinte) — usado para a
 * janela de `live.eligibleRevenue` (que PODE incluir hoje) e para o escopo
 * mensal de `refunds` (que cobre o mês inteiro independente de dias
 * completos).
 */
export function monthWindowExclusiveEnd(
  year: number,
  month: number,
  timeZone: string = GOAL_TIME_ZONE,
): Date {
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return zonedDateOnlyToUtcInstant(
    { year: nextYear, month: nextMonth, day: 1 },
    timeZone,
  );
}

/** `null` representa UNAVAILABLE — nunca `0` usado para dizer "sem dado". */
export type MaybeCents = bigint | null;

export interface GoalProgressInput {
  window: ClosedDaysWindow;
  /** `null`: nenhuma meta cadastrada para o mês/moeda — todo KPI dependente de meta sai UNAVAILABLE. */
  targetAmountCents: bigint | null;
  /** Faturamento "ao vivo" (`paid`, pode incluir hoje) do mês inteiro selecionado. */
  liveEligibleRevenueCents: bigint;
  /** Faturamento (`paid`) só dos dias completos (nunca inclui hoje num mês atual). */
  closedDaysRevenueCents: bigint;
}

export interface GoalProgressResult {
  live: {
    eligibleRevenueCents: bigint;
    /** Percentual (pode passar de 100) — `null` sem meta configurada. */
    achievementPercentage: number | null;
    remainingAmountCents: MaybeCents;
  };
  closedDays: {
    revenueCents: bigint;
    currentDailyAverageCents: MaybeCents;
    expectedRevenueCents: MaybeCents;
    projectedRevenueCents: MaybeCents;
    requiredDailyRevenueCents: MaybeCents;
  };
}

/**
 * Núcleo puro dos cálculos de meta/ritmo (design §4, itens A–I). Nenhum
 * acesso a banco — todo valor de faturamento já chega pronto, em centavos.
 */
export function computeGoalProgress(
  input: GoalProgressInput,
): GoalProgressResult {
  const {
    window,
    targetAmountCents,
    liveEligibleRevenueCents,
    closedDaysRevenueCents,
  } = input;

  // G: percentual atingido / H: falta para meta — sempre com base no "ao
  // vivo" (pode incluir hoje), nunca nos dias completos.
  const achievementPercentage =
    targetAmountCents === null || targetAmountCents <= 0n
      ? null
      : centsRatioToPercentage(liveEligibleRevenueCents, targetAmountCents);
  const remainingAmountCents =
    targetAmountCents === null
      ? null
      : maxBigint(targetAmountCents - liveEligibleRevenueCents, 0n);

  // D: média diária — UNAVAILABLE sem nenhum dia completo (nunca 0/0).
  const currentDailyAverageCents =
    window.daysCompleted === 0
      ? null
      : divideBigintRoundHalfUp(
          closedDaysRevenueCents,
          BigInt(window.daysCompleted),
        );

  // E: esperado até ontem — validamente 0 no dia 1 do mês (0 dias
  // completos), nunca tratado como ausente; UNAVAILABLE só sem meta.
  const expectedRevenueCents =
    targetAmountCents === null
      ? null
      : divideBigintRoundHalfUp(
          targetAmountCents * BigInt(window.daysCompleted),
          BigInt(window.daysInMonth),
        );

  // F: projeção — UNAVAILABLE sem nenhum dia completo (mês atual dia 1, ou
  // mês futuro, ambos com daysCompleted=0) OU sem meta. Mês passado: a
  // mesma fórmula (média × diasCompletos, que aqui é o mês inteiro) já
  // converge para o realizado final — nenhum caso especial necessário.
  const projectedRevenueCents =
    targetAmountCents === null || currentDailyAverageCents === null
      ? null
      : currentDailyAverageCents * BigInt(window.daysInMonth);

  // I: necessário por dia a partir de hoje — UNAVAILABLE no mês passado ou
  // sem nenhum dia restante; nunca depende de `daysCompleted >= 1` (dia 1
  // do mês É calculável: sobra o mês inteiro pela frente).
  const daysRemaining = window.daysInMonth - window.daysCompleted;
  const requiredDailyRevenueCents =
    targetAmountCents === null ||
    window.monthKind === 'PAST' ||
    daysRemaining <= 0
      ? null
      : divideBigintRoundHalfUp(
          maxBigint(targetAmountCents - closedDaysRevenueCents, 0n),
          BigInt(daysRemaining),
        );

  return {
    live: {
      eligibleRevenueCents: liveEligibleRevenueCents,
      achievementPercentage,
      remainingAmountCents,
    },
    closedDays: {
      revenueCents: closedDaysRevenueCents,
      currentDailyAverageCents,
      expectedRevenueCents,
      projectedRevenueCents,
      requiredDailyRevenueCents,
    },
  };
}

export interface DailyPacePoint {
  day: number;
  date: string;
  targetCumulativeCents: bigint | null;
  /** `null`: dia ainda não encerrado (nunca um valor inventado). */
  realizedCumulativeCents: bigint | null;
}

/**
 * J/K: linha de ritmo esperado (todo o mês) x realizado acumulado (só até
 * `daysCompleted` — nunca mistura hoje parcial com a linha "encerrada").
 * `dailyRevenueCents` é um mapa dia→faturamento daquele dia isolado (não
 * acumulado) — dias sem pedido algum devem vir com `0n`, nunca ausentes.
 */
export function buildDailyPace(
  year: number,
  month: number,
  window: ClosedDaysWindow,
  targetAmountCents: bigint | null,
  dailyRevenueCents: ReadonlyMap<number, bigint>,
): DailyPacePoint[] {
  const points: DailyPacePoint[] = [];
  let cumulative = 0n;

  for (let day = 1; day <= window.daysInMonth; day += 1) {
    const targetCumulativeCents =
      targetAmountCents === null
        ? null
        : divideBigintRoundHalfUp(
            targetAmountCents * BigInt(day),
            BigInt(window.daysInMonth),
          );

    let realizedCumulativeCents: bigint | null = null;
    if (day <= window.daysCompleted) {
      cumulative += dailyRevenueCents.get(day) ?? 0n;
      realizedCumulativeCents = cumulative;
    }

    points.push({
      day,
      date: dateOnlyToString({ year, month, day }),
      targetCumulativeCents,
      realizedCumulativeCents,
    });
  }

  return points;
}

function centsRatioToPercentage(
  numeratorCents: bigint,
  denominatorCents: bigint,
): number {
  if (denominatorCents === 0n) return 0;
  // Precisão de 2 casas percentuais (ex.: 87.34%) sem ponto flutuante:
  // multiplica por 10_000 (2 casas de "%" + 2 casas de arredondamento) antes
  // de dividir, depois desloca a vírgula na conversão para `number`.
  const scaled = divideBigintRoundHalfUp(
    numeratorCents * 10000n,
    denominatorCents,
  );
  return Number(scaled) / 100;
}

function maxBigint(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

/** Arredondamento "meio para cima" — mesma convenção de `money.util.ts#divideCents`, generalizada para qualquer denominador inteiro. */
function divideBigintRoundHalfUp(
  numerator: bigint,
  denominator: bigint,
): bigint {
  if (denominator === 0n) return 0n;
  const negative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  const doubled = absNumerator * 2n;
  const rounded = (doubled + absDenominator) / (absDenominator * 2n);
  return negative ? -rounded : rounded;
}
