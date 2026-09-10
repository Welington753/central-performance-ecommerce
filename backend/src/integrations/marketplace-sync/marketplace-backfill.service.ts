import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SyncRunStatus, SyncRunType } from '../../sync/sync-run.entity';
import { SyncRunsService } from '../../sync/sync-runs.service';
import { Marketplace } from '../contracts/marketplace.enum';
import { AmazonOrdersSyncError } from '../amazon-orders/amazon-orders-sync.service';
import { AmazonOrdersSyncService } from '../amazon-orders/amazon-orders-sync.service';
import { MercadoLivreOrdersSyncService } from '../mercado-livre-orders/mercado-livre-orders-sync.service';
import { SyncOrdersError } from '../mercado-livre-orders/mercado-livre-orders-sync.service';
import { MarketplaceAccountStatus } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import {
  MarketplaceOrdersPersistenceService,
  SyncAlreadyRunningError,
} from '../marketplace-orders/marketplace-orders-persistence.service';
import {
  computeBackfillChunkWindow,
  hasReachedBackfillSafetyFloor,
  utcInstantToSaoPauloDateString,
} from '../marketplace-orders/period.util';
import {
  BackfillJobActiveConflictError,
  BackfillJobsPersistenceService,
  type BackfillJobRow,
  type BackfillJobStatus,
} from './backfill-jobs-persistence.service';
import { isBackfillWorkerEnabled } from './backfill-worker-config.util';

/**
 * Além dos códigos originais (Fase 4, "Histórico completo"), o worker
 * durável (Fase 4, "Backfill durável") precisa distinguir com mais
 * fidelidade os erros retryable/transitórios dos terminais — daí os cinco
 * códigos novos abaixo, todos apenas REPASSADOS de `SyncOrdersErrorCode`/
 * `AmazonOrdersSyncErrorCode` já existentes (nunca uma classificação nova
 * de erro, só menos perda de informação em `mapChunkError`):
 * `TOKEN_EXPIRED`/`ML_APP_CONFIGURATION_ERROR` são terminais (reconectar ou
 * reconfigurar a aplicação, nunca resolvidos por retry); `ACCOUNT_BUSY`/
 * `TOKEN_REFRESH_PENDING` são sempre transitórios (requeue rápido, nunca
 * contam para o limite de tentativas); `PROVIDER_RATE_LIMITED` é
 * transitório mas usa um backoff mais longo (ver `BackfillWorkerService`).
 */
export type BackfillErrorCode =
  | 'ACCOUNT_NOT_CONNECTED'
  | 'MARKETPLACE_NOT_SUPPORTED'
  | 'NO_INITIAL_SYNC_YET'
  | 'BACKFILL_ALREADY_RUNNING'
  | 'AMAZON_NOT_CONFIGURED'
  | 'TOKEN_EXPIRED'
  | 'ACCOUNT_BUSY'
  | 'TOKEN_REFRESH_PENDING'
  | 'ML_APP_CONFIGURATION_ERROR'
  | 'PROVIDER_RATE_LIMITED'
  | 'SYNC_FAILED';

export class BackfillError extends Error {
  constructor(public readonly code: BackfillErrorCode) {
    super(code);
  }
}

export interface BackfillChunkResult {
  hasMoreHistory: boolean;
  oldestCoveredAt: string;
  ordersFetched: number;
}

/**
 * `SAFETY_LIMIT_REACHED` NUNCA significa "chegou à primeira venda da
 * empresa" — só que o teto defensivo (`BACKFILL_SAFETY_FLOOR_YEARS`) foi
 * atingido sem o provedor ter confirmado exaustão real (ver auditoria em
 * `period.util.ts`). `ERROR` é sempre uma falha transitória retryable (nunca
 * perde progresso — o próximo `next-chunk`/"Tentar novamente" retoma de
 * `oldestCoveredAt`).
 */
export type BackfillStatusValue =
  'NOT_STARTED' | 'IN_PROGRESS' | 'SAFETY_LIMIT_REACHED' | 'ERROR';

export interface BackfillProcessedChunk {
  from: string;
  to: string;
  ordersFetched: number;
}

/**
 * Estado de orquestração do job durável (Fase 4, "Backfill durável") — `null`
 * enquanto nenhum "Completar histórico" jamais foi clicado para esta conta.
 * Nunca inclui token, payload ou mensagem bruta — `lastErrorCode` é sempre
 * um `BackfillErrorCode` já sanitizado.
 */
export interface BackfillJobSummary {
  id: string;
  status: BackfillJobStatus;
  chunksProcessed: number;
  attemptCount: number;
  requestedAt: string;
  startedAt: string | null;
  lastActivityAt: string | null;
  nextAttemptAt: string | null;
  completedAt: string | null;
  lastErrorCode: string | null;
  pauseRequested: boolean;
}

export interface BackfillStatus {
  status: BackfillStatusValue;
  oldestCoveredAt: string | null;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  synchronizedIntervals: Array<{ from: string; to: string }>;
  lastProcessedChunk: BackfillProcessedChunk | null;
  lastRunErrorCode: string | null;
  /** Aditivo (Fase 4, "Backfill durável") — campos antigos acima nunca mudam de sentido. */
  job: BackfillJobSummary | null;
  /**
   * Aditivo (clareza de status) — mesma interpretação efetiva de
   * `BACKFILL_WORKER_ENABLED` que `MarketplaceBackfillWorkerService` usa
   * para decidir se cria o timer (`isBackfillWorkerEnabled`). Nunca expõe a
   * env var em si, só o booleano resultante: o frontend usa isto para nunca
   * afirmar "processando" com o worker desligado.
   */
  workerEnabled: boolean;
}

// Bem maior que a duração plausível de qualquer chunk real (Amazon/ML) —
// nunca um timeout de operação normal, só a rede de segurança para um
// processo derrubado no meio de um chunk.
const STALE_RUN_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Backfill histórico inicial (Fase 4, "Histórico completo"): completa, em
 * janelas pequenas e paginadas (`computeBackfillChunkWindow`), o histórico
 * anterior ao que a sincronização incremental já cobre — sem baixar anos de
 * pedidos de uma vez, idempotente e retomável após queda (cada chunk deriva
 * seu próprio estado de `sync_runs`, nenhuma tabela/coluna nova).
 * Reaproveita INTEGRALMENTE `MercadoLivreOrdersSyncService`/
 * `AmazonOrdersSyncService` via `windowOverride` — nenhuma cópia de
 * fetch/persistência.
 */
@Injectable()
export class MarketplaceBackfillService {
  constructor(
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
    private readonly persistence: MarketplaceOrdersPersistenceService,
    private readonly mlSyncService: MercadoLivreOrdersSyncService,
    private readonly amazonSyncService: AmazonOrdersSyncService,
    private readonly syncRunsService: SyncRunsService,
    private readonly jobsPersistence: BackfillJobsPersistenceService,
    private readonly configService: ConfigService,
  ) {}

  async getStatus(accountId: string): Promise<BackfillStatus> {
    await this.marketplaceAccountsService.findByIdOrFail(accountId);
    const coverage = await this.persistence.getAccountSyncCoverage(accountId);
    const jobRow = await this.jobsPersistence.findLatestJob(accountId);
    const job = jobRow ? this.toJobSummary(jobRow) : null;
    const workerEnabled = isBackfillWorkerEnabled(this.configService);

    if (coverage.oldestFrom === null) {
      return {
        status: 'NOT_STARTED',
        oldestCoveredAt: null,
        firstOrderAt: null,
        lastOrderAt: null,
        synchronizedIntervals: [],
        lastProcessedChunk: null,
        lastRunErrorCode: null,
        job,
        workerEnabled,
      };
    }

    const [orderRange, allRuns] = await Promise.all([
      this.persistence.getAccountOrderDateRange(accountId),
      this.syncRunsService.findAll({ marketplaceAccountId: accountId }),
    ]);

    // `findAll` já ordena DESC por `startedAt` — o primeiro é o mais recente.
    const latestRun = allRuns[0] ?? null;
    const latestInitialRun =
      allRuns.find((run) => run.type === SyncRunType.INITIAL) ?? null;

    let status: BackfillStatusValue = 'IN_PROGRESS';
    let lastRunErrorCode: string | null = null;
    if (latestRun && latestRun.status === SyncRunStatus.FAILED) {
      status = 'ERROR';
      lastRunErrorCode = latestRun.errorCode;
    } else if (
      hasReachedBackfillSafetyFloor(
        computeBackfillChunkWindow(coverage.oldestFrom).from,
        new Date(),
      )
    ) {
      status = 'SAFETY_LIMIT_REACHED';
    }

    return {
      status,
      oldestCoveredAt: utcInstantToSaoPauloDateString(coverage.oldestFrom),
      firstOrderAt: orderRange
        ? utcInstantToSaoPauloDateString(orderRange.first)
        : null,
      lastOrderAt: orderRange
        ? utcInstantToSaoPauloDateString(orderRange.last)
        : null,
      synchronizedIntervals: coverage.intervals.map((interval) => ({
        from: utcInstantToSaoPauloDateString(interval.from),
        to: utcInstantToSaoPauloDateString(interval.to),
      })),
      lastProcessedChunk:
        latestInitialRun && latestInitialRun.dateFrom && latestInitialRun.dateTo
          ? {
              from: utcInstantToSaoPauloDateString(latestInitialRun.dateFrom),
              to: utcInstantToSaoPauloDateString(latestInitialRun.dateTo),
              ordersFetched: latestInitialRun.recordsRead,
            }
          : null,
      lastRunErrorCode,
      job,
      workerEnabled,
    };
  }

  /**
   * Cria (ou, idempotentemente, devolve) o job durável de backfill desta
   * conta — chamado pelo endpoint `POST .../backfill/start`. Validado ANTES
   * de criar o job (mesmas checagens de `runNextChunk`) para dar erro
   * imediato ao usuário em vez de um job fadado a falhar já no primeiro
   * tick do worker. `BackfillJobActiveConflictError` (índice único parcial)
   * significa que já existe um job ativo para esta conta — nunca um erro
   * para o chamador, só devolve o status desse job já existente (dois
   * cliques nunca criam dois jobs).
   */
  async startBackfill(accountId: string): Promise<BackfillStatus> {
    const account =
      await this.marketplaceAccountsService.findByIdOrFail(accountId);
    if (account.status !== MarketplaceAccountStatus.CONNECTED) {
      throw new BackfillError('ACCOUNT_NOT_CONNECTED');
    }
    if (
      account.marketplace !== Marketplace.MERCADO_LIVRE &&
      account.marketplace !== Marketplace.AMAZON
    ) {
      throw new BackfillError('MARKETPLACE_NOT_SUPPORTED');
    }
    const coverage = await this.persistence.getAccountSyncCoverage(accountId);
    if (coverage.oldestFrom === null) {
      throw new BackfillError('NO_INITIAL_SYNC_YET');
    }

    try {
      await this.jobsPersistence.createJob(accountId, account.marketplace);
    } catch (error) {
      if (!(error instanceof BackfillJobActiveConflictError)) throw error;
      // Idempotência do `start`: já existe job ativo, devolve o existente.
    }
    return this.getStatus(accountId);
  }

  async pauseBackfill(accountId: string): Promise<BackfillStatus> {
    await this.marketplaceAccountsService.findByIdOrFail(accountId);
    await this.jobsPersistence.requestPause(accountId);
    return this.getStatus(accountId);
  }

  async resumeBackfill(accountId: string): Promise<BackfillStatus> {
    await this.marketplaceAccountsService.findByIdOrFail(accountId);
    await this.jobsPersistence.resumeJob(accountId);
    return this.getStatus(accountId);
  }

  private toJobSummary(job: BackfillJobRow): BackfillJobSummary {
    return {
      id: job.id,
      status: job.status,
      chunksProcessed: job.chunksProcessed,
      attemptCount: job.attemptCount,
      requestedAt: job.requestedAt.toISOString(),
      startedAt: job.startedAt ? job.startedAt.toISOString() : null,
      lastActivityAt: job.lastActivityAt
        ? job.lastActivityAt.toISOString()
        : null,
      nextAttemptAt: job.nextAttemptAt ? job.nextAttemptAt.toISOString() : null,
      completedAt: job.completedAt ? job.completedAt.toISOString() : null,
      lastErrorCode: job.lastErrorCode,
      pauseRequested: job.pauseRequested,
    };
  }

  /**
   * Executa UM chunk do backfill e retorna. O chamador (frontend) decide
   * quando parar de chamar de novo — `hasMoreHistory: false` significa
   * apenas que o teto defensivo (`hasReachedBackfillSafetyFloor`) foi
   * atingido, NUNCA que o provedor confirmou o início real do histórico
   * (nenhum chunk vazio, por si só, encerra o backfill — podem existir
   * meses sem vendas com vendas mais antigas ainda por trás).
   */
  async runNextChunk(accountId: string): Promise<BackfillChunkResult> {
    // Defensivo: um chunk anterior (desta conta ou de outra) pode ter
    // ficado preso em RUNNING por uma queda/reinício — sem isto, o índice
    // único ativo por conta bloquearia esta conta para sempre.
    await this.persistence.recoverStaleRunningRuns(STALE_RUN_THRESHOLD_MS);

    const account =
      await this.marketplaceAccountsService.findByIdOrFail(accountId);
    if (account.status !== MarketplaceAccountStatus.CONNECTED) {
      throw new BackfillError('ACCOUNT_NOT_CONNECTED');
    }

    const coverage = await this.persistence.getAccountSyncCoverage(accountId);
    if (coverage.oldestFrom === null) {
      throw new BackfillError('NO_INITIAL_SYNC_YET');
    }

    const window = computeBackfillChunkWindow(coverage.oldestFrom);
    if (hasReachedBackfillSafetyFloor(window.from, new Date())) {
      return {
        hasMoreHistory: false,
        oldestCoveredAt: utcInstantToSaoPauloDateString(coverage.oldestFrom),
        ordersFetched: 0,
      };
    }

    try {
      const ordersFetched = await this.dispatchChunk(account.marketplace, {
        accountId,
        window,
      });
      return {
        // Sempre `true` após um chunk real: um resultado vazio não é prova
        // de exaustão, só a ausência de vendas NAQUELA janela.
        hasMoreHistory: true,
        oldestCoveredAt: utcInstantToSaoPauloDateString(window.from),
        ordersFetched,
      };
    } catch (error) {
      throw this.mapChunkError(error);
    }
  }

  private async dispatchChunk(
    marketplace: Marketplace,
    input: { accountId: string; window: { from: Date; to: Date } },
  ): Promise<number> {
    if (marketplace === Marketplace.MERCADO_LIVRE) {
      const summary = await this.mlSyncService.syncOrders(input.accountId, {
        windowOverride: input.window,
        type: SyncRunType.INITIAL,
      });
      return summary.ordersFetched;
    }
    if (marketplace === Marketplace.AMAZON) {
      const summary = await this.amazonSyncService.syncOrders(
        input.accountId,
        {},
        { windowOverride: input.window, type: SyncRunType.INITIAL },
      );
      return summary.ordersFetched;
    }
    throw new BackfillError('MARKETPLACE_NOT_SUPPORTED');
  }

  private mapChunkError(error: unknown): BackfillError {
    if (error instanceof BackfillError) return error;
    if (error instanceof SyncAlreadyRunningError) {
      return new BackfillError('BACKFILL_ALREADY_RUNNING');
    }
    if (error instanceof SyncOrdersError) {
      switch (error.code) {
        case 'SYNC_ALREADY_RUNNING':
          return new BackfillError('BACKFILL_ALREADY_RUNNING');
        case 'ACCOUNT_NOT_CONNECTED':
          return new BackfillError('ACCOUNT_NOT_CONNECTED');
        case 'TOKEN_EXPIRED':
          return new BackfillError('TOKEN_EXPIRED');
        case 'ACCOUNT_BUSY':
          return new BackfillError('ACCOUNT_BUSY');
        case 'TOKEN_REFRESH_PENDING':
          return new BackfillError('TOKEN_REFRESH_PENDING');
        case 'ML_APP_CONFIGURATION_ERROR':
          return new BackfillError('ML_APP_CONFIGURATION_ERROR');
        case 'PROVIDER_RATE_LIMITED':
          return new BackfillError('PROVIDER_RATE_LIMITED');
        default:
          return new BackfillError('SYNC_FAILED');
      }
    }
    if (error instanceof AmazonOrdersSyncError) {
      switch (error.code) {
        case 'SYNC_ALREADY_RUNNING':
          return new BackfillError('BACKFILL_ALREADY_RUNNING');
        case 'AMAZON_NOT_CONFIGURED':
          return new BackfillError('AMAZON_NOT_CONFIGURED');
        case 'ACCOUNT_NOT_CONNECTED':
          return new BackfillError('ACCOUNT_NOT_CONNECTED');
        case 'PROVIDER_RATE_LIMITED':
          return new BackfillError('PROVIDER_RATE_LIMITED');
        default:
          return new BackfillError('SYNC_FAILED');
      }
    }
    return new BackfillError('SYNC_FAILED');
  }
}
