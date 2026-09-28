import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountScopeMode } from './account-scope-mode.enum';
import {
  ALL_PERMISSION_KEYS,
  isPermissionKey,
  ROLE_KEYS,
  ROLE_PERMISSION_PRESETS,
  type PermissionKey,
  type RoleKey,
} from './permissions.catalog';
import { Role } from './role.entity';
import { User } from './user.entity';
import { UserAccountScope } from './user-account-scope.entity';
import { UserAuditLog } from './user-audit-log.entity';
import { UserPermissionOverride } from './user-permission-override.entity';
import { UserNotFoundError } from './users-management.errors';
import type {
  AuditLogItem,
  Paginated,
  UserDetail,
  UserListItem,
  UserOverrideDetail,
} from './users-management.types';

/**
 * Leitura pura de gerenciamento de usuários (listagem, detalhe, catálogo,
 * auditoria paginada). Nenhum método aqui abre transação nem escreve dado —
 * usado tanto pelo controller (via facade) quanto internamente por
 * `UserProvisioningService`/`UserAccessManagementService` para montar o
 * `UserDetail` de retorno após uma escrita.
 */
@Injectable()
export class UsersManagementQueryService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(UserPermissionOverride)
    private readonly overrideRepository: Repository<UserPermissionOverride>,
    @InjectRepository(UserAccountScope)
    private readonly accountScopeRepository: Repository<UserAccountScope>,
    @InjectRepository(UserAuditLog)
    private readonly auditRepository: Repository<UserAuditLog>,
  ) {}

  async list(query: {
    page?: number;
    limit?: number;
    status?: 'active' | 'inactive';
    role?: RoleKey;
  }): Promise<Paginated<UserListItem>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.userRepository
      .createQueryBuilder('u')
      .innerJoin(Role, 'r', 'r.id = u.role_id')
      .select([
        'u.id AS id',
        'u.name AS name',
        'u.email AS email',
        'u.active AS active',
        'r.key AS role_key',
        'u.created_at AS created_at',
      ])
      .orderBy('u.created_at', 'DESC')
      .addOrderBy('u.id', 'DESC');

    if (query.status) {
      qb.andWhere('u.active = :active', { active: query.status === 'active' });
    }
    if (query.role) {
      qb.andWhere('r.key = :role', { role: query.role });
    }

    const total = await qb.getCount();
    const rows = await qb
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany<{
        id: string;
        name: string;
        email: string;
        active: boolean;
        role_key: RoleKey;
        created_at: Date;
      }>();

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        active: row.active,
        role: row.role_key,
        createdAt: row.created_at,
      })),
      total,
      page,
      limit,
    };
  }

  getPermissionsCatalog(): {
    permissions: PermissionKey[];
    presets: Record<RoleKey, PermissionKey[]>;
  } {
    return {
      permissions: [...ALL_PERMISSION_KEYS],
      presets: {
        ADMIN: [...ALL_PERMISSION_KEYS],
        ANALYST: [...this.presetFor('ANALYST')],
        VIEWER: [...this.presetFor('VIEWER')],
      },
    };
  }

  presetFor(role: RoleKey): readonly PermissionKey[] {
    return ROLE_PERMISSION_PRESETS[role];
  }

  async getById(id: string): Promise<UserDetail> {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) throw new UserNotFoundError();
    return this.toUserDetail(user);
  }

  async getAudit(
    targetUserId: string,
    query: { page?: number; limit?: number },
  ): Promise<Paginated<AuditLogItem>> {
    const user = await this.userRepository.findOneBy({ id: targetUserId });
    if (!user) throw new UserNotFoundError();

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [rows, total] = await this.auditRepository.findAndCount({
      where: { targetUserId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items: rows.map((row) => ({
        id: row.id,
        actorUserId: row.actorUserId,
        targetUserId: row.targetUserId,
        action: row.action,
        changes: row.changes,
        createdAt: row.createdAt,
      })),
      total,
      page,
      limit,
    };
  }

  async toUserDetail(user: User): Promise<UserDetail> {
    const role = await this.roleRepository.findOneByOrFail({ id: user.roleId });
    const roleKey = role.key;

    const overrideRows = await this.overrideRepository.findBy({
      userId: user.id,
    });
    const overrides: UserOverrideDetail[] = overrideRows
      .filter((row) => isPermissionKey(row.permissionKey))
      .map((row) => ({
        permissionKey: row.permissionKey,
        granted: row.granted,
      }));

    const permissions = this.computeEffectivePermissions(roleKey, overrides);
    const accountScope = await this.loadAccountScope(user);

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      active: user.active,
      role: roleKey,
      isAdmin: user.isAdmin,
      permissions,
      overrides,
      accountScope,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private computeEffectivePermissions(
    roleKey: RoleKey,
    overrides: UserOverrideDetail[],
  ): PermissionKey[] {
    if (roleKey === ROLE_KEYS.ADMIN) return [...ALL_PERMISSION_KEYS].sort();
    const preset = this.presetFor(roleKey);
    const permissions = new Set<PermissionKey>(preset);
    for (const override of overrides) {
      if (override.granted) permissions.add(override.permissionKey);
      else permissions.delete(override.permissionKey);
    }
    return [...permissions].sort();
  }

  private async loadAccountScope(user: User) {
    if (user.accountScopeMode === AccountScopeMode.ALL)
      return { mode: 'ALL' as const };
    if (user.accountScopeMode === AccountScopeMode.SELECTED) {
      const rows = await this.accountScopeRepository.findBy({
        userId: user.id,
      });
      return {
        mode: 'SELECTED' as const,
        accountIds: rows.map((row) => row.marketplaceAccountId).sort(),
      };
    }
    return { mode: 'NONE' as const };
  }
}
