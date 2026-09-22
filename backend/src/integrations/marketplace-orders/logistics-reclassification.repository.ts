import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Marketplace } from '../contracts/marketplace.enum';
import {
  LOGISTICS_UNKNOWN,
  type LogisticsClassification,
} from './logistics-classification';

export interface PendingLogisticsCounts {
  marketplaceAccountId: string;
  nickname: string | null;
  /** Pedidos `UNKNOWN` COM `external_shipment_id` — a fila realmente processável hoje. */
  pendingWithShipmentId: number;
  /**
   * Pedidos `UNKNOWN` SEM `external_shipment_id` (sincronizados antes da
   * migration 1789000000000, ou sem envio). NÃO são processáveis por este
   * serviço: falta o identificador suficiente para consultar o envio.
   * Contados à parte, nunca escondidos e nunca inferidos.
   */
  pendingWithoutShipmentId: number;
  /** Pedidos já classificados (`MARKETPLACE_FULFILLED` ou `SELLER_FULFILLED`). */
  resolved: number;
}

export interface PendingLogisticsOrder {
  id: string;
  externalShipmentId: string;
}

export interface OrderPendingShipmentRecovery {
  id: string;
  externalOrderId: string;
}

/**
 * Acesso a dados da fila de reclassificação logística (correção da auditoria
 * Full). Separado de `MarketplaceOrdersPersistenceService` de propósito: são
 * consultas de um fluxo operacional distinto, acionado só pela CLI dedicada,
 * e o serviço de persistência já concentra todo o ciclo de vida de
 * sincronização.
 *
 * NENHUM método aqui mantém transação aberta — a reclassificação intercala
 * chamadas HTTP entre as leituras e as escritas, e o design do projeto
 * proíbe segurar uma transação durante HTTP.
 */
@Injectable()
export class LogisticsReclassificationRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Contagens por conta de UM marketplace. Somente leitura — é a base do
   * modo `--plan` da CLI, que nunca chama nenhuma API externa.
   */
  async countPendingByAccount(
    marketplace: Marketplace,
    accountId: string | null = null,
  ): Promise<PendingLogisticsCounts[]> {
    const rows = await this.dataSource.query<
      Array<{
        marketplace_account_id: string;
        nickname: string | null;
        pending_with_shipment_id: string;
        pending_without_shipment_id: string;
        resolved: string;
      }>
    >(
      `SELECT o.marketplace_account_id,
              a.nickname,
              COUNT(*) FILTER (
                WHERE o.logistics_classification = $3
                  AND o.external_shipment_id IS NOT NULL
              ) AS pending_with_shipment_id,
              COUNT(*) FILTER (
                WHERE o.logistics_classification = $3
                  AND o.external_shipment_id IS NULL
              ) AS pending_without_shipment_id,
              COUNT(*) FILTER (
                WHERE o.logistics_classification <> $3
              ) AS resolved
         FROM marketplace_orders o
         JOIN marketplace_accounts a ON a.id = o.marketplace_account_id
        WHERE a.marketplace = $1
          AND ($2::uuid IS NULL OR o.marketplace_account_id = $2::uuid)
        GROUP BY o.marketplace_account_id, a.nickname
        ORDER BY a.nickname NULLS LAST`,
      [marketplace, accountId, LOGISTICS_UNKNOWN],
    );

    return rows.map((row) => ({
      marketplaceAccountId: row.marketplace_account_id,
      nickname: row.nickname,
      pendingWithShipmentId: Number(row.pending_with_shipment_id),
      pendingWithoutShipmentId: Number(row.pending_without_shipment_id),
      resolved: Number(row.resolved),
    }));
  }

  /**
   * Lote pequeno de pedidos pendentes de UMA conta, ordenado por `id` e
   * paginado por cursor (`afterId`) — nunca por OFFSET. O cursor torna a
   * execução RETOMÁVEL e impede laço infinito: um pedido que permanece
   * `UNKNOWN` (envio inexistente, `logistic_type` não reconhecido) não é
   * relido na mesma execução, porque o cursor já passou dele.
   */
  async fetchPendingBatch(input: {
    marketplaceAccountId: string;
    limit: number;
    afterId: string | null;
  }): Promise<PendingLogisticsOrder[]> {
    const rows = await this.dataSource.query<
      Array<{ id: string; external_shipment_id: string }>
    >(
      `SELECT id, external_shipment_id
         FROM marketplace_orders
        WHERE marketplace_account_id = $1
          AND logistics_classification = $4
          AND external_shipment_id IS NOT NULL
          AND ($2::uuid IS NULL OR id > $2::uuid)
        ORDER BY id ASC
        LIMIT $3`,
      [
        input.marketplaceAccountId,
        input.afterId,
        input.limit,
        LOGISTICS_UNKNOWN,
      ],
    );

    return rows.map((row) => ({
      id: row.id,
      externalShipmentId: row.external_shipment_id,
    }));
  }

  /**
   * Lote pequeno de pedidos `UNKNOWN` SEM `external_shipment_id` — a fila do
   * fallback de recuperação (revisão crítica da auditoria Full, só usado em
   * `--apply`). Mesmo padrão de cursor por `id`/`ORDER BY id ASC` do lote
   * principal: retomável, sem OFFSET, sem relatura do que já passou.
   */
  async fetchPendingWithoutShipmentIdBatch(input: {
    marketplaceAccountId: string;
    limit: number;
    afterId: string | null;
  }): Promise<OrderPendingShipmentRecovery[]> {
    const rows = await this.dataSource.query<
      Array<{ id: string; external_order_id: string }>
    >(
      `SELECT id, external_order_id
         FROM marketplace_orders
        WHERE marketplace_account_id = $1
          AND logistics_classification = $4
          AND external_shipment_id IS NULL
          AND ($2::uuid IS NULL OR id > $2::uuid)
        ORDER BY id ASC
        LIMIT $3`,
      [
        input.marketplaceAccountId,
        input.afterId,
        input.limit,
        LOGISTICS_UNKNOWN,
      ],
    );

    return rows.map((row) => ({
      id: row.id,
      externalOrderId: row.external_order_id,
    }));
  }

  /**
   * Grava o `external_shipment_id` RECUPERADO via `GET /orders/{id}`
   * (fallback, revisão crítica). Escrita CONDICIONAL dupla: só se a linha
   * CONTINUA `UNKNOWN` e AINDA não tem shipment id — nunca sobrescreve um
   * valor já persistido (por uma sincronização normal concorrente, por
   * exemplo) e nunca mexe numa linha já resolvida. Não altera
   * `logistics_classification` — só o identificador; a classificação em si
   * só muda depois, pela consulta a `GET /shipments/{id}`.
   */
  async attachRecoveredShipmentId(input: {
    orderId: string;
    externalShipmentId: string;
  }): Promise<boolean> {
    const [rows] = await this.dataSource.query<[Array<{ id: string }>, number]>(
      `UPDATE marketplace_orders
          SET external_shipment_id = $2,
              updated_at = now()
        WHERE id = $1
          AND logistics_classification = $3
          AND external_shipment_id IS NULL
        RETURNING id`,
      [input.orderId, input.externalShipmentId, LOGISTICS_UNKNOWN],
    );

    return rows.length > 0;
  }

  /**
   * Escrita CONDICIONAL: `WHERE logistics_classification = 'UNKNOWN'`. Se
   * outro processo (uma sincronização normal, outra execução) já resolveu a
   * linha, nada é escrito e o método devolve `false` — uma classificação já
   * resolvida NUNCA é sobrescrita, nem por um valor igual.
   *
   * Recusa gravar `UNKNOWN` (a única coisa que isso faria seria mexer em
   * `updated_at` sem informação nova) e recusa um valor fora do vocabulário
   * canônico.
   */
  async applyResolvedClassification(input: {
    orderId: string;
    classification: LogisticsClassification;
    logisticsType: string | null;
  }): Promise<boolean> {
    if (input.classification === LOGISTICS_UNKNOWN) return false;

    const [rows] = await this.dataSource.query<[Array<{ id: string }>, number]>(
      `UPDATE marketplace_orders
          SET logistics_classification = $2,
              logistics_type = $3,
              updated_at = now()
        WHERE id = $1
          AND logistics_classification = $4
        RETURNING id`,
      [
        input.orderId,
        input.classification,
        input.logisticsType,
        LOGISTICS_UNKNOWN,
      ],
    );

    return rows.length > 0;
  }
}
