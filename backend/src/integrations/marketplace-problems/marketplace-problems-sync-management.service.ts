import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AccountScope } from '../../users/account-scope.types';
import { Marketplace } from '../contracts/marketplace.enum';
import type { MarketplaceAccount } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { ScopedMarketplaceAccountService } from '../marketplace-accounts/scoped-marketplace-account.service';
import { MarketplaceProblemsSyncJobsPersistenceService } from './marketplace-problems-sync-jobs-persistence.service';
import type { MarketplaceProblemsSyncJobRow } from './marketplace-problems-sync-jobs.types';
import { isProblemsSyncWorkerEnabled } from './marketplace-problems-sync-worker-config.util';
import type { ProblemsSyncStatusDto } from './marketplace-problems.types';

export const PROBLEMS_SYNC_MARKETPLACE_NOT_SUPPORTED =
  'A sincronização de problemas só está disponível para o Mercado Livre.';
export const PROBLEMS_SYNC_JOB_NOT_STARTED =
  'A sincronização desta conta ainda não foi iniciada.';

const iso = (value: Date | null): string | null =>
  value ? value.toISOString() : null;

/**
 * Controles manuais do job de sincronização (`problems.sync`) — só grava o
 * ESTADO durável do job (CP2-C) e devolve o status. NUNCA executa tick e
 * nunca faz chamada HTTP ao Mercado Livre: quem processa é o worker (que só
 * roda com `PROBLEMS_SYNC_WORKER_ENABLED=true`). Conta inexistente ou fora
 * do escopo: 404 genérico via `ScopedMarketplaceAccountService`. Nada cria
 * jobs automaticamente — só `start` explícito.
 */
@Injectable()
export class MarketplaceProblemsSyncManagementService {
  constructor(
    private readonly jobs: MarketplaceProblemsSyncJobsPersistenceService,
    private readonly scopedAccounts: ScopedMarketplaceAccountService,
    private readonly accounts: MarketplaceAccountsService,
    private readonly configService: ConfigService,
  ) {}

  private toStatus(
    account: Pick<MarketplaceAccount, 'id' | 'nickname'>,
    job: MarketplaceProblemsSyncJobRow | null,
  ): ProblemsSyncStatusDto {
    return {
      accountId: account.id,
      accountNickname: account.nickname ?? null,
      jobStatus: job?.status ?? 'NOT_STARTED',
      windowCursorAt: iso(job?.windowCursorAt ?? null),
      lastCompleteCensusAt: iso(job?.lastCompleteCensusAt ?? null),
      lastActivityAt: iso(job?.lastActivityAt ?? null),
      nextAttemptAt: iso(job?.nextAttemptAt ?? null),
      attemptCount: job?.attemptCount ?? 0,
      lastErrorCode: job?.lastErrorCode ?? null,
      pauseRequested: job?.pauseRequested ?? false,
      claimsProcessedCount: job?.claimsProcessedCount ?? 0,
      workerEnabled: isProblemsSyncWorkerEnabled(this.configService),
    };
  }

  /** Contas Mercado Livre do escopo, com o job quando existir (`NOT_STARTED` senão). */
  async status(scope: AccountScope): Promise<ProblemsSyncStatusDto[]> {
    const accounts = (await this.accounts.findAllForScope(scope)).filter(
      (account) => account.marketplace === Marketplace.MERCADO_LIVRE,
    );
    const jobs = await this.jobs.findByAccountIds(
      accounts.map((account) => account.id),
    );
    const byAccount = new Map(
      jobs.map((job) => [job.marketplaceAccountId, job]),
    );
    return accounts.map((account) =>
      this.toStatus(account, byAccount.get(account.id) ?? null),
    );
  }

  private async resolveAccount(
    scope: AccountScope,
    accountId: string,
  ): Promise<MarketplaceAccount> {
    const account = await this.scopedAccounts.assertAllowedAndFindOrFail(
      scope,
      accountId,
    );
    if (account.marketplace !== Marketplace.MERCADO_LIVRE) {
      throw new BadRequestException(PROBLEMS_SYNC_MARKETPLACE_NOT_SUPPORTED);
    }
    return account;
  }

  /** Idempotente: job já existente (em qualquer estado) é devolvido SEM duplicar nem alterar. */
  async start(
    scope: AccountScope,
    accountId: string,
  ): Promise<ProblemsSyncStatusDto> {
    const account = await this.resolveAccount(scope, accountId);
    const job = await this.jobs.createIfAbsent(accountId, new Date());
    return this.toStatus(account, job);
  }

  async pause(
    scope: AccountScope,
    accountId: string,
  ): Promise<ProblemsSyncStatusDto> {
    const account = await this.resolveAccount(scope, accountId);
    const existing = await this.jobs.findByAccountId(accountId);
    if (!existing) throw new NotFoundException(PROBLEMS_SYNC_JOB_NOT_STARTED);
    const paused = await this.jobs.requestPause(accountId);
    return this.toStatus(account, paused ?? existing);
  }

  /** Limpa tentativas/erro e agenda execução; job já ativo apenas devolve o status. */
  async resume(
    scope: AccountScope,
    accountId: string,
  ): Promise<ProblemsSyncStatusDto> {
    const account = await this.resolveAccount(scope, accountId);
    const resumed = await this.jobs.resume(accountId, new Date());
    if (resumed) return this.toStatus(account, resumed);
    const existing = await this.jobs.findByAccountId(accountId);
    if (!existing) throw new NotFoundException(PROBLEMS_SYNC_JOB_NOT_STARTED);
    return this.toStatus(account, existing);
  }
}
