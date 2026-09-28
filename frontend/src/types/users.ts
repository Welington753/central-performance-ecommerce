/**
 * Espelha exatamente os contratos de `backend/src/users/*` e
 * `backend/src/auth/*` (Checkpoint 3, commit b42e49c) — nunca inventar campo
 * novo aqui sem antes existir no backend.
 */

export const PERMISSION_KEYS = [
  "dashboard.view",
  "full.view",
  "customers.view",
  "customers.export",
  "customers.export_personal_data",
  "customers.manage_enrichment",
  "goals.view",
  "goals.manage",
  "integrations.view",
  "integrations.manage",
  "sync.view",
  "sync.run",
  "sync.backfill",
  "sync.full_history",
  "users.view",
  "users.manage",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const ROLE_KEYS = ["ADMIN", "ANALYST", "VIEWER"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/** Espelha `AccountScope` de `backend/src/users/account-scope.types.ts`. */
export type AccountScope =
  | { mode: "ALL" }
  | { mode: "SELECTED"; accountIds: string[] }
  | { mode: "NONE" };

export interface UserListItemDto {
  id: string;
  name: string;
  email: string;
  active: boolean;
  role: RoleKey;
  createdAt: string;
}

export interface UserOverrideDetailDto {
  permissionKey: PermissionKey;
  granted: boolean;
}

/** Espelha `UserDetail` de `backend/src/users/users-management.types.ts`. */
export interface UserDetailDto {
  id: string;
  name: string;
  email: string;
  active: boolean;
  role: RoleKey;
  isAdmin: boolean;
  permissions: PermissionKey[];
  overrides: UserOverrideDetailDto[];
  accountScope: AccountScope;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/** Espelha `AuditLogItem` — `changes` só guarda nomes de campos, nunca valores. */
export interface AuditLogItemDto {
  id: string;
  actorUserId: string;
  targetUserId: string;
  action: string;
  changes: { fields?: string[] } & Record<string, unknown>;
  createdAt: string;
}

export interface PermissionsCatalogDto {
  permissions: PermissionKey[];
  presets: Record<RoleKey, PermissionKey[]>;
}

export interface OverrideInputPayload {
  permissionKey: string;
  granted: boolean;
}

export interface AccountScopeInputPayload {
  mode: "ALL" | "SELECTED" | "NONE";
  accountIds?: string[];
}

/** Espelha `CreateUserDto`. */
export interface CreateUserPayload {
  name: string;
  email: string;
  role: RoleKey;
  overrides?: OverrideInputPayload[];
  accountScope: AccountScopeInputPayload;
}

/** Espelha `UpdateUserDto` — todo campo enviado SUBSTITUI o valor inteiro (nunca merge parcial). */
export interface UpdateUserPayload {
  name?: string;
  role?: RoleKey;
  overrides?: OverrideInputPayload[];
  accountScope?: AccountScopeInputPayload;
}

export interface ListUsersQuery {
  page?: number;
  limit?: number;
  status?: "active" | "inactive";
  role?: RoleKey;
}

export interface AuditQuery {
  page?: number;
  limit?: number;
}

export interface CreateUserResult {
  user: UserDetailDto;
  temporaryPassword: string;
}

export interface ResetPasswordResult {
  temporaryPassword: string;
}
