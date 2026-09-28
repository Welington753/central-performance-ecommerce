import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildDataSourceOptions } from '../database/typeorm-options.factory';
import { requireTestDatabaseUrl } from '../test-utils/require-test-database-url';
import { AccountScopeService } from '../users/account-scope.service';
import { PermissionResolverService } from '../users/permission-resolver.service';
import { UsersManagementModule } from '../users/users-management.module';
import { UsersManagementService } from '../users/users-management.service';
import { AuthModule } from './auth.module';
import { AuthorizationContextService } from './authorization-context.service';
import { AdminGuard } from './guards/admin.guard';
import { PermissionGuard } from './guards/permission.guard';

/**
 * Prova de wiring REAL (Postgres real, nunca mock): todo o resto dos testes
 * deste checkpoint instancia os services/guards novos diretamente (sem o
 * container do Nest), então nenhum deles pegaria um erro de
 * `@Module({ providers/exports })` esquecido — só um boot real do DI pega
 * isso. Não usa `AppModule` inteiro (evitaria puxar validação de env de
 * módulos não relacionados a este checkpoint, ex.: Amazon/Shopee) — só
 * `ConfigModule` (sem schema) + `TypeOrmModule.forRoot` (Postgres
 * descartável) + `AuthModule` (que já importa `UsersModule`).
 */
describe('Wiring de módulos — AuthModule/UsersModule resolvem os providers novos do Checkpoint 2 via DI real (Postgres real)', () => {
  it('compila o módulo e resolve PermissionResolverService, AccountScopeService, AuthorizationContextService, PermissionGuard e AdminGuard sem erro', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        TypeOrmModule.forRoot(
          buildDataSourceOptions({
            databaseUrl: requireTestDatabaseUrl(),
            nodeEnv: 'test',
          }),
        ),
        AuthModule,
        UsersManagementModule,
      ],
    }).compile();

    expect(moduleRef.get(PermissionResolverService)).toBeInstanceOf(
      PermissionResolverService,
    );
    expect(moduleRef.get(AccountScopeService)).toBeInstanceOf(
      AccountScopeService,
    );
    expect(moduleRef.get(AuthorizationContextService)).toBeInstanceOf(
      AuthorizationContextService,
    );
    expect(moduleRef.get(PermissionGuard)).toBeInstanceOf(PermissionGuard);
    // Regressão: AdminGuard continua resolvendo normalmente ao lado dos providers novos.
    expect(moduleRef.get(AdminGuard)).toBeInstanceOf(AdminGuard);
    // Checkpoint 3: UsersManagementModule (que precisa de AccessTokenGuard/
    // PermissionGuard de AuthModule) resolve sem ciclo.
    expect(moduleRef.get(UsersManagementService)).toBeInstanceOf(
      UsersManagementService,
    );

    await moduleRef.close();
  });
});
