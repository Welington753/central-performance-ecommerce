import { DataSource } from 'typeorm';
import { requireTestDatabaseUrl } from '../../test-utils/require-test-database-url';
import { buildDataSourceOptions } from '../../database/typeorm-options.factory';
import { MarketplaceProblemReasonsCacheRepository } from './marketplace-problem-reasons-cache.repository';

describe('MarketplaceProblemReasonsCacheRepository (Postgres real)', () => {
  let dataSource: DataSource;
  let repository: MarketplaceProblemReasonsCacheRepository;

  beforeAll(async () => {
    dataSource = new DataSource(
      buildDataSourceOptions({
        databaseUrl: requireTestDatabaseUrl(),
        nodeEnv: 'test',
      }),
    );
    await dataSource.initialize();
    await dataSource.runMigrations();
    repository = new MarketplaceProblemReasonsCacheRepository(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  const baseEntry = {
    marketplace: 'MERCADO_LIVRE',
    siteId: 'MLB',
    reasonId: `PDD-${Date.now()}`,
    flow: 'mediations',
    name: 'Produto não recebido',
    detail: 'Comprador alega não ter recebido',
    status: 'active',
    triage: ['auto_refund'],
    allowedFlows: ['mediations'],
    expectedResolutions: ['refund'],
  };

  it('findFresh devolve null quando a chave nunca foi vista', async () => {
    const result = await repository.findFresh(
      'MERCADO_LIVRE',
      'MLB',
      'never-seen-reason',
      3_600_000,
      new Date(),
    );
    expect(result).toBeNull();
  });

  it('upsert grava e findFresh devolve dentro do TTL', async () => {
    const now = new Date('2026-02-01T00:00:00.000Z');
    await repository.upsert({ ...baseEntry, fetchedAt: now });

    const fresh = await repository.findFresh(
      baseEntry.marketplace,
      baseEntry.siteId,
      baseEntry.reasonId,
      3_600_000,
      new Date(now.getTime() + 1_000),
    );
    expect(fresh).toEqual({
      flow: baseEntry.flow,
      name: baseEntry.name,
      detail: baseEntry.detail,
      status: baseEntry.status,
      triage: baseEntry.triage,
      allowedFlows: baseEntry.allowedFlows,
      expectedResolutions: baseEntry.expectedResolutions,
      fetchedAt: now,
    });
  });

  it('findFresh devolve null quando fetchedAt é mais velho que maxAgeMs (expirado)', async () => {
    const now = new Date('2026-02-01T00:00:00.000Z');
    const beyondTtl = new Date(now.getTime() + 3_600_001);
    const result = await repository.findFresh(
      baseEntry.marketplace,
      baseEntry.siteId,
      baseEntry.reasonId,
      3_600_000,
      beyondTtl,
    );
    expect(result).toBeNull();
  });

  it('upsert substitui por inteiro numa chamada repetida (nunca faz merge parcial)', async () => {
    const firstAt = new Date('2026-02-01T00:00:00.000Z');
    const secondAt = new Date('2026-02-02T00:00:00.000Z');
    const key = {
      marketplace: 'MERCADO_LIVRE',
      siteId: 'MLB',
      reasonId: `PDD-upd-${Date.now()}`,
    };

    await repository.upsert({
      ...key,
      flow: 'mediations',
      name: 'Nome antigo',
      detail: 'Detalhe antigo',
      status: 'active',
      triage: ['old'],
      allowedFlows: ['old_flow'],
      expectedResolutions: ['old_resolution'],
      fetchedAt: firstAt,
    });
    await repository.upsert({
      ...key,
      flow: 'cancellations',
      name: 'Nome novo',
      detail: null,
      status: 'inactive',
      triage: ['new'],
      allowedFlows: ['new_flow'],
      expectedResolutions: ['new_resolution'],
      fetchedAt: secondAt,
    });

    const result = await repository.findFresh(
      key.marketplace,
      key.siteId,
      key.reasonId,
      3_600_000,
      new Date(secondAt.getTime() + 1_000),
    );
    expect(result).toEqual({
      flow: 'cancellations',
      name: 'Nome novo',
      detail: null,
      status: 'inactive',
      triage: ['new'],
      allowedFlows: ['new_flow'],
      expectedResolutions: ['new_resolution'],
      fetchedAt: secondAt,
    });
  });

  it('chave é COMPARTILHADA entre contas do mesmo marketplace/site (não existe conceito de conta aqui)', async () => {
    // Não há coluna de conta na tabela — a mesma leitura serve qualquer
    // conta que consulte o mesmo (marketplace, site, reason). Este teste só
    // documenta/prova que a assinatura do repositório nunca pede accountId.
    const now = new Date('2026-03-01T00:00:00.000Z');
    const key = {
      marketplace: 'MERCADO_LIVRE',
      siteId: 'MLB',
      reasonId: `PDD-shared-${Date.now()}`,
    };
    await repository.upsert({
      ...key,
      flow: 'mediations',
      name: 'Motivo compartilhado',
      detail: null,
      status: 'active',
      triage: [],
      allowedFlows: [],
      expectedResolutions: [],
      fetchedAt: now,
    });

    const asIfFromAccountA = await repository.findFresh(
      key.marketplace,
      key.siteId,
      key.reasonId,
      3_600_000,
      new Date(now.getTime() + 1),
    );
    const asIfFromAccountB = await repository.findFresh(
      key.marketplace,
      key.siteId,
      key.reasonId,
      3_600_000,
      new Date(now.getTime() + 2),
    );
    expect(asIfFromAccountA).not.toBeNull();
    expect(asIfFromAccountB).toEqual(asIfFromAccountA);
  });

  it('isola marketplaces/sites diferentes mesmo com o mesmo reasonId', async () => {
    const now = new Date('2026-03-01T00:00:00.000Z');
    const reasonId = `PDD-isolation-${Date.now()}`;
    await repository.upsert({
      marketplace: 'MERCADO_LIVRE',
      siteId: 'MLB',
      reasonId,
      flow: 'mediations',
      name: 'Motivo do site MLB',
      detail: null,
      status: 'active',
      triage: [],
      allowedFlows: [],
      expectedResolutions: [],
      fetchedAt: now,
    });

    const otherSite = await repository.findFresh(
      'MERCADO_LIVRE',
      'MLA',
      reasonId,
      3_600_000,
      new Date(now.getTime() + 1),
    );
    expect(otherSite).toBeNull();
  });
});
