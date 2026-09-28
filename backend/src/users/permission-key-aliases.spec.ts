import { CUSTOMER_PERMISSIONS } from '../customers/customer-permissions';
import {
  LEGACY_CUSTOMER_PERMISSION_ALIASES,
  toCanonicalPermissionKey,
} from './permission-key-aliases';
import { ALL_PERMISSION_KEYS, PERMISSIONS } from './permissions.catalog';

describe('permission-key-aliases (transição Clientes PT -> catálogo canônico EN)', () => {
  it('mapeia exatamente as 4 permission keys reais de customer-permissions.ts, sem cópia divergente', () => {
    const legacyKeysInUse = Object.values(CUSTOMER_PERMISSIONS).sort();
    const legacyKeysMapped = Object.keys(
      LEGACY_CUSTOMER_PERMISSION_ALIASES,
    ).sort();
    expect(legacyKeysMapped).toEqual(legacyKeysInUse);
  });

  it('todo alias aponta para uma permission key que existe no catálogo canônico', () => {
    for (const canonical of Object.values(LEGACY_CUSTOMER_PERMISSION_ALIASES)) {
      expect(ALL_PERMISSION_KEYS).toContain(canonical);
    }
  });

  it('cada permissão legada em português aponta para o equivalente canônico correto', () => {
    expect(LEGACY_CUSTOMER_PERMISSION_ALIASES[CUSTOMER_PERMISSIONS.VIEW]).toBe(
      PERMISSIONS.CUSTOMERS_VIEW,
    );
    expect(
      LEGACY_CUSTOMER_PERMISSION_ALIASES[CUSTOMER_PERMISSIONS.EXPORT],
    ).toBe(PERMISSIONS.CUSTOMERS_EXPORT);
    expect(
      LEGACY_CUSTOMER_PERMISSION_ALIASES[
        CUSTOMER_PERMISSIONS.EXPORT_PERSONAL_DATA
      ],
    ).toBe(PERMISSIONS.CUSTOMERS_EXPORT_PERSONAL_DATA);
    expect(
      LEGACY_CUSTOMER_PERMISSION_ALIASES[
        CUSTOMER_PERMISSIONS.MANAGE_ENRICHMENT
      ],
    ).toBe(PERMISSIONS.CUSTOMERS_MANAGE_ENRICHMENT);
  });

  it('não introduz nenhuma chave canônica duplicada (cada permissão legada aponta para um alvo único)', () => {
    const targets = Object.values(LEGACY_CUSTOMER_PERMISSION_ALIASES);
    expect(new Set(targets).size).toBe(targets.length);
  });
});

describe('toCanonicalPermissionKey', () => {
  it('devolve a própria chave quando já é canônica', () => {
    expect(toCanonicalPermissionKey(PERMISSIONS.CUSTOMERS_VIEW)).toBe(
      PERMISSIONS.CUSTOMERS_VIEW,
    );
  });

  it('converte alias legado de Clientes (PT) para a chave canônica (EN)', () => {
    expect(toCanonicalPermissionKey(CUSTOMER_PERMISSIONS.VIEW)).toBe(
      PERMISSIONS.CUSTOMERS_VIEW,
    );
    expect(toCanonicalPermissionKey(CUSTOMER_PERMISSIONS.EXPORT)).toBe(
      PERMISSIONS.CUSTOMERS_EXPORT,
    );
  });

  it('devolve null para uma chave desconhecida — nunca inventa uma canônica', () => {
    expect(toCanonicalPermissionKey('chave.inexistente')).toBeNull();
    expect(toCanonicalPermissionKey('')).toBeNull();
  });
});
