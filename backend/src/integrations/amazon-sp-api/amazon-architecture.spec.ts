import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Prova automatizada de isolamento entre os módulos Amazon (SP-API e
 * pedidos) e Mercado Livre (OAuth e pedidos) — Etapa 3/Etapa 8 teste #14
 * (Checkpoint 4-A) e "testes arquiteturais" (Checkpoint 4-B): nenhum
 * arquivo de `integrations/amazon-sp-api/` ou `integrations/amazon-orders/`
 * referencia uma classe de NEGÓCIO do Mercado Livre, e nenhum arquivo de
 * `integrations/mercado-livre-oauth/` ou `integrations/mercado-livre-orders/`
 * referencia uma classe de negócio da Amazon. Utilitários genuinamente
 * genéricos (`AdvisoryLockService`, `EncryptionService`,
 * `MarketplaceAccountsService`, `MarketplaceOrdersPersistenceService`) são
 * explicitamente permitidos nos dois sentidos — só serviços/clients de
 * negócio específicos de cada marketplace são proibidos.
 */

const SRC_ROOT = join(__dirname, '..', '..');

const AMAZON_SP_API_DIR = join(SRC_ROOT, 'integrations', 'amazon-sp-api');
const AMAZON_ORDERS_DIR = join(SRC_ROOT, 'integrations', 'amazon-orders');
const ML_OAUTH_DIR = join(SRC_ROOT, 'integrations', 'mercado-livre-oauth');
const ML_ORDERS_DIR = join(SRC_ROOT, 'integrations', 'mercado-livre-orders');

const FORBIDDEN_IN_AMAZON = [
  'MercadoLivreOAuthService',
  'MercadoLivreHttpClient',
  'MercadoLivreOrdersHttpClient',
  'MercadoLivreOrdersSyncService',
  'MercadoLivreOrdersPersistenceService',
  'MercadoLivreOrdersKpiService',
  'MercadoLivreConnector',
  'OAuthAuthorizationRequestsService',
];

const FORBIDDEN_IN_MERCADO_LIVRE = [
  'AmazonAuthService',
  'AmazonLwaClient',
  'AmazonSpApiClient',
  'AmazonOrdersSyncService',
  'AmazonConnector',
];

function listTsFilesRecursively(directory: string): string[] {
  const entries = readdirSync(directory);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...listTsFilesRecursively(fullPath));
      continue;
    }

    if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

function findOffenders(directory: string, forbiddenSymbols: string[]) {
  const offenders: string[] = [];
  for (const file of listTsFilesRecursively(directory)) {
    const content = readFileSync(file, 'utf8');
    const found = forbiddenSymbols.find((symbol) => content.includes(symbol));
    if (found) offenders.push(`${file} referencia "${found}"`);
  }
  return offenders;
}

describe('Isolamento arquitetural Amazon x Mercado Livre', () => {
  it('nenhum arquivo de integrations/amazon-sp-api/ referencia um serviço de negócio do Mercado Livre', () => {
    expect(findOffenders(AMAZON_SP_API_DIR, FORBIDDEN_IN_AMAZON)).toEqual([]);
  });

  it('nenhum arquivo de integrations/amazon-orders/ referencia um serviço de negócio do Mercado Livre', () => {
    expect(findOffenders(AMAZON_ORDERS_DIR, FORBIDDEN_IN_AMAZON)).toEqual([]);
  });

  it('nenhum arquivo de integrations/mercado-livre-oauth/ referencia um serviço de negócio da Amazon', () => {
    expect(findOffenders(ML_OAUTH_DIR, FORBIDDEN_IN_MERCADO_LIVRE)).toEqual([]);
  });

  it('nenhum arquivo de integrations/mercado-livre-orders/ referencia um serviço de negócio da Amazon', () => {
    expect(findOffenders(ML_ORDERS_DIR, FORBIDDEN_IN_MERCADO_LIVRE)).toEqual(
      [],
    );
  });
});
