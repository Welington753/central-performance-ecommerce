import { Injectable } from '@nestjs/common';
import { SyncRunType } from '../../sync/sync-run.entity';
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

export interface BackfillStatus {
  oldestCoveredAt: string | null;
  historyComplete: boolean;
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
  ) {}

  async getStatus(accountId: string): Promise<BackfillStatus> {
    await this.marketplaceAccountsService.findByIdOrFail(accountId);
    const coverage = await this.persistence.getAccountSyncCoverage(accountId);
    return {
      oldestCoveredAt: coverage.oldestFrom
        ? utcInstantToSaoPauloDateString(coverage.oldestFrom)
        : null,
      historyComplete: coverage.oldestRunRecordsRead === 0,
    };
  }

  /**
   * Executa UM chunk do backfill e retorna. O chamador (frontend) decide
   * quando parar de chamar de novo — `hasMoreHistory: false` sinaliza que o
   * provedor confirmou não haver pedido mais antigo que a janela deste
   * chunk (nunca inferido antecipadamente; sempre uma prova real do
   * provedor).
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
    if (coverage.oldestRunRecordsRead === 0) {
      // Um chunk anterior já provou o início real do histórico — idempotente:
      // nunca chama o provedor de novo para confirmar o óbvio.
      return {
        hasMoreHistory: false,
        oldestCoveredAt: utcInstantToSaoPauloDateString(coverage.oldestFrom),
        ordersFetched: 0,
      };
    }

    const window = computeBackfillChunkWindow(coverage.oldestFrom);

    try {
      const ordersFetched = await this.dispatchChunk(account.marketplace, {
        accountId,
        window,
      });
      return {
        hasMoreHistory: ordersFetched > 0,
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
