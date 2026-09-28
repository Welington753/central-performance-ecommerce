import { ROLE_KEYS } from './permissions.catalog';
import { isAdminForRoleKey } from './role-admin-sync.util';

describe('isAdminForRoleKey', () => {
  it('ADMIN => true', () => {
    expect(isAdminForRoleKey(ROLE_KEYS.ADMIN)).toBe(true);
  });

  it('ANALYST => false', () => {
    expect(isAdminForRoleKey(ROLE_KEYS.ANALYST)).toBe(false);
  });

  it('VIEWER => false', () => {
    expect(isAdminForRoleKey(ROLE_KEYS.VIEWER)).toBe(false);
  });
});
