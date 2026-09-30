import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { MarketplaceProblemsSyncJobsPersistenceService } from './marketplace-problems-sync-jobs-persistence.service';
import type {
  MarketplaceProblemsSyncJobCommitUpdate,
  MarketplaceProblemsSyncJobRow,
} from './marketplace-problems-sync-jobs.types';
import { buildCommitUpdate } from './marketplace-problems-sync-outcome.util';
import { MarketplaceProblemsSyncTickService } from './marketplace-problems-sync-tick.service';
import {
  PROBLEMS_SYNC_WORKER_CLOCK,
  PROBLEMS_SYNC_WORKER_TIMERS,
  SYSTEM_CLOCK,
  SYSTEM_TIMERS,
  type MarketplaceProblemsSyncWorkerClock,
  type MarketplaceProblemsSyncWorkerTimers,
} from './marketplace-problems-sync-worker.clock';
import {
  readProblemsSyncWorkerConfig,
  type ProblemsSyncWorkerConfig,
} from './marketplace-problems-sync-worker-config.util';

/**
 * Worker durável da sincronização incremental de "Problemas" (CP2-C) — MESMO
 * padrão de `MarketplaceBackfillWorkerService`/
 * `MlLogisticsReclassificationWorkerService`: reivindica jobs elegíveis via
 * `FOR UPDATE SKIP LOCKED` + lease
 * (`MarketplaceProblemsSyncJobsPersistenceService.claim`), executa UM tick por
 * job (`MarketplaceProblemsSyncTickService`, que reaproveita os 3 métodos
 * públicos do CP2-B) e persiste o resultado por CAS (`id + version +
 * lease_owner`).
 *
 * Nenhuma transação de banco fica aberta durante HTTP: o claim é uma
 * transação curta e separada, o tick roda TOTALMENTE fora de transação e o
 * `commit` é outro `UPDATE` isolado. No máximo um tick simultâneo por job
 * (lease), entre instâncias; `ticking` evita ciclos sobrepostos no mesmo
 * processo. Um job que falha nunca interrompe os demais
 * (`Promise.allSettled`); CAS perdido só é logado.
 *
 * Desligado por padrão: flag própria `PROBLEMS_SYNC_WORKER_ENABLED`
 * (default `false`) e SEMPRE desligado com `NODE_ENV=test` — nenhum timer é
 * criado; os testes chamam `runTickOnce()` diretamente. O worker só processa
 * jobs já criados (`createIfAbsent`), nunca cria um sozinho.
 */
@Injectable()
export class MarketplaceProblemsSyncWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    MarketplaceProblemsSyncWorkerService.name,
  );
  private readonly workerId = randomUUID();
  private readonly config: ProblemsSyncWorkerConfig;
  private readonly clock: MarketplaceProblemsSyncWorkerClock;
  private readonly timers: MarketplaceProblemsSyncWorkerTimers;
  private intervalHandle: unknown = null;
  private ticking = false;

  constructor(
    configService: ConfigService,
    private readonly jobsPersistence: MarketplaceProblemsSyncJobsPersistenceService,
    private readonly tickService: MarketplaceProblemsSyncTickService,
    @Optional()
    @Inject(PROBLEMS_SYNC_WORKER_CLOCK)
    clock?: MarketplaceProblemsSyncWorkerClock,
    @Optional()
    @Inject(PROBLEMS_SYNC_WORKER_TIMERS)
    timers?: MarketplaceProblemsSyncWorkerTimers,
  ) {
    this.config = readProblemsSyncWorkerConfig(configService);
    this.clock = clock ?? SYSTEM_CLOCK;
    this.timers = timers ?? SYSTEM_TIMERS;
  }

  onModuleInit(): void {
    if (!this.config.enabled) return;
    this.intervalHandle = this.timers.setInterval(
      () => void this.runTickOnce(),
      this.config.tickMs,
    );
  }

  onModuleDestroy(): void {
    if (this.intervalHandle !== null) {
      this.timers.clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Um ciclo completo: reivindica até `maxConcurrentJobs` jobs e processa cada
   * um em paralelo (uma conta lenta nunca atrasa a outra). Reentrância
   * própria (`ticking`) evita dois ciclos sobrepostos NO MESMO processo;
   * entre processos, quem impede é o `FOR UPDATE SKIP LOCKED`.
   */
  async runTickOnce(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const claimed = await this.jobsPersistence.claim(
        this.workerId,
        this.config.maxConcurrentJobs,
        this.config.leaseMs,
      );
      if (claimed.length === 0) return;

      const results = await Promise.allSettled(
        claimed.map((job) => this.processClaimedJob(job)),
      );
      // Falha INESPERADA (ex.: banco caiu no `commit`) nunca fica muda: o
      // lease expira sozinho (recuperação no próximo claim), aqui só garante
      // que o operador VÊ o problema — sem mensagem de erro (pode carregar
      // dados), só o nome do erro.
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          this.logger.error('problems_sync_job_failed', {
            jobId: claimed[index].id,
            accountId: claimed[index].marketplaceAccountId,
            error:
              result.reason instanceof Error ? result.reason.name : 'unknown',
          });
        }
      });
    } catch (error) {
      // Falha ao reivindicar (ex.: banco indisponível) nunca derruba o
      // worker; o próximo tick tenta de novo.
      this.logger.warn('problems_sync_tick_failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
    } finally {
      this.ticking = false;
    }
  }

  private async processClaimedJob(
    job: MarketplaceProblemsSyncJobRow,
  ): Promise<void> {
    const now = this.clock.now();
    const update = job.pauseRequested
      ? this.idleUpdate(job, now)
      : buildCommitUpdate(
          job,
          await this.tickService.runTick(job, now, this.config),
          now,
          this.config,
        );

    const committed = await this.jobsPersistence.commit(
      job.id,
      job.version,
      this.workerId,
      update,
    );
    if (!committed) {
      // Perdeu o controle do job (lease expirou e outro worker reivindicou):
      // seguro descartar — todo upsert do CP2-B é idempotente e o próximo
      // claim recalcula a partir do cursor/cobertura reais. NUNCA sobrescreve
      // o novo dono.
      this.logger.debug('problems_sync_lost_job_race', {
        jobId: job.id,
        accountId: job.marketplaceAccountId,
      });
    }
  }

  /**
   * Job reivindicado com `pause_requested` já marcado (pausa pedida quando o
   * lease anterior tinha expirado): NENHUM tick roda — o commit sem mudança
   * de progresso deixa o SQL converter em `PAUSED` de forma atômica.
   */
  private idleUpdate(
    job: MarketplaceProblemsSyncJobRow,
    now: Date,
  ): MarketplaceProblemsSyncJobCommitUpdate {
    return {
      status: 'RUNNING',
      windowCursorAt: job.windowCursorAt,
      claimsProcessedDelta: 0,
      claimsPersistedDelta: 0,
      claimsFailedDelta: 0,
      callsMadeDelta: 0,
      attemptCount: job.attemptCount,
      nextAttemptAt: now,
      lastActivityAt: now,
      lastErrorCode: job.lastErrorCode,
      lastCompleteCensusAt: null,
    };
  }
}
