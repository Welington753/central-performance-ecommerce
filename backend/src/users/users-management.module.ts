import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { MarketplaceAccount } from '../integrations/marketplace-accounts/marketplace-account.entity';
import { Role } from './role.entity';
import { RolePermission } from './role-permission.entity';
import { User } from './user.entity';
import { UserAccountScope } from './user-account-scope.entity';
import { UserAuditLog } from './user-audit-log.entity';
import { UserPermissionOverride } from './user-permission-override.entity';
import { UserAccessManagementService } from './user-access-management.service';
import { UserAccessRulesService } from './user-access-rules.service';
import { UserAuditService } from './user-audit.service';
import { UserProvisioningService } from './user-provisioning.service';
import { UsersController } from './users.controller';
import { UsersManagementQueryService } from './users-management-query.service';
import { UsersManagementService } from './users-management.service';
import { UsersModule } from './users.module';

/**
 * Camada HTTP administrativa de usuários (Checkpoint 3), separada de
 * `UsersModule` de propósito — `UsersController` precisa de
 * `AccessTokenGuard`/`PermissionGuard` (só disponíveis via `AuthModule`),
 * e `AuthModule` já importa `UsersModule`; importar `AuthModule` DE VOLTA
 * dentro de `UsersModule` criaria um ciclo. Este módulo importa os dois
 * (`AuthModule` e `UsersModule`) sem que nenhum dos dois precise saber que
 * ele existe.
 */
@Module({
  imports: [
    AuthModule,
    UsersModule,
    TypeOrmModule.forFeature([
      User,
      Role,
      RolePermission,
      UserPermissionOverride,
      UserAccountScope,
      UserAuditLog,
      MarketplaceAccount,
    ]),
  ],
  controllers: [UsersController],
  providers: [
    UsersManagementQueryService,
    UserAccessRulesService,
    UserAuditService,
    UserProvisioningService,
    UserAccessManagementService,
    UsersManagementService,
  ],
  exports: [UsersManagementService],
})
export class UsersManagementModule {}
