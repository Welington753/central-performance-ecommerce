import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { DataSource, QueryRunner, Repository } from 'typeorm';
import { generateTemporaryPassword } from '../auth/temporary-password.util';
import { isAdminForRoleKey } from './role-admin-sync.util';
import { Role } from './role.entity';
import { SessionRevocationService } from './session-revocation.service';
import { User } from './user.entity';
import { UserAccessRulesService } from './user-access-rules.service';
import { UserAuditAction } from './user-audit-action.enum';
import { UserAuditService } from './user-audit.service';
import {
  CannotResetOwnPasswordError,
  UserNotFoundError,
} from './users-management.errors';
import {
  mapUniqueViolation,
  normalizeEmail,
  requireRole,
  safeRollback,
} from './users-management.helpers';
import type { CreateUserInput, UserDetail } from './users-management.types';
import { UsersManagementQueryService } from './users-management-query.service';

/**
 * Criação de usuário e geração/reset de senha temporária. Nunca loga nem
 * audita a senha em texto claro — o hash argon2 é o único valor persistido,
 * e a senha em claro só existe no retorno desta chamada.
 */
@Injectable()
export class UserProvisioningService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    private readonly sessionRevocationService: SessionRevocationService,
    private readonly accessRules: UserAccessRulesService,
    private readonly audit: UserAuditService,
    private readonly queryService: UsersManagementQueryService,
  ) {}

  async create(
    actorUserId: string,
    input: CreateUserInput,
  ): Promise<{ user: UserDetail; temporaryPassword: string }> {
    const role = await requireRole(this.roleRepository, input.role);
    const overridesToPersist = this.accessRules.resolveOverridesForRole(
      role.key,
      input.overrides ?? [],
    );
    this.accessRules.validateAccountScopeForRole(role.key, input.accountScope);

    const email = normalizeEmail(input.email);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await argon2.hash(temporaryPassword);
    const isAdmin = isAdminForRoleKey(role.key);
    const userId = randomUUID();

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await this.insertUser(queryRunner, {
        id: userId,
        name: input.name.trim(),
        email,
        passwordHash,
        roleId: role.id,
        isAdmin,
        accountScopeMode: input.accountScope.mode,
      });
      await this.accessRules.persistOverrides(
        queryRunner,
        userId,
        overridesToPersist,
      );
      await this.accessRules.persistAccountScope(
        queryRunner,
        userId,
        input.accountScope,
      );
      await this.audit.insertAudit(queryRunner, {
        actorUserId,
        targetUserId: userId,
        action: UserAuditAction.USER_CREATED,
        changes: { fields: ['name', 'email', 'role', 'accountScope'] },
      });
      await queryRunner.commitTransaction();
    } catch (error) {
      await safeRollback(queryRunner);
      throw mapUniqueViolation(error);
    } finally {
      await queryRunner.release();
    }

    const created = await this.queryService.getById(userId);
    return { user: created, temporaryPassword };
  }

  async resetPassword(
    actorUserId: string,
    id: string,
  ): Promise<{ temporaryPassword: string }> {
    if (actorUserId === id) throw new CannotResetOwnPasswordError();
    const user = await this.userRepository.findOneBy({ id });
    if (!user) throw new UserNotFoundError();

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await argon2.hash(temporaryPassword);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await queryRunner.query(
        `UPDATE "users" SET
           "password_hash" = $2,
           "must_change_password" = true,
           "updated_at" = now()
         WHERE "id" = $1`,
        [id, passwordHash],
      );
      await this.sessionRevocationService.revokeAllActiveForUser(
        queryRunner.manager,
        id,
      );
      await this.audit.insertAudit(queryRunner, {
        actorUserId,
        targetUserId: id,
        action: UserAuditAction.PASSWORD_RESET,
        changes: { fields: ['passwordHash', 'mustChangePassword'] },
      });
      await queryRunner.commitTransaction();
    } catch (error) {
      await safeRollback(queryRunner);
      throw error;
    } finally {
      await queryRunner.release();
    }

    return { temporaryPassword };
  }

  private async insertUser(
    queryRunner: QueryRunner,
    row: {
      id: string;
      name: string;
      email: string;
      passwordHash: string;
      roleId: string;
      isAdmin: boolean;
      accountScopeMode: string;
    },
  ): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "users"
         (id, name, email, password_hash, active, role_id, is_admin, account_scope_mode, must_change_password)
       VALUES ($1, $2, $3, $4, true, $5, $6, $7, true)`,
      [
        row.id,
        row.name,
        row.email,
        row.passwordHash,
        row.roleId,
        row.isAdmin,
        row.accountScopeMode,
      ],
    );
  }
}
