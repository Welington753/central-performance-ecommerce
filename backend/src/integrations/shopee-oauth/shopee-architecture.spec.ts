import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Prova automatizada das decisões de escopo do Checkpoint CP2A:
 *
 *  - nenhum arquivo de `integrations/shopee-oauth/` referencia
 *    `MercadoLivreConnector`, `AmazonConnector`, `ShopeeConnector` ou
 *    `ConnectorRegistryService` — a fundação Shopee é só config/validação/
 *    assinatura, nunca um connector concreto;
 *  - o núcleo compartilhado de OAuth (`oauth-authorization-requests.service.ts`
 *    e `oauth-authorization-request.entity.ts`) não importa nenhum
 *    vocabulário concreto de failureCode — nem o do Mercado Livre
 *    (`MercadoLivreOAuthFailureCode`), nem o da Shopee
 *    (`ShopeeOAuthFailureCode`). A generalização mínima (Checkpoint CP2A)
 *    substitui o parâmetro/coluna por `string` nesse limite.
 */

const SRC_ROOT = join(__dirname, '..', '..');
const SHOPEE_OAUTH_DIR = join(SRC_ROOT, 'integrations', 'shopee-oauth');
const OAUTH_CORE_FILES = [
  join(
    SRC_ROOT,
    'integrations',
    'mercado-livre-oauth',
    'oauth-authorization-requests.service.ts',
  ),
  join(
    SRC_ROOT,
    'integrations',
    'mercado-livre-oauth',
    'oauth-authorization-request.entity.ts',
  ),
];

const FORBIDDEN_CONNECTOR_SYMBOLS = [
  'MercadoLivreConnector',
  'AmazonConnector',
  'ShopeeConnector',
  'ConnectorRegistryService',
];

const FORBIDDEN_FAILURE_CODE_SYMBOLS = [
  'MercadoLivreOAuthFailureCode',
  'ShopeeOAuthFailureCode',
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

function findOffenders(files: string[], forbiddenSymbols: string[]): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const found = forbiddenSymbols.find((symbol) => content.includes(symbol));
    if (found) offenders.push(`${file} referencia "${found}"`);
  }
  return offenders;
}

describe('Escopo arquitetural Shopee (Checkpoint CP2A)', () => {
  it('nenhum arquivo de integrations/shopee-oauth/ referencia um connector concreto ou o registro de connectors', () => {
    const offenders = findOffenders(
      listTsFilesRecursively(SHOPEE_OAUTH_DIR),
      FORBIDDEN_CONNECTOR_SYMBOLS,
    );
    expect(offenders).toEqual([]);
  });

  it('o núcleo compartilhado de OAuth (service + entity) não importa o vocabulário concreto de failureCode de nenhum marketplace', () => {
    const offenders = findOffenders(
      OAUTH_CORE_FILES,
      FORBIDDEN_FAILURE_CODE_SYMBOLS,
    );
    expect(offenders).toEqual([]);
  });
});
