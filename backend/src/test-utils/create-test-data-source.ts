import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { requireTestDatabaseUrl } from './require-test-database-url';

/**
 * Único ponto de criação de `DataSource` para testes reais neste plano.
 * Sem `namingStrategy: new SnakeNamingStrategy()` (a mesma usada em produção
 * — `backend/src/database/typeorm-options.factory.ts`), um
 * `Repository<MarketplaceAccount>` tentaria ler colunas camelCase
 * (`tokenExpiresAt`) que não existem no schema real em snake_case
 * (`token_expires_at`), retornando `undefined` silenciosamente em vez de
 * falhar. `synchronize` é sempre `false` — o schema vem só das migrations
 * reais (Task 5), nunca de `entities` sincronizadas.
 */
export async function createTestDataSource(
  entities: Function[],
): Promise<DataSource> {
  const dataSource = new DataSource({
    type: 'postgres',
    url: requireTestDatabaseUrl(),
    entities,
    synchronize: false,
    namingStrategy: new SnakeNamingStrategy(),
  });
  await dataSource.initialize();
  return dataSource;
}
