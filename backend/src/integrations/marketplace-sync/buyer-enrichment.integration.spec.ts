import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { createTestEncryptionService } from '../../test-utils/create-test-encryption-service';
import { SyncRun } from '../../sync/sync-run.entity';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceBuyer } from '../marketplace-orders/marketplace-buyer.entity';
import { MarketplaceOrder } from '../marketplace-orders/marketplace-order.entity';
import { MarketplaceOrderItem } from '../marketplace-orders/marketplace-order-item.entity';
import { MarketplaceOrdersPersistenceService } from '../marketplace-orders/marketplace-orders-persistence.service';
import type { PeriodWindow } from '../marketplace-orders/period.util';
import { validateOrdersSearchResponseBody } from '../mercado-livre-orders/mercado-livre-order-response';
import { mapMercadoLivreOrder } from '../mercado-livre-orders/mercado-livre-order.mapper';
import { MercadoLivreOrdersSyncService } from '../mercado-livre-orders/mercado-livre-orders-sync.service';
import { BackfillJobsPersistenceService } from './backfill-jobs-persistence.service';
import {
  BuyerEnrichmentModeConflictError,
  BuyerEnrichmentService,
} from './buyer-enrichment.service';
import { MarketplaceBackfillWorkerService } from './marketplace-backfill-worker.service';
import { MarketplaceBackfillService } from './marketplace-backfill.service';

function fakeConfig(): ConfigService {
  const values: Record<string, string | number> = {
    NODE_ENV: 'production',
    BACKFILL_WORKER_ENABLED: 'true',
    BACKFILL_WORKER_MAX_CONCURRENT_JOBS: 5,
  };
  return {
    get: (key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
  } as unknown as ConfigService;
}

/** Pedido bruto no formato de `GET /orders/search` (nunca dado real). */
function rawMlOrder(id: string, dateCreated: string, buyerId: number) {
  return {
    id,
    status: 'paid',
    currency_id: 'BRL',
    total_amount: 50,
    date_created: dateCreated,
    last_updated: dateCreated,
    shipping: { id: 9000 + Number(id) },
    order_items: [
      {
        item: { id: 'MLB1', title: 'Produto', seller_sku: 'SKU-1' },
        quantity: 1,
        unit_price: 50,
        currency_id: 'BRL',
      },
    ],
    buyer: { id: buyerId, nickname: `NICK_${buyerId}` },
  };
}

// Colunas que o enriquecimento NUNCA pode tocar (financeiro, status, Full...).
const ORDER_COLUMNS = `external_order_id, status, currency_id, total_amount,
  refunded_amount, date_created, marketplace_last_updated, source_status,
  logistics_classification, logistics_type, external_shipment_id, updated_at`;

/**
 * Prova ponta a ponta (Postgres real, HTTP do provedor simulado, serviço de
 * listagem ML REAL): pedidos históricos persistidos SEM comprador ganham o
 * comprador pelo worker durável, janela a janela até o pedido mais antigo —
 * sem `/shipments`, sem `sync_runs`, sem tocar nenhuma outra coluna.
 */
describe('Enriquecimento histórico de compradores (Postgres real)', () => {
  let dataSource: DataSource;
  let persistence: MarketplaceOrdersPersistenceService;
  let jobs: BackfillJobsPersistenceService;
  let accountId: string;
  let otherAccountId: string;

  const accountsService = () => ({
    findByIdOrFail: (id: string) =>
      dataSource.getRepository(MarketplaceAccount).findOneByOrFail({ id }),
    findAll: () => dataSource.getRepository(MarketplaceAccount).find(),
  });

  beforeAll(async () => {
    dataSource = await createTestDataSource([
      MarketplaceAccount,
      SyncRun,
      MarketplaceOrder,
      MarketplaceOrderItem,
      MarketplaceBuyer,
    ]);
    persistence = new MarketplaceOrdersPersistenceService(
      dataSource,
      createTestEncryptionService(),
    );
    jobs = new BackfillJobsPersistenceService(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    for (const table of [
      'marketplace_backfill_jobs',
      'marketplace_order_items',
      'marketplace_orders',
      'marketplace_buyers',
      'sync_runs',
      'marketplace_accounts',
    ]) {
      await dataSource.query(`TRUNCATE TABLE ${table} CASCADE`);
    }
    const save = async (externalSellerId: string, nickname: string) =>
      (
        await dataSource.getRepository(MarketplaceAccount).save({
          id: randomUUID(),
          marketplace: Marketplace.MERCADO_LIVRE,
          externalSellerId,
          nickname,
          status: MarketplaceAccountStatus.CONNECTED,
          tokenVersion: 1,
        })
      ).id;
    accountId = await save('42', 'ML1');
    otherAccountId = await save('43', 'ML2');
  });

  /** Serviço ML REAL com HTTP simulado (filtro por data de criação, inclusivo como o provedor). */
  function buildWorld(providerOrders: Array<ReturnType<typeof rawMlOrder>>) {
    const windows: PeriodWindow[] = [];
    const httpClient = {
      fetchOrdersPage: jest.fn(
        (input: {
          dateFrom: Date;
          dateTo: Date;
          offset: number;
          limit: number;
        }) => {
          if (input.offset === 0) {
            windows.push({ from: input.dateFrom, to: input.dateTo });
          }
          const inWindow = providerOrders.filter((raw) => {
            const created = new Date(raw.date_created).getTime();
            return (
              created >= input.dateFrom.getTime() &&
              created <= input.dateTo.getTime()
            );
          });
          return Promise.resolve({
            kind: 'success' as const,
            body: {
              paging: {
                total: inWindow.length,
                offset: input.offset,
                limit: input.limit,
              },
              results: inWindow.slice(input.offset, input.offset + input.limit),
            },
          });
        },
      ),
    };
    const shipmentLookup = { lookup: jest.fn() };
    const accounts = accountsService();
    const mlSync = new MercadoLivreOrdersSyncService(
      accounts as never,
      { ensureValidAccessToken: jest.fn().mockResolvedValue('token') } as never,
      httpClient as never,
      shipmentLookup as never,
      persistence,
      fakeConfig(),
    );
    const backfill = new MarketplaceBackfillService(
      accounts as never,
      persistence,
      mlSync,
      {} as never,
      {} as never,
      {} as never,
      jobs,
      fakeConfig(),
    );
    const newWorker = () =>
      new MarketplaceBackfillWorkerService(fakeConfig(), backfill, jobs);
    const enrichment = new BuyerEnrichmentService(
      accounts as never,
      jobs,
      fakeConfig(),
    );
    return {
      windows,
      httpClient,
      shipmentLookup,
      backfill,
      newWorker,
      enrichment,
    };
  }

  async function persistWithoutBuyer(
    raws: Array<ReturnType<typeof rawMlOrder>>,
  ): Promise<void> {
    const page = validateOrdersSearchResponseBody({
      paging: { total: raws.length, offset: 0, limit: 50 },
      results: raws.map((raw) => ({ ...raw, buyer: undefined })),
    });
    if (!page.valid) throw new Error('fixture inválida');
    await persistence.persistOrders(
      page.orders.map((raw) => ({
        ...mapMercadoLivreOrder(accountId, raw),
        // Dados "antigos" que o enriquecimento nunca pode alterar.
        logisticsClassification: 'MARKETPLACE_FULFILLED',
        logisticsType: 'fulfillment',
        refundedAmount: '5.00',
      })),
    );
  }

  async function orderColumns(): Promise<unknown[]> {
    return dataSource.query(
      `SELECT ${ORDER_COLUMNS} FROM marketplace_orders
        WHERE marketplace_account_id = $1 ORDER BY external_order_id`,
      [accountId],
    );
  }

  async function runUntilDone(
    newWorker: () => MarketplaceBackfillWorkerService,
    restartEvery: number,
    onTick?: (tick: number) => Promise<void>,
  ): Promise<void> {
    let worker = newWorker();
    for (let tick = 1; tick <= 40; tick += 1) {
      // "Reinício do processo": worker novo, só o cursor persistido no job.
      if (tick % restartEvery === 0) worker = newWorker();
      await worker.runTickOnce();
      await onTick?.(tick);
      const latest = await jobs.findLatestJob(accountId, 'BUYER_ENRICHMENT');
      if (latest?.status === 'COMPLETED') return;
    }
    throw new Error('enriquecimento não concluiu');
  }

  it('walks contiguous windows from the cursor to 1 day before the oldest order, survives restarts and concurrent new orders, links every order and touches nothing else (zero /shipments, zero sync_runs)', async () => {
    const cursor = new Date('2026-09-01T00:00:00.000Z');
    const boundary = new Date(cursor.getTime() - 30 * 86400000); // 2026-08-02T00:00Z
    const providerOrders = [
      rawMlOrder('1', '2026-03-05T12:00:00.000Z', 7),
      rawMlOrder('2', '2026-06-10T12:00:00.000Z', 7),
      // Exatamente na fronteira entre duas janelas, escrito com fuso -03:00.
      rawMlOrder('3', '2026-08-01T21:00:00.000-03:00', 8),
      rawMlOrder('4', '2026-08-31T23:59:59.999Z', 9),
    ];
    expect(new Date(providerOrders[2].date_created)).toEqual(boundary);
    await persistWithoutBuyer(providerOrders);
    const before = await orderColumns();
    const world = buildWorld(providerOrders);

    await jobs.createJob(
      accountId,
      Marketplace.MERCADO_LIVRE,
      'BUYER_ENRICHMENT',
      cursor,
    );
    await runUntilDone(world.newWorker, 2, async (tick) => {
      if (tick !== 2) return;
      // Sincronização normal concorrente trazendo um pedido NOVO com comprador.
      const page = validateOrdersSearchResponseBody({
        paging: { total: 1, offset: 0, limit: 50 },
        results: [rawMlOrder('5', '2026-09-20T10:00:00.000Z', 10)],
      });
      if (!page.valid) throw new Error('fixture inválida');
      await persistence.persistOrders(
        page.orders.map((raw) => mapMercadoLivreOrder(accountId, raw)),
      );
    });

    const { windows } = world;
    expect(windows[0]).toEqual({ from: boundary, to: cursor });
    for (let i = 1; i < windows.length; i += 1) {
      // Sem lacuna e sem sobreposição além do instante de fronteira.
      expect(windows[i].to).toEqual(windows[i - 1].from);
    }
    expect(windows[windows.length - 1].from).toEqual(
      new Date('2026-03-04T12:00:00.000Z'),
    );

    expect(world.shipmentLookup.lookup).not.toHaveBeenCalled();
    expect(await orderColumns()).toEqual([
      ...(before as object[]),
      expect.objectContaining({ external_order_id: '5' }),
    ]);
    const linked = await dataSource.query<
      Array<{ external_order_id: string; external_buyer_id: string }>
    >(
      `SELECT o.external_order_id, b.external_buyer_id
         FROM marketplace_orders o JOIN marketplace_buyers b ON b.id = o.marketplace_buyer_id
        ORDER BY o.external_order_id`,
    );
    expect(linked).toEqual([
      { external_order_id: '1', external_buyer_id: '7' },
      { external_order_id: '2', external_buyer_id: '7' },
      { external_order_id: '3', external_buyer_id: '8' },
      { external_order_id: '4', external_buyer_id: '9' },
      { external_order_id: '5', external_buyer_id: '10' },
    ]);
    const [counts] = await dataSource.query<
      Array<{ orders: number; runs: number; synced: number }>
    >(
      `SELECT (SELECT COUNT(*)::int FROM marketplace_orders) AS orders,
              (SELECT COUNT(*)::int FROM sync_runs) AS runs,
              (SELECT COUNT(*)::int FROM marketplace_accounts
                WHERE last_successful_sync_at IS NOT NULL) AS synced`,
    );
    // Nada de sync_run/última sincronização: a janela incremental e a
    // cobertura da sincronização normal ficam exatamente como estavam.
    expect(counts).toEqual({ orders: 5, runs: 0, synced: 0 });
  });

  it('an account without orders completes on the first tick without any provider call', async () => {
    const world = buildWorld([]);
    await world.enrichment.start(accountId);
    await world.newWorker().runTickOnce();
    const job = await jobs.findLatestJob(accountId, 'BUYER_ENRICHMENT');
    expect(job?.status).toBe('COMPLETED');
    expect(world.httpClient.fetchOrdersPage).not.toHaveBeenCalled();
  });

  describe('mesma fila: HISTORY × BUYER_ENRICHMENT', () => {
    function historyService() {
      return new MarketplaceBackfillService(
        accountsService() as never,
        {
          getAccountSyncCoverage: jest.fn().mockResolvedValue({
            intervals: [],
            oldestFrom: new Date('2026-06-01T00:00:00.000Z'),
            oldestRunRecordsRead: 1,
          }),
          getAccountOrderDateRange: jest.fn().mockResolvedValue(null),
        } as never,
        {} as never,
        {} as never,
        {} as never,
        { findAll: jest.fn().mockResolvedValue([]) } as never,
        jobs,
        fakeConfig(),
      );
    }

    it.each(['QUEUED', 'RUNNING', 'PAUSED', 'RETRY_WAIT'])(
      'enrichment never overrides a %s history backfill: 409 for one account, MODE_CONFLICT in the bulk start, history job intact',
      async (status) => {
        const history = await jobs.createJob(
          accountId,
          Marketplace.MERCADO_LIVRE,
        );
        await dataSource.query(
          `UPDATE marketplace_backfill_jobs SET status = $2 WHERE id = $1`,
          [history.id, status],
        );
        const { enrichment } = buildWorld([]);

        await expect(enrichment.start(accountId)).rejects.toBeInstanceOf(
          BuyerEnrichmentModeConflictError,
        );
        const bulk = await enrichment.start();
        const byId = new Map(bulk.accounts.map((a) => [a.accountId, a]));
        expect(byId.get(accountId)?.lastStartOutcome).toBe('MODE_CONFLICT');
        // ML2 é outra conta: isolada, enfileira normalmente.
        expect(byId.get(otherAccountId)?.lastStartOutcome).toBe('QUEUED');

        const after = await jobs.findLatestJob(accountId, 'HISTORY');
        // Nem status, nem versão (CAS), nem lease do backfill mudaram.
        expect(after).toMatchObject({
          id: history.id,
          status,
          version: history.version,
          leaseOwner: null,
        });
        expect(
          await jobs.findLatestJob(accountId, 'BUYER_ENRICHMENT'),
        ).toBeNull();
      },
    );

    it('history backfill never overrides an active enrichment (409 code) and never resumes over it', async () => {
      const { enrichment } = buildWorld([]);
      await enrichment.start(accountId);
      const active = await jobs.findLatestJob(accountId, 'BUYER_ENRICHMENT');

      await expect(
        historyService().startBackfill(accountId),
      ).rejects.toMatchObject({ code: 'BACKFILL_JOB_MODE_CONFLICT' });
      expect(
        await jobs.findLatestJob(accountId, 'BUYER_ENRICHMENT'),
      ).toMatchObject({
        id: active?.id,
        status: 'QUEUED',
        cursorBefore: active?.cursorBefore,
      });

      // Histórico FAILED antigo + enriquecimento ativo: "Retomar" histórico → conflito, não 500.
      await dataSource.query(
        `INSERT INTO marketplace_backfill_jobs
            (marketplace_account_id, marketplace, mode, status, next_attempt_at, created_at)
          VALUES ($1, 'MERCADO_LIVRE', 'HISTORY', 'FAILED', now(), now() - interval '1 day')`,
        [accountId],
      );
      await expect(
        historyService().resumeBackfill(accountId),
      ).rejects.toMatchObject({ code: 'BACKFILL_JOB_MODE_CONFLICT' });
    });

    it('COMPLETED history → enrichment starts with its own fresh cursor (history row untouched) → after COMPLETED enrichment, history can run again', async () => {
      const history = await jobs.createJob(
        accountId,
        Marketplace.MERCADO_LIVRE,
      );
      await dataSource.query(
        `UPDATE marketplace_backfill_jobs SET status = 'SAFETY_LIMIT_REACHED' WHERE id = $1`,
        [history.id],
      );
      const historyBefore = await jobs.findLatestJob(accountId, 'HISTORY');

      const world = buildWorld([]);
      const started = await world.enrichment.start(accountId);
      expect(
        started.accounts.find((a) => a.accountId === accountId),
      ).toMatchObject({ lastStartOutcome: 'QUEUED', jobStatus: 'QUEUED' });
      const enrichmentJob = await jobs.findLatestJob(
        accountId,
        'BUYER_ENRICHMENT',
      );
      expect(enrichmentJob?.cursorBefore).toBeInstanceOf(Date);
      expect(enrichmentJob?.chunksProcessed).toBe(0);
      expect(await jobs.findLatestJob(accountId, 'HISTORY')).toEqual(
        historyBefore,
      );

      await world.newWorker().runTickOnce();
      expect(
        (await jobs.findLatestJob(accountId, 'BUYER_ENRICHMENT'))?.status,
      ).toBe('COMPLETED');

      const status = await historyService().startBackfill(accountId);
      expect(status.job).toMatchObject({ status: 'QUEUED' });
      expect(status.job?.id).not.toBe(history.id);
    });
  });
});
