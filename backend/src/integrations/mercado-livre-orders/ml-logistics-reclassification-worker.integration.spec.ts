import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceOrder } from '../marketplace-orders/marketplace-order.entity';
import { MarketplaceOrderItem } from '../marketplace-orders/marketplace-order-item.entity';
import { LogisticsReclassificationRepository } from '../marketplace-orders/logistics-reclassification.repository';
import { emptyAccountReport } from './logistics-reclassification-report';
import { MlLogisticsReclassificationJobsPersistenceService } from './ml-logistics-reclassification-jobs-persistence.service';
import { MlLogisticsReclassificationWorkerService } from './ml-logistics-reclassification-worker.service';

function fakeConfigService(): ConfigService {
  const values: Record<string, string | number> = {
    NODE_ENV: 'production',
    ML_LOGISTICS_RECLASSIFICATION_WORKER_ENABLED: 'true',
    ML_LOGISTICS_RECLASSIFICATION_WORKER_TICK_MS: 5000,
    ML_LOGISTICS_RECLASSIFICATION_WORKER_BATCH_SIZE: 20,
    ML_LOGISTICS_RECLASSIFICATION_WORKER_MAX_CALLS_PER_TICK: 20,
    ML_LOGISTICS_RECLASSIFICATION_WORKER_MAX_CONCURRENT_JOBS: 5,
    ML_LOGISTICS_RECLASSIFICATION_WORKER_LEASE_MS: 60000,
    ML_LOGISTICS_RECLASSIFICATION_WORKER_RATE_LIMIT_BACKOFF_MS: 30000,
    ML_LOGISTICS_RECLASSIFICATION_WORKER_PROVIDER_UNAVAILABLE_BACKOFF_MS: 15000,
    ML_LOGISTICS_RECLASSIFICATION_WORKER_TOKEN_UNAVAILABLE_BACKOFF_MS: 15000,
  };
  return {
    get: (key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
  } as unknown as ConfigService;
}

/**
 * Prova de concorrência REAL entre PROCESSOS (correção da auditoria Full,
 * "Render free sem Shell") — MESMO padrão de
 * `marketplace-backfill-worker.integration.spec.ts`: duas instâncias
 * INDEPENDENTES de `MlLogisticsReclassificationWorkerService`, cada uma com
 * sua própria persistência, competindo pelo MESMO job contra um PostgreSQL
 * real. `apply()` (o único ponto de chamada HTTP real) é sempre mockado —
 * nenhuma chamada de rede real ocorre nesta suíte.
 */
describe('MlLogisticsReclassificationWorkerService — concorrência entre processos (Postgres real)', () => {
  let dataSource: DataSource;
  let accountId: string;
  let repository: LogisticsReclassificationRepository;

  beforeAll(async () => {
    dataSource = await createTestDataSource([
      MarketplaceAccount,
      MarketplaceOrder,
      MarketplaceOrderItem,
    ]);
    repository = new LogisticsReclassificationRepository(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE TABLE ml_logistics_reclassification_jobs CASCADE',
    );
    await dataSource.query('TRUNCATE TABLE marketplace_order_items CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_orders CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');

    const account = await dataSource.getRepository(MarketplaceAccount).save({
      id: randomUUID(),
      marketplace: Marketplace.MERCADO_LIVRE,
      externalSellerId: '1548451374',
      nickname: 'Meli 1',
      status: MarketplaceAccountStatus.CONNECTED,
      tokenVersion: 1,
    });
    accountId = account.id;
  });

  it('two independent worker instances ticking at the same time make only ONE apply() call for the same account', async () => {
    const persistenceA = new MlLogisticsReclassificationJobsPersistenceService(
      dataSource,
    );
    const persistenceB = new MlLogisticsReclassificationJobsPersistenceService(
      dataSource,
    );
    await persistenceA.createIfAbsent(accountId, 100, new Date());

    // `apply()` só resolve quando o teste manda — força as duas janelas de
    // claim a se sobreporem de verdade (mesmo racional do teste análogo do
    // backfill).
    let resolveApply!: (value: unknown) => void;
    const pendingApply = new Promise((resolve) => {
      resolveApply = resolve;
    });
    const apply = jest.fn().mockReturnValue(pendingApply);
    const reclassificationServiceStub = { apply } as never;

    const workerA = new MlLogisticsReclassificationWorkerService(
      fakeConfigService(),
      reclassificationServiceStub,
      persistenceA,
      repository,
    );
    const workerB = new MlLogisticsReclassificationWorkerService(
      fakeConfigService(),
      reclassificationServiceStub,
      persistenceB,
      repository,
    );

    const tickA = workerA.runTickOnce();
    const tickB = workerB.runTickOnce();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(apply).toHaveBeenCalledTimes(1);

    resolveApply([emptyAccountReport(null)]);
    await Promise.all([tickA, tickB]);

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ accountId }));
  });

  it('the job survives a full recreation of the persistence/data-source instance (durable, not in-memory) — retomada após restart', async () => {
    const persistenceA = new MlLogisticsReclassificationJobsPersistenceService(
      dataSource,
    );
    const created = await persistenceA.createIfAbsent(
      accountId,
      7933,
      new Date(),
    );

    const freshDataSource = await createTestDataSource([
      MarketplaceAccount,
      MarketplaceOrder,
      MarketplaceOrderItem,
    ]);
    try {
      const persistenceAfterRestart =
        new MlLogisticsReclassificationJobsPersistenceService(freshDataSource);
      const found = await persistenceAfterRestart.findByAccountId(accountId);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.status).toBe('RUNNING');
      expect(found!.initialUnknownCount).toBe(7933);
    } finally {
      await freshDataSource.destroy();
    }
  });

  it('a job abandoned by a worker that crashed (lease expired) is picked up and completed by a second worker instance', async () => {
    const persistenceA = new MlLogisticsReclassificationJobsPersistenceService(
      dataSource,
    );
    const created = await persistenceA.createIfAbsent(
      accountId,
      100,
      new Date(),
    );
    await dataSource.query(
      `UPDATE ml_logistics_reclassification_jobs
          SET status = 'RUNNING', lease_owner = 'dead-worker',
              lease_expires_at = now() - interval '1 hour'
        WHERE id = $1`,
      [created.id],
    );

    const persistenceB = new MlLogisticsReclassificationJobsPersistenceService(
      dataSource,
    );
    const apply = jest.fn().mockResolvedValue([
      {
        ...emptyAccountReport(null),
        outcome: 'COMPLETED',
        // `outcome: 'COMPLETED'` só é real quando as DUAS filas esgotaram —
        // um mock que afirma "completed" sem sinalizar isso seria uma
        // combinação impossível no serviço reaproveitado (ver doc de
        // `queue1Exhausted`/`queue2Exhausted`).
        queue1Exhausted: true,
        queue2Exhausted: true,
      },
    ]);
    const workerB = new MlLogisticsReclassificationWorkerService(
      fakeConfigService(),
      { apply } as never,
      persistenceB,
      repository,
    );

    await workerB.runTickOnce();

    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ accountId }));
    const after = await persistenceB.findByAccountId(accountId);
    expect(after!.status).toBe('COMPLETED');
    expect(after!.leaseOwner).toBeNull();
  });

  /**
   * Fechamento pré-commit (item 2): o teste "lease expired" acima cobre só o
   * worker MORTO (nunca mais chama `commit`). Este cobre o caso realmente
   * perigoso: worker A ainda está VIVO, preso numa chamada `apply()` lenta
   * que ultrapassa o próprio lease — o mesmo cenário que a suíte de
   * advisory lock prova NUNCA gerar uma segunda chamada HTTP. Aqui a prova é
   * sobre o ESTADO PERSISTIDO: o `commit` (CAS por `version` + `lease_owner`)
   * de A, quando finalmente chega, precisa perder a corrida sem corromper
   * nem duplicar o que B já gravou, e o tick seguinte precisa continuar
   * normalmente (job nunca fica preso).
   */
  it('a slow apply() that outlives its own lease never overwrites or duplicates what a second worker already committed for the same job', async () => {
    const persistenceA = new MlLogisticsReclassificationJobsPersistenceService(
      dataSource,
    );
    const persistenceB = new MlLogisticsReclassificationJobsPersistenceService(
      dataSource,
    );
    await persistenceA.createIfAbsent(accountId, 100, new Date());

    let resolveSlowApply!: (value: unknown) => void;
    const slowApply = new Promise((resolve) => {
      resolveSlowApply = resolve;
    });
    const applyA = jest.fn().mockReturnValue(slowApply);
    const workerA = new MlLogisticsReclassificationWorkerService(
      fakeConfigService(),
      { apply: applyA } as never,
      persistenceA,
      repository,
    );

    // Worker A reivindica e fica preso em `apply()` — nunca aguardado aqui,
    // simula o tick lento que vai ultrapassar o próprio lease.
    const tickA = workerA.runTickOnce();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(applyA).toHaveBeenCalledTimes(1);

    // Simula o lease de A tendo estourado de verdade (120s por padrão) —
    // sem matar o processo A, que continua preso na mesma `apply()`.
    await dataSource.query(
      `UPDATE ml_logistics_reclassification_jobs
          SET lease_expires_at = now() - interval '1 hour'
        WHERE marketplace_account_id = $1`,
      [accountId],
    );

    // Worker B reivindica o job (elegível: lease expirado) e conclui um
    // tick RÁPIDO e completo antes de A terminar.
    const applyB = jest.fn().mockResolvedValue([
      {
        ...emptyAccountReport(null),
        outcome: 'STOPPED_MAX_REQUESTS',
        resolvedMarketplaceFulfilled: 2,
      },
    ]);
    const workerB = new MlLogisticsReclassificationWorkerService(
      fakeConfigService(),
      { apply: applyB } as never,
      persistenceB,
      repository,
    );
    await workerB.runTickOnce();

    const afterB = await persistenceB.findByAccountId(accountId);
    expect(afterB!.resolvedFullCount).toBe(2);
    expect(afterB!.leaseOwner).toBeNull();
    const versionAfterB = afterB!.version;

    // SÓ AGORA A termina — tenta commitar com a `version`/`lease_owner`
    // antigos, que B já sobrescreveu. O CAS deve rejeitar silenciosamente
    // (nenhuma exceção, nenhuma linha afetada).
    resolveSlowApply([
      { ...emptyAccountReport(null), resolvedMarketplaceFulfilled: 1 },
    ]);
    await tickA;

    const afterA = await persistenceB.findByAccountId(accountId);
    // Nem duplicado (3), nem regredido (0/1) — só o que B gravou persiste.
    expect(afterA!.resolvedFullCount).toBe(2);
    expect(afterA!.version).toBe(versionAfterB);
    expect(afterA!.leaseOwner).toBeNull();

    // Nenhuma chamada HTTP duplicada: cada worker chamou `apply()` UMA vez.
    expect(applyA).toHaveBeenCalledTimes(1);
    expect(applyB).toHaveBeenCalledTimes(1);

    // O tick seguinte continua normalmente — job não fica preso pela
    // corrida perdida de A (claimável de novo, processado sem erro,
    // contadores acumulados intactos).
    const applyC = jest
      .fn()
      .mockResolvedValue([
        { ...emptyAccountReport(null), outcome: 'STOPPED_MAX_REQUESTS' },
      ]);
    const persistenceC = new MlLogisticsReclassificationJobsPersistenceService(
      dataSource,
    );
    const workerC = new MlLogisticsReclassificationWorkerService(
      fakeConfigService(),
      { apply: applyC } as never,
      persistenceC,
      repository,
    );
    await workerC.runTickOnce();
    expect(applyC).toHaveBeenCalledTimes(1);
    const afterC = await persistenceC.findByAccountId(accountId);
    expect(afterC!.status).toBe('RUNNING');
    expect(afterC!.leaseOwner).toBeNull();
    expect(afterC!.resolvedFullCount).toBe(2);
  });

  it('a PAUSED job is never claimed by any worker tick', async () => {
    const persistence = new MlLogisticsReclassificationJobsPersistenceService(
      dataSource,
    );
    await persistence.createIfAbsent(accountId, 100, new Date());
    await dataSource.query(
      `UPDATE ml_logistics_reclassification_jobs SET status = 'PAUSED' WHERE marketplace_account_id = $1`,
      [accountId],
    );

    const apply = jest.fn();
    const worker = new MlLogisticsReclassificationWorkerService(
      fakeConfigService(),
      { apply } as never,
      persistence,
      repository,
    );
    await worker.runTickOnce();
    expect(apply).not.toHaveBeenCalled();
  });

  it('COMPLETED transitions only when apply() reports the queue truly drained — a job with more work left never gets marked COMPLETED', async () => {
    const persistence = new MlLogisticsReclassificationJobsPersistenceService(
      dataSource,
    );
    await persistence.createIfAbsent(accountId, 100, new Date());
    const apply = jest
      .fn()
      .mockResolvedValue([
        { ...emptyAccountReport(null), outcome: 'STOPPED_MAX_REQUESTS' },
      ]);
    const worker = new MlLogisticsReclassificationWorkerService(
      fakeConfigService(),
      { apply } as never,
      persistence,
      repository,
    );
    await worker.runTickOnce();

    const after = await persistence.findByAccountId(accountId);
    expect(after!.status).not.toBe('COMPLETED');
    expect(after!.status).toBe('RUNNING');
  });

  /**
   * Revisão crítica pós-implementação: prova que o cursor durável
   * (`queue1_cursor_id`/`queue2_cursor_id`, persistido na linha do job)
   * resolve a starvation — sem ele, `apply()` sempre recomeçaria do zero a
   * cada tick, e pedidos permanentemente inválidos (sempre os primeiros,
   * ordenados por `id`) consumiriam o orçamento inteiro para sempre,
   * nunca alcançando pedidos válidos mais adiante.
   *
   * `simulateApply` reproduz o CONTRATO real do serviço reaproveitado
   * (`ReclassificationAccountReport.queue1EndCursor`/`queue1Exhausted`/
   * `queue2EndCursor`/`queue2Exhausted`) sobre uma fila fake de 6 pedidos —
   * os 3 primeiros SEMPRE `not_found` (permanentemente inválidos), os 3
   * últimos SEMPRE resolvem como Full. A fila 1 (com `external_shipment_id`)
   * está sempre vazia nesta simulação — reflete a auditoria de produção real
   * (Meli 1/Meli 2: 100% dos UNKNOWN sem `external_shipment_id` hoje).
   */
  describe('cursor durável — starvation corrigida (revisão crítica)', () => {
    // `queue1_cursor_id`/`queue2_cursor_id` são colunas `uuid` (mesmo tipo de
    // `marketplace_orders.id`, o identificador real que o cursor persiste em
    // produção) — a simulação usa UUIDs de verdade, ORDENADOS, para que a
    // comparação `id > cursor` se comporte exatamente como a consulta real.
    const ALL_ITEMS = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ].sort();
    // Os 3 primeiros (ordenados) são permanentemente inválidos; os 3
    // últimos resolvem como Full.
    const TERMINAL_ITEMS = new Set(ALL_ITEMS.slice(0, 3));

    function buildSimulation(budgetPerTick: number) {
      const resolved = new Set<string>();
      const attemptsByItem = new Map<string, number>();

      const apply = jest.fn(
        ({
          queue1AfterId,
          queue2AfterId,
          maxRequestsPerAccount,
        }: {
          accountId: string;
          batchSize: number;
          maxRequestsPerAccount: number;
          queue1AfterId: string | null;
          queue2AfterId: string | null;
        }) => {
          const budget = Math.min(budgetPerTick, maxRequestsPerAccount);
          const pending = ALL_ITEMS.filter((id) => !resolved.has(id));
          const startIndex = queue2AfterId
            ? pending.findIndex((id) => id > queue2AfterId)
            : 0;
          const effectiveStart =
            startIndex === -1 ? pending.length : startIndex;
          const slice = pending.slice(effectiveStart, effectiveStart + budget);

          let resolvedFull = 0;
          for (const id of slice) {
            attemptsByItem.set(id, (attemptsByItem.get(id) ?? 0) + 1);
            if (!TERMINAL_ITEMS.has(id)) {
              resolved.add(id);
              resolvedFull += 1;
            }
          }

          const queue2Exhausted =
            effectiveStart + slice.length >= pending.length;
          const queue2EndCursor =
            slice.length > 0 ? slice[slice.length - 1] : queue2AfterId;

          return [
            {
              ...emptyAccountReport(null),
              outcome: queue2Exhausted ? 'COMPLETED' : 'STOPPED_MAX_REQUESTS',
              ordersExamined: slice.length,
              orderDetailRequests: slice.length,
              resolvedMarketplaceFulfilled: resolvedFull,
              queue1EndCursor: queue1AfterId,
              queue1Exhausted: true,
              queue2EndCursor,
              queue2Exhausted,
            },
          ];
        },
      );

      const repositoryStub = {
        countPendingByAccount: jest.fn().mockImplementation(() => {
          const remaining = ALL_ITEMS.filter((id) => !resolved.has(id)).length;
          return Promise.resolve([
            { pendingWithShipmentId: 0, pendingWithoutShipmentId: remaining },
          ]);
        }),
      };

      return { apply, resolved, attemptsByItem, repositoryStub };
    }

    it('reaches valid items after permanently-invalid ones, across several ticks, surviving a restart mid-way', async () => {
      const sim = buildSimulation(1);
      const persistenceBeforeRestart =
        new MlLogisticsReclassificationJobsPersistenceService(dataSource);
      await persistenceBeforeRestart.createIfAbsent(accountId, 6, new Date());

      const workerBeforeRestart = new MlLogisticsReclassificationWorkerService(
        fakeConfigService(),
        { apply: sim.apply } as never,
        persistenceBeforeRestart,
        sim.repositoryStub as never,
      );

      // 3 ticks: os 3 primeiros pedidos (todos permanentemente inválidos)
      // consomem 1 tentativa cada, nada resolvido — mas o cursor avança.
      await workerBeforeRestart.runTickOnce();
      await workerBeforeRestart.runTickOnce();
      await workerBeforeRestart.runTickOnce();

      const jobBeforeRestart =
        await persistenceBeforeRestart.findByAccountId(accountId);
      expect(jobBeforeRestart?.resolvedFullCount).toBe(0);
      expect(jobBeforeRestart?.queue2CursorId).toBe(ALL_ITEMS[2]);
      // Cada item inválido foi tentado EXATAMENTE uma vez até aqui — nunca
      // reexaminado tick após tick (a prova direta de que o cursor não
      // reinicia mais do zero a cada chamada).
      expect(sim.attemptsByItem.get(ALL_ITEMS[0])).toBe(1);
      expect(sim.attemptsByItem.get(ALL_ITEMS[1])).toBe(1);
      expect(sim.attemptsByItem.get(ALL_ITEMS[2])).toBe(1);

      // Restart: nova instância de persistência/worker, mesmo Postgres —
      // simula o processo caindo e subindo de novo.
      const persistenceAfterRestart =
        new MlLogisticsReclassificationJobsPersistenceService(dataSource);
      const workerAfterRestart = new MlLogisticsReclassificationWorkerService(
        fakeConfigService(),
        { apply: sim.apply } as never,
        persistenceAfterRestart,
        sim.repositoryStub as never,
      );

      // Tick 4 (pós-restart): alcança o PRIMEIRO pedido válido — nunca
      // reexamina os 3 inválidos de novo.
      await workerAfterRestart.runTickOnce();
      expect(sim.attemptsByItem.get(ALL_ITEMS[3])).toBe(1);
      expect(sim.attemptsByItem.get(ALL_ITEMS[0])).toBe(1);

      const jobAfterFirstValid =
        await persistenceAfterRestart.findByAccountId(accountId);
      expect(jobAfterFirstValid?.resolvedFullCount).toBe(1);
      expect(jobAfterFirstValid?.queue2CursorId).toBe(ALL_ITEMS[3]);
    });

    it('permanently-invalid items never block the budget forever — the job reaches COMPLETED with the stuck items surfaced as remainingUnknownCount, never a false zero', async () => {
      const sim = buildSimulation(3);
      const persistence = new MlLogisticsReclassificationJobsPersistenceService(
        dataSource,
      );
      await persistence.createIfAbsent(accountId, 6, new Date());
      const worker = new MlLogisticsReclassificationWorkerService(
        fakeConfigService(),
        { apply: sim.apply } as never,
        persistence,
        sim.repositoryStub as never,
      );

      // Tick 1: itens 1-3 (inválidos) — passada NÃO esgotada ainda (6 itens
      // no total, orçamento 3).
      await worker.runTickOnce();
      let job = await persistence.findByAccountId(accountId);
      expect(job?.status).toBe('RUNNING');
      expect(job?.resolvedFullCount).toBe(0);

      // Tick 2: itens 4-6 (válidos) — passada ESGOTADA e produtiva (3
      // resoluções) → nova passada, cursor volta a `null`.
      await worker.runTickOnce();
      job = await persistence.findByAccountId(accountId);
      expect(job?.status).toBe('RUNNING');
      expect(job?.resolvedFullCount).toBe(3);
      expect(job?.queue2CursorId).toBeNull();

      // Tick 3: só sobram os 3 inválidos (os válidos já saíram do pool,
      // exatamente como `logistics_classification <> 'UNKNOWN'` os
      // excluiria da consulta real) — passada esgota SEM resolver nada →
      // COMPLETED, nunca um loop infinito re-tentando os mesmos 3 pedidos
      // para sempre.
      await worker.runTickOnce();
      job = await persistence.findByAccountId(accountId);
      expect(job?.status).toBe('COMPLETED');
      expect(job?.resolvedFullCount).toBe(3);
      expect(job?.remainingUnknownCount).toBe(3);
      expect(job?.completedAt).not.toBeNull();

      // Cada item inválido foi tentado exatamente 2 vezes no total (uma por
      // passada) — nunca "para sempre", nunca zero (foram genuinamente
      // examinados e permanecem `UNKNOWN`, "não resolvidos").
      expect(sim.attemptsByItem.get(ALL_ITEMS[0])).toBe(2);
      expect(sim.attemptsByItem.get(ALL_ITEMS[1])).toBe(2);
      expect(sim.attemptsByItem.get(ALL_ITEMS[2])).toBe(2);
      expect(sim.attemptsByItem.get(ALL_ITEMS[3])).toBe(1);
    });
  });
});
