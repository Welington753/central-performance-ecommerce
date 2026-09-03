import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Marketplace } from '../contracts/marketplace.enum';
import { SyncRunStatus, SyncRunType } from '../../sync/sync-run.entity';
import { mergeIntervals, type SyncedInterval } from './coverage-interval.util';
import type { MappedOrderRecord } from './mapped-order-record';

export interface AccountSyncCoverage {
  intervals: SyncedInterval[];
  oldestFrom: Date | null;
  oldestRunRecordsRead: number | null;
}

export class SyncAlreadyRunningError extends Error {}

export interface BeginSyncRunInput {
  marketplaceAccountId: string;
  marketplace: Marketplace;
  periodFrom: Date;
  periodTo: Date;
  startedAt: Date;
  type?: SyncRunType;
}

export interface PersistOrdersResult {
  ordersCreated: number;
  ordersUpdated: number;
  itemsPersisted: number;
}

/**
 * Único ponto de escrita no Postgres para pedidos/itens normalizados de
 * QUALQUER marketplace e para o ciclo de vida do `sync_runs` correspondente
 * — extraído de `mercado-livre-orders/` (Checkpoint 4-B, "Commit 1") por não
 * ter nenhuma dependência de negócio específica do Mercado Livre; a Amazon
 * (Checkpoint 4-B, "Commit 2") usa exatamente esta mesma classe, nunca uma
 * cópia. Nunca chama a rede — todo o fetch já terminou antes de qualquer
 * método aqui ser invocado (design: "não faça chamadas HTTP mantendo uma
 * transação de banco aberta").
 */
@Injectable()
export class MarketplaceOrdersPersistenceService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Cria a linha `RUNNING` de `sync_runs`. O índice único parcial
   * `UQ_sync_runs_active_run_per_account` (migration da Fase 3) garante,
   * mesmo sob concorrência real entre processos, que só uma sincronização
   * por conta esteja `RUNNING` por vez — uma segunda tentativa simultânea
   * vira violação de unicidade, traduzida aqui em `SyncAlreadyRunningError`.
   * Isso vale por CONTA, não por marketplace — uma mesma conta nunca tem
   * duas sincronizações concorrentes, mas contas de marketplaces diferentes
   * nunca colidem entre si (chave é `marketplace_account_id`).
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
          input.marketplace,
          input.type ?? SyncRunType.MANUAL,
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

  /**
   * Finaliza um `sync_run` como `FAILED` PRESERVANDO os contadores de
   * leitura/criação/atualização/páginas/itens do que foi de fato buscado e
   * persistido (Checkpoint 4-B-R1, "Correção 1") — diferente de
   * `finalizeSyncRunFailure` (usada pelo Mercado Livre e pelas demais falhas
   * da Amazon), que zera esses contadores por não ter nada útil para
   * registrar quando a falha ocorre ANTES de qualquer fetch/persistência
   * bem-sucedida. Usada quando pedidos válidos FORAM persistidos, mas parte
   * do lote foi descartada (quarentena) — o run nunca pode terminar como
   * `SUCCESS` nesse caso, mas os contadores reais continuam úteis para
   * diagnóstico.
   */
  async finalizeSyncRunIncomplete(
    syncRunId: string,
    counts: {
      ordersFetched: number;
      ordersCreated: number;
      ordersUpdated: number;
      recordsFailed: number;
      pagesFetched: number;
      itemsPersisted: number;
    },
    errorCode: string,
    errorSummary: string,
    finishedAt: Date,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE sync_runs
          SET status = $2, finished_at = $3, records_read = $4,
              records_created = $5, records_updated = $6, records_failed = $7,
              pages_fetched = $8, items_persisted = $9, error_code = $10,
              error_summary = $11
        WHERE id = $1`,
      [
        syncRunId,
        SyncRunStatus.FAILED,
        finishedAt,
        counts.ordersFetched,
        counts.ordersCreated,
        counts.ordersUpdated,
        counts.recordsFailed,
        counts.pagesFetched,
        counts.itemsPersisted,
        errorCode,
        errorSummary,
      ],
    );
  }

  /**
   * Cobertura já sincronizada com sucesso para UMA conta — base tanto da
   * janela incremental (`computeIncrementalSyncWindow`) quanto do backfill
   * histórico (`computeBackfillChunkWindow`/`oldestFrom`). `oldestRunRecordsRead`
   * é o `records_read` do run SUCCESS mais antigo (por `date_from`): quando é
   * `0`, o provedor já confirmou que não há pedido mais antigo que aquela
   * janela — sinal de "backfill completo" sem precisar de nenhuma coluna
   * nova (nunca inferido da menor/maior data de PEDIDO, só de runs SUCCESS
   * reais, que é o que prova cobertura de verdade).
   */
  async getAccountSyncCoverage(
    accountId: string,
  ): Promise<AccountSyncCoverage> {
    const rows = await this.dataSource.query<
      Array<{ date_from: Date; date_to: Date; records_read: number }>
    >(
      `SELECT date_from, date_to, records_read
         FROM sync_runs
        WHERE marketplace_account_id = $1 AND status = 'SUCCESS'
          AND date_from IS NOT NULL AND date_to IS NOT NULL
        ORDER BY date_from ASC`,
      [accountId],
    );
    if (rows.length === 0) {
      return { intervals: [], oldestFrom: null, oldestRunRecordsRead: null };
    }
    const intervals = mergeIntervals(
      rows.map((row) => ({ from: row.date_from, to: row.date_to })),
    );
    return {
      intervals,
      oldestFrom: rows[0].date_from,
      oldestRunRecordsRead: rows[0].records_read,
    };
  }

  /**
   * Recupera `sync_runs` presos em `RUNNING` (processo derrubado/reiniciado
   * no meio de uma sincronização) marcando-os `FAILED` — sem isso, o índice
   * único parcial `UQ_sync_runs_active_run_per_account` bloquearia PARA
   * SEMPRE qualquer nova tentativa naquela conta (backfill, incremental ou
   * manual) após uma queda. `staleAfterMs` deve ser bem maior que a duração
   * plausível de qualquer sincronização real, nunca usado como timeout de
   * operação normal.
   */
  async recoverStaleRunningRuns(staleAfterMs: number): Promise<number> {
    const [rows] = (await this.dataSource.query(
      `UPDATE sync_runs
          SET status = 'FAILED', finished_at = now(), error_code = 'STALE_RUN_RECOVERED',
              error_summary = 'Execução interrompida (processo reiniciado ou travado) — recuperada automaticamente.'
        WHERE status = 'RUNNING' AND started_at < now() - ($1 || ' milliseconds')::interval
        RETURNING id`,
      [staleAfterMs],
    )) as [Array<{ id: string }>, number];
    return rows.length;
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
   * período atualiza os registros existentes sem duplicar pedidos nem itens.
   *
   * Proteção contra evento antigo (Checkpoint 4-B): a cláusula `WHERE` do
   * `ON CONFLICT DO UPDATE` só aplica a atualização quando o
   * `marketplace_last_updated` recebido é `>=` ao já armazenado (ou quando
   * um dos dois é `NULL` — sem dado suficiente para provar staleness, o
   * comportamento permanece o histórico: sempre atualiza). Quando a
   * atualização é bloqueada por ser mais antiga, a linha simplesmente não é
   * retornada por este INSERT — o pedido é pulado inteiramente (itens
   * também não são tocados) e não conta nem como criado nem como
   * atualizado.
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
        // acima, confirmado empiricamente contra um Postgres real). Quando a
        // cláusula `WHERE` do `DO UPDATE` bloqueia a atualização (evento
        // antigo), NENHUMA linha é retornada — `orderRows` vem vazio.
        const orderRows = (await queryRunner.query(
          `INSERT INTO marketplace_orders
              (marketplace_account_id, external_order_id, status, currency_id,
               total_amount, pack_id, date_created, date_closed,
               marketplace_last_updated, source_status, fulfillment_channel,
               external_marketplace_id, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
            ON CONFLICT (marketplace_account_id, external_order_id) DO UPDATE
              SET status = EXCLUDED.status,
                  currency_id = EXCLUDED.currency_id,
                  total_amount = EXCLUDED.total_amount,
                  pack_id = EXCLUDED.pack_id,
                  date_created = EXCLUDED.date_created,
                  date_closed = EXCLUDED.date_closed,
                  marketplace_last_updated = EXCLUDED.marketplace_last_updated,
                  source_status = EXCLUDED.source_status,
                  fulfillment_channel = EXCLUDED.fulfillment_channel,
                  external_marketplace_id = EXCLUDED.external_marketplace_id,
                  updated_at = now()
              WHERE marketplace_orders.marketplace_last_updated IS NULL
                 OR EXCLUDED.marketplace_last_updated IS NULL
                 OR EXCLUDED.marketplace_last_updated >= marketplace_orders.marketplace_last_updated
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
            order.sourceStatus ?? null,
            order.fulfillmentChannel ?? null,
            order.externalMarketplaceId ?? null,
          ],
        )) as Array<{ id: string; inserted: boolean }>;

        if (orderRows.length === 0) {
          // Evento antigo: bloqueado pela cláusula WHERE acima. Pulado por
          // completo — itens do pedido existente permanecem intocados.
          continue;
        }

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
