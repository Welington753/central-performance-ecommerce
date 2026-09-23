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
import { Marketplace } from '../contracts/marketplace.enum';
import { LogisticsReclassificationRepository } from '../marketplace-orders/logistics-reclassification.repository';
import { MercadoLivreLogisticsReclassificationService } from './mercado-livre-logistics-reclassification.service';
import type { ReclassificationAccountOutcome } from './logistics-reclassification-report';
import {
  MlLogisticsReclassificationJobsPersistenceService,
  type MlLogisticsReclassificationJobCommitUpdate,
  type MlLogisticsReclassificationJobRow,
  type MlLogisticsReclassificationJobStatus,
} from './ml-logistics-reclassification-jobs-persistence.service';
import {
  ML_LOGISTICS_RECLASSIFICATION_WORKER_CLOCK,
  ML_LOGISTICS_RECLASSIFICATION_WORKER_TIMERS,
  SYSTEM_CLOCK,
  SYSTEM_TIMERS,
  type MlLogisticsReclassificationWorkerClock,
  type MlLogisticsReclassificationWorkerTimers,
} from './ml-logistics-reclassification-worker.clock';
import {
  readMlLogisticsReclassificationWorkerConfig,
  type MlLogisticsReclassificationWorkerConfig,
} from './ml-logistics-reclassification-worker-config.util';

/**
 * Worker durável da reclassificação histórica Full (correção da auditoria
 * Full — Render free sem Shell) — MESMO padrão de
 * `MarketplaceBackfillWorkerService` (Fase 4, "Backfill durável"): reivindica
 * linhas elegíveis via `FOR UPDATE SKIP LOCKED` + lease
 * (`MlLogisticsReclassificationJobsPersistenceService.claim`), processa UMA
 * fatia pequena por vez reaproveitando
 * `MercadoLivreLogisticsReclassificationService.apply` (nenhuma cópia de
 * HTTP/classificação/escrita condicional) e agenda o próximo passo.
 *
 * Nenhuma transação de banco fica aberta durante a chamada HTTP: o claim é
 * uma transação curta e separada, `apply()` roda TOTALMENTE fora de
 * transação, e o `commit` final é outro `UPDATE` isolado guardado por CAS.
 *
 * Classificação de saída → transição de estado do job (vocabulário fechado
 * de `ReclassificationAccountOutcome`, nunca inventado aqui):
 * - `COMPLETED`/`SKIPPED_NOTHING_PENDING`: fila REALMENTE esgotada (as duas
 *   filas do serviço — com e sem `external_shipment_id` — vazias) →
 *   `COMPLETED`.
 * - `STOPPED_MAX_REQUESTS`: orçamento do tick acabou, ainda há trabalho →
 *   continua `RUNNING`, `nextAttemptAt = now` (próximo tick reivindica de
 *   novo; nunca dois ticks concorrentes do MESMO job, pelo lease).
 * - `STOPPED_RATE_LIMITED`/`STOPPED_PROVIDER_UNAVAILABLE`: falha transitória
 *   do provedor → `WAITING_RETRY` com backoff (mais longo para rate limit).
 * - `ABORTED_UNAUTHORIZED`: 401/403 EXPLÍCITO devolvido pela API (shipment ou
 *   detalhe do pedido) → `FAILED_AUTH`, para automaticamente. Precisa de
 *   reconexão OAuth manual antes de qualquer retomada.
 * - `ABORTED_TOKEN_UNAVAILABLE`: falha ao obter/renovar o token — o serviço
 *   reaproveitado aqui NUNCA distingue a causa exata internamente (design
 *   documentado em `mercado-livre-logistics-reclassification.service.ts`:
 *   "a causa exata NUNCA é propagada"). Decisão CONSERVADORA deste worker:
 *   nunca declara `FAILED_AUTH` sem um 401/403 explícito — trata como
 *   transitório (`WAITING_RETRY`) para nunca travar uma conta cuja causa
 *   real era só contenção momentânea (`ACCOUNT_BUSY`) num estado que só sai
 *   com ação manual do usuário.
 * - `SKIPPED_ACCOUNT_BUSY`: o advisory lock por conta (defesa em
 *   profundidade contra a CLI manual rodando ao mesmo tempo) estava
 *   ocupado → continua `RUNNING`, nextAttemptAt = now.
 * - `SKIPPED_NOT_CONNECTED`: a conta foi desconectada entre o claim e a
 *   chamada → `FAILED_AUTH` (mesma ação exigida do usuário: reconectar).
 *
 * Desligado sempre que `NODE_ENV=test` (mesmo com a env var dizendo o
 * contrário) — nenhum timer chega a ser criado; os testes chamam
 * `runTickOnce()` diretamente.
 */
@Injectable()
export class MlLogisticsReclassificationWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    MlLogisticsReclassificationWorkerService.name,
  );
  private readonly workerId = randomUUID();
  private readonly config: MlLogisticsReclassificationWorkerConfig;
  private readonly clock: MlLogisticsReclassificationWorkerClock;
  private readonly timers: MlLogisticsReclassificationWorkerTimers;
  private intervalHandle: unknown = null;
  private ticking = false;

  constructor(
    configService: ConfigService,
    private readonly reclassificationService: MercadoLivreLogisticsReclassificationService,
    private readonly jobsPersistence: MlLogisticsReclassificationJobsPersistenceService,
    private readonly repository: LogisticsReclassificationRepository,
    @Optional()
    @Inject(ML_LOGISTICS_RECLASSIFICATION_WORKER_CLOCK)
    clock?: MlLogisticsReclassificationWorkerClock,
    @Optional()
    @Inject(ML_LOGISTICS_RECLASSIFICATION_WORKER_TIMERS)
    timers?: MlLogisticsReclassificationWorkerTimers,
  ) {
    this.config = readMlLogisticsReclassificationWorkerConfig(configService);
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
   * Um ciclo completo: calcula o espaço restante do teto de concorrência
   * GLOBAL (contas RUNNING com lease ativo, nunca estado em memória — vale
   * para todas as instâncias do backend), reivindica até esse tanto e
   * processa cada job em paralelo (uma conta lenta nunca atrasa a outra —
   * Meli 1 x Meli 2 isoladas). Reentrância própria (`ticking`) evita dois
   * ciclos sobrepostos NO MESMO processo; entre processos diferentes, quem
   * impede é o `FOR UPDATE SKIP LOCKED`.
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
      // Uma falha INESPERADA (não tratada dentro de `processClaimedJob`,
      // ex.: o banco caiu no meio do `commit`) nunca pode ficar muda —
      // `Promise.allSettled` por si só engoliria a rejeição sem log
      // nenhum. A linha permanece com o lease preso até expirar sozinho
      // (recuperação automática no próximo tick, mesmo mecanismo de "worker
      // caiu" já coberto pelo claim); aqui só garante que o operador VÊ o
      // problema.
      for (let i = 0; i < results.length; i += 1) {
        const result = results[i];
        if (result.status === 'rejected') {
          this.logger.error('ml_logistics_reclassification_job_failed', {
            jobId: claimed[i].id,
            accountId: claimed[i].marketplaceAccountId,
            message:
              result.reason instanceof Error
                ? result.reason.message
                : 'unknown',
          });
        }
      }
    } catch (error) {
      // Uma falha ao reivindicar (ex.: banco momentaneamente indisponível)
      // nunca derruba o worker — só o log; o próximo tick tenta de novo.
      this.logger.warn('ml_logistics_reclassification_tick_failed', {
        message: error instanceof Error ? error.message : 'unknown',
      });
    } finally {
      this.ticking = false;
    }
  }

  private async processClaimedJob(
    job: MlLogisticsReclassificationJobRow,
  ): Promise<void> {
    const now = this.clock.now();
    const [report] = await this.reclassificationService.apply({
      accountId: job.marketplaceAccountId,
      batchSize: this.config.batchSize,
      maxRequestsPerAccount: this.config.maxCallsPerTick,
      // Cursor durável (correção "sem starvation") — retoma de onde a
      // passada atual parou, em vez de sempre reiniciar do zero a cada
      // tick. Ver doc completa na migration da tabela.
      queue1AfterId: job.queue1CursorId,
      queue2AfterId: job.queue2CursorId,
    });

    const callsMadeDelta =
      (report?.shipmentRequests ?? 0) + (report?.orderDetailRequests ?? 0);
    const resolvedFullDelta = report?.resolvedMarketplaceFulfilled ?? 0;
    const resolvedNotFullDelta = report?.resolvedSellerFulfilled ?? 0;
    const resolvedThisTick = resolvedFullDelta + resolvedNotFullDelta;

    const remainingUnknownCount = await this.currentRemainingUnknown(
      job.marketplaceAccountId,
    );

    const outcome: ReclassificationAccountOutcome =
      report?.outcome ?? 'SKIPPED_NOTHING_PENDING';
    // Eco do cursor ANTERIOR quando a fila correspondente nem chegou a
    // rodar neste tick (ex.: `SKIPPED_ACCOUNT_BUSY` antes de qualquer
    // fila, ou fila 2 nunca roda porque a fila 1 não terminou) — nunca
    // perde o cursor já conquistado.
    let queue1CursorId = report?.queue1EndCursor ?? job.queue1CursorId;
    let queue2CursorId = report?.queue2EndCursor ?? job.queue2CursorId;
    let passResolvedCount = job.passResolvedCount + resolvedThisTick;

    // Passada completa (correção "sem starvation"): as duas filas
    // alcançaram o fim de tudo que hoje é `UNKNOWN` a partir de onde
    // começaram. Só ENTÃO decide entre "nova passada" (algo foi resolvido —
    // pode haver pedido cujo shipment id só foi recuperado tarde demais
    // para esta passada) e "COMPLETED de fato" (passada inteira sem
    // resolver NADA — o que sobrou é permanentemente inclassificável;
    // `remainingUnknownCount` acima já reflete esse total, nunca escondido).
    const bothQueuesExhausted =
      (report?.queue1Exhausted ?? false) && (report?.queue2Exhausted ?? false);

    let status: MlLogisticsReclassificationJobRow['status'];
    let nextAttemptAt: Date;
    let lastErrorCode: string | null;
    let completedAt: Date | null = null;

    if (bothQueuesExhausted) {
      if (passResolvedCount > 0) {
        queue1CursorId = null;
        queue2CursorId = null;
        passResolvedCount = 0;
        status = 'RUNNING';
        nextAttemptAt = now;
        lastErrorCode = null;
      } else {
        status = 'COMPLETED';
        nextAttemptAt = now;
        lastErrorCode = null;
        completedAt = now;
      }
    } else {
      const transition = this.transitionFor(outcome, now);
      status = transition.status;
      nextAttemptAt = transition.nextAttemptAt;
      lastErrorCode = transition.lastErrorCode;
    }

    if (job.pauseRequested) {
      status = 'PAUSED';
      nextAttemptAt = now;
    }

    const update: MlLogisticsReclassificationJobCommitUpdate = {
      status,
      remainingUnknownCount,
      resolvedFullDelta,
      resolvedNotFullDelta,
      callsMadeDelta,
      queue1CursorId,
      queue2CursorId,
      passResolvedCount,
      nextAttemptAt,
      lastActivityAt: now,
      completedAt,
      lastErrorCode,
      pauseRequested: false,
      releaseLease: true,
    };

    const committed = await this.jobsPersistence.commit(
      job.id,
      job.version,
      this.workerId,
      update,
    );
    if (!committed) {
      // Perdeu a corrida pelo controle do job (lease expirou e outro worker
      // já reivindicou de novo) — seguro descartar: a classificação já foi
      // persistida de forma condicional e idempotente por `apply()` ANTES
      // disto. Só a contabilidade deste job é perdida, e o próximo commit
      // recalcula `remainingUnknownCount` a partir da verdade real do banco.
      this.logger.debug('ml_logistics_reclassification_lost_job_race', {
        jobId: job.id,
        accountId: job.marketplaceAccountId,
      });
    }
  }

  private async currentRemainingUnknown(accountId: string): Promise<number> {
    const counts = await this.repository.countPendingByAccount(
      Marketplace.MERCADO_LIVRE,
      accountId,
    );
    const row = counts[0];
    if (!row) return 0;
    return row.pendingWithShipmentId + row.pendingWithoutShipmentId;
  }

  /**
   * Só chamada quando `bothQueuesExhausted` é `false` (ver
   * `processClaimedJob`) — ou seja, NUNCA decide `COMPLETED` sozinha. Os
   * dois casos `COMPLETED`/`SKIPPED_NOTHING_PENDING` do vocabulário do
   * serviço reaproveitado só chegam aqui de forma defensiva (nunca deveriam
   * acontecer com `bothQueuesExhausted = false`, dado como o serviço
   * encadeia as duas filas — ver doc de `queue1Exhausted`/`queue2Exhausted`);
   * tratados como "ainda há trabalho, tenta de novo já" em vez de encerrar
   * o job, para nunca arriscar uma conclusão falsa.
   */
  private transitionFor(
    outcome: ReclassificationAccountOutcome,
    now: Date,
  ): {
    status: MlLogisticsReclassificationJobStatus;
    nextAttemptAt: Date;
    lastErrorCode: string | null;
  } {
    switch (outcome) {
      case 'COMPLETED':
      case 'SKIPPED_NOTHING_PENDING':
      case 'STOPPED_MAX_REQUESTS':
      case 'SKIPPED_ACCOUNT_BUSY':
        return { status: 'RUNNING', nextAttemptAt: now, lastErrorCode: null };
      case 'STOPPED_RATE_LIMITED':
        return {
          status: 'WAITING_RETRY',
          nextAttemptAt: this.addMs(now, this.config.rateLimitBackoffMs),
          lastErrorCode: outcome,
        };
      case 'STOPPED_PROVIDER_UNAVAILABLE':
        return {
          status: 'WAITING_RETRY',
          nextAttemptAt: this.addMs(
            now,
            this.config.providerUnavailableBackoffMs,
          ),
          lastErrorCode: outcome,
        };
      case 'ABORTED_TOKEN_UNAVAILABLE':
        return {
          status: 'WAITING_RETRY',
          nextAttemptAt: this.addMs(now, this.config.tokenUnavailableBackoffMs),
          lastErrorCode: outcome,
        };
      case 'ABORTED_UNAUTHORIZED':
      case 'SKIPPED_NOT_CONNECTED':
        return {
          status: 'FAILED_AUTH',
          nextAttemptAt: now,
          lastErrorCode: outcome,
        };
    }
  }

  private addMs(date: Date, ms: number): Date {
    return new Date(date.getTime() + ms);
  }
}
