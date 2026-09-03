import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Marketplace } from '../contracts/marketplace.enum';
import { MarketplaceAccountStatus } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import {
  toMarketplaceAccountResponse,
  type MarketplaceAccountResponseDto,
} from '../marketplace-accounts/dto/marketplace-account-response.dto';
import { loadAmazonConfig } from '../amazon-sp-api/amazon-config';
import { AmazonAuthService } from '../amazon-sp-api/amazon-auth.service';
import { AmazonSpApiClient } from '../amazon-sp-api/amazon-sp-api.client';
import { loadAmazonMarketplaceIds } from '../amazon-orders/amazon-marketplace-ids.util';
import type { ProvisionAmazonAccountDto } from './dto/provision-amazon-account.dto';
import type { AmazonSetupStatusResponseDto } from './dto/amazon-setup-status-response.dto';
import type {
  AmazonVerifyConnectionCode,
  AmazonVerifyConnectionResponseDto,
} from './dto/amazon-verify-connection-response.dto';

// Nomes das seis variáveis de ambiente esperadas — nunca seus valores (ver
// `computeMissingConfigurationKeys` abaixo, que só verifica presença).
const REQUIRED_STRING_CONFIG_KEYS = [
  'AMAZON_SP_API_APP_ID',
  'AMAZON_LWA_CLIENT_ID',
  'AMAZON_LWA_CLIENT_SECRET',
  'AMAZON_SP_API_ENDPOINT',
  'AMAZON_SP_API_USER_AGENT',
] as const;
const MARKETPLACE_IDS_CONFIG_KEY = 'AMAZON_MARKETPLACE_IDS';

// Janela mínima para a chamada de verificação (Checkpoint 4-C) — nunca
// paginada, nunca persistida, só prova que a Orders API responde para as
// credenciais fornecidas. `createdBefore` é deliberadamente omitido (nunca
// enviado): sem ele, o cutoff de 2 minutos do Checkpoint 4-B-R1 não se
// aplica, e o contrato de `SearchOrdersInput` continua satisfeito (só
// `createdAfter`, modo `created`).
const VERIFY_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * Orquestra o status de configuração e o fluxo de conexão Amazon
 * (Checkpoint 4-C) — nunca duplica autenticação, criptografia, renovação,
 * cliente HTTP ou persistência: tudo delega a `AmazonAuthService`
 * (renovação/CAS/criptografia já existentes desde a Fase 4/Checkpoint
 * 4-B-R1), `AmazonSpApiClient` (mesmo cliente HTTP do
 * `AmazonOrdersSyncService`) e `MarketplaceAccountsService` (genérico,
 * compartilhado com o Mercado Livre). Nunca importa nenhum serviço de
 * NEGÓCIO do Mercado Livre.
 */
@Injectable()
export class AmazonConnectionService {
  constructor(
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
    private readonly authService: AmazonAuthService,
    private readonly spApiClient: AmazonSpApiClient,
    private readonly configService: ConfigService,
  ) {}

  async getSetupStatus(): Promise<AmazonSetupStatusResponseDto> {
    const configResult = loadAmazonConfig(this.configService);
    const marketplaceIds = loadAmazonMarketplaceIds(this.configService);
    const applicationConfigured =
      configResult.configured && marketplaceIds !== null;

    const accounts = await this.marketplaceAccountsService.findAll({
      marketplace: Marketplace.AMAZON,
    });
    const sanitizedAccounts = accounts.map(toMarketplaceAccountResponse);
    const hasCredentials = sanitizedAccounts.some(
      (account) => account.status !== MarketplaceAccountStatus.DISCONNECTED,
    );
    const hasConnected = sanitizedAccounts.some(
      (account) => account.status === MarketplaceAccountStatus.CONNECTED,
    );

    return {
      applicationConfigured,
      missingConfigurationKeys: applicationConfigured
        ? []
        : this.computeMissingConfigurationKeys(),
      hasAccount: sanitizedAccounts.length > 0,
      accounts: sanitizedAccounts,
      canProvision: applicationConfigured,
      canVerify: applicationConfigured && hasCredentials,
      canSynchronize: applicationConfigured && hasConnected,
    };
  }

  /**
   * Só verifica PRESENÇA de cada variável — nunca lê nem devolve o valor.
   */
  private computeMissingConfigurationKeys(): string[] {
    const missing: string[] = REQUIRED_STRING_CONFIG_KEYS.filter(
      (key) => !this.configService.get<string>(key),
    );
    if (loadAmazonMarketplaceIds(this.configService) === null) {
      missing.push(MARKETPLACE_IDS_CONFIG_KEY);
    }
    return missing;
  }

  /**
   * Reaproveita `AmazonAuthService.provisionAccount` — nunca uma segunda
   * implementação de criptografia/CAS/tratamento de Selling Partner ID
   * duplicado (esses três já vivem só ali, ver seus próprios comentários).
   */
  async provision(
    accountId: string,
    dto: ProvisionAmazonAccountDto,
    connectedByUserId: string,
  ): Promise<MarketplaceAccountResponseDto> {
    await this.authService.provisionAccount({
      accountId,
      sellingPartnerId: dto.sellingPartnerId,
      refreshToken: dto.refreshToken,
      connectedByUserId,
    });
    const account =
      await this.marketplaceAccountsService.findByIdOrFail(accountId);
    return toMarketplaceAccountResponse(account);
  }

  /**
   * Chamada única, não persistente, de teste de acesso à Orders API
   * (Checkpoint 4-C). Nunca pagina, nunca chama o mapper/persistência —
   * o corpo da resposta é descartado assim que `outcome.kind` é lido.
   * Um único 401/403 força exatamente uma renovação (mesma política de
   * `AmazonOrdersSyncService`, nunca mais de uma) via
   * `refreshAccessTokenAfterUnauthorized` — nunca um loop.
   */
  async verify(accountId: string): Promise<AmazonVerifyConnectionResponseDto> {
    const verifiedAt = new Date();

    try {
      let accessToken =
        await this.authService.ensureValidAccessToken(accountId);

      const configResult = loadAmazonConfig(this.configService);
      const marketplaceIds = loadAmazonMarketplaceIds(this.configService);
      if (!configResult.configured || marketplaceIds === null) {
        return this.buildResult(false, 'AMAZON_NOT_CONFIGURED', verifiedAt, 0);
      }

      const createdAfter = new Date(
        verifiedAt.getTime() - VERIFY_LOOKBACK_MS,
      ).toISOString();

      let outcome = await this.spApiClient.searchOrders({
        accessToken,
        endpoint: configResult.config.spApiEndpoint,
        userAgent: configResult.config.userAgent,
        marketplaceIds,
        createdAfter,
      });

      if (outcome.kind === 'unauthorized') {
        accessToken =
          await this.authService.refreshAccessTokenAfterUnauthorized(
            accountId,
            accessToken,
          );
        outcome = await this.spApiClient.searchOrders({
          accessToken,
          endpoint: configResult.config.spApiEndpoint,
          userAgent: configResult.config.userAgent,
          marketplaceIds,
          createdAfter,
        });
      }

      return this.mapSearchOutcomeToResult(
        outcome.kind,
        marketplaceIds.length,
        verifiedAt,
      );
    } catch (error) {
      // Todo erro de negócio de `AmazonAuthService` é um `ConflictException`
      // cuja `.message` já É o código fechado (`super(code)`, ver a classe)
      // — nunca vazamos a instância do erro nem qualquer detalhe além dele.
      if (error instanceof ConflictException) {
        const code = error.message as AmazonVerifyConnectionCode;
        return this.buildResult(false, code, verifiedAt, 0);
      }
      throw error;
    }
  }

  private mapSearchOutcomeToResult(
    kind:
      | 'success'
      | 'endpoint_not_allowed'
      | 'unauthorized'
      | 'rate_limited'
      | 'provider_unavailable'
      | 'client_error'
      | 'invalid_response',
    marketplaceCount: number,
    verifiedAt: Date,
  ): AmazonVerifyConnectionResponseDto {
    switch (kind) {
      case 'success':
        return this.buildResult(true, 'VERIFIED', verifiedAt, marketplaceCount);
      case 'unauthorized':
        return this.buildResult(
          false,
          'PROVIDER_REJECTED_CREDENTIAL',
          verifiedAt,
          0,
        );
      case 'rate_limited':
        return this.buildResult(false, 'PROVIDER_RATE_LIMITED', verifiedAt, 0);
      case 'client_error':
        return this.buildResult(
          false,
          'PROVIDER_REJECTED_REQUEST',
          verifiedAt,
          0,
        );
      case 'invalid_response':
        return this.buildResult(
          false,
          'INVALID_PROVIDER_RESPONSE',
          verifiedAt,
          0,
        );
      case 'endpoint_not_allowed':
      case 'provider_unavailable':
      default:
        return this.buildResult(false, 'PROVIDER_UNAVAILABLE', verifiedAt, 0);
    }
  }

  private buildResult(
    connected: boolean,
    code: AmazonVerifyConnectionCode,
    verifiedAt: Date,
    marketplaceCount: number,
  ): AmazonVerifyConnectionResponseDto {
    return {
      connected,
      code,
      verifiedAt: verifiedAt.toISOString(),
      marketplaceCount,
    };
  }
}
