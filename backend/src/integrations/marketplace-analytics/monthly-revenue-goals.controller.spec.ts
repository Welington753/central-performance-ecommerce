import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { MonthlyRevenueGoalsController } from './monthly-revenue-goals.controller';
import { MonthlyRevenueGoalsService } from './monthly-revenue-goals.service';
import { MonthlyRevenueGoalProgressService } from './monthly-revenue-goal-progress.service';
import type { MonthlyRevenueGoal } from './monthly-revenue-goal.entity';

function buildGoal(
  overrides: Partial<MonthlyRevenueGoal> = {},
): MonthlyRevenueGoal {
  return {
    id: 'goal-1',
    year: 2026,
    month: 9,
    currencyId: 'BRL',
    targetAmount: '600000.00',
    createdByUserId: 'user-1',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('MonthlyRevenueGoalsController', () => {
  let goalsService: jest.Mocked<
    Pick<MonthlyRevenueGoalsService, 'findByYearMonth' | 'upsert'>
  >;
  let progressService: jest.Mocked<
    Pick<MonthlyRevenueGoalProgressService, 'computeProgress'>
  >;
  let controller: MonthlyRevenueGoalsController;

  beforeEach(async () => {
    goalsService = { findByYearMonth: jest.fn(), upsert: jest.fn() };
    progressService = { computeProgress: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [MonthlyRevenueGoalsController],
      providers: [
        { provide: MonthlyRevenueGoalsService, useValue: goalsService },
        {
          provide: MonthlyRevenueGoalProgressService,
          useValue: progressService,
        },
      ],
    })
      // AccessTokenGuard/AdminGuard já são cobertos isoladamente por
      // access-token.guard.spec.ts / admin.guard.spec.ts — aqui os métodos
      // do controller são chamados diretamente, guards substituídos por stub
      // (mesma convenção de auth.controller.spec.ts).
      .overrideGuard(AccessTokenGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(MonthlyRevenueGoalsController);
  });

  describe('GET /monthly', () => {
    it('returns configured=false with no targetAmount invented when there is no goal', async () => {
      goalsService.findByYearMonth.mockResolvedValue(null);
      const result = await controller.getMonthlyGoal('2026', '9');
      expect(result).toEqual({
        configured: false,
        year: 2026,
        month: 9,
        currencyId: 'BRL',
        targetAmount: null,
        createdAt: null,
        updatedAt: null,
      });
    });

    it('returns the configured goal', async () => {
      goalsService.findByYearMonth.mockResolvedValue(buildGoal());
      const result = await controller.getMonthlyGoal('2026', '9');
      expect(result.configured).toBe(true);
      expect(result.targetAmount).toBe('600000.00');
    });

    it('rejects an invalid query with 400', async () => {
      await expect(
        controller.getMonthlyGoal('2026', '13'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a missing query parameter with 400', async () => {
      await expect(
        controller.getMonthlyGoal(undefined, undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('PUT /monthly', () => {
    it('upserts using the current user id as createdByUserId and converts targetAmount to a 2-decimal string', async () => {
      goalsService.upsert.mockResolvedValue(buildGoal());

      await controller.upsertMonthlyGoal(
        { year: 2026, month: 9, currencyId: 'BRL', targetAmount: 600000 },
        { sub: 'admin-1', email: 'admin@example.com' },
      );

      expect(goalsService.upsert).toHaveBeenCalledWith({
        year: 2026,
        month: 9,
        currencyId: 'BRL',
        targetAmount: '600000.00',
        createdByUserId: 'admin-1',
      });
    });

    it('returns the persisted goal mapped to the response DTO', async () => {
      goalsService.upsert.mockResolvedValue(
        buildGoal({ targetAmount: '450000.00' }),
      );
      const result = await controller.upsertMonthlyGoal(
        { year: 2026, month: 9, currencyId: 'BRL', targetAmount: 450000 },
        { sub: 'admin-1', email: 'admin@example.com' },
      );
      expect(result.targetAmount).toBe('450000.00');
    });
  });

  describe('GET /monthly-progress', () => {
    it('delegates to the progress service with the parsed year/month and current time', async () => {
      progressService.computeProgress.mockResolvedValue({
        year: 2026,
        month: 9,
        currencyId: 'BRL',
        goal: null,
        window: {
          monthKind: 'CURRENT',
          daysInMonth: 30,
          daysCompleted: 14,
          cutoffDate: '2026-09-14',
          windowFromUtc: new Date(),
          windowToExclusiveUtc: new Date(),
        },
        progress: {
          live: {
            eligibleRevenueCents: 0n,
            achievementPercentage: null,
            remainingAmountCents: null,
          },
          closedDays: {
            revenueCents: 0n,
            currentDailyAverageCents: null,
            expectedRevenueCents: null,
            projectedRevenueCents: null,
            requiredDailyRevenueCents: null,
          },
        },
        dailyPace: [],
        refunds: {
          partiallyRefundedOrders: 0,
          partiallyRefundedGrossAmountCents: 0n,
          coverage: 'COMPLETE',
        },
      });

      const result = await controller.getMonthlyProgress('2026', '9');

      expect(progressService.computeProgress).toHaveBeenCalledWith(
        2026,
        9,
        expect.any(Date),
      );
      expect(result.goal.configured).toBe(false);
    });

    it('rejects an invalid query with 400', async () => {
      await expect(
        controller.getMonthlyProgress('2026', 'abc'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
