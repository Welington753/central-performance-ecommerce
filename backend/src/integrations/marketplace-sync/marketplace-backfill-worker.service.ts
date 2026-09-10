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
import {
  BackfillError,
  type BackfillErrorCode,
  MarketplaceBackfillService,
} from './marketplace-backfill.service';
import {
  BackfillJobsPersistenceService,
  type BackfillJobRow,
  type BackfillJobStateUpdate,
} from './backfill-jobs-persistence.service';
import {
  BACKFILL_WORKER_CLOCK,
  BACKFILL_WORKER_TIMERS,
  SYSTEM_CLOCK,
  SYSTEM_TIMERS,
  type BackfillWorkerClock,
  type BackfillWorkerTimers,
} from './backfill-worker.clock';
import { isBackfillWorkerEnabled } from './backfill-worker-config.util';

type ErrorClass = 'TERMINAL' | 'REQUEUE' | 'RATE_LIMITED' | 'TRANSIENT';

/**
 * Classificação de retry (Fase 4, "Backfill durável"): `TERMINAL` nunca
 * resolve sozinho com retry (precisa de reconexão/reconfiguração — vai
 * direto para `FAILED`); `REQUEUE` é contenção esperada entre a
 * sincronização incremental e o backfill DA MESMA conta (índice único de
 * `sync_runs`) — NUNCA conta para o limite de tentativas, é sempre
 * reagendado rápido (design explícito: "requeue, não falha definitiva");
 * `RATE_LIMITED` é transitório mas usa um backoff mais longo; `TRANSIENT` é
 * qualquer outra falha transitória (rede/timeout/5xx/resposta inesperada),
 * com backoff exponencial até `maxAttempts`.
 */
const ERROR_CLASSIFICATION: Record<BackfillErrorCode, ErrorClass> = {
  ACCOUNT_NOT_CONNECTED: 'TERMINAL',
  NO_INITIAL_SYNC_YET: 'TERMINAL',
  MARKETPLACE_NOT_SUPPORTED: 'TERMINAL',
  AMAZON_NOT_CONFIGURED: 'TERMINAL',
  TOKEN_EXPIRED: 'TERMINAL',
  ML_APP_CONFIGURATION_ERROR: 'TERMINAL',
  BACKFILL_ALREADY_RUNNING: 'REQUEUE',
  ACCOUNT_BUSY: 'REQUEUE',
  TOKEN_REFRESH_PENDING: 'REQUEUE',
  PROVIDER_RATE_LIMITED: 'RATE_LIMITED',
  SYNC_FAILED: 'TRANSIENT',
};

export interface BackfillWorkerConfig {
  enabled: boolean;
  tickMs: number;
  maxConcurrentJobs: number;
  leaseMs: number;
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
  requeueDelayMs: number;
  rateLimitBackoffMs: number;
}

function readWorkerConfig(configService: ConfigService): BackfillWorkerConfig {
  return {
    enabled: isBackfillWorkerEnabled(configService),
    tickMs: configService.get<number>('BACKFILL_WORKER_TICK_MS', 5000),
    maxConcurrentJobs: configService.get<number>(
      'BACKFILL_WORKER_MAX_CONCURRENT_JOBS',
      2,
    ),
    leaseMs: configService.get<number>('BACKFILL_WORKER_LEASE_MS', 120000),
    maxAttempts: configService.get<number>('BACKFILL_WORKER_MAX_ATTEMPTS', 5),
    retryBaseMs: configService.get<number>(
      'BACKFILL_WORKER_RETRY_BASE_MS',
      5000,
    ),
    retryMaxMs: configService.get<number>(
      'BACKFILL_WORKER_RETRY_MAX_MS',
      300000,
    ),
    requeueDelayMs: configService.get<number>(
      'BACKFILL_WORKER_REQUEUE_MS',
      10000,
    ),
    rateLimitBackoffMs: configService.get<number>(
      'BACKFILL_WORKER_RATE_LIMIT_BACKOFF_MS',
      60000,
    ),
  };
}

/**
 * Worker durável do backfill histórico (Fase 4, "Backfill durável") —
 * substitui o `while` client-side chamando `next-chunk` em loop. O usuário
 * clica uma vez em "Completar histórico" (cria/retoma um job `QUEUED`); daí
 * em diante, este worker — rodando no BACKEND, em ciclo, mesmo sem a aba do
 * navegador aberta — reivindica jobs elegíveis via `FOR UPDATE SKIP LOCKED`
 * (`BackfillJobsPersistenceService.claimJobs`), processa UM chunk por vez
 * reaproveitando `MarketplaceBackfillService.runNextChunk` (nenhuma cópia de
 * fetch/persistência de pedidos) e agenda o próximo passo.
 *
 * Nenhuma transação de banco fica aberta durante a chamada de rede: o claim
 * é uma transação curta e separada (`claimJobs`), e o chunk em si roda TOTALMENTE
 * fora de transação — só o `commitJobState` final (outro `UPDATE` isolado,
 * guardado por CAS de `version`+`lease_owner`) volta a tocar o banco.
 *
 * Múltiplas instâncias do backend rodando este mesmo worker NUNCA processam
 * o mesmo job (claim via lock do Postgres, não estado em memória) e
 * respeitam um teto de concorrência GLOBAL (`countCurrentlyRunning` conta
 * `RUNNING` de TODAS as instâncias antes de reivindicar mais).
 *
 * Desligado sempre que `NODE_ENV=test` (mesmo que a flag de ambiente diga o
 * contrário) — nenhum timer chega a ser criado, e os testes chamam
 * `runTickOnce()` diretamente, de forma síncrona e controlada.
 */
@Injectable()
export class MarketplaceBackfillWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MarketplaceBackfillWorkerService.name);
  private readonly workerId = randomUUID();
  private readonly config: BackfillWorkerConfig;
  private readonly clock: BackfillWorkerClock;
  private readonly timers: BackfillWorkerTimers;
  private intervalHandle: unknown = null;
  private ticking = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly backfillService: MarketplaceBackfillService,
    private readonly jobsPersistence: BackfillJobsPersistenceService,
    @Optional()
    @Inject(BACKFILL_WORKER_CLOCK)
    clock?: BackfillWorkerClock,
    @Optional()
    @Inject(BACKFILL_WORKER_TIMERS)
    timers?: BackfillWorkerTimers,
  ) {
    this.config = readWorkerConfig(configService);
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
   * Um ciclo completo: calcula quanto espaço ainda existe para o teto de
   * concorrência GLOBAL, reivindica até esse tanto e processa cada job
   * reivindicado em paralelo (uma conta travada/lenta nunca atrasa as
   * demais — isolamento entre contas, inclusive Mercado Livre 1 x 2).
   * Reentrância própria (`ticking`) evita dois ciclos sobrepostos NO MESMO
   * processo mesmo se um tick demorar mais que `tickMs`; entre PROCESSOS
   * diferentes, quem impede sobreposição é o `FOR UPDATE SKIP LOCKED`.
   */
  async runTickOnce(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const running = await this.jobsPersistence.countCurrentlyRunning();
      const headroom = this.config.maxConcurrentJobs - running;
      if (headroom <= 0) return;

      const claimed = await this.jobsPersistence.claimJobs(
        this.workerId,
        headroom,
        this.config.leaseMs,
      );
      if (claimed.length === 0) return;

      await Promise.allSettled(
        claimed.map((job) => this.processClaimedJob(job)),
      );
    } catch (error) {
      // Uma falha ao consultar/reivindicar (ex.: banco momentaneamente
      // indisponível) nunca deve derrubar o worker — só o log; o próximo
      // tick tenta de novo.
      this.logger.warn('backfill_worker_tick_failed', {
        message: error instanceof Error ? error.message : 'unknown',
      });
    } finally {
      this.ticking = false;
    }
  }

  private async processClaimedJob(job: BackfillJobRow): Promise<void> {
    const now = this.clock.now();
    let update: BackfillJobStateUpdate;

    try {
      const result = await this.backfillService.runNextChunk(
        job.marketplaceAccountId,
      );
      const chunksProcessed = job.chunksProcessed + 1;

      if (!result.hasMoreHistory) {
        update = this.buildUpdate(job, now, {
          status: 'SAFETY_LIMIT_REACHED',
          chunksProcessed,
          attemptCount: 0,
          nextAttemptAt: now,
          completedAt: now,
          lastErrorCode: null,
          pauseRequested: false,
        });
      } else if (job.pauseRequested) {
        update = this.buildUpdate(job, now, {
          status: 'PAUSED',
          chunksProcessed,
          attemptCount: 0,
          nextAttemptAt: now,
          completedAt: null,
          lastErrorCode: null,
          pauseRequested: false,
        });
      } else {
        // Reagendado para "agora" — o próximo tick (não este mesmo ciclo)
        // reivindica de novo; nunca chunks concorrentes do MESMO job.
        update = this.buildUpdate(job, now, {
          status: 'QUEUED',
          chunksProcessed,
          attemptCount: 0,
          nextAttemptAt: now,
          completedAt: null,
          lastErrorCode: null,
          pauseRequested: false,
        });
      }
    } catch (rawError) {
      const error =
        rawError instanceof BackfillError
          ? rawError
          : new BackfillError('SYNC_FAILED');
      update = this.buildFailureUpdate(job, now, error);
    }

    const committed = await this.jobsPersistence.commitJobState(
      job.id,
      job.version,
      this.workerId,
      update,
    );
    if (!committed) {
      // Perdeu a corrida pelo controle do job (lease expirou e outro worker
      // já reivindicou de novo) — seguro descartar: `runNextChunk` já
      // persistiu qualquer pedido de forma idempotente antes disto, e o
      // próximo claim recalcula tudo a partir da cobertura real.
      this.logger.debug('backfill_worker_lost_job_race', {
        jobId: job.id,
        accountId: job.marketplaceAccountId,
      });
    }
  }

  private buildFailureUpdate(
    job: BackfillJobRow,
    now: Date,
    error: BackfillError,
  ): BackfillJobStateUpdate {
    const classification = ERROR_CLASSIFICATION[error.code];

    if (classification === 'TERMINAL') {
      return this.buildUpdate(job, now, {
        status: 'FAILED',
        chunksProcessed: job.chunksProcessed,
        attemptCount: job.attemptCount + 1,
        nextAttemptAt: now,
        completedAt: null,
        lastErrorCode: error.code,
        pauseRequested: false,
      });
    }

    // Pausa pedida durante um chunk que terminou em erro transitório —
    // respeita a pausa em vez de reagendar mais uma tentativa.
    if (job.pauseRequested) {
      return this.buildUpdate(job, now, {
        status: 'PAUSED',
        chunksProcessed: job.chunksProcessed,
        attemptCount: job.attemptCount,
        nextAttemptAt: now,
        completedAt: null,
        lastErrorCode: error.code,
        pauseRequested: false,
      });
    }

    if (classification === 'REQUEUE') {
      // NUNCA conta para o limite de tentativas — contenção esperada com a
      // sincronização incremental, não uma falha real do backfill.
      return this.buildUpdate(job, now, {
        status: 'RETRY_WAIT',
        chunksProcessed: job.chunksProcessed,
        attemptCount: job.attemptCount,
        nextAttemptAt: this.addMs(now, this.config.requeueDelayMs),
        completedAt: null,
        lastErrorCode: error.code,
        pauseRequested: false,
      });
    }

    const nextAttemptCount = job.attemptCount + 1;
    if (nextAttemptCount >= this.config.maxAttempts) {
      return this.buildUpdate(job, now, {
        status: 'FAILED',
        chunksProcessed: job.chunksProcessed,
        attemptCount: nextAttemptCount,
        nextAttemptAt: now,
        completedAt: null,
        lastErrorCode: error.code,
        pauseRequested: false,
      });
    }

    const delayMs =
      classification === 'RATE_LIMITED'
        ? this.config.rateLimitBackoffMs
        : Math.min(
            this.config.retryMaxMs,
            this.config.retryBaseMs * 2 ** (nextAttemptCount - 1),
          );

    return this.buildUpdate(job, now, {
      status: 'RETRY_WAIT',
      chunksProcessed: job.chunksProcessed,
      attemptCount: nextAttemptCount,
      nextAttemptAt: this.addMs(now, delayMs),
      completedAt: null,
      lastErrorCode: error.code,
      pauseRequested: false,
    });
  }

  private buildUpdate(
    job: BackfillJobRow,
    now: Date,
    fields: Omit<BackfillJobStateUpdate, 'lastActivityAt' | 'releaseLease'>,
  ): BackfillJobStateUpdate {
    return { ...fields, lastActivityAt: now, releaseLease: true };
  }

  private addMs(date: Date, ms: number): Date {
    return new Date(date.getTime() + ms);
  }
}
