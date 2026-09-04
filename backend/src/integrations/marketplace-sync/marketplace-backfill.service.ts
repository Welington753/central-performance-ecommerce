import { Injectable } from '@nestjs/common';
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

export type BackfillErrorCode =
  | 'ACCOUNT_NOT_CONNECTED'
  | 'MARKETPLACE_NOT_SUPPORTED'
  | 'NO_INITIAL_SYNC_YET'
  | 'BACKFILL_ALREADY_RUNNING'
  | 'AMAZON_NOT_CONFIGURED'
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

export interface BackfillStatus {
  status: BackfillStatusValue;
  oldestCoveredAt: string | null;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  synchronizedIntervals: Array<{ from: string; to: string }>;
  lastProcessedChunk: BackfillProcessedChunk | null;
  lastRunErrorCode: string | null;
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
  ) {}

  async getStatus(accountId: string): Promise<BackfillStatus> {
    await this.marketplaceAccountsService.findByIdOrFail(accountId);
    const coverage = await this.persistence.getAccountSyncCoverage(accountId);

    if (coverage.oldestFrom === null) {
      return {
        status: 'NOT_STARTED',
        oldestCoveredAt: null,
        firstOrderAt: null,
        lastOrderAt: null,
        synchronizedIntervals: [],
        lastProcessedChunk: null,
        lastRunErrorCode: null,
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
      return error.code === 'SYNC_ALREADY_RUNNING'
        ? new BackfillError('BACKFILL_ALREADY_RUNNING')
        : new BackfillError('SYNC_FAILED');
    }
    if (error instanceof AmazonOrdersSyncError) {
      if (error.code === 'SYNC_ALREADY_RUNNING') {
        return new BackfillError('BACKFILL_ALREADY_RUNNING');
      }
      if (error.code === 'AMAZON_NOT_CONFIGURED') {
        return new BackfillError('AMAZON_NOT_CONFIGURED');
      }
      return new BackfillError('SYNC_FAILED');
    }
    return new BackfillError('SYNC_FAILED');
  }
}
