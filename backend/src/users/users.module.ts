import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountScopeService } from './account-scope.service';
import { PermissionResolverService } from './permission-resolver.service';
import { Role } from './role.entity';
import { RolePermission } from './role-permission.entity';
import { SessionRevocationService } from './session-revocation.service';
import { User } from './user.entity';
import { UserAccountScope } from './user-account-scope.entity';
import { UserPermissionOverride } from './user-permission-override.entity';
import { UsersService } from './users.service';

/**
 * Módulo "núcleo" de usuários (Checkpoints 1/2) — `AuthModule` já importa
 * este módulo. `UsersController`/`UsersManagementService` (Checkpoint 3)
 * vivem em `UsersManagementModule` à parte, exatamente para não criar um
 * ciclo: o controller precisa de `AccessTokenGuard`/`PermissionGuard`
 * (exportados por `AuthModule`), e `AuthModule` não pode importar de volta
 * um módulo que já o importa.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Role,
      RolePermission,
      UserPermissionOverride,
      UserAccountScope,
    ]),
  ],
  providers: [
    UsersService,
    PermissionResolverService,
    AccountScopeService,
    SessionRevocationService,
  ],
  exports: [
    UsersService,
    PermissionResolverService,
    AccountScopeService,
    SessionRevocationService,
  ],
})
export class UsersModule {}
