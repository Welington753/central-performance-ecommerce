import type { AccountScope } from './account-scope.types';
import type { PermissionKey, RoleKey } from './permissions.catalog';

/**
 * Resultado tipado de `PermissionResolverService.resolve()` — a única fonte
 * de verdade sobre o que um usuário pode fazer nesta requisição. Calculado
 * do zero a cada chamada (nunca cacheado entre requisições — ver
 * `AuthorizationContextService`, que cacheia só DENTRO de uma mesma
 * requisição).
 *
 * `roleKey: null` cobre TODOS os casos de "acesso negado por papel"
 * (usuário sem papel, papel apontando para linha inexistente, papel com
 * `key` desconhecida) — nesses casos `permissions` vem sempre vazio e
 * `isAdmin` sempre `false`, nunca um fallback permissivo.
 */
export interface AuthorizationContext {
  userId: string;
  active: boolean;
  roleKey: RoleKey | null;
  isAdmin: boolean;
  permissions: readonly PermissionKey[];
  accountScope: AccountScope;
  mustChangePassword: boolean;
}
