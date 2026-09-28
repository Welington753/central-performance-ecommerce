import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AccountScope } from './account-scope.types';
import { AccountScopeMode } from './account-scope-mode.enum';
import type { AuthorizationContext } from './authorization-context.interface';
import {
  ALL_PERMISSION_KEYS,
  isPermissionKey,
  isRoleKey,
  ROLE_KEYS,
  type PermissionKey,
} from './permissions.catalog';
import { Role } from './role.entity';
import { RolePermission } from './role-permission.entity';
import type { User } from './user.entity';
import { UserAccountScope } from './user-account-scope.entity';
import { UserPermissionOverride } from './user-permission-override.entity';
import { UsersService } from './users.service';

/**
 * Fundação de autorização (Checkpoint 2): única fonte de verdade sobre o que
 * um usuário pode fazer. Relê TUDO do banco a cada chamada (mesmo padrão já
 * usado por `AdminGuard`/`CustomerPermissionGuard` — nunca cacheia entre
 * requisições, nunca confia em nada vindo do JWT), então uma promoção,
 * rebaixamento, override ou mudança de escopo feita direto no banco vale na
 * PRÓXIMA chamada, sem exigir novo login.
 *
 * Substituirá `AdminGuard`/`CustomerPermissionGuard` num checkpoint futuro —
 * por ora coexiste com os dois sem alterá-los.
 */
@Injectable()
export class PermissionResolverService {
  constructor(
    private readonly usersService: UsersService,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(UserPermissionOverride)
    private readonly overrideRepository: Repository<UserPermissionOverride>,
    @InjectRepository(UserAccountScope)
    private readonly accountScopeRepository: Repository<UserAccountScope>,
  ) {}

  async resolve(userId: string): Promise<AuthorizationContext> {
    const user = await this.usersService.findById(userId);
    if (!user || !user.active) {
      return this.denied(userId);
    }

    const accountScope = await this.resolveAccountScope(user);
    const mustChangePassword = user.mustChangePassword;

    if (!user.roleId) {
      // Usuário sem papel: sempre negado, nunca um fallback permissivo.
      return {
        userId,
        active: true,
        roleKey: null,
        isAdmin: false,
        permissions: [],
        accountScope,
        mustChangePassword,
      };
    }

    const role = await this.roleRepository.findOneBy({ id: user.roleId });
    if (!role || !isRoleKey(role.key)) {
      // Papel órfão/desconhecido: mesmo tratamento — negado, nunca concede.
      return {
        userId,
        active: true,
        roleKey: null,
        isAdmin: false,
        permissions: [],
        accountScope,
        mustChangePassword,
      };
    }

    if (role.key === ROLE_KEYS.ADMIN) {
      // ADMIN recebe sempre o catálogo inteiro — overrides nunca são lidos
      // para este papel (positivo ou negativo, nenhum dos dois muda nada).
      return {
        userId,
        active: true,
        roleKey: role.key,
        isAdmin: true,
        permissions: [...ALL_PERMISSION_KEYS].sort(),
        accountScope,
        mustChangePassword,
      };
    }

    const permissions = await this.resolveNonAdminPermissions(
      user.roleId,
      userId,
    );
    return {
      userId,
      active: true,
      roleKey: role.key,
      isAdmin: false,
      permissions,
      accountScope,
      mustChangePassword,
    };
  }

  private async resolveNonAdminPermissions(
    roleId: string,
    userId: string,
  ): Promise<PermissionKey[]> {
    const rolePermissionRows = await this.rolePermissionRepository.findBy({
      roleId,
    });
    const permissions = new Set<PermissionKey>(
      rolePermissionRows
        .map((row) => row.permissionKey)
        .filter((key): key is PermissionKey => isPermissionKey(key)),
    );

    const overrideRows = await this.overrideRepository.findBy({ userId });
    for (const override of overrideRows) {
      if (!isPermissionKey(override.permissionKey)) continue;
      if (override.granted) {
        permissions.add(override.permissionKey);
      } else {
        permissions.delete(override.permissionKey);
      }
    }

    return [...permissions].sort();
  }

  private async resolveAccountScope(user: User): Promise<AccountScope> {
    if (user.accountScopeMode === AccountScopeMode.ALL) {
      return { mode: 'ALL' };
    }
    if (user.accountScopeMode === AccountScopeMode.SELECTED) {
      const rows = await this.accountScopeRepository.findBy({
        userId: user.id,
      });
      return {
        mode: 'SELECTED',
        accountIds: rows.map((row) => row.marketplaceAccountId).sort(),
      };
    }
    // NONE, ou qualquer valor não reconhecido: fail-closed, nunca ALL.
    return { mode: 'NONE' };
  }

  private denied(userId: string): AuthorizationContext {
    return {
      userId,
      active: false,
      roleKey: null,
      isAdmin: false,
      permissions: [],
      accountScope: { mode: 'NONE' },
      mustChangePassword: false,
    };
  }
}
