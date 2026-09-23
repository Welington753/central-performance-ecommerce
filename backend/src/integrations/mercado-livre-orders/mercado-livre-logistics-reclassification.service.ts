import { Injectable } from '@nestjs/common';
import { Marketplace } from '../contracts/marketplace.enum';
import { MarketplaceAccountStatus } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { MercadoLivreOAuthService } from '../mercado-livre-oauth/mercado-livre-oauth.service';
import { AdvisoryLockService } from '../shared/advisory-lock.service';
import { LogisticsReclassificationRepository } from '../marketplace-orders/logistics-reclassification.repository';
import { MercadoLivreShipmentLookupService } from './mercado-livre-shipment-lookup.service';
import { MercadoLivreOrderDetailLookupService } from './mercado-livre-order-detail-lookup.service';
import { applyShipmentLookupOutcome } from './mercado-livre-shipment-outcome.util';
import { drainRecoveryQueue } from './mercado-livre-logistics-recovery-queue.util';
import {
  emptyAccountReport,
  type ReclassificationAccountReport,
  type ReclassificationApplyOptions,
  type ReclassificationPlanReport,
} from './logistics-reclassification-report';

export type {
  ReclassificationAccountOutcome,
  ReclassificationAccountReport,
  ReclassificationApplyOptions,
  ReclassificationPlanAccountReport,
  ReclassificationPlanReport,
} from './logistics-reclassification-report';

export const DEFAULT_RECLASSIFICATION_BATCH_SIZE = 50;
export const DEFAULT_RECLASSIFICATION_MAX_REQUESTS = 500;
const MAX_BATCH_SIZE = 500;
const MAX_REQUESTS_HARD_CAP = 20000;

/**
 * Reclassificação dedicada dos pedidos do Mercado Livre que ficaram
 * `UNKNOWN` (correção da auditoria Full). NUNCA refaz o backfill de pedidos:
 * lê apenas linhas já persistidas, consulta somente `GET /shipments/{id}`
 * (e, no fallback abaixo, `GET /orders/{id}` só para recuperar o
 * identificador do envio) e escreve somente `logistics_classification`/
 * `logistics_type`/`external_shipment_id`.
 *
 * Duas filas, sempre nesta ordem, mesmo orçamento de requisições
 * (`maxRequestsPerAccount`) para as duas:
 * 1. pedidos `UNKNOWN` que JÁ têm `external_shipment_id` — consulta direta;
 * 2. pedidos `UNKNOWN` SEM `external_shipment_id` (revisão crítica: qualquer
 *    pedido sincronizado antes da migration 1789000000000) — fallback
 *    read-only via `GET /orders/{id}` para recuperar o identificador, grava
 *    condicionalmente, e só então consulta o envio. Pedido sem envio
 *    associado (`shipping.id` nulo no detalhe) permanece `UNKNOWN` sem
 *    nenhuma segunda chamada — nunca inventado.
 *
 * Garantias de segurança e integridade (as duas filas):
 * - só processa contas Mercado Livre CONECTADAS;
 * - escrita SEMPRE CONDICIONAL (`WHERE logistics_classification = 'UNKNOWN'`
 *   para a classificação, `WHERE ... AND external_shipment_id IS NULL` para
 *   o identificador recuperado): nunca sobrescreve valor já persistido;
 * - idempotente e retomável: cursor por `id`, qualquer parada preserva o
 *   progresso já gravado;
 * - advisory lock por conta (mesmo padrão de OAuth/sync) impede dois
 *   reclassificadores simultâneos na mesma conta;
 * - nenhuma transação de banco fica aberta durante chamada HTTP;
 * - 401/403 (em QUALQUER das duas chamadas) INTERROMPE a conta
 *   imediatamente, em vez de degradar registros;
 * - falha nunca vira `SELLER_FULFILLED` — permanece `UNKNOWN`.
 *
 * O token é obtido exclusivamente por `ensureValidAccessToken`, que já
 * serializa a renovação por conta via advisory lock — é o que impede disputar
 * o refresh token com outro ambiente.
 */
@Injectable()
export class MercadoLivreLogisticsReclassificationService {
  constructor(
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
    private readonly oauthService: MercadoLivreOAuthService,
    private readonly shipmentLookup: MercadoLivreShipmentLookupService,
    private readonly orderDetailLookup: MercadoLivreOrderDetailLookupService,
    private readonly repository: LogisticsReclassificationRepository,
    private readonly advisoryLock: AdvisoryLockService,
  ) {}

  /**
   * Modo `--plan`: SOMENTE leitura do banco. Nunca obtém token, nunca chama
   * o Mercado Livre. O `marketplaceAccountId` é deliberadamente descartado
   * da saída — o relatório operacional nunca precisa dele.
   */
  async plan(
    accountId: string | null = null,
    batchSize: number = DEFAULT_RECLASSIFICATION_BATCH_SIZE,
  ): Promise<ReclassificationPlanReport> {
    const effectiveBatchSize = clamp(batchSize, 1, MAX_BATCH_SIZE);
    const counts = await this.repository.countPendingByAccount(
      Marketplace.MERCADO_LIVRE,
      accountId,
    );
    return {
      batchSize: effectiveBatchSize,
      accounts: counts.map((row) => {
        const totalUnknown =
          row.pendingWithShipmentId + row.pendingWithoutShipmentId;
        return {
          nickname: row.nickname,
          pendingWithShipmentId: row.pendingWithShipmentId,
          pendingWithoutShipmentId: row.pendingWithoutShipmentId,
          resolved: row.resolved,
          totalUnknown,
          // Pessimista: 1 chamada (envio) por pedido já com shipment id, até
          // 2 (detalhe do pedido + envio) por pedido dependente de
          // recuperação — nunca uma contagem exata, só o TETO plausível.
          estimatedMaxRequests:
            row.pendingWithShipmentId + row.pendingWithoutShipmentId * 2,
          estimatedBatches: Math.ceil(totalUnknown / effectiveBatchSize),
        };
      }),
    };
  }

  async apply(
    options: ReclassificationApplyOptions = {},
  ): Promise<ReclassificationAccountReport[]> {
    const accountIdFilter = options.accountId ?? null;
    const batchSize = clamp(
      options.batchSize ?? DEFAULT_RECLASSIFICATION_BATCH_SIZE,
      1,
      MAX_BATCH_SIZE,
    );
    const maxRequests = clamp(
      options.maxRequestsPerAccount ?? DEFAULT_RECLASSIFICATION_MAX_REQUESTS,
      1,
      MAX_REQUESTS_HARD_CAP,
    );

    const accounts = (await this.marketplaceAccountsService.findAll()).filter(
      (account) =>
        account.marketplace === Marketplace.MERCADO_LIVRE &&
        (accountIdFilter === null || account.id === accountIdFilter),
    );

    const reports: ReclassificationAccountReport[] = [];
    for (const account of accounts) {
      reports.push(
        await this.applyForAccount(
          {
            id: account.id,
            nickname: account.nickname,
            status: account.status,
          },
          batchSize,
          maxRequests,
          options.queue1AfterId ?? null,
          options.queue2AfterId ?? null,
        ),
      );
    }
    return reports;
  }

  private async applyForAccount(
    account: {
      id: string;
      nickname: string | null;
      status: MarketplaceAccountStatus;
    },
    batchSize: number,
    maxRequests: number,
    queue1AfterId: string | null,
    queue2AfterId: string | null,
  ): Promise<ReclassificationAccountReport> {
    const report = emptyAccountReport(account.nickname, {
      queue1AfterId,
      queue2AfterId,
    });

    if (account.status !== MarketplaceAccountStatus.CONNECTED) {
      report.outcome = 'SKIPPED_NOT_CONNECTED';
      return report;
    }

    // Lock ANTES de qualquer token ou chamada externa: duas execuções
    // simultâneas na mesma conta nunca chegam a competir por requisições.
    const lock = await this.advisoryLock.tryAcquire(account.id);
    if (!lock) {
      report.outcome = 'SKIPPED_ACCOUNT_BUSY';
      return report;
    }

    try {
      let accessToken: string;
      try {
        accessToken = await this.oauthService.ensureValidAccessToken(
          account.id,
        );
      } catch {
        // Cobre todo o vocabulário fechado de `ensureValidAccessToken`
        // (ACCOUNT_BUSY, REFRESH_TOKEN_REJECTED, REFRESH_TEMPORARY_FAILURE,
        // ML_APP_CONFIGURATION_ERROR...). A causa exata NUNCA é propagada
        // para a saída operacional: só o código fechado abaixo. A conta é
        // abandonada sem nenhuma escrita — reexecutar depois retoma do
        // mesmo ponto.
        report.outcome = 'ABORTED_TOKEN_UNAVAILABLE';
        return report;
      }

      await this.drainShipmentIdQueue(account.id, accessToken, {
        report,
        batchSize,
        maxRequests,
        startCursor: queue1AfterId,
      });
      // Só tenta o fallback de recuperação se a fila direta terminou de
      // forma NÃO terminal (nunca depois de um abort/parada — o mesmo
      // problema que interrompeu a fila 1 interromperia a fila 2).
      if (
        report.outcome === 'COMPLETED' ||
        report.outcome === 'SKIPPED_NOTHING_PENDING'
      ) {
        await drainRecoveryQueue(
          account.id,
          accessToken,
          {
            repository: this.repository,
            orderDetailLookup: this.orderDetailLookup,
            shipmentLookup: this.shipmentLookup,
            budgetExhausted: (r) => this.budgetExhausted(r, maxRequests),
          },
          { report, batchSize, startCursor: queue2AfterId },
        );
      }
      return report;
    } finally {
      await lock.release();
    }
  }

  private budgetExhausted(
    report: ReclassificationAccountReport,
    maxRequests: number,
  ): boolean {
    return report.shipmentRequests + report.orderDetailRequests >= maxRequests;
  }

  /**
   * `startCursor` (correção "sem starvation", worker do backend): em vez de
   * sempre `null`, o CHAMADOR pode informar de onde retomar — o cursor
   * durável persistido entre ticks. Sem isto, um tick com orçamento pequeno
   * SEMPRE reexaminaria os mesmos primeiros pedidos (ordenados por `id`) a
   * cada chamada; se os primeiros forem permanentemente inválidos
   * (`not_found`/resposta inválida), pedidos válidos mais adiante na fila
   * NUNCA seriam alcançados. A CLI (`--apply` de uma vez, orçamento alto)
   * nunca precisou disto e continua passando `null` (comportamento
   * idêntico ao de antes desta correção).
   */
  private async drainShipmentIdQueue(
    marketplaceAccountId: string,
    accessToken: string,
    context: {
      report: ReclassificationAccountReport;
      batchSize: number;
      maxRequests: number;
      startCursor: string | null;
    },
  ): Promise<void> {
    const { report, batchSize, maxRequests, startCursor } = context;
    let cursor: string | null = startCursor;
    const transientFailureState = { consecutive: 0 };

    for (;;) {
      const batch = await this.repository.fetchPendingBatch({
        marketplaceAccountId,
        limit: batchSize,
        afterId: cursor,
      });
      if (batch.length === 0) {
        report.outcome =
          report.ordersExamined === 0 ? 'SKIPPED_NOTHING_PENDING' : 'COMPLETED';
        report.queue1EndCursor = cursor;
        report.queue1Exhausted = true;
        return;
      }

      for (const order of batch) {
        if (this.budgetExhausted(report, maxRequests)) {
          report.outcome = 'STOPPED_MAX_REQUESTS';
          report.queue1EndCursor = cursor;
          report.queue1Exhausted = false;
          return;
        }

        // O cursor avança SEMPRE, inclusive quando o pedido continua
        // `UNKNOWN` — é o que impede laço infinito sobre a mesma linha
        // NESTA chamada. Persistido pelo chamador (`queue1EndCursor`),
        // impede o MESMO laço entre chamadas/ticks também.
        cursor = order.id;
        report.ordersExamined += 1;
        report.shipmentRequests += 1;

        const { outcome } = await this.shipmentLookup.lookup(
          accessToken,
          order.externalShipmentId,
        );
        const result = await applyShipmentLookupOutcome({
          outcome,
          orderId: order.id,
          report,
          repository: this.repository,
          transientFailureState,
        });
        if (result !== 'CONTINUE') {
          report.queue1EndCursor = cursor;
          report.queue1Exhausted = false;
          return;
        }
      }
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.floor(value), min), max);
}
