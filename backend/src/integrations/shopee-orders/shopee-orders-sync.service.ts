import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Marketplace } from '../contracts/marketplace.enum';
import { MarketplaceAccountStatus } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { ShopeeAccessTokenService } from '../shopee-oauth/shopee-access-token.service';
import type { MappedOrderRecord } from '../marketplace-orders/mapped-order-record';
import {
  MarketplaceOrdersPersistenceService,
  SyncAlreadyRunningError,
} from '../marketplace-orders/marketplace-orders-persistence.service';
import { computeIncrementalSyncWindow } from '../marketplace-orders/period.util';
import {
  fetchShopeeOrderDetails,
  fetchShopeeOrderSns,
} from './shopee-orders-fetch.util';
import { ShopeeOrdersApiClient } from './shopee-orders-api.client';
import { mapShopeeOrder, ShopeeOrderMappingError } from './shopee-order.mapper';
import {
  resolveShopeeCredentialsErrorCode,
  ShopeeOrdersSyncError,
  type ShopeeOrdersSyncErrorCode,
} from './shopee-orders-sync-error';
import { splitShopeeSyncWindowIntoBlocks } from './shopee-orders-sync-window.util';

export interface ShopeeOrdersSyncSummary {
  syncRunId: string;
  status: 'SUCCESS' | 'INCOMPLETE';
  periodFrom: string;
  periodTo: string;
  pagesFetched: number;
  ordersFetched: number;
  ordersCreated: number;
  ordersUpdated: number;
  itemsPersisted: number;
}

const FAILURE_SUMMARIES: Record<ShopeeOrdersSyncErrorCode, string> = {
  NOT_CONNECTED: 'Conta não está conectada à Shopee.',
  CONNECTION_BUSY:
    'Já existe uma operação de token em andamento para esta conta.',
  NOT_CONFIGURED: 'Integração Shopee não configurada.',
  TEMPORARILY_UNAVAILABLE: 'Provedor indisponível ao consultar pedidos.',
  DATA_UNAVAILABLE:
    'Resposta do provedor em formato inesperado, rejeitada ou não mapeável com segurança.',
  SYNC_ALREADY_RUNNING: 'Já existe uma sincronização em andamento.',
  SYNC_FAILED: 'Falha inesperada durante a sincronização.',
};

/**
 * `error_code`/resumo gravados em `sync_runs` quando um teto de segurança
 * (páginas, total de pedidos ou cursor anômalo — `shopee-orders-fetch.util.ts`)
 * interrompe a busca (Checkpoint CP2K-3B) — nunca parte do vocabulário
 * público de erro HTTP (`ShopeeOrdersSyncErrorCode`): este caminho NUNCA
 * lança, sempre devolve `status: 'INCOMPLETE'` com 200. Desde o Checkpoint
 * CP2K-5C-3, grava `status: 'PARTIAL'` via `finalizeSyncRunPartial`
 * (nunca mais `finalizeSyncRunIncomplete`/`FAILED` — essa função continua
 * existindo só para a quarentena de pedidos da Amazon, sem relação com
 * safety cap).
 */
const INCOMPLETE_ERROR_CODE = 'SHOPEE_SAFETY_CAP_REACHED';
const INCOMPLETE_SUMMARY =
  'Sincronização interrompida por teto de segurança (páginas, total de pedidos ou cursor anômalo) antes do fim natural da janela.';

function resolveSyncErrorCode(error: unknown): ShopeeOrdersSyncErrorCode {
  if (error instanceof ShopeeOrdersSyncError) return error.code;
  if (error instanceof ShopeeOrderMappingError) return 'DATA_UNAVAILABLE';
  if (error instanceof ConflictException) {
    return resolveShopeeCredentialsErrorCode(error.message);
  }
  return 'SYNC_FAILED';
}

/**
 * Sincronização manual de pedidos Shopee (Checkpoint CP2K-3B) — espelha a
 * forma já usada por `MercadoLivreOrdersSyncService`/`AmazonOrdersSyncService`
 * (conta → `SyncRun` → credenciais → busca → mapeamento → persistência →
 * finalização), mas com paginação por cursor em blocos de até 15 dias
 * (`splitShopeeSyncWindowIntoBlocks`/`fetchShopeeOrderSns`, exigência da Shop
 * API da Shopee) e busca de detalhe em lotes de até 50
 * (`fetchShopeeOrderDetails`). Persiste através do MESMO
 * `MarketplaceOrdersPersistenceService` genérico — nunca uma cópia. Um
 * pedido com mapeamento inválido (ex.: `totalAmount` ausente) aborta a
 * execução INTEIRA antes de qualquer persistência — nunca uma quarentena
 * parcial como a Amazon, por exigência explícita deste checkpoint.
 */
@Injectable()
export class ShopeeOrdersSyncService {
  constructor(
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
    private readonly accessTokenService: ShopeeAccessTokenService,
    private readonly client: ShopeeOrdersApiClient,
    private readonly persistence: MarketplaceOrdersPersistenceService,
  ) {}

  async syncOrders(accountId: string): Promise<ShopeeOrdersSyncSummary> {
    const account =
      await this.marketplaceAccountsService.findByIdOrFail(accountId);

    if (account.marketplace !== Marketplace.SHOPEE) {
      throw new NotFoundException('Conta de marketplace não encontrada.');
    }
    if (
      account.status !== MarketplaceAccountStatus.CONNECTED ||
      !account.externalSellerId
    ) {
      throw new ShopeeOrdersSyncError('NOT_CONNECTED');
    }

    const startedAt = new Date();
    const coverage = await this.persistence.getAccountSyncCoverage(accountId);
    const window = computeIncrementalSyncWindow(coverage.intervals, startedAt);

    let syncRunId: string;
    try {
      syncRunId = await this.persistence.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.SHOPEE,
        periodFrom: window.from,
        periodTo: window.to,
        startedAt,
      });
    } catch (error) {
      if (error instanceof SyncAlreadyRunningError) {
        throw new ShopeeOrdersSyncError('SYNC_ALREADY_RUNNING');
      }
      throw error;
    }

    let finalized = false;
    try {
      // Única leitura de credenciais (Checkpoint CP2H/CP2J): accessToken e
      // shopId sempre da MESMA versão da conta, nunca relidos separadamente
      // durante o resto desta execução.
      const credentials =
        await this.accessTokenService.ensureValidShopCredentials(accountId);

      const blocks = splitShopeeSyncWindowIntoBlocks(window);
      const { orderSns, pagesFetched, capped, completedThroughSeconds } =
        await fetchShopeeOrderSns({
          client: this.client,
          credentials,
          blocks,
        });

      const detailOrders = await fetchShopeeOrderDetails({
        client: this.client,
        credentials,
        orderSns,
      });

      // Mapeamento inválido (ex.: `totalAmount` ausente, timestamp inválido,
      // status desconhecido) lança e aborta ANTES de qualquer persistência —
      // nenhum pedido parcial é gravado (exigência explícita CP2K-3B).
      const mappedOrders: MappedOrderRecord[] = detailOrders.map((raw) =>
        mapShopeeOrder(accountId, raw),
      );

      const persistResult = await this.persistence.persistOrders(mappedOrders);
      const finishedAt = new Date();
      finalized = true;

      if (capped) {
        // Checkpoint CP2K-5C-3: `completedThroughSeconds` (segundos desde a
        // época, `shopee-orders-fetch.util.ts`) vira `covered_through`
        // (instante) só quando não nulo — `null` significa "nenhum bloco
        // inteiro foi provado ainda", propagado como `null` sem conversão,
        // nunca inferido de `window`/`block` locais.
        const coveredThrough =
          completedThroughSeconds !== null
            ? new Date(completedThroughSeconds * 1000)
            : null;
        await this.persistence.finalizeSyncRunPartial(
          syncRunId,
          {
            ordersFetched: orderSns.length,
            ordersCreated: persistResult.ordersCreated,
            ordersUpdated: persistResult.ordersUpdated,
            recordsFailed: 0,
            pagesFetched,
            itemsPersisted: persistResult.itemsPersisted,
          },
          coveredThrough,
          INCOMPLETE_ERROR_CODE,
          INCOMPLETE_SUMMARY,
          finishedAt,
        );
      } else {
        await this.persistence.finalizeSyncRunSuccess(
          syncRunId,
          {
            ordersFetched: orderSns.length,
            ordersCreated: persistResult.ordersCreated,
            ordersUpdated: persistResult.ordersUpdated,
            pagesFetched,
            itemsPersisted: persistResult.itemsPersisted,
          },
          finishedAt,
        );
        await this.persistence.markAccountSynced(accountId, finishedAt);
      }

      return {
        syncRunId,
        status: capped ? 'INCOMPLETE' : 'SUCCESS',
        periodFrom: window.from.toISOString(),
        periodTo: window.to.toISOString(),
        pagesFetched,
        ordersFetched: orderSns.length,
        ordersCreated: persistResult.ordersCreated,
        ordersUpdated: persistResult.ordersUpdated,
        itemsPersisted: persistResult.itemsPersisted,
      };
    } catch (error) {
      const code = resolveSyncErrorCode(error);
      if (!finalized) {
        await this.persistence.finalizeSyncRunFailure(
          syncRunId,
          code,
          FAILURE_SUMMARIES[code],
          new Date(),
        );
      }
      throw error instanceof ShopeeOrdersSyncError
        ? error
        : new ShopeeOrdersSyncError(code);
    }
  }
}
