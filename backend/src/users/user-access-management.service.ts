import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  acquireLastAdminGuardLock,
  assertOtherActiveAdminExists,
} from './last-admin-guard';
import { isAdminForRoleKey } from './role-admin-sync.util';
import {
  isPermissionKey,
  ROLE_KEYS,
  type RoleKey,
} from './permissions.catalog';
import { Role } from './role.entity';
import { SessionRevocationService } from './session-revocation.service';
import { User } from './user.entity';
import { UserAccessRulesService } from './user-access-rules.service';
import { UserAuditAction } from './user-audit-action.enum';
import { UserAuditService } from './user-audit.service';
import { UserPermissionOverride } from './user-permission-override.entity';
import {
  InvalidAccountScopeError,
  UserNotFoundError,
} from './users-management.errors';
import { requireRole, safeRollback } from './users-management.helpers';
import type {
  AccountScopeInput,
  OverrideInput,
  UserDetail,
} from './users-management.types';
import { UsersManagementQueryService } from './users-management-query.service';

/**
 * Mudança de papel/permissões/escopo e ativação/desativação. Toda operação
 * que pode reduzir o número de admins ativos (rebaixar, desativar) adquire
 * `acquireLastAdminGuardLock` dentro da mesma transação antes de decidir —
 * ver `last-admin-guard.ts`.
 */
@Injectable()
export class UserAccessManagementService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(UserPermissionOverride)
    private readonly overrideRepository: Repository<UserPermissionOverride>,
    private readonly sessionRevocationService: SessionRevocationService,
    private readonly accessRules: UserAccessRulesService,
    private readonly audit: UserAuditService,
    private readonly queryService: UsersManagementQueryService,
  ) {}

  async update(
    actorUserId: string,
    id: string,
    input: {
      name?: string;
      role?: RoleKey;
      overrides?: OverrideInput[];
      accountScope?: AccountScopeInput;
    },
  ): Promise<UserDetail> {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) throw new UserNotFoundError();
    const currentRole = await this.roleRepository.findOneByOrFail({
      id: user.roleId,
    });
    const currentRoleKey = currentRole.key;

    const newRoleKey = input.role ?? currentRoleKey;
    const newRole =
      input.role && input.role !== currentRoleKey
        ? await requireRole(this.roleRepository, input.role)
        : currentRole;
    const roleChanged = newRoleKey !== currentRoleKey;

    // Papel não-ADMIN, sem overrides explícitos nesta chamada: mantém os
    // existentes, mas SEMPRE re-poda contra o preset do papel EFETIVO
    // (novo, se mudou) — nunca deixa override redundante acumular quando o
    // papel muda entre ANALYST/VIEWER. ADMIN nunca aceita overrides —
    // centralizado em `UserAccessRulesService`, mesma regra do `create`.
    let overridesToPersist: OverrideInput[] | null = null;
    if (newRoleKey === ROLE_KEYS.ADMIN) {
      overridesToPersist = this.accessRules.resolveOverridesForRole(
        newRoleKey,
        input.overrides ?? [],
      );
    } else if (input.overrides) {
      overridesToPersist = this.accessRules.resolveOverridesForRole(
        newRoleKey,
        input.overrides,
      );
    } else if (roleChanged) {
      const existing = await this.overrideRepository.findBy({ userId: id });
      const asInput = existing
        .filter((row) => isPermissionKey(row.permissionKey))
        .map((row) => ({
          permissionKey: row.permissionKey,
          granted: row.granted,
        }));
      overridesToPersist = this.accessRules.resolveOverridesForRole(
        newRoleKey,
        asInput,
      );
    }

    let accountScopeToPersist: AccountScopeInput | null = null;
    if (newRoleKey === ROLE_KEYS.ADMIN) {
      this.accessRules.validateAccountScopeForRole(
        newRoleKey,
        input.accountScope ?? { mode: 'ALL' },
      );
      accountScopeToPersist = { mode: 'ALL' };
    } else if (input.accountScope) {
      this.accessRules.validateAccountScopeForRole(
        newRoleKey,
        input.accountScope,
      );
      accountScopeToPersist = input.accountScope;
    } else if (roleChanged && currentRoleKey === ROLE_KEYS.ADMIN) {
      // Rebaixando um ADMIN sem informar o novo escopo explicitamente —
      // decisão deliberada de não herdar ALL silenciosamente nem zerar
      // para NONE sem ser pedido: exige que o chamador decida.
      throw new InvalidAccountScopeError(
        'accountScope é obrigatório ao rebaixar um ADMIN',
      );
    }

    const auditEntries: Array<{
      action: UserAuditAction;
      changes: Record<string, unknown>;
    }> = [];
    if (input.name && input.name.trim() !== user.name) {
      auditEntries.push({
        action: UserAuditAction.USER_UPDATED,
        changes: { fields: ['name'] },
      });
    }
    if (roleChanged) {
      auditEntries.push({
        action: UserAuditAction.ROLE_CHANGED,
        changes: { fields: ['role'] },
      });
    } else if (overridesToPersist !== null) {
      auditEntries.push({
        action: UserAuditAction.PERMISSIONS_CHANGED,
        changes: { fields: ['overrides'] },
      });
    }
    if (accountScopeToPersist !== null && !roleChanged) {
      auditEntries.push({
        action: UserAuditAction.ACCOUNT_SCOPE_CHANGED,
        changes: { fields: ['accountScope'] },
      });
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // Só precisa do guard se ESTE usuário conta hoje como admin ativo —
      // rebaixar um admin já inativo nunca reduz o número de admins ativos.
      if (roleChanged && currentRoleKey === ROLE_KEYS.ADMIN && user.active) {
        await acquireLastAdminGuardLock(queryRunner);
        await assertOtherActiveAdminExists(queryRunner, currentRole.id, id);
      }

      const newIsAdmin = isAdminForRoleKey(newRoleKey);
      await queryRunner.query(
        `UPDATE "users" SET
           "name" = COALESCE($2, "name"),
           "role_id" = $3,
           "is_admin" = $4,
           "account_scope_mode" = COALESCE($5, "account_scope_mode"),
           "updated_at" = now()
         WHERE "id" = $1`,
        [
          id,
          input.name ? input.name.trim() : null,
          newRole.id,
          newIsAdmin,
          accountScopeToPersist?.mode ?? null,
        ],
      );

      if (overridesToPersist !== null) {
        await queryRunner.query(
          `DELETE FROM "user_permission_overrides" WHERE "user_id" = $1`,
          [id],
        );
        await this.accessRules.persistOverrides(
          queryRunner,
          id,
          overridesToPersist,
        );
      }

      if (accountScopeToPersist !== null) {
        await queryRunner.query(
          `DELETE FROM "user_account_scope" WHERE "user_id" = $1`,
          [id],
        );
        await this.accessRules.persistAccountScope(
          queryRunner,
          id,
          accountScopeToPersist,
        );
      }

      for (const entry of auditEntries) {
        await this.audit.insertAudit(queryRunner, {
          actorUserId,
          targetUserId: id,
          action: entry.action,
          changes: entry.changes,
        });
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      await safeRollback(queryRunner);
      throw error;
    } finally {
      await queryRunner.release();
    }

    return this.queryService.getById(id);
  }

  async setStatus(
    actorUserId: string,
    id: string,
    active: boolean,
  ): Promise<UserDetail> {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) throw new UserNotFoundError();
    if (user.active === active) return this.queryService.toUserDetail(user);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      if (!active && user.isAdmin) {
        await acquireLastAdminGuardLock(queryRunner);
        await assertOtherActiveAdminExists(queryRunner, user.roleId, id);
      }

      await queryRunner.query(
        `UPDATE "users" SET "active" = $2, "updated_at" = now() WHERE "id" = $1`,
        [id, active],
      );

      if (!active) {
        await this.sessionRevocationService.revokeAllActiveForUser(
          queryRunner.manager,
          id,
        );
      }

      await this.audit.insertAudit(queryRunner, {
        actorUserId,
        targetUserId: id,
        action: active
          ? UserAuditAction.USER_ACTIVATED
          : UserAuditAction.USER_DEACTIVATED,
        changes: { fields: ['active'] },
      });

      await queryRunner.commitTransaction();
    } catch (error) {
      await safeRollback(queryRunner);
      throw error;
    } finally {
      await queryRunner.release();
    }

    return this.queryService.getById(id);
  }
}
