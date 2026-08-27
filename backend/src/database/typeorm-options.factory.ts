import { join } from 'path';
import type { DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

export interface BuildDataSourceOptionsInput {
  databaseUrl: string;
  nodeEnv: string;
}

/**
 * Única fonte de verdade para a configuração de conexão do TypeORM, usada
 * tanto pela aplicação (`app.module.ts`, via `TypeOrmModule.forRootAsync`)
 * quanto pela CLI do TypeORM (`database/data-source.ts`, usada pelos scripts
 * `migration:generate`/`migration:run`/`migration:revert`).
 *
 * `synchronize` é SEMPRE `false` e nunca é parametrizável por variável de
 * ambiente — o schema do banco é controlado exclusivamente por migrations
 * versionadas em `database/migrations`. Ver `typeorm-options.factory.spec.ts`.
 */
export function buildDataSourceOptions(
  input: BuildDataSourceOptionsInput,
): DataSourceOptions {
  return {
    type: 'postgres',
    url: input.databaseUrl,
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    logging: input.nodeEnv === 'production' ? ['error'] : ['error', 'warn'],
    entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
  };
}
