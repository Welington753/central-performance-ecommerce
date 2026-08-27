import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Prova automatizada de que o "núcleo" do sistema não tem nenhuma dependência
 * direta de um marketplace específico.
 *
 * Varre os arquivos-fonte de auth/, users/, sync/, common/, health/ e
 * integrations/marketplace-accounts/ e falha caso qualquer um deles
 * referencie diretamente uma classe concreta de connector
 * (MercadoLivreConnector, AmazonConnector, ShopeeConnector). Essas classes só
 * podem existir dentro de integrations/connectors/, que é injetado no resto
 * do sistema apenas através da interface `MarketplaceConnector` e do
 * `ConnectorRegistryService`.
 */

const SRC_ROOT = join(__dirname, '..');

const SCANNED_DIRECTORIES = [
  'auth',
  'users',
  'sync',
  'common',
  'health',
  join('integrations', 'marketplace-accounts'),
];

const FORBIDDEN_SYMBOLS = [
  'MercadoLivreConnector',
  'AmazonConnector',
  'ShopeeConnector',
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

describe('Arquitetura multi-marketplace', () => {
  it('nenhum arquivo do núcleo referencia uma classe concreta de connector', () => {
    const offendingFiles: string[] = [];

    for (const relativeDirectory of SCANNED_DIRECTORIES) {
      const absoluteDirectory = join(SRC_ROOT, relativeDirectory);
      const files = listTsFilesRecursively(absoluteDirectory);

      for (const file of files) {
        const content = readFileSync(file, 'utf8');
        const foundSymbol = FORBIDDEN_SYMBOLS.find((symbol) =>
          content.includes(symbol),
        );
        if (foundSymbol) {
          offendingFiles.push(`${file} referencia "${foundSymbol}"`);
        }
      }
    }

    expect(offendingFiles).toEqual([]);
  });

  it('a lista de diretórios varridos não está vazia (sanity check)', () => {
    expect(SCANNED_DIRECTORIES.length).toBeGreaterThan(0);
  });
});
