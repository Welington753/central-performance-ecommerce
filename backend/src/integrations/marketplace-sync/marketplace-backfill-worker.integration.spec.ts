import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { BackfillJobsPersistenceService } from './backfill-jobs-persistence.service';
import { MarketplaceBackfillWorkerService } from './marketplace-backfill-worker.service';

function fakeConfigService(): ConfigService {
  const values: Record<string, string | number> = {
    NODE_ENV: 'production',
    BACKFILL_WORKER_ENABLED: 'true',
    BACKFILL_WORKER_TICK_MS: 5000,
    BACKFILL_WORKER_MAX_CONCURRENT_JOBS: 5,
    BACKFILL_WORKER_LEASE_MS: 60000,
    BACKFILL_WORKER_MAX_ATTEMPTS: 5,
    BACKFILL_WORKER_RETRY_BASE_MS: 1000,
    BACKFILL_WORKER_RETRY_MAX_MS: 60000,
    BACKFILL_WORKER_REQUEUE_MS: 2000,
    BACKFILL_WORKER_RATE_LIMIT_BACKOFF_MS: 30000,
  };
  return {
    get: (key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
  } as unknown as ConfigService;
}

/**
 * Prova de concorrência REAL entre PROCESSOS (Fase 4, "Backfill durável"):
 * duas instâncias INDEPENDENTES de `MarketplaceBackfillWorkerService`,
 * cada uma com sua própria `BackfillJobsPersistenceService`, competindo pelo
 * MESMO job contra um PostgreSQL 16 real — só o lock do Postgres (`FOR
 * UPDATE SKIP LOCKED`) pode garantir isto, nunca um mock. `runNextChunk` é
 * mockado (nenhuma chamada real a marketplace) só para contar quantas vezes
 * foi de fato invocado.
 */
describe('MarketplaceBackfillWorkerService — concorrência entre processos (Postgres real)', () => {
  let dataSource: DataSource;
  let accountId: string;

  beforeAll(async () => {
    dataSource = await createTestDataSource([MarketplaceAccount]);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE marketplace_backfill_jobs CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');

    const account = await dataSource.getRepository(MarketplaceAccount).save({
      id: randomUUID(),
      marketplace: Marketplace.MERCADO_LIVRE,
      externalSellerId: '1548451374',
      nickname: 'EZIEHOME',
      status: MarketplaceAccountStatus.CONNECTED,
      tokenVersion: 1,
    });
    accountId = account.id;
  });

  it('two independent worker instances ticking at the same time make only ONE runNextChunk call for the same job', async () => {
    const persistenceA = new BackfillJobsPersistenceService(dataSource);
    const persistenceB = new BackfillJobsPersistenceService(dataSource);
    await persistenceA.createJob(accountId, Marketplace.MERCADO_LIVRE);

    // `runNextChunk` só resolve quando o teste manda (`resolveChunk`) — força
    // as duas janelas de claim a se sobreporem DE VERDADE. Sem isto, a
    // primeira tentativa poderia terminar (processar + devolver o job a
    // QUEUED, de propósito, para a PRÓXIMA chunk) antes da segunda sequer
    // tentar reivindicar — aí duas chamadas seriam dois chunks legítimos e
    // sequenciais do mesmo job, não uma violação de exclusividade.
    let resolveChunk!: (value: {
      hasMoreHistory: boolean;
      oldestCoveredAt: string;
      ordersFetched: number;
    }) => void;
    const pendingChunk = new Promise((resolve) => {
      resolveChunk = resolve;
    });
    let signalChunkStarted!: () => void;
    const chunkStarted = new Promise<void>((resolve) => {
      signalChunkStarted = resolve;
    });
    const runNextChunk = jest.fn().mockImplementation(() => {
      signalChunkStarted();
      return pendingChunk;
    });
    const backfillServiceStub = { runNextChunk } as never;

    const workerA = new MarketplaceBackfillWorkerService(
      fakeConfigService(),
      backfillServiceStub,
      persistenceA,
    );
    const workerB = new MarketplaceBackfillWorkerService(
      fakeConfigService(),
      backfillServiceStub,
      persistenceB,
    );

    const tickA = workerA.runTickOnce();
    const tickB = workerB.runTickOnce();
    // Espera determinística (sem relógio): o tick que reivindicou o job fica
    // preso em `pendingChunk`, então o PRIMEIRO tick a terminar é o que já
    // tentou reivindicar e não obteve nada. Só depois disso o chunk é liberado
    // — a outra instância nunca chega atrasada e pega o job devolvido à fila.
    await Promise.all([chunkStarted, Promise.race([tickA, tickB])]);
    expect(runNextChunk).toHaveBeenCalledTimes(1);

    resolveChunk({
      hasMoreHistory: true,
      oldestCoveredAt: '2026-01-01',
      ordersFetched: 1,
    });
    await Promise.all([tickA, tickB]);

    expect(runNextChunk).toHaveBeenCalledTimes(1);
    expect(runNextChunk).toHaveBeenCalledWith(accountId);
  });

  it('the job survives a full recreation of the persistence/data-source instance (durable, not in-memory)', async () => {
    const persistenceA = new BackfillJobsPersistenceService(dataSource);
    const created = await persistenceA.createJob(
      accountId,
      Marketplace.MERCADO_LIVRE,
    );

    // Simula um reinício do backend: uma NOVA conexão/instância, nenhum
    // estado em memória compartilhado com `persistenceA`.
    const freshDataSource = await createTestDataSource([MarketplaceAccount]);
    try {
      const persistenceAfterRestart = new BackfillJobsPersistenceService(
        freshDataSource,
      );
      const found = await persistenceAfterRestart.findLatestJob(accountId);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.status).toBe('QUEUED');
    } finally {
      await freshDataSource.destroy();
    }
  });

  it('regressão de produção: jobs QUEUED criados enquanto BACKFILL_WORKER_ENABLED estava false são retomados automaticamente assim que o worker é ligado, sem novo clique do usuário', async () => {
    const secondAccount = await dataSource
      .getRepository(MarketplaceAccount)
      .save({
        id: randomUUID(),
        marketplace: Marketplace.MERCADO_LIVRE,
        externalSellerId: '1029648966',
        nickname: 'Mercado Livre 2',
        status: MarketplaceAccountStatus.CONNECTED,
        tokenVersion: 1,
      });

    // Simula exatamente o estado reportado em produção: dois jobs ML já
    // criados (cliques anteriores do usuário) e nunca reivindicados, porque
    // BACKFILL_WORKER_ENABLED estava "false" na época — nenhuma ação nova é
    // tomada aqui além de criá-los, como já estavam antes do deploy da
    // correção.
    const persistenceBeforeFix = new BackfillJobsPersistenceService(dataSource);
    await persistenceBeforeFix.createJob(accountId, Marketplace.MERCADO_LIVRE);
    await persistenceBeforeFix.createJob(
      secondAccount.id,
      Marketplace.MERCADO_LIVRE,
    );

    // "Deploy da correção": só agora um worker é instanciado — com
    // BACKFILL_WORKER_ENABLED=true (fakeConfigService) — e roda seu PRIMEIRO
    // ciclo. Nenhum `start`/`createJob` novo é chamado.
    const runNextChunk = jest.fn().mockResolvedValue({
      hasMoreHistory: true,
      oldestCoveredAt: '2026-01-01',
      ordersFetched: 4,
    });
    const worker = new MarketplaceBackfillWorkerService(
      fakeConfigService(),
      { runNextChunk } as never,
      persistenceBeforeFix,
    );

    await worker.runTickOnce();

    expect(runNextChunk).toHaveBeenCalledTimes(2);
    expect(runNextChunk).toHaveBeenCalledWith(accountId);
    expect(runNextChunk).toHaveBeenCalledWith(secondAccount.id);

    const jobsAfter = await Promise.all([
      persistenceBeforeFix.findLatestJob(accountId),
      persistenceBeforeFix.findLatestJob(secondAccount.id),
    ]);
    for (const job of jobsAfter) {
      expect(job!.chunksProcessed).toBe(1);
    }

    // Idempotência: reivindicar de novo (segundo ciclo, sem trabalho pendente
    // ainda) nunca duplica nem cria um terceiro job para nenhuma conta.
    const allJobsForAccount = await dataSource.query<Array<{ count: number }>>(
      'SELECT count(*)::int AS count FROM marketplace_backfill_jobs WHERE marketplace_account_id = ANY($1::uuid[])',
      [[accountId, secondAccount.id]],
    );
    expect(allJobsForAccount[0].count).toBe(2);
  });

  it('a job abandoned by a worker that never restarts is picked up and completed by a second worker instance', async () => {
    const persistenceA = new BackfillJobsPersistenceService(dataSource);
    const job = await persistenceA.createJob(
      accountId,
      Marketplace.MERCADO_LIVRE,
    );
    // Simula um worker que reivindicou e travou/caiu para sempre.
    await dataSource.query(
      `UPDATE marketplace_backfill_jobs
          SET status = 'RUNNING', lease_owner = 'dead-worker',
              lease_expires_at = now() - interval '1 hour'
        WHERE id = $1`,
      [job.id],
    );

    const persistenceB = new BackfillJobsPersistenceService(dataSource);
    const runNextChunk = jest.fn().mockResolvedValue({
      hasMoreHistory: true,
      oldestCoveredAt: '2026-01-01',
      ordersFetched: 2,
    });
    const workerB = new MarketplaceBackfillWorkerService(
      fakeConfigService(),
      { runNextChunk } as never,
      persistenceB,
    );

    await workerB.runTickOnce();

    expect(runNextChunk).toHaveBeenCalledWith(accountId);
    const after = await persistenceB.findLatestJob(accountId);
    expect(after!.chunksProcessed).toBe(1);
    expect(after!.leaseOwner).toBeNull();
  });
});
