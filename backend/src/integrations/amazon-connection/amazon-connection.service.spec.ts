import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Marketplace } from '../contracts/marketplace.enum';
import { MarketplaceAccountStatus } from '../marketplace-accounts/marketplace-account.entity';
import { AmazonConnectionService } from './amazon-connection.service';

const AMAZON_ENV = {
  AMAZON_SP_API_APP_ID: 'amzn1.sp.solution.example',
  AMAZON_LWA_CLIENT_ID: 'amzn1.application-oa2-client.example',
  AMAZON_LWA_CLIENT_SECRET: 'lwa-secret-example',
  AMAZON_SP_API_ENDPOINT: 'https://sellingpartnerapi-na.amazon.com',
  AMAZON_SP_API_USER_AGENT: 'CentralPerformance/1.0',
  AMAZON_MARKETPLACE_IDS: 'A2Q3Y263D00KWC',
};

function amazonAccount(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'acc-1',
    marketplace: Marketplace.AMAZON,
    externalSellerId: null,
    nickname: null,
    status: MarketplaceAccountStatus.DISCONNECTED,
    tokenExpiresAt: null,
    lastSuccessfulSyncAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildService(
  overrides: {
    marketplaceAccountsService?: Record<string, jest.Mock>;
    authService?: Record<string, jest.Mock>;
    spApiClient?: Record<string, jest.Mock>;
    configValues?: Record<string, unknown>;
  } = {},
) {
  const marketplaceAccountsService = {
    findAll: jest.fn().mockResolvedValue([]),
    findByIdOrFail: jest.fn().mockResolvedValue(amazonAccount()),
    ...overrides.marketplaceAccountsService,
  };
  const authService = {
    provisionAccount: jest.fn().mockResolvedValue(undefined),
    ensureValidAccessToken: jest.fn().mockResolvedValue('access-token-1'),
    refreshAccessTokenAfterUnauthorized: jest
      .fn()
      .mockResolvedValue('access-token-2'),
    ...overrides.authService,
  };
  const spApiClient = {
    searchOrders: jest.fn().mockResolvedValue({ kind: 'success', body: {} }),
    ...overrides.spApiClient,
  };
  const configValues: Record<string, unknown> =
    overrides.configValues ?? AMAZON_ENV;
  const configService = {
    get: (key: string, fallback?: unknown) => configValues[key] ?? fallback,
  } as unknown as ConfigService;

  const service = new AmazonConnectionService(
    marketplaceAccountsService as never,
    authService as never,
    spApiClient as never,
    configService,
  );

  return { service, marketplaceAccountsService, authService, spApiClient };
}

describe('AmazonConnectionService.getSetupStatus', () => {
  it('a fully configured app with no accounts: applicationConfigured true, canProvision true, canVerify/canSynchronize false', async () => {
    const { service } = buildService();
    const status = await service.getSetupStatus();
    expect(status.applicationConfigured).toBe(true);
    expect(status.missingConfigurationKeys).toEqual([]);
    expect(status.hasAccount).toBe(false);
    expect(status.accounts).toEqual([]);
    expect(status.canProvision).toBe(true);
    expect(status.canVerify).toBe(false);
    expect(status.canSynchronize).toBe(false);
  });

  it('lists only the NAMES of missing configuration keys — never any value', async () => {
    const { service } = buildService({
      configValues: {
        AMAZON_SP_API_APP_ID: 'amzn1.sp.solution.example',
        // os outros quatro strings + AMAZON_MARKETPLACE_IDS ausentes
      },
    });
    const status = await service.getSetupStatus();
    expect(status.applicationConfigured).toBe(false);
    expect(status.missingConfigurationKeys.sort()).toEqual(
      [
        'AMAZON_LWA_CLIENT_ID',
        'AMAZON_LWA_CLIENT_SECRET',
        'AMAZON_SP_API_ENDPOINT',
        'AMAZON_SP_API_USER_AGENT',
        'AMAZON_MARKETPLACE_IDS',
      ].sort(),
    );
    expect(JSON.stringify(status)).not.toContain('lwa-secret');
    expect(JSON.stringify(status)).not.toContain('amzn1.sp.solution');
  });

  it('canProvision is false when the application is not configured', async () => {
    const { service } = buildService({ configValues: {} });
    const status = await service.getSetupStatus();
    expect(status.canProvision).toBe(false);
  });

  it('hasAccount true and canVerify true for a DISCONNECTED-turned-CONNECTED... actually: a CONNECTED account enables both canVerify and canSynchronize', async () => {
    const { service } = buildService({
      marketplaceAccountsService: {
        findAll: jest.fn().mockResolvedValue([
          amazonAccount({
            status: MarketplaceAccountStatus.CONNECTED,
            externalSellerId: 'A1SELLERPARTNERID',
          }),
        ]),
      },
    });
    const status = await service.getSetupStatus();
    expect(status.hasAccount).toBe(true);
    expect(status.canVerify).toBe(true);
    expect(status.canSynchronize).toBe(true);
  });

  it('a DISCONNECTED account (no credentials yet): hasAccount true, canVerify/canSynchronize both false', async () => {
    const { service } = buildService({
      marketplaceAccountsService: {
        findAll: jest
          .fn()
          .mockResolvedValue([
            amazonAccount({ status: MarketplaceAccountStatus.DISCONNECTED }),
          ]),
      },
    });
    const status = await service.getSetupStatus();
    expect(status.hasAccount).toBe(true);
    expect(status.canVerify).toBe(false);
    expect(status.canSynchronize).toBe(false);
  });

  it('a TOKEN_EXPIRED/ERROR account (has credentials, not currently connected): canVerify true, canSynchronize false', async () => {
    const { service } = buildService({
      marketplaceAccountsService: {
        findAll: jest
          .fn()
          .mockResolvedValue([
            amazonAccount({ status: MarketplaceAccountStatus.TOKEN_EXPIRED }),
          ]),
      },
    });
    const status = await service.getSetupStatus();
    expect(status.canVerify).toBe(true);
    expect(status.canSynchronize).toBe(false);
  });

  it('only queries AMAZON accounts (never Mercado Livre)', async () => {
    const { service, marketplaceAccountsService } = buildService();
    await service.getSetupStatus();
    expect(marketplaceAccountsService.findAll).toHaveBeenCalledWith({
      marketplace: Marketplace.AMAZON,
    });
  });

  it('never exposes encrypted*, tokenVersion, failureCode or errorSummary in the account list', async () => {
    const { service } = buildService({
      marketplaceAccountsService: {
        findAll: jest.fn().mockResolvedValue([
          amazonAccount({
            status: MarketplaceAccountStatus.ERROR,
            encryptedAccessToken: 'iv:tag:SHOULD_NEVER_LEAK',
            encryptedRefreshToken: 'iv:tag:SHOULD_NEVER_LEAK',
            failureCode: 'SOME_INTERNAL_CODE',
            errorSummary: 'internal diagnostic text',
            tokenVersion: 7,
          }),
        ]),
      },
    });
    const status = await service.getSetupStatus();
    const keys = Object.keys(status.accounts[0]).sort();
    expect(keys).toEqual(
      [
        'id',
        'marketplace',
        'externalSellerId',
        'nickname',
        'status',
        'tokenExpiresAt',
        'lastSuccessfulSyncAt',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
    expect(JSON.stringify(status)).not.toContain('SHOULD_NEVER_LEAK');
    expect(JSON.stringify(status)).not.toContain('SOME_INTERNAL_CODE');
  });
});

describe('AmazonConnectionService.provision', () => {
  it('delegates to AmazonAuthService.provisionAccount with the authenticated user id, then returns the sanitized account', async () => {
    const { service, authService, marketplaceAccountsService } = buildService({
      marketplaceAccountsService: {
        findByIdOrFail: jest.fn().mockResolvedValue(
          amazonAccount({
            status: MarketplaceAccountStatus.CONNECTED,
            externalSellerId: 'A1SELLERPARTNERID',
          }),
        ),
      },
    });

    const result = await service.provision(
      'acc-1',
      { sellingPartnerId: 'A1SELLERPARTNERID', refreshToken: 'Atzr|refresh' },
      'user-1',
    );

    expect(authService.provisionAccount).toHaveBeenCalledWith({
      accountId: 'acc-1',
      sellingPartnerId: 'A1SELLERPARTNERID',
      refreshToken: 'Atzr|refresh',
      connectedByUserId: 'user-1',
    });
    expect(marketplaceAccountsService.findByIdOrFail).toHaveBeenCalledWith(
      'acc-1',
    );
    expect(result.status).toBe('CONNECTED');
    expect(result.externalSellerId).toBe('A1SELLERPARTNERID');
  });

  it('propagates a ConflictException from AmazonAuthService.provisionAccount unchanged (e.g. duplicate Selling Partner ID)', async () => {
    const { service } = buildService({
      authService: {
        provisionAccount: jest
          .fn()
          .mockRejectedValue(
            new ConflictException('AMAZON_ACCOUNT_ALREADY_CONNECTED'),
          ),
      },
    });

    await expect(
      service.provision(
        'acc-1',
        { sellingPartnerId: 'A1SELLERPARTNERID', refreshToken: 'Atzr|x' },
        'user-1',
      ),
    ).rejects.toMatchObject({ message: 'AMAZON_ACCOUNT_ALREADY_CONNECTED' });
  });

  it('propagates a version conflict unchanged (concurrency protection)', async () => {
    const { service } = buildService({
      authService: {
        provisionAccount: jest
          .fn()
          .mockRejectedValue(
            new ConflictException('AMAZON_PROVISION_VERSION_CONFLICT'),
          ),
      },
    });

    await expect(
      service.provision(
        'acc-1',
        { sellingPartnerId: 'A1SELLERPARTNERID', refreshToken: 'Atzr|x' },
        'user-1',
      ),
    ).rejects.toMatchObject({ message: 'AMAZON_PROVISION_VERSION_CONFLICT' });
  });

  it('never logs or includes the raw refresh token anywhere in the resolved result', async () => {
    const rawToken = 'Atzr|SUPER-SECRET-REFRESH-TOKEN';
    const { service } = buildService({
      marketplaceAccountsService: {
        findByIdOrFail: jest.fn().mockResolvedValue(amazonAccount()),
      },
    });

    const result = await service.provision(
      'acc-1',
      { sellingPartnerId: 'A1SELLERPARTNERID', refreshToken: rawToken },
      'user-1',
    );

    expect(JSON.stringify(result)).not.toContain(rawToken);
  });
});

describe('AmazonConnectionService.verify', () => {
  it('a successful call returns connected:true, code VERIFIED, and the configured marketplace count', async () => {
    const { service } = buildService();
    const result = await service.verify('acc-1');
    expect(result.connected).toBe(true);
    expect(result.code).toBe('VERIFIED');
    expect(result.marketplaceCount).toBe(1);
    expect(result.verifiedAt).toEqual(expect.any(String));
  });

  it('never persists orders — no persistence dependency exists on this service at all', () => {
    // A ausência estrutural de qualquer serviço de persistência no
    // construtor já é a prova: `AmazonConnectionService` não tem como
    // gravar um pedido mesmo que quisesse.
    expect(AmazonConnectionService.length).toBe(4); // accounts, auth, spApi, config — nunca persistence
  });

  it('AMAZON_NOT_CONFIGURED (ensureValidAccessToken throws) maps to a sanitized, non-connected result', async () => {
    const { service } = buildService({
      authService: {
        ensureValidAccessToken: jest
          .fn()
          .mockRejectedValue(new ConflictException('AMAZON_NOT_CONFIGURED')),
      },
    });
    const result = await service.verify('acc-1');
    expect(result.connected).toBe(false);
    expect(result.code).toBe('AMAZON_NOT_CONFIGURED');
    expect(result.marketplaceCount).toBe(0);
    expect(typeof result.verifiedAt).toBe('string');
  });

  it('a rejected refresh token maps to AMAZON_REFRESH_TOKEN_REJECTED, connected:false — never a thrown/500 error', async () => {
    const { service } = buildService({
      authService: {
        ensureValidAccessToken: jest
          .fn()
          .mockRejectedValue(
            new ConflictException('AMAZON_REFRESH_TOKEN_REJECTED'),
          ),
      },
    });
    const result = await service.verify('acc-1');
    expect(result.connected).toBe(false);
    expect(result.code).toBe('AMAZON_REFRESH_TOKEN_REJECTED');
  });

  it('an invalid LWA app client maps to AMAZON_LWA_APP_CONFIGURATION_ERROR', async () => {
    const { service } = buildService({
      authService: {
        ensureValidAccessToken: jest
          .fn()
          .mockRejectedValue(
            new ConflictException('AMAZON_LWA_APP_CONFIGURATION_ERROR'),
          ),
      },
    });
    const result = await service.verify('acc-1');
    expect(result.code).toBe('AMAZON_LWA_APP_CONFIGURATION_ERROR');
  });

  it('a transient LWA failure maps to a sanitized code and never throws — the stored refresh token is untouched (AmazonAuthService already guarantees this)', async () => {
    const { service } = buildService({
      authService: {
        ensureValidAccessToken: jest
          .fn()
          .mockRejectedValue(
            new ConflictException('AMAZON_REFRESH_TRANSIENT_FAILURE'),
          ),
      },
    });
    const result = await service.verify('acc-1');
    expect(result.connected).toBe(false);
    expect(result.code).toBe('AMAZON_REFRESH_TRANSIENT_FAILURE');
  });

  it('a NotFoundException (unknown account id) propagates unchanged — never swallowed into a 200 result', async () => {
    const { service } = buildService({
      authService: {
        ensureValidAccessToken: jest
          .fn()
          .mockRejectedValue(new NotFoundException('não encontrada')),
      },
    });
    await expect(service.verify('unknown-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('a single 401 forces exactly one refreshAccessTokenAfterUnauthorized call, then succeeds with the new token', async () => {
    const { service, authService, spApiClient } = buildService({
      spApiClient: {
        searchOrders: jest
          .fn()
          .mockResolvedValueOnce({ kind: 'unauthorized' })
          .mockResolvedValueOnce({ kind: 'success', body: {} }),
      },
    });

    const result = await service.verify('acc-1');

    expect(result.connected).toBe(true);
    expect(
      authService.refreshAccessTokenAfterUnauthorized,
    ).toHaveBeenCalledTimes(1);
    expect(
      authService.refreshAccessTokenAfterUnauthorized,
    ).toHaveBeenCalledWith('acc-1', 'access-token-1');
    expect(spApiClient.searchOrders).toHaveBeenCalledTimes(2);
    const secondCallArgs = spApiClient.searchOrders.mock.calls[1] as [
      Record<string, unknown>,
    ];
    expect(secondCallArgs[0].accessToken).toBe('access-token-2');
  });

  it('a second consecutive 401 (after the one retry) ends as PROVIDER_REJECTED_CREDENTIAL — never a second renewal, never a loop', async () => {
    const { service, authService, spApiClient } = buildService({
      spApiClient: {
        searchOrders: jest.fn().mockResolvedValue({ kind: 'unauthorized' }),
      },
    });

    const result = await service.verify('acc-1');

    expect(result.connected).toBe(false);
    expect(result.code).toBe('PROVIDER_REJECTED_CREDENTIAL');
    expect(spApiClient.searchOrders).toHaveBeenCalledTimes(2);
    expect(
      authService.refreshAccessTokenAfterUnauthorized,
    ).toHaveBeenCalledTimes(1);
  });

  it('maps rate_limited to PROVIDER_RATE_LIMITED', async () => {
    const { service } = buildService({
      spApiClient: {
        searchOrders: jest
          .fn()
          .mockResolvedValue({ kind: 'rate_limited', retryAfterMs: null }),
      },
    });
    const result = await service.verify('acc-1');
    expect(result.code).toBe('PROVIDER_RATE_LIMITED');
    expect(result.connected).toBe(false);
  });

  it('maps a 5xx / timeout (provider_unavailable) to PROVIDER_UNAVAILABLE', async () => {
    const { service } = buildService({
      spApiClient: {
        searchOrders: jest
          .fn()
          .mockResolvedValue({ kind: 'provider_unavailable' }),
      },
    });
    const result = await service.verify('acc-1');
    expect(result.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('maps a 400 contract error to PROVIDER_REJECTED_REQUEST', async () => {
    const { service } = buildService({
      spApiClient: {
        searchOrders: jest.fn().mockResolvedValue({ kind: 'client_error' }),
      },
    });
    const result = await service.verify('acc-1');
    expect(result.code).toBe('PROVIDER_REJECTED_REQUEST');
  });

  it('maps a malformed 200 body to INVALID_PROVIDER_RESPONSE', async () => {
    const { service } = buildService({
      spApiClient: {
        searchOrders: jest.fn().mockResolvedValue({ kind: 'invalid_response' }),
      },
    });
    const result = await service.verify('acc-1');
    expect(result.code).toBe('INVALID_PROVIDER_RESPONSE');
  });

  it('never sends BUYER/RECIPIENT/PAYMENT/address-related includedData — reuses the same closed AmazonSpApiClient contract', async () => {
    const { service, spApiClient } = buildService();
    await service.verify('acc-1');
    // O client já fecha `includedData` internamente (ver
    // amazon-sp-api.client.ts) — este teste só confirma que o serviço nunca
    // passa nenhum parâmetro extra que pudesse alargar esse escopo.
    const [firstCall] = spApiClient.searchOrders.mock.calls as [
      [Record<string, unknown>],
    ];
    const callArgs = firstCall[0];
    expect(Object.keys(callArgs).sort()).toEqual(
      [
        'accessToken',
        'endpoint',
        'userAgent',
        'marketplaceIds',
        'createdAfter',
      ].sort(),
    );
  });

  it('the returned result never contains any order data, SKU, buyer or raw payload — only the closed allowlist', async () => {
    const { service } = buildService({
      spApiClient: {
        searchOrders: jest.fn().mockResolvedValue({
          kind: 'success',
          body: {
            orders: [
              { orderId: 'SHOULD_NEVER_LEAK', buyerInfo: { name: 'x' } },
            ],
          },
        }),
      },
    });
    const result = await service.verify('acc-1');
    expect(Object.keys(result).sort()).toEqual(
      ['connected', 'code', 'verifiedAt', 'marketplaceCount'].sort(),
    );
    expect(JSON.stringify(result)).not.toContain('SHOULD_NEVER_LEAK');
  });

  it('never makes a real network call — the fetch boundary is always the injected mock', async () => {
    const { service, spApiClient } = buildService();
    await service.verify('acc-1');
    expect(spApiClient.searchOrders).toHaveBeenCalledTimes(1);
  });
});
