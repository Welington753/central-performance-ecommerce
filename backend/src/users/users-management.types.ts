import type { AccountScope } from './account-scope.types';
import type { PermissionKey, RoleKey } from './permissions.catalog';

export interface OverrideInput {
  permissionKey: string;
  granted: boolean;
}

export interface AccountScopeInput {
  mode: 'ALL' | 'SELECTED' | 'NONE';
  accountIds?: string[];
}

export interface CreateUserInput {
  name: string;
  email: string;
  role: RoleKey;
  overrides?: OverrideInput[];
  accountScope: AccountScopeInput;
}

export interface UpdateUserInput {
  name?: string;
  role?: RoleKey;
  overrides?: OverrideInput[];
  accountScope?: AccountScopeInput;
}

export interface UserListItem {
  id: string;
  name: string;
  email: string;
  active: boolean;
  role: RoleKey;
  createdAt: Date;
}

export interface UserOverrideDetail {
  permissionKey: PermissionKey;
  granted: boolean;
}

export interface UserDetail {
  id: string;
  name: string;
  email: string;
  active: boolean;
  role: RoleKey;
  isAdmin: boolean;
  permissions: PermissionKey[];
  overrides: UserOverrideDetail[];
  accountScope: AccountScope;
  mustChangePassword: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface AuditLogItem {
  id: string;
  actorUserId: string;
  targetUserId: string;
  action: string;
  changes: Record<string, unknown>;
  createdAt: Date;
}
