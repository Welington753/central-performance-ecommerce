import {
  BadRequestException,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { AuthorizationContextService } from '../../auth/authorization-context.service';
import { PermissionGuard } from '../../auth/guards/permission.guard';
import type { AuthorizationContext } from '../../users/authorization-context.interface';
import { PERMISSIONS } from '../../users/permissions.catalog';
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
      // AccessTokenGuard/PermissionGuard já são cobertos isoladamente e,
      // abaixo, por uma suíte HTTP dedicada (Checkpoint 5A) — aqui os
      // métodos do controller são chamados diretamente, guards substituídos
      // por stub (mesma convenção de auth.controller.spec.ts).
      .overrideGuard(AccessTokenGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
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

/**
 * Checkpoint 5A — substitui `AdminGuard` por `PermissionGuard` genérico:
 * leitura exige `goals.view`, escrita exige `goals.manage`. Suíte HTTP real
 * (guards de verdade, service mockado) — os testes acima cobrem a lógica de
 * negócio do controller isoladamente; esta cobre só a autorização.
 */
describe('MonthlyRevenueGoalsController — autorização (HTTP)', () => {
  let app: INestApplication;
  const http = () => app.getHttpServer() as Parameters<typeof request>[0];
  let currentUserId: string | null;
  let currentPermissions: string[];
  let currentMustChangePassword: boolean;

  const goalsService = { findByYearMonth: jest.fn(), upsert: jest.fn() };
  const progressService = { computeProgress: jest.fn() };

  const authorizationContextService = {
    resolveForRequest: jest.fn((request: Request): AuthorizationContext => {
      const context: AuthorizationContext = {
        userId: currentUserId ?? 'anon',
        active: true,
        roleKey: 'ADMIN',
        isAdmin: true,
        permissions: currentPermissions as never,
        accountScope: { mode: 'ALL' },
        mustChangePassword: currentMustChangePassword,
      };
      request.authorizationContext = context;
      return context;
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MonthlyRevenueGoalsController],
      providers: [
        { provide: MonthlyRevenueGoalsService, useValue: goalsService },
        {
          provide: MonthlyRevenueGoalProgressService,
          useValue: progressService,
        },
        {
          provide: AuthorizationContextService,
          useValue: authorizationContextService,
        },
        PermissionGuard,
      ],
    })
      .overrideGuard(AccessTokenGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          if (currentUserId === null) {
            throw new UnauthorizedException('Não autenticado.');
          }
          const req = context.switchToHttp().getRequest<Request>();
          req.user = { sub: currentUserId, email: 'a@b.com' };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    currentUserId = 'u1';
    currentPermissions = [PERMISSIONS.GOALS_VIEW, PERMISSIONS.GOALS_MANAGE];
    currentMustChangePassword = false;
    goalsService.findByYearMonth.mockResolvedValue(null);
    goalsService.upsert.mockResolvedValue(buildGoal());
  });

  describe('GET /marketplace-analytics/goals/monthly (goals.view)', () => {
    it('401 sem autenticação', async () => {
      currentUserId = null;
      await request(http())
        .get('/marketplace-analytics/goals/monthly?year=2026&month=9')
        .expect(401);
    });

    it('403 sem goals.view', async () => {
      currentPermissions = [];
      await request(http())
        .get('/marketplace-analytics/goals/monthly?year=2026&month=9')
        .expect(403);
    });

    it('200 com goals.view (ANALYST/VIEWER conseguem visualizar)', async () => {
      currentPermissions = [PERMISSIONS.GOALS_VIEW];
      await request(http())
        .get('/marketplace-analytics/goals/monthly?year=2026&month=9')
        .expect(200);
    });

    it('403 PASSWORD_CHANGE_REQUIRED quando mustChangePassword', async () => {
      currentMustChangePassword = true;
      const res = await request(http())
        .get('/marketplace-analytics/goals/monthly?year=2026&month=9')
        .expect(403);
      expect((res.body as { message: string }).message).toBe(
        'PASSWORD_CHANGE_REQUIRED',
      );
    });
  });

  describe('PUT /marketplace-analytics/goals/monthly (goals.manage)', () => {
    const body = {
      year: 2026,
      month: 9,
      currencyId: 'BRL',
      targetAmount: 600000,
    };

    it('403 com só goals.view — leitura não libera escrita', async () => {
      currentPermissions = [PERMISSIONS.GOALS_VIEW];
      await request(http())
        .put('/marketplace-analytics/goals/monthly')
        .send(body)
        .expect(403);
      expect(goalsService.upsert).not.toHaveBeenCalled();
    });

    it('200 com goals.manage (ADMIN continua funcionando)', async () => {
      await request(http())
        .put('/marketplace-analytics/goals/monthly')
        .send(body)
        .expect(200);
      expect(goalsService.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /marketplace-analytics/goals/monthly-progress (goals.view)', () => {
    it('403 sem goals.view', async () => {
      currentPermissions = [];
      await request(http())
        .get('/marketplace-analytics/goals/monthly-progress?year=2026&month=9')
        .expect(403);
    });
  });
});
