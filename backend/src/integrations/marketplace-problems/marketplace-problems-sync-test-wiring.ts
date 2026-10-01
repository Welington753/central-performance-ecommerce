import type { DataSource } from 'typeorm';
import { MarketplaceProblemClaimQuarantineRepository } from './marketplace-problem-claim-quarantine.repository';
import { MarketplaceProblemsHistoricalBackfillService } from './marketplace-problems-historical-backfill.service';
import { MarketplaceProblemsSyncTickService } from './marketplace-problems-sync-tick.service';
import { MercadoLivreProblemsHistoricalSyncService } from './mercado-livre-problems-historical-sync.service';
import { MercadoLivreProblemsSyncService } from './mercado-livre-problems-sync.service';

type SyncArgs = ConstructorParameters<typeof MercadoLivreProblemsSyncService>;

/** Monta o pipeline REAL de sync (incremental + histórico + tick) sobre um `DataSource` de teste. */
export function buildProblemsSyncServices(deps: {
  dataSource: DataSource;
  preflight: unknown;
  httpClient: SyncArgs[1];
  reasonCache: SyncArgs[2];
  problems: SyncArgs[3];
  configService: SyncArgs[5];
}) {
  const quarantine = new MarketplaceProblemClaimQuarantineRepository(
    deps.dataSource,
  );
  const args = [
    deps.preflight as never,
    deps.httpClient,
    deps.reasonCache,
    deps.problems,
    quarantine,
    deps.configService,
  ] as const;
  const sync = new MercadoLivreProblemsSyncService(...args);
  const historicalSync = new MercadoLivreProblemsHistoricalSyncService(...args);
  const backfill = new MarketplaceProblemsHistoricalBackfillService(
    deps.dataSource,
    historicalSync,
  );
  const tick = new MarketplaceProblemsSyncTickService(
    sync,
    historicalSync,
    backfill,
  );
  return { quarantine, sync, historicalSync, backfill, tick };
}
