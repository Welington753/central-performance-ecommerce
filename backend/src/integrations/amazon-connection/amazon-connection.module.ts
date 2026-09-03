import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AmazonModule } from '../amazon-sp-api/amazon.module';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
import { AmazonConnectionController } from './amazon-connection.controller';
import { AmazonConnectionService } from './amazon-connection.service';

/**
 * Módulo de conexão/configuração Amazon (Checkpoint 4-C) — reaproveita
 * `AmazonModule` (`AmazonAuthService`/`AmazonSpApiClient`, já com toda a
 * autenticação/criptografia/renovação/cliente HTTP da Fase 4 e Checkpoint
 * 4-B-R1) e `MarketplaceAccountsModule` (genérico, compartilhado com o
 * Mercado Livre). Nunca importa nenhum módulo específico do Mercado Livre.
 */
@Module({
  imports: [MarketplaceAccountsModule, AmazonModule, AuthModule],
  controllers: [AmazonConnectionController],
  providers: [AmazonConnectionService],
})
export class AmazonConnectionModule {}
