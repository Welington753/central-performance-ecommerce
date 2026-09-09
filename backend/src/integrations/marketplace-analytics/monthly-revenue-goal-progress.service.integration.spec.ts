import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceOrder } from '../marketplace-orders/marketplace-order.entity';
import { MarketplaceOrderItem } from '../marketplace-orders/marketplace-order-item.entity';
import { zonedDateOnlyToUtcInstant } from './goal-pace.util';
import { MonthlyRevenueGoal } from './monthly-revenue-goal.entity';
import { MonthlyRevenueGoalProgressService } from './monthly-revenue-goal-progress.service';
import { MonthlyRevenueGoalsService } from './monthly-revenue-goals.service';

describe('MonthlyRevenueGoalProgressService (Postgres real)', () => {
  let dataSource: DataSource;
  let goalsService: MonthlyRevenueGoalsService;
  let progressService: MonthlyRevenueGoalProgressService;

  beforeAll(async () => {
    dataSource = await createTestDataSource([
      MarketplaceAccount,
      MarketplaceOrder,
      MarketplaceOrderItem,
      MonthlyRevenueGoal,
    ]);
    goalsService = new MonthlyRevenueGoalsService(dataSource);
    progressService = new MonthlyRevenueGoalProgressService(
      dataSource,
      goalsService,
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE marketplace_order_items CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_orders CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
    await dataSource.query('TRUNCATE TABLE monthly_revenue_goals CASCADE');
  });

  async function seedAccount(marketplace: Marketplace): Promise<string> {
    const account = await dataSource.getRepository(MarketplaceAccount).save({
      id: randomUUID(),
      marketplace,
      status: MarketplaceAccountStatus.CONNECTED,
      tokenVersion: 1,
    });
    return account.id;
  }

  async function seedOrder(input: {
    accountId: string;
    externalOrderId: string;
    status: string;
    totalAmount: string;
    dateCreated: Date;
    currencyId?: string;
  }): Promise<void> {
    await dataSource.query(
      `INSERT INTO marketplace_orders
          (marketplace_account_id, external_order_id, status, currency_id, total_amount, date_created)
        VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.accountId,
        input.externalOrderId,
        input.status,
        input.currencyId ?? 'BRL',
        input.totalAmount,
        input.dateCreated,
      ],
    );
  }

  const referenceNow = zonedDateOnlyToUtcInstant({
    year: 2026,
    month: 9,
    day: 15,
  });

  it('consolidates revenue across MULTIPLE accounts and marketplaces — never scoped by account/marketplace', async () => {
    const mlAccount = await seedAccount(Marketplace.MERCADO_LIVRE);
    const amazonAccount = await seedAccount(Marketplace.AMAZON);
    await seedOrder({
      accountId: mlAccount,
      externalOrderId: '1',
      status: 'paid',
      totalAmount: '100.00',
      dateCreated: zonedDateOnlyToUtcInstant({ year: 2026, month: 9, day: 5 }),
    });
    await seedOrder({
      accountId: amazonAccount,
      externalOrderId: '2',
      status: 'paid',
      totalAmount: '50.00',
      dateCreated: zonedDateOnlyToUtcInstant({ year: 2026, month: 9, day: 6 }),
    });

    const progress = await progressService.computeProgress(
      2026,
      9,
      referenceNow,
    );
    expect(progress.progress.live.eligibleRevenueCents).toBe(15000n);
  });

  it('goal.configured is false and goal-dependent KPIs are null when no goal exists for the month', async () => {
    const progress = await progressService.computeProgress(
      2026,
      9,
      referenceNow,
    );
    expect(progress.goal).toBeNull();
    expect(progress.progress.live.achievementPercentage).toBeNull();
  });

  it('uses the configured goal for the requested year/month/BRL', async () => {
    await goalsService.upsert({
      year: 2026,
      month: 9,
      currencyId: 'BRL',
      targetAmount: '600000.00',
      createdByUserId: null,
    });

    const progress = await progressService.computeProgress(
      2026,
      9,
      referenceNow,
    );
    expect(progress.goal?.targetAmount).toBe('600000.00');
    expect(progress.progress.live.achievementPercentage).toBe(0);
  });

  it('closed-days revenue never includes today (current month)', async () => {
    const accountId = await seedAccount(Marketplace.MERCADO_LIVRE);
    await seedOrder({
      accountId,
      externalOrderId: 'today',
      status: 'paid',
      totalAmount: '999.00',
      dateCreated: zonedDateOnlyToUtcInstant({ year: 2026, month: 9, day: 15 }), // "hoje"
    });
    await seedOrder({
      accountId,
      externalOrderId: 'yesterday',
      status: 'paid',
      totalAmount: '10.00',
      dateCreated: zonedDateOnlyToUtcInstant({ year: 2026, month: 9, day: 14 }),
    });

    const progress = await progressService.computeProgress(
      2026,
      9,
      referenceNow,
    );
    // "Ao vivo" inclui hoje; "dias completos" nunca inclui.
    expect(progress.progress.live.eligibleRevenueCents).toBe(100900n);
    expect(progress.progress.closedDays.revenueCents).toBe(1000n);
  });

  it('surfaces partially_refunded orders scoped to the whole selected month, isolated from grossRevenue', async () => {
    const accountId = await seedAccount(Marketplace.MERCADO_LIVRE);
    await seedOrder({
      accountId,
      externalOrderId: 'pr-1',
      status: 'partially_refunded',
      totalAmount: '77.00',
      dateCreated: zonedDateOnlyToUtcInstant({ year: 2026, month: 9, day: 10 }),
    });
    await seedOrder({
      accountId,
      externalOrderId: 'paid-1',
      status: 'paid',
      totalAmount: '30.00',
      dateCreated: zonedDateOnlyToUtcInstant({ year: 2026, month: 9, day: 10 }),
    });

    const progress = await progressService.computeProgress(
      2026,
      9,
      referenceNow,
    );
    expect(progress.refunds.partiallyRefundedOrders).toBe(1);
    expect(progress.refunds.partiallyRefundedGrossAmountCents).toBe(7700n);
    expect(progress.refunds.coverage).toBe('PARTIAL');
    // Nunca somado ao faturamento realizado.
    expect(progress.progress.live.eligibleRevenueCents).toBe(3000n);
  });

  it('never touches marketplace_orders/marketplace_order_items — read-only', async () => {
    const accountId = await seedAccount(Marketplace.MERCADO_LIVRE);
    await seedOrder({
      accountId,
      externalOrderId: '1',
      status: 'paid',
      totalAmount: '100.00',
      dateCreated: zonedDateOnlyToUtcInstant({ year: 2026, month: 9, day: 5 }),
    });

    const [before] = await dataSource.query<Array<{ count: string }>>(
      'SELECT COUNT(*)::text AS count FROM marketplace_orders',
    );

    await progressService.computeProgress(2026, 9, referenceNow);

    const [after] = await dataSource.query<Array<{ count: string }>>(
      'SELECT COUNT(*)::text AS count FROM marketplace_orders',
    );
    expect(after.count).toBe(before.count);
  });

  it('builds a daily pace point for every day of the month, target line present even without a completed day (day 1)', async () => {
    await goalsService.upsert({
      year: 2026,
      month: 9,
      currencyId: 'BRL',
      targetAmount: '300000.00',
      createdByUserId: null,
    });
    const day1Reference = zonedDateOnlyToUtcInstant({
      year: 2026,
      month: 9,
      day: 1,
    });

    const progress = await progressService.computeProgress(
      2026,
      9,
      day1Reference,
    );
    expect(progress.dailyPace).toHaveLength(30);
    expect(progress.dailyPace[0].targetCumulativeCents).not.toBeNull();
    expect(progress.dailyPace[0].realizedCumulativeCents).toBeNull();
  });
});
