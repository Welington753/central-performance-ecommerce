/**
 * Catálogo canônico de permission keys — sempre em inglês, ponto único de
 * verdade tanto para o código quanto para o que a migration de roles/RBAC
 * insere no banco (ver `database/migrations/*-users-roles-permissions.ts`,
 * que hardcoda as MESMAS 16 chaves como literais SQL — nunca importa este
 * arquivo, para a migration nunca depender do estado futuro do código; o
 * alinhamento entre os dois lados é garantido por teste de integração, não
 * por import compartilhado).
 *
 * Histórico: a função "Clientes" já tinha um catálogo próprio em português
 * (`clientes.visualizar`, ...) em `customers/customer-permissions.ts`. Este
 * catálogo o substitui como fonte canônica; a ponte entre os dois nomes vive
 * em `permission-key-aliases.ts`, nunca duplicada em mais de um lugar.
 */
export const PERMISSIONS = {
  DASHBOARD_VIEW: 'dashboard.view',
  FULL_VIEW: 'full.view',
  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_EXPORT: 'customers.export',
  CUSTOMERS_EXPORT_PERSONAL_DATA: 'customers.export_personal_data',
  CUSTOMERS_MANAGE_ENRICHMENT: 'customers.manage_enrichment',
  GOALS_VIEW: 'goals.view',
  GOALS_MANAGE: 'goals.manage',
  INTEGRATIONS_VIEW: 'integrations.view',
  INTEGRATIONS_MANAGE: 'integrations.manage',
  SYNC_VIEW: 'sync.view',
  SYNC_RUN: 'sync.run',
  SYNC_BACKFILL: 'sync.backfill',
  SYNC_FULL_HISTORY: 'sync.full_history',
  USERS_VIEW: 'users.view',
  USERS_MANAGE: 'users.manage',
  PROBLEMS_VIEW: 'problems.view',
  PROBLEMS_MANAGE: 'problems.manage',
  PROBLEMS_SYNC: 'problems.sync',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSION_KEYS: readonly PermissionKey[] =
  Object.values(PERMISSIONS);

const PERMISSION_KEY_SET: ReadonlySet<string> = new Set(ALL_PERMISSION_KEYS);

/**
 * Guarda de tipo fail-closed: só true para as 16 chaves canônicas. Usada
 * pelo `PermissionResolverService` para descartar (nunca conceder) qualquer
 * linha de `role_permissions`/`user_permission_overrides` cuja
 * `permission_key` não seja reconhecida — defesa extra além do CHECK
 * constraint do banco.
 */
export function isPermissionKey(value: string): value is PermissionKey {
  return PERMISSION_KEY_SET.has(value);
}

export const ROLE_KEYS = {
  ADMIN: 'ADMIN',
  ANALYST: 'ANALYST',
  VIEWER: 'VIEWER',
} as const;

export type RoleKey = (typeof ROLE_KEYS)[keyof typeof ROLE_KEYS];

const ROLE_KEY_SET: ReadonlySet<string> = new Set(Object.values(ROLE_KEYS));

/** Fail-closed: só true para ADMIN/ANALYST/VIEWER — qualquer outro valor de `roles.key` é "papel desconhecido". */
export function isRoleKey(value: string): value is RoleKey {
  return ROLE_KEY_SET.has(value);
}

/**
 * Presets iniciais dos 3 papéis (Checkpoint 1). ADMIN sempre recebe o
 * catálogo inteiro por referência a `ALL_PERMISSION_KEYS` — nunca uma lista
 * fixa copiada, que poderia ficar desalinhada se uma permissão nova entrar
 * no catálogo. ANALYST/VIEWER são ajustáveis por usuário via
 * `user_permission_overrides` (schema deste checkpoint; resolução da
 * permissão efetiva — papel + overrides — fica para o service do próximo
 * checkpoint). ADMIN não aceita override negativo: essa regra é de negócio
 * (aplicada no service futuro), não expressável em CHECK constraint sem
 * trigger — ver nota em `database/migrations/*-users-roles-permissions.ts`.
 */
export const ROLE_PERMISSION_PRESETS: Readonly<
  Record<RoleKey, readonly PermissionKey[]>
> = {
  ADMIN: ALL_PERMISSION_KEYS,
  ANALYST: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.FULL_VIEW,
    PERMISSIONS.CUSTOMERS_VIEW,
    PERMISSIONS.CUSTOMERS_EXPORT,
    PERMISSIONS.GOALS_VIEW,
    PERMISSIONS.INTEGRATIONS_VIEW,
    PERMISSIONS.SYNC_VIEW,
    PERMISSIONS.PROBLEMS_VIEW,
  ],
  VIEWER: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.FULL_VIEW,
    PERMISSIONS.GOALS_VIEW,
    PERMISSIONS.INTEGRATIONS_VIEW,
    PERMISSIONS.SYNC_VIEW,
  ],
};
