import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccessTokenGuard } from './guards/access-token.guard';
import { AdminGuard } from './guards/admin.guard';
import { UserSession } from './user-session.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserSession]),
    UsersModule,
    // Sem "secret" global: cada emissão/verificação de token informa o
    // secret explicitamente (via ConfigService), então nenhum valor padrão
    // inseguro é usado aqui.
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService, AccessTokenGuard, AdminGuard],
  // UsersModule reexportado: AdminGuard depende de UsersService, e
  // qualquer módulo que use `@UseGuards(AdminGuard)` (ex.:
  // MarketplaceAnalyticsModule) precisa enxergar essa dependência através
  // do próprio AuthModule — sem isto, o Nest falha ao instanciar o guard
  // fora do AuthModule ("Please make sure that UsersService is available").
  exports: [AuthService, AccessTokenGuard, AdminGuard, JwtModule, UsersModule],
})
export class AuthModule {}
