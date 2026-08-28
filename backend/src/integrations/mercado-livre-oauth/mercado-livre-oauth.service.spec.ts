import { ConfigService } from '@nestjs/config';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { OAuthConnectionInProgressError } from './oauth-authorization-requests.service';
import { MercadoLivreOAuthService } from './mercado-livre-oauth.service';

function account(
  overrides: Partial<MarketplaceAccount> = {},
): MarketplaceAccount {
  return {
    id: 'acc-1',
    marketplace: Marketplace.MERCADO_LIVRE,
    externalSellerId: null,
    nickname: null,
    status: MarketplaceAccountStatus.DISCONNECTED,
    errorSummary: null,
    failureCode: null,
    encryptedAccessToken: null,
    encryptedRefreshToken: null,
    encryptedCredentialMetadata: null,
    connectedByUserId: null,
    tokenVersion: 0,
    tokenExpiresAt: null,
    lastSuccessfulSyncAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function configService(): ConfigService {
  const values: Record<string, unknown> = {
    ML_CLIENT_ID: 'app-id',
    ML_REDIRECT_URI:
      'https://api.example.com/integrations/mercado-livre/callback',
  };
  return {
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('MercadoLivreOAuthService.startConnection', () => {
  it('builds an authorization URL when the account is connectable', async () => {
    const marketplaceAccountsService = {
      findByIdOrFail: jest.fn().mockResolvedValue(account()),
    };
    const authorizationRequestsService = {
      createPending: jest.fn().mockResolvedValue({
        id: 'req-1',
        state: 'state-value',
        codeChallenge: 'challenge-value',
      }),
    };

    const service = new MercadoLivreOAuthService(
      marketplaceAccountsService as never,
      authorizationRequestsService as never,
      {} as never, // AdvisoryLockService, unused by startConnection
      {} as never, // MercadoLivreHttpClient, unused by startConnection
      {} as never, // EncryptionService, unused by startConnection
      configService(),
      {} as never, // DataSource, unused by startConnection
    );

    const result = await service.startConnection({
      marketplaceAccountId: 'acc-1',
      initiatedByUserId: 'user-1',
    });

    expect(result.authorizationUrl).toContain('state=state-value');
    expect(result.authorizationUrl).toContain('code_challenge=challenge-value');
    expect(authorizationRequestsService.createPending).toHaveBeenCalledWith({
      marketplaceAccountId: 'acc-1',
      initiatedByUserId: 'user-1',
      marketplace: Marketplace.MERCADO_LIVRE,
    });
  });

  it.each([Marketplace.AMAZON, Marketplace.SHOPEE])(
    'rejects with NotFoundException when the account marketplace is %s',
    async (marketplace) => {
      const marketplaceAccountsService = {
        findByIdOrFail: jest.fn().mockResolvedValue(account({ marketplace })),
      };
      const service = new MercadoLivreOAuthService(
        marketplaceAccountsService as never,
        { createPending: jest.fn() } as never,
        {} as never,
        {} as never,
        {} as never,
        configService(),
        {} as never,
      );

      await expect(
        service.startConnection({
          marketplaceAccountId: 'acc-1',
          initiatedByUserId: 'u',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    },
  );

  it('maps OAuthConnectionInProgressError to a 409 ConflictException', async () => {
    const marketplaceAccountsService = {
      findByIdOrFail: jest.fn().mockResolvedValue(account()),
    };
    const authorizationRequestsService = {
      createPending: jest
        .fn()
        .mockRejectedValue(new OAuthConnectionInProgressError()),
    };
    const service = new MercadoLivreOAuthService(
      marketplaceAccountsService as never,
      authorizationRequestsService as never,
      {} as never,
      {} as never,
      {} as never,
      configService(),
      {} as never,
    );

    await expect(
      service.startConnection({
        marketplaceAccountId: 'acc-1',
        initiatedByUserId: 'u',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
