import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './typeorm-options.factory';

/**
 * DataSource usado exclusivamente pela CLI do TypeORM
 * (`migration:generate`, `migration:run`, `migration:revert` — ver scripts
 * no package.json). A aplicação NestJS em si usa
 * `TypeOrmModule.forRootAsync` em `app.module.ts`, que reaproveita a mesma
 * `buildDataSourceOptions` para garantir que os dois nunca divirjam.
 *
 * Lê `.env` diretamente (via dotenv) porque, fora do contexto do Nest, não
 * existe `ConfigModule`/validação de ambiente rodando.
 */
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL não configurada. Defina-a no seu .env antes de rodar comandos de migration.',
  );
}

export const AppDataSource = new DataSource(
  buildDataSourceOptions({
    databaseUrl,
    nodeEnv: process.env.NODE_ENV ?? 'development',
  }),
);

export default AppDataSource;
