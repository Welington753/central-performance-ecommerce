import { Injectable } from '@nestjs/common';
import type { PermissionKey, RoleKey } from './permissions.catalog';
import { UserAccessManagementService } from './user-access-management.service';
import { UserProvisioningService } from './user-provisioning.service';
import { UsersManagementQueryService } from './users-management-query.service';
import type {
  AuditLogItem,
  CreateUserInput,
  Paginated,
  UserDetail,
  UserListItem,
  UpdateUserInput,
} from './users-management.types';

/**
 * Fachada pública de gerenciamento de usuários (Checkpoint 3). Controller
 * nunca acessa TypeORM diretamente — só conhece esta classe, cujo contrato
 * público é idêntico ao anterior à divisão em `UsersManagementQueryService`
 * (leitura), `UserProvisioningService` (criação/senha temporária) e
 * `UserAccessManagementService` (papel/permissões/escopo/status). Nenhuma
 * transação, lock ou regra muda — só onde o código mora.
 */
@Injectable()
export class UsersManagementService {
  constructor(
    private readonly queryService: UsersManagementQueryService,
    private readonly provisioningService: UserProvisioningService,
    private readonly accessManagementService: UserAccessManagementService,
  ) {}

  list(query: {
    page?: number;
    limit?: number;
    status?: 'active' | 'inactive';
    role?: RoleKey;
  }): Promise<Paginated<UserListItem>> {
    return this.queryService.list(query);
  }

  getPermissionsCatalog(): {
    permissions: PermissionKey[];
    presets: Record<RoleKey, PermissionKey[]>;
  } {
    return this.queryService.getPermissionsCatalog();
  }

  getById(id: string): Promise<UserDetail> {
    return this.queryService.getById(id);
  }

  getAudit(
    targetUserId: string,
    query: { page?: number; limit?: number },
  ): Promise<Paginated<AuditLogItem>> {
    return this.queryService.getAudit(targetUserId, query);
  }

  create(
    actorUserId: string,
    input: CreateUserInput,
  ): Promise<{ user: UserDetail; temporaryPassword: string }> {
    return this.provisioningService.create(actorUserId, input);
  }

  resetPassword(
    actorUserId: string,
    id: string,
  ): Promise<{ temporaryPassword: string }> {
    return this.provisioningService.resetPassword(actorUserId, id);
  }

  update(
    actorUserId: string,
    id: string,
    input: UpdateUserInput,
  ): Promise<UserDetail> {
    return this.accessManagementService.update(actorUserId, id, input);
  }

  setStatus(
    actorUserId: string,
    id: string,
    active: boolean,
  ): Promise<UserDetail> {
    return this.accessManagementService.setStatus(actorUserId, id, active);
  }
}
