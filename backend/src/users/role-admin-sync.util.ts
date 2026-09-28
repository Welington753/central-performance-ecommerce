import { ROLE_KEYS, type RoleKey } from './permissions.catalog';

/**
 * Único ponto que decide `is_admin` a partir do papel — todo serviço que
 * escreve `role_id` DEVE gravar `is_admin` com o resultado desta função, na
 * MESMA transação (Checkpoint 3, compatibilidade `is_admin`). Nunca duas
 * fontes de verdade divergentes.
 */
export function isAdminForRoleKey(roleKey: RoleKey): boolean {
  return roleKey === ROLE_KEYS.ADMIN;
}
