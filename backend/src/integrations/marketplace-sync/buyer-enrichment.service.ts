import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccountStatus,
  type MarketplaceAccount,
} from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import {
  BackfillJobActiveConflictError,
  BackfillJobsPersistenceService,
  type BackfillJobRow,
} from './backfill-jobs-persistence.service';
import { isBackfillWorkerEnabled } from './backfill-worker-config.util';

const ENRICHMENT_MODE = 'BUYER_ENRICHMENT' as const;

export const BUYER_ENRICHMENT_MARKETPLACES: readonly Marketplace[] = [
  Marketplace.MERCADO_LIVRE,
  Marketplace.SHOPEE,
];

/**
 * `ALREADY_ACTIVE`: já existe enriquecimento ativo (idempotente).
 * `MODE_CONFLICT`: o backfill histórico (outro modo da MESMA fila) está
 * ativo na conta — nada foi alterado nele.
 */
export type BuyerEnrichmentStartOutcome =
  | 'QUEUED'
  | 'ALREADY_ACTIVE'
  | 'MODE_CONFLICT'
  | 'NOT_CONNECTED'
  | 'NOT_SUPPORTED';

export interface BuyerEnrichmentAccountStatus {
  accountId: string;
  marketplace: Marketplace;
  nickname: string | null;
  connected: boolean;
  /** `null` = nenhum enriquecimento jamais solicitado para esta conta. */
  jobStatus: string | null;
  cursorBefore: string | null;
  chunksProcessed: number;
  lastErrorCode: string | null;
  requestedAt: string | null;
  completedAt: string | null;
  pauseRequested: boolean;
  lastStartOutcome?: BuyerEnrichmentStartOutcome;
}

export interface BuyerEnrichmentStatus {
  workerEnabled: boolean;
  accounts: BuyerEnrichmentAccountStatus[];
}

export class BuyerEnrichmentAccountNotFoundError extends Error {
  constructor() {
    super('ACCOUNT_NOT_ELIGIBLE');
  }
}

/** Backfill histórico ativo na conta pedida (409 no controller). */
export class BuyerEnrichmentModeConflictError extends Error {
  constructor() {
    super('BACKFILL_JOB_MODE_CONFLICT');
  }
}

/**
 * Orquestração do enriquecimento histórico de compradores (função
 * "Clientes") — só cria/pausa/retoma jobs `BUYER_ENRICHMENT` na mesma fila
 * durável do backfill; o processamento é do `MarketplaceBackfillWorkerService`.
 * Nunca iniciado automaticamente: só por ação explícita de administrador.
 */
@Injectable()
export class BuyerEnrichmentService {
  constructor(
    private readonly accounts: MarketplaceAccountsService,
    private readonly jobs: BackfillJobsPersistenceService,
    private readonly configService: ConfigService,
  ) {}

  async getStatus(): Promise<BuyerEnrichmentStatus> {
    const eligible = await this.listEligibleAccounts();
    const accounts = await Promise.all(
      eligible.map(async (account) =>
        this.toStatus(
          account,
          await this.jobs.findLatestJob(account.id, ENRICHMENT_MODE),
        ),
      ),
    );
    return {
      workerEnabled: isBackfillWorkerEnabled(this.configService),
      accounts,
    };
  }

  /**
   * `accountId` ausente = todas as contas ML/Shopee conectadas (resultado
   * por conta em `lastStartOutcome`). Com `accountId`, backfill histórico
   * ativo na conta → `BuyerEnrichmentModeConflictError` (409).
   */
  async start(accountId?: string): Promise<BuyerEnrichmentStatus> {
    const targets = await this.resolveTargets(accountId);
    const outcomes = new Map<string, BuyerEnrichmentStartOutcome>();
    for (const account of targets) {
      outcomes.set(account.id, await this.startForAccount(account));
    }
    if (accountId && outcomes.get(accountId) === 'MODE_CONFLICT') {
      throw new BuyerEnrichmentModeConflictError();
    }
    const status = await this.getStatus();
    for (const entry of status.accounts) {
      const outcome = outcomes.get(entry.accountId);
      if (outcome) entry.lastStartOutcome = outcome;
    }
    return status;
  }

  async pause(accountId: string): Promise<BuyerEnrichmentStatus> {
    await this.requireEligible(accountId);
    await this.jobs.requestPause(accountId, ENRICHMENT_MODE);
    return this.getStatus();
  }

  async resume(accountId: string): Promise<BuyerEnrichmentStatus> {
    await this.requireEligible(accountId);
    try {
      await this.jobs.resumeJob(accountId, ENRICHMENT_MODE);
    } catch (error) {
      if (error instanceof BackfillJobActiveConflictError) {
        throw new BuyerEnrichmentModeConflictError();
      }
      throw error;
    }
    return this.getStatus();
  }

  private async startForAccount(
    account: MarketplaceAccount,
  ): Promise<BuyerEnrichmentStartOutcome> {
    if (!BUYER_ENRICHMENT_MARKETPLACES.includes(account.marketplace)) {
      return 'NOT_SUPPORTED';
    }
    if (account.status !== MarketplaceAccountStatus.CONNECTED) {
      return 'NOT_CONNECTED';
    }
    try {
      await this.jobs.createJob(
        account.id,
        account.marketplace,
        ENRICHMENT_MODE,
        new Date(),
      );
      return 'QUEUED';
    } catch (error) {
      if (!(error instanceof BackfillJobActiveConflictError)) throw error;
      const active = await this.jobs.findActiveJob(account.id);
      return active && active.mode !== ENRICHMENT_MODE
        ? 'MODE_CONFLICT'
        : 'ALREADY_ACTIVE';
    }
  }

  private async resolveTargets(
    accountId?: string,
  ): Promise<MarketplaceAccount[]> {
    if (accountId) return [await this.requireEligible(accountId)];
    return this.listEligibleAccounts();
  }

  private async requireEligible(
    accountId: string,
  ): Promise<MarketplaceAccount> {
    const account = (await this.listEligibleAccounts()).find(
      (candidate) => candidate.id === accountId,
    );
    if (!account) throw new BuyerEnrichmentAccountNotFoundError();
    return account;
  }

  private async listEligibleAccounts(): Promise<MarketplaceAccount[]> {
    const all = await this.accounts.findAll();
    return all.filter((account) =>
      BUYER_ENRICHMENT_MARKETPLACES.includes(account.marketplace),
    );
  }

  private toStatus(
    account: MarketplaceAccount,
    job: BackfillJobRow | null,
  ): BuyerEnrichmentAccountStatus {
    return {
      accountId: account.id,
      marketplace: account.marketplace,
      nickname: account.nickname,
      connected: account.status === MarketplaceAccountStatus.CONNECTED,
      jobStatus: job?.status ?? null,
      cursorBefore: job?.cursorBefore ? job.cursorBefore.toISOString() : null,
      chunksProcessed: job?.chunksProcessed ?? 0,
      lastErrorCode: job?.lastErrorCode ?? null,
      requestedAt: job ? job.requestedAt.toISOString() : null,
      completedAt: job?.completedAt ? job.completedAt.toISOString() : null,
      pauseRequested: job?.pauseRequested ?? false,
    };
  }
}
