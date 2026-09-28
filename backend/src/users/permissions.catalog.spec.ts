import {
  ALL_PERMISSION_KEYS,
  isPermissionKey,
  isRoleKey,
  PERMISSIONS,
  ROLE_KEYS,
  ROLE_PERMISSION_PRESETS,
} from './permissions.catalog';

const EXPECTED_CATALOG = [
  'dashboard.view',
  'full.view',
  'customers.view',
  'customers.export',
  'customers.export_personal_data',
  'customers.manage_enrichment',
  'goals.view',
  'goals.manage',
  'integrations.view',
  'integrations.manage',
  'sync.view',
  'sync.run',
  'sync.backfill',
  'sync.full_history',
  'users.view',
  'users.manage',
] as const;

const EXPECTED_ANALYST_PRESET = [
  'dashboard.view',
  'full.view',
  'customers.view',
  'customers.export',
  'goals.view',
  'integrations.view',
  'sync.view',
];

const EXPECTED_VIEWER_PRESET = [
  'dashboard.view',
  'full.view',
  'goals.view',
  'integrations.view',
  'sync.view',
];

describe('permissions.catalog', () => {
  it('catálogo canônico tem exatamente as 16 permission keys em inglês, sem duplicatas', () => {
    expect(ALL_PERMISSION_KEYS).toHaveLength(16);
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(16);
    expect([...ALL_PERMISSION_KEYS].sort()).toEqual(
      [...EXPECTED_CATALOG].sort(),
    );
  });

  it('PERMISSIONS expõe exatamente as mesmas 16 chaves que ALL_PERMISSION_KEYS', () => {
    expect(Object.values(PERMISSIONS).sort()).toEqual(
      [...ALL_PERMISSION_KEYS].sort(),
    );
  });

  it('ROLE_KEYS define exatamente ADMIN, ANALYST e VIEWER', () => {
    expect(Object.values(ROLE_KEYS).sort()).toEqual(
      ['ADMIN', 'ANALYST', 'VIEWER'].sort(),
    );
  });

  it('ADMIN sempre recebe o catálogo inteiro — nunca uma lista fixa que pode ficar desalinhada', () => {
    expect([...ROLE_PERMISSION_PRESETS.ADMIN].sort()).toEqual(
      [...ALL_PERMISSION_KEYS].sort(),
    );
  });

  it('ANALYST recebe exatamente o preset definido pelo negócio', () => {
    expect([...ROLE_PERMISSION_PRESETS.ANALYST].sort()).toEqual(
      [...EXPECTED_ANALYST_PRESET].sort(),
    );
  });

  it('VIEWER recebe exatamente o preset definido pelo negócio', () => {
    expect([...ROLE_PERMISSION_PRESETS.VIEWER].sort()).toEqual(
      [...EXPECTED_VIEWER_PRESET].sort(),
    );
  });

  it('isPermissionKey reconhece só as 16 chaves canônicas — nunca chave legada em português nem lixo', () => {
    for (const key of ALL_PERMISSION_KEYS) {
      expect(isPermissionKey(key)).toBe(true);
    }
    expect(isPermissionKey('clientes.visualizar')).toBe(false);
    expect(isPermissionKey('dashboard.viewer')).toBe(false);
    expect(isPermissionKey('')).toBe(false);
  });

  it('isRoleKey reconhece só ADMIN/ANALYST/VIEWER', () => {
    expect(isRoleKey('ADMIN')).toBe(true);
    expect(isRoleKey('ANALYST')).toBe(true);
    expect(isRoleKey('VIEWER')).toBe(true);
    expect(isRoleKey('SUPERUSER')).toBe(false);
    expect(isRoleKey('admin')).toBe(false);
    expect(isRoleKey('')).toBe(false);
  });

  it('permissões sensíveis nunca entram no preset padrão de ANALYST ou VIEWER', () => {
    const notGrantedByDefault = [
      PERMISSIONS.CUSTOMERS_EXPORT_PERSONAL_DATA,
      PERMISSIONS.CUSTOMERS_MANAGE_ENRICHMENT,
      PERMISSIONS.GOALS_MANAGE,
      PERMISSIONS.INTEGRATIONS_MANAGE,
      PERMISSIONS.SYNC_RUN,
      PERMISSIONS.SYNC_BACKFILL,
      PERMISSIONS.SYNC_FULL_HISTORY,
      PERMISSIONS.USERS_VIEW,
      PERMISSIONS.USERS_MANAGE,
    ];
    for (const permission of notGrantedByDefault) {
      expect(ROLE_PERMISSION_PRESETS.ANALYST).not.toContain(permission);
      expect(ROLE_PERMISSION_PRESETS.VIEWER).not.toContain(permission);
    }
  });
});
