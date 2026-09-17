import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SyncRunType } from '../../sync/sync-run.entity';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { MarketplaceOrdersPersistenceService } from '../marketplace-orders/marketplace-orders-persistence.service';
import { AdvisoryLockService } from '../shared/advisory-lock.service';
import { AmazonOrdersSyncError } from '../amazon-orders/amazon-orders-sync.service';
import { AmazonOrdersSyncService } from '../amazon-orders/amazon-orders-sync.service';
import { SyncOrdersError } from '../mercado-livre-orders/mercado-livre-orders-sync.service';
import { MercadoLivreOrdersSyncService } from '../mercado-livre-orders/mercado-livre-orders-sync.service';
import { ShopeeOrdersSyncError } from '../shopee-orders/shopee-orders-sync-error';
import { ShopeeOrdersSyncService } from '../shopee-orders/shopee-orders-sync.service';

// Chave fixa e bem conhecida do lock de CICLO (distinto dos locks por conta
// já usados por `ensureValidAccessToken`/sincronização manual): impede que
// duas instâncias do backend — ou dois timers da mesma instância, por
// segurança — rodem um ciclo automático ao mesmo tempo. `deriveAdvisoryLockKey`
// aceita qualquer string, não só um `accountId`.
const AUTO_SYNC_CYCLE_LOCK_KEY = 'marketplace-auto-sync-cycle';

// Bem maior que a duração plausível de qualquer sincronização real — nunca
// um timeout de operação normal, só a rede de segurança para um processo
// derrubado no meio de um ciclo.
const STALE_RUN_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Orquestrador de sincronização automática (Fase 4, "Sincronização
 * automática") — genérico, sem NENHUMA dependência de negócio entre
 * Mercado Livre e Amazon: cada conta elegível é despachada para o
 * `*SyncService` do seu próprio marketplace, uma de cada vez (nunca em
 * paralelo, para reduzir rate limit), e uma falha em uma conta nunca
 * interrompe as demais. Amazon não configurada e qualquer marketplace sem
 * conector (ex.: Shopee) são ignorados com um motivo sanitizado no log —
 * nunca tratados como erro real.
 *
 * Desligado por padrão (`MARKETPLACE_AUTO_SYNC_ENABLED`) e SEMPRE desligado
 * quando `NODE_ENV=test` — mesmo que alguém habilite a flag por engano em
 * ambiente de teste, nenhum timer chega a ser criado.
 */
@Injectable()
export class MarketplaceAutoSyncService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MarketplaceAutoSyncService.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
    private readonly persistence: MarketplaceOrdersPersistenceService,
    private readonly mlSyncService: MercadoLivreOrdersSyncService,
    private readonly amazonSyncService: AmazonOrdersSyncService,
    private readonly advisoryLockService: AdvisoryLockService,
    private readonly shopeeSyncService: ShopeeOrdersSyncService,
  ) {}

  onModuleInit(): void {
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    const enabled =
      this.configService.get<string>(
        'MARKETPLACE_AUTO_SYNC_ENABLED',
        'false',
      ) === 'true';
    if (nodeEnv === 'test' || !enabled) return;

    const intervalMinutes = this.configService.get<number>(
      'MARKETPLACE_AUTO_SYNC_INTERVAL_MINUTES',
      60,
    );
    this.intervalHandle = setInterval(
      () => void this.runCycle(),
      intervalMinutes * 60 * 1000,
    );
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Um ciclo completo: recupera `sync_runs` presos, adquire o lock de
   * ciclo (se outra instância/timer já está rodando, desiste sem erro) e
   * sincroniza cada conta CONNECTED sequencialmente.
   */
  async runCycle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.persistence.recoverStaleRunningRuns(STALE_RUN_THRESHOLD_MS);

      const lock = await this.advisoryLockService.tryAcquire(
        AUTO_SYNC_CYCLE_LOCK_KEY,
      );
      if (!lock) {
        this.logger.log('marketplace_auto_sync_cycle_skipped_already_running');
        return;
      }

      try {
        const accounts = await this.marketplaceAccountsService.findAll();
        const eligible = accounts.filter(
          (account) => account.status === MarketplaceAccountStatus.CONNECTED,
        );

        for (const account of eligible) {
          await this.syncOneAccount(account);
        }
      } finally {
        await lock.release();
      }
    } finally {
      this.running = false;
    }
  }

  private async syncOneAccount(account: MarketplaceAccount): Promise<void> {
    try {
      if (account.marketplace === Marketplace.MERCADO_LIVRE) {
        await this.mlSyncService.syncOrders(account.id, {
          type: SyncRunType.INCREMENTAL,
        });
        return;
      }
      if (account.marketplace === Marketplace.AMAZON) {
        await this.amazonSyncService.syncOrders(
          account.id,
          {},
          { type: SyncRunType.INCREMENTAL },
        );
        return;
      }
      if (account.marketplace === Marketplace.SHOPEE) {
        await this.shopeeSyncService.syncOrders(account.id, {
          type: SyncRunType.INCREMENTAL,
        });
        return;
      }
      // Nenhum conector ainda para este marketplace — ignorado, nunca
      // tratado como falha.
      this.logger.log('marketplace_auto_sync_account_skipped', {
        accountId: account.id,
        marketplace: account.marketplace,
        reason: 'MARKETPLACE_NOT_SUPPORTED',
      });
    } catch (error) {
      // Nunca loga o erro bruto (poderia conter contexto sensível) — só o
      // código fechado já sanitizado de
      // `SyncOrdersError`/`AmazonOrdersSyncError`/`ShopeeOrdersSyncError`,
      // ou o fallback genérico para qualquer outra exceção.
      const code =
        error instanceof SyncOrdersError ||
        error instanceof AmazonOrdersSyncError ||
        error instanceof ShopeeOrdersSyncError
          ? error.code
          : 'SYNC_FAILED';
      this.logger.warn('marketplace_auto_sync_account_failed', {
        accountId: account.id,
        marketplace: account.marketplace,
        code,
      });
    }
  }
}
