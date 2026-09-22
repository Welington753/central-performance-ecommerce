import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Marketplace } from '../contracts/marketplace.enum';
import { SyncRunStatus, SyncRunType } from '../../sync/sync-run.entity';
import { mergeIntervals, type SyncedInterval } from './coverage-interval.util';
import {
  sanitizeLogisticsDiagnostics,
  type LogisticsClassificationDiagnostics,
} from './logistics-classification-diagnostics';
import type { MappedOrderRecord } from './mapped-order-record';

export interface AccountSyncCoverage {
  intervals: SyncedInterval[];
  oldestFrom: Date | null;
  oldestRunRecordsRead: number | null;
}

export class SyncAlreadyRunningError extends Error {}

/**
 * `coveredThrough` fora de `[date_from, date_to]` do próprio run (Checkpoint
 * CP2K-5C-1) — nunca inclui os valores reais no `message` (nem a fronteira
 * recebida, nem `date_from`/`date_to` armazenados): só o código fechado,
 * mesmo padrão de `ShopeeOrdersSyncError`/erros de vocabulário fechado do
 * projeto. O CHECK `CK_sync_runs_covered_through_within_period` (migration)
 * é a última linha de defesa contra QUALQUER escritor futuro; esta exceção
 * é a validação em nível de aplicação que detecta o mesmo problema antes de
 * qualquer escrita, com uma mensagem própria do domínio.
 */
export class InvalidCoveredThroughError extends Error {
  constructor() {
    super('INVALID_COVERED_THROUGH');
  }
}

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

  /**
   * `logisticsDiagnostics` (correção da auditoria Full) é OPCIONAL e
   * aditivo: os chamadores que não classificam logística (Amazon, Shopee)
   * continuam chamando exatamente como antes e a coluna fica `NULL`.
   * O objeto é sanitizado aqui, no último ponto antes da escrita — só
   * inteiros, vocabulário de chaves fechado, nunca identificador nem texto
   * do provedor (ver `logistics-classification-diagnostics.ts`).
   */
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
    logisticsDiagnostics?: LogisticsClassificationDiagnostics,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE sync_runs
          SET status = $2, finished_at = $3, records_read = $4,
              records_created = $5, records_updated = $6, records_failed = 0,
              pages_fetched = $7, items_persisted = $8,
              logistics_diagnostics = $9
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
        logisticsDiagnostics
          ? JSON.stringify(sanitizeLogisticsDiagnostics(logisticsDiagnostics))
          : null,
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
   * Finaliza um `sync_run` como `PARTIAL` (Checkpoint CP2K-5C-1) — usado
   * exclusivamente quando um safety cap interrompe uma sincronização,
   * NUNCA para falha real de provider/parsing/mapping/persistência (isso
   * continua `finalizeSyncRunFailure`). Ao contrário de
   * `finalizeSyncRunIncomplete` (que grava `FAILED`, sem nenhum conceito de
   * prefixo provado), esta grava `coveredThrough` — `null` quando o cap
   * ocorreu antes de concluir qualquer bloco (nenhum prefixo provado, igual
   * a `FAILED` para efeito de cobertura), ou o fim do último bloco
   * inteiramente enumerado.
   *
   * Uma única leitura (nunca escrita) valida `coveredThrough` contra o
   * `date_from`/`date_to` JÁ ARMAZENADOS deste run antes de qualquer
   * escrita — nunca confia em uma cópia separada em memória que o chamador
   * possa ter deixado dessincronizar. Quando válido (ou `null`), a
   * finalização inteira é UM ÚNICO `UPDATE` atômico — nunca duas escritas
   * separadas, nunca um estado intermediário com `status` novo e contadores
   * antigos (ou vice-versa). Lança {@link InvalidCoveredThroughError} sem
   * escrever nada quando a validação falha — mesmo comportamento do CHECK
   * `CK_sync_runs_covered_through_within_period` da migration, verificado
   * aqui antes para dar ao chamador um erro de domínio claro em vez de uma
   * violação de constraint Postgres crua.
   */
  async finalizeSyncRunPartial(
    syncRunId: string,
    counts: {
      ordersFetched: number;
      ordersCreated: number;
      ordersUpdated: number;
      recordsFailed: number;
      pagesFetched: number;
      itemsPersisted: number;
    },
    coveredThrough: Date | null,
    errorCode: string,
    errorSummary: string,
    finishedAt: Date,
  ): Promise<void> {
    if (coveredThrough !== null) {
      const [row] = await this.dataSource.query<
        Array<{ date_from: Date | null; date_to: Date | null }>
      >(`SELECT date_from, date_to FROM sync_runs WHERE id = $1`, [syncRunId]);
      const withinPeriod =
        row !== undefined &&
        row.date_from !== null &&
        row.date_to !== null &&
        coveredThrough.getTime() >= row.date_from.getTime() &&
        coveredThrough.getTime() <= row.date_to.getTime();
      if (!withinPeriod) {
        throw new InvalidCoveredThroughError();
      }
    }

    await this.dataSource.query(
      `UPDATE sync_runs
          SET status = $2, finished_at = $3, covered_through = $4,
              records_read = $5, records_created = $6, records_updated = $7,
              records_failed = $8, pages_fetched = $9, items_persisted = $10,
              error_code = $11, error_summary = $12
        WHERE id = $1`,
      [
        syncRunId,
        SyncRunStatus.PARTIAL,
        finishedAt,
        coveredThrough,
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
   * Cobertura já PROVADA para UMA conta — base tanto da janela incremental
   * (`computeIncrementalSyncWindow`) quanto do backfill histórico
   * (`computeBackfillChunkWindow`/`oldestFrom`). Duas fontes contribuem
   * intervalo (Checkpoint CP2K-5C-1): `SUCCESS` inteiro (`date_from` até
   * `date_to`, como sempre) e `PARTIAL` com `covered_through` PREENCHIDO
   * (`date_from` até `covered_through` — nunca até `date_to`, que ali é só a
   * janela REQUISITADA, não a provada). `PARTIAL` com `covered_through`
   * nulo (cap antes de concluir qualquer bloco) e `FAILED`/`RUNNING` nunca
   * contribuem — idêntico ao comportamento anterior a este checkpoint.
   *
   * `oldestRunRecordsRead` continua EXCLUSIVAMENTE calculado a partir de
   * runs `SUCCESS` (nunca `PARTIAL`, mesmo que ele tenha `date_from` mais
   * antigo) — é o `records_read` do run SUCCESS mais antigo (por
   * `date_from`): quando é `0`, o provedor já confirmou que não há pedido
   * mais antigo que aquela janela — sinal de "backfill completo" que só um
   * SUCCESS real pode emitir (um `PARTIAL` nunca prova exaustão, só um
   * prefixo).
   */
  async getAccountSyncCoverage(
    accountId: string,
  ): Promise<AccountSyncCoverage> {
    const rows = await this.dataSource.query<
      Array<{
        date_from: Date;
        effective_to: Date;
        status: string;
        records_read: number;
      }>
    >(
      `SELECT date_from,
              CASE WHEN status = 'SUCCESS' THEN date_to ELSE covered_through END
                AS effective_to,
              status,
              records_read
         FROM sync_runs
        WHERE marketplace_account_id = $1
          AND date_from IS NOT NULL
          AND (
            (status = 'SUCCESS' AND date_to IS NOT NULL)
            OR (status = 'PARTIAL' AND covered_through IS NOT NULL)
          )
        ORDER BY date_from ASC`,
      [accountId],
    );
    if (rows.length === 0) {
      return { intervals: [], oldestFrom: null, oldestRunRecordsRead: null };
    }
    const intervals = mergeIntervals(
      rows.map((row) => ({ from: row.date_from, to: row.effective_to })),
    );
    const oldestSuccessRow = rows.find((row) => row.status === 'SUCCESS');
    return {
      intervals,
      oldestFrom: rows[0].date_from,
      oldestRunRecordsRead: oldestSuccessRow
        ? oldestSuccessRow.records_read
        : null,
    };
  }

  /**
   * Primeira e última venda REALMENTE persistida para uma conta (Fase 4,
   * "Completar histórico") — só para exibição (ex.: painel de
   * sincronizações); nunca usado como prova de cobertura contínua (isso
   * continua sendo `getAccountSyncCoverage`/`mergeIntervals`).
   */
  async getAccountOrderDateRange(
    accountId: string,
  ): Promise<{ first: Date; last: Date } | null> {
    const [row] = await this.dataSource.query<
      Array<{ min_date: Date | null; max_date: Date | null }>
    >(
      `SELECT MIN(date_created) AS min_date, MAX(date_created) AS max_date
         FROM marketplace_orders
        WHERE marketplace_account_id = $1`,
      [accountId],
    );
    if (!row?.min_date || !row.max_date) return null;
    return { first: row.min_date, last: row.max_date };
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
    const [rows] = await this.dataSource.query<[Array<{ id: string }>, number]>(
      `UPDATE sync_runs
          SET status = 'FAILED', finished_at = now(), error_code = 'STALE_RUN_RECOVERED',
              error_summary = 'Execução interrompida (processo reiniciado ou travado) — recuperada automaticamente.'
        WHERE status = 'RUNNING' AND started_at < now() - ($1 || ' milliseconds')::interval
        RETURNING id`,
      [staleAfterMs],
    );
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
   *
   * Proteção adicional para `logistics_classification` (Fase 4, "Full"): uma
   * atualização aceita pela regra acima nunca pode REGREDIR uma
   * classificação já resolvida de volta para `UNKNOWN` — isso aconteceria,
   * por exemplo, se o limite defensivo de consultas ao envio for atingido
   * numa sincronização repetida do mesmo pedido. Quando o valor recebido é
   * `UNKNOWN` e o já armazenado não é, o valor armazenado (classificação e
   * tipo bruto) é preservado; em qualquer outro caso, o valor recebido
   * prevalece normalmente.
   *
   * Proteção adicional para os 5 campos financeiros do pedido (CP2K-7E,
   * auditoria pós-CP2K-7D): `COALESCE(EXCLUDED.campo, marketplace_orders.campo)`
   * — nunca `SET campo = EXCLUDED.campo` puro. O fluxo real de
   * sincronização (manual, auto-sync e backfill — todos via
   * `MercadoLivreOrdersSyncService.syncOrders`) só chama `/orders/search`,
   * nunca `/orders/{id}`; e o parser não distingue "a fonte confirmou que
   * este campo não existe" de "esta resposta específica não o trouxe" — as
   * duas colapsam no mesmo `null` (ver `mercado-livre-order-response.ts`).
   * Sem o COALESCE, uma ressincronização cujo payload não tivesse nenhum
   * payment `approved` com o campo apagaria silenciosamente um valor
   * financeiro já conhecido. Um valor NOVO NÃO NULO (incluindo `"0.00"`,
   * nunca confundido com ausência) sempre substitui o antigo normalmente —
   * só um `null` recebido nunca sobrescreve um valor já persistido.
   *
   * `external_shipment_id` (correção da auditoria Full) usa exatamente o
   * mesmo `COALESCE`: um payload sem `shipping.id` nunca apaga um
   * identificador de envio já conhecido — apagá-lo removeria o pedido da
   * fila de reclassificação sem que nada tivesse sido resolvido.
   *
   * `fulfillment_channel` passou a usar o mesmo `COALESCE` pelo mesmo
   * motivo (defeito encontrado pelo teste de persistência da Shopee
   * acrescentado nesta rodada): uma ressincronização cujo detalhe não
   * trouxesse o campo apagava silenciosamente o `fulfillment_flag` da
   * Shopee — ou o canal FBA/FBM da Amazon — já persistido. Um valor NOVO
   * não nulo continua substituindo o antigo normalmente.
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
               external_marketplace_id, logistics_classification, logistics_type,
               external_shipment_id,
               marketplace_fee_amount, buyer_shipping_cost_amount, taxes_amount,
               coupon_amount, refunded_amount,
               updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                     $15, $16, $17, $18, $19, $20, now())
            ON CONFLICT (marketplace_account_id, external_order_id) DO UPDATE
              SET status = EXCLUDED.status,
                  currency_id = EXCLUDED.currency_id,
                  total_amount = EXCLUDED.total_amount,
                  pack_id = EXCLUDED.pack_id,
                  date_created = EXCLUDED.date_created,
                  date_closed = EXCLUDED.date_closed,
                  marketplace_last_updated = EXCLUDED.marketplace_last_updated,
                  source_status = EXCLUDED.source_status,
                  fulfillment_channel = COALESCE(EXCLUDED.fulfillment_channel, marketplace_orders.fulfillment_channel),
                  external_marketplace_id = EXCLUDED.external_marketplace_id,
                  logistics_classification = CASE
                    WHEN EXCLUDED.logistics_classification = 'UNKNOWN'
                     AND marketplace_orders.logistics_classification <> 'UNKNOWN'
                    THEN marketplace_orders.logistics_classification
                    ELSE EXCLUDED.logistics_classification
                  END,
                  logistics_type = CASE
                    WHEN EXCLUDED.logistics_classification = 'UNKNOWN'
                     AND marketplace_orders.logistics_classification <> 'UNKNOWN'
                    THEN marketplace_orders.logistics_type
                    ELSE EXCLUDED.logistics_type
                  END,
                  external_shipment_id = COALESCE(EXCLUDED.external_shipment_id, marketplace_orders.external_shipment_id),
                  marketplace_fee_amount = COALESCE(EXCLUDED.marketplace_fee_amount, marketplace_orders.marketplace_fee_amount),
                  buyer_shipping_cost_amount = COALESCE(EXCLUDED.buyer_shipping_cost_amount, marketplace_orders.buyer_shipping_cost_amount),
                  taxes_amount = COALESCE(EXCLUDED.taxes_amount, marketplace_orders.taxes_amount),
                  coupon_amount = COALESCE(EXCLUDED.coupon_amount, marketplace_orders.coupon_amount),
                  refunded_amount = COALESCE(EXCLUDED.refunded_amount, marketplace_orders.refunded_amount),
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
            order.logisticsClassification ?? 'UNKNOWN',
            order.logisticsType ?? null,
            order.externalShipmentId ?? null,
            order.marketplaceFeeAmount ?? null,
            order.buyerShippingCostAmount ?? null,
            order.taxesAmount ?? null,
            order.couponAmount ?? null,
            order.refundedAmount ?? null,
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
                 quantity, unit_price, currency_id, sale_fee_amount)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              orderId,
              item.externalItemId,
              item.variationId,
              item.sellerSku,
              item.title,
              item.quantity,
              item.unitPrice,
              item.currencyId,
              item.saleFeeAmount ?? null,
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
