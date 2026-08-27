import { DataSource } from 'typeorm';

/**
 * Reproduz um defeito real encontrado na homologação em PostgreSQL real:
 * `data-source.ts` exportava a mesma instância de DataSource tanto como
 * export nomeado (`AppDataSource`) quanto como `export default`. A CLI do
 * TypeORM (`CommandUtils.loadDataSource`) itera todas as chaves exportadas
 * do módulo e falha com "Given data source file must contain only one
 * export of DataSource instance" quando encontra a mesma instância em mais
 * de uma chave — o que quebra `npm run migration:run`/`migration:revert`.
 *
 * Usa um DATABASE_URL fake (nunca conectado) só para permitir a construção
 * do DataSource sem exigir um Postgres real neste teste.
 */
describe('data-source (compatibilidade com a CLI do TypeORM)', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(() => {
    process.env.DATABASE_URL =
      'postgres://user:pass@localhost:5432/fake_db_for_data_source_spec';
  });

  afterAll(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it('exporta a instância de DataSource em exatamente uma chave do módulo', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dataSourceModule = require('./data-source') as Record<
      string,
      unknown
    >;

    const matchingKeys = Object.keys(dataSourceModule).filter(
      (key) => dataSourceModule[key] instanceof DataSource,
    );

    expect(matchingKeys).toHaveLength(1);
  });
});
