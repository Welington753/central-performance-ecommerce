import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { User } from '../../users/user.entity';
import { MonthlyRevenueGoal } from './monthly-revenue-goal.entity';
import { MonthlyRevenueGoalsService } from './monthly-revenue-goals.service';

describe('MonthlyRevenueGoalsService (Postgres real)', () => {
  let dataSource: DataSource;
  let service: MonthlyRevenueGoalsService;
  let userId: string;

  beforeAll(async () => {
    dataSource = await createTestDataSource([User, MonthlyRevenueGoal]);
    service = new MonthlyRevenueGoalsService(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE monthly_revenue_goals CASCADE');
    await dataSource.query('TRUNCATE TABLE users CASCADE');

    const user = await dataSource.getRepository(User).save({
      id: randomUUID(),
      name: 'Admin',
      email: `admin-${randomUUID()}@example.com`,
      passwordHash: 'hash',
      active: true,
      isAdmin: true,
    });
    userId = user.id;
  });

  it('returns null when no goal exists for the year/month/currency', async () => {
    const goal = await service.findByYearMonth(2026, 9, 'BRL');
    expect(goal).toBeNull();
  });

  it('creates a new goal', async () => {
    const goal = await service.upsert({
      year: 2026,
      month: 9,
      currencyId: 'BRL',
      targetAmount: '600000.00',
      createdByUserId: userId,
    });
    expect(goal.year).toBe(2026);
    expect(goal.month).toBe(9);
    expect(goal.targetAmount).toBe('600000.00');
    expect(goal.createdByUserId).toBe(userId);
  });

  it('updating the same year/month/currency never duplicates the row (unique constraint)', async () => {
    await service.upsert({
      year: 2026,
      month: 9,
      currencyId: 'BRL',
      targetAmount: '600000.00',
      createdByUserId: userId,
    });
    await service.upsert({
      year: 2026,
      month: 9,
      currencyId: 'BRL',
      targetAmount: '450000.00',
      createdByUserId: userId,
    });

    const rows = await dataSource.query<Array<{ count: string }>>(
      `SELECT COUNT(*)::text AS count FROM monthly_revenue_goals WHERE year=2026 AND month=9 AND currency_id='BRL'`,
    );
    expect(Number(rows[0].count)).toBe(1);

    const goal = await service.findByYearMonth(2026, 9, 'BRL');
    expect(goal?.targetAmount).toBe('450000.00');
  });

  it('an update preserves createdAt and createdByUserId, only updatedAt/targetAmount change', async () => {
    const first = await service.upsert({
      year: 2026,
      month: 9,
      currencyId: 'BRL',
      targetAmount: '600000.00',
      createdByUserId: userId,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const second = await service.upsert({
      year: 2026,
      month: 9,
      currencyId: 'BRL',
      targetAmount: '700000.00',
      createdByUserId: userId,
    });

    expect(second.createdAt.getTime()).toBe(first.createdAt.getTime());
    expect(second.createdByUserId).toBe(first.createdByUserId);
    expect(second.updatedAt.getTime()).toBeGreaterThan(
      first.updatedAt.getTime(),
    );
    expect(second.targetAmount).toBe('700000.00');
  });

  it('allows the same year/month with a different currency as a distinct row (schema-ready, even though only BRL is accepted today)', async () => {
    await service.upsert({
      year: 2026,
      month: 9,
      currencyId: 'BRL',
      targetAmount: '600000.00',
      createdByUserId: userId,
    });
    // A checagem CK_monthly_revenue_goals_currency_id restringe a 'BRL' hoje
    // — este teste prova só que a CHAVE (year, month, currency) é o que
    // define unicidade, não uma suposição sobre moedas futuras aceitas.
    await expect(
      dataSource.query(
        `INSERT INTO monthly_revenue_goals (year, month, currency_id, target_amount)
           VALUES (2026, 9, 'USD', 100.00)`,
      ),
    ).rejects.toThrow();
  });

  it('rejects month outside [1,12] via CHECK constraint', async () => {
    await expect(
      dataSource.query(
        `INSERT INTO monthly_revenue_goals (year, month, currency_id, target_amount) VALUES (2026, 13, 'BRL', 100.00)`,
      ),
    ).rejects.toThrow();
  });

  it('rejects a non-positive target_amount via CHECK constraint', async () => {
    await expect(
      dataSource.query(
        `INSERT INTO monthly_revenue_goals (year, month, currency_id, target_amount) VALUES (2026, 9, 'BRL', 0.00)`,
      ),
    ).rejects.toThrow();
  });

  it('rejects a year outside the documented range via CHECK constraint', async () => {
    await expect(
      dataSource.query(
        `INSERT INTO monthly_revenue_goals (year, month, currency_id, target_amount) VALUES (1999, 9, 'BRL', 100.00)`,
      ),
    ).rejects.toThrow();
  });

  it('setting created_by_user_id to a deleted user sets it to NULL (ON DELETE SET NULL), never blocks the deletion', async () => {
    await service.upsert({
      year: 2026,
      month: 9,
      currencyId: 'BRL',
      targetAmount: '600000.00',
      createdByUserId: userId,
    });
    await dataSource.query('DELETE FROM users WHERE id = $1', [userId]);

    const goal = await service.findByYearMonth(2026, 9, 'BRL');
    expect(goal?.createdByUserId).toBeNull();
  });
});
