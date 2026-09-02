import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Marketplace } from '../contracts/marketplace.enum';
import { SyncRunStatus, SyncRunType } from '../../sync/sync-run.entity';
import type { MappedOrderRecord } from './mercado-livre-order.mapper';

export class SyncAlreadyRunningError extends Error {}

export interface BeginSyncRunInput {
  marketplaceAccountId: string;
  periodFrom: Date;
  periodTo: Date;
  startedAt: Date;
}

export interface PersistOrdersResult {
  ordersCreated: number;
  ordersUpdated: number;
  itemsPersisted: number;
}

/**
 * Único ponto de escrita no Postgres para pedidos/itens do Mercado Livre e
 * para o ciclo de vida do `sync_runs` correspondente. Nunca chama a rede —
 * todo o fetch já terminou antes de qualquer método aqui ser invocado
 * (design: "não faça chamadas HTTP mantendo uma transação de banco aberta").
 */
@Injectable()
export class MercadoLivreOrdersPersistenceService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Cria a linha `RUNNING` de `sync_runs`. O índice único parcial
   * `UQ_sync_runs_active_run_per_account` (migration da Fase 3) garante,
   * mesmo sob concorrência real entre processos, que só uma sincronização
   * por conta esteja `RUNNING` por vez — uma segunda tentativa simultânea
   * vira violação de unicidade, traduzida aqui em `SyncAlreadyRunningError`.
   */
  async beginSyncRun(input: BeginSyncRunInput): Promise<string> {
    try {
      // `INSERT ... RETURNING` (diferente de `UPDATE/DELETE ... RETURNING`)
      // devolve, via `DataSource.query()` do driver `pg`, o array de linhas
      // diretamente — nunca a tupla `[rows, rowCount]` usada pelos métodos
      // `queryReturning` de UPDATE/DELETE deste código-base (confirmado
      // empiricamente contra um Postgres real antes desta implementação).
      const rows = await this.dataSource.query<Array<{ id: string }>>(
        `INSERT INTO sync_runs
            (marketplace_account_id, marketplace, type, status, started_at, date_from, date_to)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id`,
        [
          input.marketplaceAccountId,
          Marketplace.MERCADO_LIVRE,
          SyncRunType.MANUAL,
          SyncRunStatus.RUNNING,
          input.startedAt,
          input.periodFrom,
          input.periodTo,
        ],
      );
      return rows[0].id;
    } catch (error) {
      if (this.isActiveRunConflict(error)) {
        throw new SyncAlreadyRunningError();
      }
      throw error;
    }
  }

  async finalizeSyncRunSuccess(
    syncRunId: string,
    counts: {
      ordersFetched: number;
      ordersCreated: number;
      ordersUpdated: number;
      pagesFetched: number;
      itemsPersisted: number;
    },
    finishedAt: Date,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE sync_runs
          SET status = $2, finished_at = $3, records_read = $4,
              records_created = $5, records_updated = $6, records_failed = 0,
              pages_fetched = $7, items_persisted = $8
        WHERE id = $1`,
      [
        syncRunId,
        SyncRunStatus.SUCCESS,
        finishedAt,
        counts.ordersFetched,
        counts.ordersCreated,
        counts.ordersUpdated,
        counts.pagesFetched,
        counts.itemsPersisted,
      ],
    );
  }

  async finalizeSyncRunFailure(
    syncRunId: string,
    errorCode: string,
    errorSummary: string,
    finishedAt: Date,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE sync_runs
          SET status = $2, finished_at = $3, error_code = $4, error_summary = $5
        WHERE id = $1`,
      [syncRunId, SyncRunStatus.FAILED, finishedAt, errorCode, errorSummary],
    );
  }

  async markAccountSynced(accountId: string, syncedAt: Date): Promise<void> {
    await this.dataSource.query(
      `UPDATE marketplace_accounts SET last_successful_sync_at = $2 WHERE id = $1`,
      [accountId, syncedAt],
    );
  }

  /**
   * UPSERT idempotente por `(marketplace_account_id, external_order_id)` +
   * substituição total dos itens do pedido (delete + insert), tudo em UMA
   * transação para todo o lote — uma sincronização repetida do mesmo
   * período atualiza os registros existentes sem duplicar pedidos nem
   * itens.
   */
  async persistOrders(
    orders: MappedOrderRecord[],
  ): Promise<PersistOrdersResult> {
    if (orders.length === 0) {
      return { ordersCreated: 0, ordersUpdated: 0, itemsPersisted: 0 };
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let ordersCreated = 0;
    let ordersUpdated = 0;
    let itemsPersisted = 0;

    try {
      for (const order of orders) {
        // `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` continua sendo,
        // para o driver, um comando INSERT — devolve o array de linhas
        // diretamente, nunca a tupla `[rows, rowCount]` (ver `beginSyncRun`
        // acima, confirmado empiricamente contra um Postgres real).
        const orderRows = (await queryRunner.query(
          `INSERT INTO marketplace_orders
              (marketplace_account_id, external_order_id, status, currency_id,
               total_amount, pack_id, date_created, date_closed,
               marketplace_last_updated, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
            ON CONFLICT (marketplace_account_id, external_order_id) DO UPDATE
              SET status = EXCLUDED.status,
                  currency_id = EXCLUDED.currency_id,
                  total_amount = EXCLUDED.total_amount,
                  pack_id = EXCLUDED.pack_id,
                  date_created = EXCLUDED.date_created,
                  date_closed = EXCLUDED.date_closed,
                  marketplace_last_updated = EXCLUDED.marketplace_last_updated,
                  updated_at = now()
            RETURNING id, (xmax = 0) AS inserted`,
          [
            order.marketplaceAccountId,
            order.externalOrderId,
            order.status,
            order.currencyId,
            order.totalAmount,
            order.packId,
            order.dateCreated,
            order.dateClosed,
            order.marketplaceLastUpdated,
          ],
        )) as Array<{ id: string; inserted: boolean }>;

        const { id: orderId, inserted } = orderRows[0];
        if (inserted) ordersCreated += 1;
        else ordersUpdated += 1;

        await queryRunner.query(
          `DELETE FROM marketplace_order_items WHERE order_id = $1`,
          [orderId],
        );

        for (const item of order.items) {
          await queryRunner.query(
            `INSERT INTO marketplace_order_items
                (order_id, external_item_id, variation_id, seller_sku, title,
                 quantity, unit_price, currency_id)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              orderId,
              item.externalItemId,
              item.variationId,
              item.sellerSku,
              item.title,
              item.quantity,
              item.unitPrice,
              item.currencyId,
            ],
          );
          itemsPersisted += 1;
        }
      }

      await queryRunner.commitTransaction();
      return { ordersCreated, ordersUpdated, itemsPersisted };
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private isActiveRunConflict(error: unknown): boolean {
    const pgError = this.extractPostgresError(error);
    return (
      pgError?.code === '23505' &&
      pgError.constraint === 'UQ_sync_runs_active_run_per_account'
    );
  }

  private extractPostgresError(
    error: unknown,
  ): { code?: string; constraint?: string } | null {
    if (!(error instanceof Error)) return null;
    const candidate = error as Error & { code?: string; constraint?: string };
    return typeof candidate.code === 'string' ? candidate : null;
  }
}
