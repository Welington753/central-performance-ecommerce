import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Marketplace } from '../contracts/marketplace.enum';
import { MarketplaceAccountStatus } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { LogisticsReclassificationRepository } from '../marketplace-orders/logistics-reclassification.repository';
import {
  MlLogisticsReclassificationJobsPersistenceService,
  type MlLogisticsReclassificationJobRow,
  type MlLogisticsReclassificationJobStatus,
} from './ml-logistics-reclassification-jobs-persistence.service';
import { isMlLogisticsReclassificationWorkerEnabled } from './ml-logistics-reclassification-worker-config.util';

export type MlLogisticsReclassificationErrorCode =
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_NOT_MERCADO_LIVRE'
  /**
   * Revisão crítica pós-implementação (item 6): `start`/`resume` nunca
   * criam/reabrem um job que o worker não vai processar — sem isto, o botão
   * "Iniciar" pareceria funcionar (a linha existe no banco) mas ficaria
   * `RUNNING` para sempre, nunca reivindicado por nenhum tick.
   */
  | 'WORKER_DISABLED';

export class MlLogisticsReclassificationError extends Error {
  constructor(public readonly code: MlLogisticsReclassificationErrorCode) {
    super(code);
  }
}

/**
 * Estado exposto de UMA conta (correção da auditoria Full, Render free sem
 * Shell). Nunca inclui token, `external_shipment_id`, `external_order_id` ou
 * resposta bruta do provedor — só contadores e timestamps já sanitizados.
 * `remainingUnknownCount` é SEMPRE a contagem REAL, lida ao vivo de
 * `marketplace_orders` (nunca o valor potencialmente desatualizado gravado
 * pelo último tick do worker) — a mesma consulta barata já usada pelo
 * `--plan` da CLI.
 */
export interface MlLogisticsReclassificationAccountStatus {
  accountId: string;
  nickname: string | null;
  status: MlLogisticsReclassificationJobStatus;
  initialUnknownCount: number;
  remainingUnknownCount: number;
  resolvedFullCount: number;
  resolvedNotFullCount: number;
  callsMadeCount: number;
  lastActivityAt: string | null;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  pauseRequested: boolean;
  /** Mesma interpretação efetiva que o worker usa para decidir se cria o timer — nunca afirmar "processando" quando `false`. */
  workerEnabled: boolean;
}

/**
 * Orquestração (status/start/pause/resume) da reclassificação histórica Full
 * — camada FINA sobre `MlLogisticsReclassificationJobsPersistenceService`,
 * nunca chama rede nem duplica a classificação (isso é
 * `MercadoLivreLogisticsReclassificationService`, acionado só pelo worker).
 * MESMO padrão de `MarketplaceBackfillService`.
 */
@Injectable()
export class MlLogisticsReclassificationService {
  constructor(
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
    private readonly jobsPersistence: MlLogisticsReclassificationJobsPersistenceService,
    private readonly repository: LogisticsReclassificationRepository,
    private readonly configService: ConfigService,
  ) {}

  async getStatus(
    accountId: string,
  ): Promise<MlLogisticsReclassificationAccountStatus> {
    const account = await this.assertMercadoLivreAccount(accountId);
    const job = await this.jobsPersistence.findByAccountId(accountId);
    const remaining = await this.currentRemainingUnknown(accountId);
    return this.toStatus(account.id, account.nickname, remaining, job);
  }

  async getStatusForAllAccounts(): Promise<
    MlLogisticsReclassificationAccountStatus[]
  > {
    const accounts = (await this.marketplaceAccountsService.findAll()).filter(
      (a) => a.marketplace === Marketplace.MERCADO_LIVRE,
    );
    const jobs = await this.jobsPersistence.findAll();
    const jobByAccountId = new Map(
      jobs.map((job) => [job.marketplaceAccountId, job]),
    );
    return Promise.all(
      accounts.map(async (account) => {
        const remaining = await this.currentRemainingUnknown(account.id);
        return this.toStatus(
          account.id,
          account.nickname,
          remaining,
          jobByAccountId.get(account.id) ?? null,
        );
      }),
    );
  }

  /**
   * Cria (ou, idempotentemente, devolve) o estado `RUNNING` desta conta. Se
   * a linha já existe em QUALQUER status ativo (`RUNNING`/`WAITING_RETRY`/
   * `PAUSED`), devolve como está, sem tocar em nada — dois cliques nunca
   * criam dois jobs nem reiniciam um em andamento (idempotência). Se a
   * linha existe `COMPLETED`/`FAILED_AUTH`, reabre (`restart`) — cobre o
   * caso de `UNKNOWN` novo ter surgido depois (nova sincronização normal)
   * ou de a conta ter sido reconectada após `FAILED_AUTH`.
   */
  async start(
    accountId: string,
  ): Promise<MlLogisticsReclassificationAccountStatus> {
    const account = await this.assertMercadoLivreAccount(accountId);
    const existing = await this.jobsPersistence.findByAccountId(accountId);
    const wouldCreateOrRestartWork =
      existing === null ||
      existing.status === 'COMPLETED' ||
      existing.status === 'FAILED_AUTH';
    // Bloqueia SÓ quando este `start` de fato criaria/reabriria trabalho —
    // idempotente sobre um job já ativo (`RUNNING`/`WAITING_RETRY`/`PAUSED`)
    // continua sem erro, mesmo com o worker desligado (não muda nada).
    if (
      wouldCreateOrRestartWork &&
      !isMlLogisticsReclassificationWorkerEnabled(this.configService)
    ) {
      throw new MlLogisticsReclassificationError('WORKER_DISABLED');
    }
    if (existing === null) {
      const initialUnknownCount = await this.currentRemainingUnknown(accountId);
      await this.jobsPersistence.createIfAbsent(
        accountId,
        initialUnknownCount,
        new Date(),
      );
    } else if (
      existing.status === 'COMPLETED' ||
      existing.status === 'FAILED_AUTH'
    ) {
      await this.jobsPersistence.restart(accountId, new Date());
    }
    return this.getStatus(account.id);
  }

  async startAll(): Promise<MlLogisticsReclassificationAccountStatus[]> {
    const accounts = (await this.marketplaceAccountsService.findAll()).filter(
      (a) =>
        a.marketplace === Marketplace.MERCADO_LIVRE &&
        a.status === MarketplaceAccountStatus.CONNECTED,
    );
    const results = await Promise.allSettled(
      accounts.map((a) => this.start(a.id)),
    );
    return this.collectSettled(
      results,
      accounts.map((a) => a.id),
    );
  }

  async pause(
    accountId: string,
  ): Promise<MlLogisticsReclassificationAccountStatus> {
    await this.assertMercadoLivreAccount(accountId);
    await this.jobsPersistence.requestPause(accountId);
    return this.getStatus(accountId);
  }

  async pauseAll(): Promise<MlLogisticsReclassificationAccountStatus[]> {
    const accounts = (await this.marketplaceAccountsService.findAll()).filter(
      (a) => a.marketplace === Marketplace.MERCADO_LIVRE,
    );
    const results = await Promise.allSettled(
      accounts.map((a) => this.pause(a.id)),
    );
    return this.collectSettled(
      results,
      accounts.map((a) => a.id),
    );
  }

  async resume(
    accountId: string,
  ): Promise<MlLogisticsReclassificationAccountStatus> {
    await this.assertMercadoLivreAccount(accountId);
    if (!isMlLogisticsReclassificationWorkerEnabled(this.configService)) {
      throw new MlLogisticsReclassificationError('WORKER_DISABLED');
    }
    await this.jobsPersistence.resume(accountId, new Date());
    return this.getStatus(accountId);
  }

  async resumeAll(): Promise<MlLogisticsReclassificationAccountStatus[]> {
    const accounts = (await this.marketplaceAccountsService.findAll()).filter(
      (a) => a.marketplace === Marketplace.MERCADO_LIVRE,
    );
    const results = await Promise.allSettled(
      accounts.map((a) => this.resume(a.id)),
    );
    return this.collectSettled(
      results,
      accounts.map((a) => a.id),
    );
  }

  private async collectSettled(
    results: PromiseSettledResult<MlLogisticsReclassificationAccountStatus>[],
    accountIds: string[],
  ): Promise<MlLogisticsReclassificationAccountStatus[]> {
    const out: MlLogisticsReclassificationAccountStatus[] = [];
    for (let i = 0; i < results.length; i += 1) {
      const result = results[i];
      // Uma conta com erro nunca derruba as demais — a ação "todas" é
      // best-effort; o chamador relê o status individual de cada uma
      // depois, se precisar do motivo específico.
      if (result.status === 'fulfilled') out.push(result.value);
      else out.push(await this.getStatus(accountIds[i]));
    }
    return out;
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

  private toStatus(
    accountId: string,
    nickname: string | null,
    remainingUnknownCount: number,
    job: MlLogisticsReclassificationJobRow | null,
  ): MlLogisticsReclassificationAccountStatus {
    const workerEnabled = isMlLogisticsReclassificationWorkerEnabled(
      this.configService,
    );
    if (job === null) {
      return {
        accountId,
        nickname,
        status: 'IDLE',
        initialUnknownCount: remainingUnknownCount,
        remainingUnknownCount,
        resolvedFullCount: 0,
        resolvedNotFullCount: 0,
        callsMadeCount: 0,
        lastActivityAt: null,
        nextAttemptAt: null,
        lastErrorCode: null,
        pauseRequested: false,
        workerEnabled,
      };
    }
    return {
      accountId: job.marketplaceAccountId,
      nickname,
      status: job.status,
      initialUnknownCount: job.initialUnknownCount,
      remainingUnknownCount,
      resolvedFullCount: job.resolvedFullCount,
      resolvedNotFullCount: job.resolvedNotFullCount,
      callsMadeCount: job.callsMadeCount,
      lastActivityAt: job.lastActivityAt
        ? job.lastActivityAt.toISOString()
        : null,
      nextAttemptAt:
        job.status === 'RUNNING' || job.status === 'WAITING_RETRY'
          ? job.nextAttemptAt.toISOString()
          : null,
      lastErrorCode: job.lastErrorCode,
      pauseRequested: job.pauseRequested,
      workerEnabled,
    };
  }

  /**
   * `findByIdOrFail` já lança `NotFoundException` (404) para conta
   * inexistente — nunca envolvido aqui, deixado subir igual ao padrão de
   * `MarketplaceBackfillService`. Só a regra de negócio ADICIONAL (marketplace
   * errado) vira `MlLogisticsReclassificationError`, mapeado pelo controller.
   */
  private async assertMercadoLivreAccount(accountId: string) {
    const account =
      await this.marketplaceAccountsService.findByIdOrFail(accountId);
    if (account.marketplace !== Marketplace.MERCADO_LIVRE) {
      throw new MlLogisticsReclassificationError('ACCOUNT_NOT_MERCADO_LIVRE');
    }
    return account;
  }
}
