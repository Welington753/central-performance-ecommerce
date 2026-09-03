import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { Marketplace } from '../contracts/marketplace.enum';
import { MarketplaceAccountStatus } from '../marketplace-accounts/marketplace-account.entity';
import { AmazonAuthService } from './amazon-auth.service';

const ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes em hex

function buildEncryptionService(): EncryptionService {
  const configService = {
    get: (key: string) =>
      key === 'CREDENTIAL_ENCRYPTION_KEY' ? ENCRYPTION_KEY : undefined,
  } as unknown as ConfigService;
  return new EncryptionService(configService);
}

const AMAZON_ENV = {
  AMAZON_SP_API_APP_ID: 'amzn1.sp.solution.example',
  AMAZON_LWA_CLIENT_ID: 'amzn1.application-oa2-client.example',
  AMAZON_LWA_CLIENT_SECRET: 'lwa-secret-example',
  AMAZON_SP_API_ENDPOINT: 'https://sellingpartnerapi-na.amazon.com',
  AMAZON_SP_API_USER_AGENT: 'CentralPerformance/1.0 (Language=TypeScript)',
};

function buildConfigService(values: Record<string, unknown> = AMAZON_ENV) {
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

function firstCallFirstArg<T>(mockFn: jest.Mock): T {
  const calls = mockFn.mock.calls as unknown[][];
  return calls[0][0] as T;
}

function simpleLock() {
  return { release: jest.fn().mockResolvedValue(undefined) };
}

function amazonAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acc-amazon-1',
    marketplace: Marketplace.AMAZON,
    externalSellerId: 'A1SELLERPARTNERID',
    nickname: null,
    status: MarketplaceAccountStatus.CONNECTED,
    encryptedAccessToken: null,
    encryptedRefreshToken: null,
    encryptedCredentialMetadata: null,
    tokenExpiresAt: null,
    lastSuccessfulSyncAt: null,
    errorSummary: null,
    failureCode: null,
    connectedByUserId: null,
    tokenVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildService(
  overrides: {
    marketplaceAccountsService?: Record<string, jest.Mock>;
    advisoryLockService?: Record<string, jest.Mock>;
    lwaClient?: Record<string, jest.Mock>;
    configValues?: Record<string, unknown>;
    encryptionService?: EncryptionService;
  } = {},
) {
  const marketplaceAccountsService = {
    findByIdOrFail: jest.fn(),
    markError: jest.fn().mockResolvedValue(true),
    markTokenExpired: jest.fn().mockResolvedValue(true),
    applyRefreshedTokens: jest.fn().mockResolvedValue(true),
    provisionCredentials: jest.fn().mockResolvedValue('applied'),
    ...overrides.marketplaceAccountsService,
  };
  const advisoryLockService = {
    tryAcquire: jest.fn().mockResolvedValue(simpleLock()),
    ...overrides.advisoryLockService,
  };
  const lwaClient = {
    refreshAccessToken: jest.fn(),
    ...overrides.lwaClient,
  };
  const encryptionService =
    overrides.encryptionService ?? buildEncryptionService();
  const configService = buildConfigService(
    overrides.configValues ?? AMAZON_ENV,
  );

  const service = new AmazonAuthService(
    marketplaceAccountsService as never,
    advisoryLockService as never,
    lwaClient as never,
    encryptionService,
    configService,
  );

  return {
    service,
    marketplaceAccountsService,
    advisoryLockService,
    lwaClient,
    encryptionService,
  };
}

describe('AmazonAuthService.ensureValidAccessToken', () => {
  it('rejects a Mercado Livre account with a closed error — regardless of Amazon configuration or eligibility', async () => {
    const { service, marketplaceAccountsService, lwaClient } = buildService();
    marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      amazonAccount({ marketplace: Marketplace.MERCADO_LIVRE }),
    );

    await expect(service.ensureValidAccessToken('acc-1')).rejects.toMatchObject(
      { message: 'AMAZON_ACCOUNT_MARKETPLACE_MISMATCH' },
    );
    expect(lwaClient.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('returns AMAZON_NOT_CONFIGURED when any Amazon env var is missing, for an otherwise valid Amazon account', async () => {
    const { service, marketplaceAccountsService, lwaClient } = buildService({
      configValues: {},
    });
    marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      amazonAccount({
        status: MarketplaceAccountStatus.CONNECTED,
        encryptedRefreshToken: 'iv:tag:refresh',
        encryptedAccessToken: 'iv:tag:access',
        tokenExpiresAt: new Date(Date.now() - 1000),
      }),
    );

    await expect(service.ensureValidAccessToken('acc-1')).rejects.toMatchObject(
      { message: 'AMAZON_NOT_CONFIGURED' },
    );
    expect(lwaClient.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('rejects an ineligible Amazon account (no refresh token stored / not CONNECTED)', async () => {
    const { service, marketplaceAccountsService } = buildService();
    marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      amazonAccount({ status: MarketplaceAccountStatus.DISCONNECTED }),
    );

    await expect(service.ensureValidAccessToken('acc-1')).rejects.toMatchObject(
      { message: 'AMAZON_ACCOUNT_NOT_ELIGIBLE_FOR_TOKEN' },
    );
  });

  it('reuses a still-valid access token (outside the leeway window) without acquiring the lock or calling LWA', async () => {
    const encryptionService = buildEncryptionService();
    const {
      service,
      marketplaceAccountsService,
      advisoryLockService,
      lwaClient,
    } = buildService({ encryptionService });

    marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      amazonAccount({
        encryptedRefreshToken: 'iv:tag:refresh',
        encryptedAccessToken: encryptionService.encrypt(
          'still-valid-access-token',
        ),
        tokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60), // 1h no futuro
      }),
    );

    const token = await service.ensureValidAccessToken('acc-1');

    expect(token).toBe('still-valid-access-token');
    expect(advisoryLockService.tryAcquire).not.toHaveBeenCalled();
    expect(lwaClient.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('decrypts the refresh token only internally: it is passed to the LWA client but never appears in the returned access token or in any thrown error', async () => {
    const encryptionService = buildEncryptionService();
    const rawRefreshToken = 'Atzr|SUPER-SECRET-REFRESH-TOKEN';
    const { service, marketplaceAccountsService, lwaClient } = buildService({
      encryptionService,
    });

    marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      amazonAccount({
        encryptedRefreshToken: encryptionService.encrypt(rawRefreshToken),
        encryptedAccessToken: null,
        tokenExpiresAt: null,
      }),
    );
    lwaClient.refreshAccessToken.mockResolvedValue({
      kind: 'success',
      token: {
        accessToken: 'new-access-token',
        tokenType: 'bearer',
        expiresInSeconds: 3600,
      },
    });

    const token = await service.ensureValidAccessToken('acc-1');

    expect(lwaClient.refreshAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: rawRefreshToken }),
    );
    expect(token).toBe('new-access-token');
    expect(token).not.toContain(rawRefreshToken);
  });

  it('a valid LWA response produces an access token and persists an expiry via applyRefreshedTokens', async () => {
    const encryptionService = buildEncryptionService();
    const { service, marketplaceAccountsService, lwaClient } = buildService({
      encryptionService,
    });

    marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      amazonAccount({
        encryptedRefreshToken: encryptionService.encrypt('refresh-token'),
        encryptedAccessToken: null,
        tokenExpiresAt: null,
        tokenVersion: 7,
      }),
    );
    lwaClient.refreshAccessToken.mockResolvedValue({
      kind: 'success',
      token: {
        accessToken: 'new-access-token',
        tokenType: 'bearer',
        expiresInSeconds: 3600,
      },
    });

    const before = Date.now();
    const token = await service.ensureValidAccessToken('acc-1');
    const after = Date.now();

    expect(token).toBe('new-access-token');
    expect(
      marketplaceAccountsService.applyRefreshedTokens,
    ).toHaveBeenCalledTimes(1);
    const call = firstCallFirstArg<{
      expectedTokenVersion: number;
      encryptedAccessToken: string;
      tokenExpiresAt: Date;
    }>(marketplaceAccountsService.applyRefreshedTokens);
    expect(call.expectedTokenVersion).toBe(7);
    expect(encryptionService.decrypt(call.encryptedAccessToken)).toBe(
      'new-access-token',
    );
    expect(call.tokenExpiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 3600 * 1000,
    );
    expect(call.tokenExpiresAt.getTime()).toBeLessThanOrEqual(
      after + 3600 * 1000,
    );
  });

  it('a malformed LWA response never overwrites the stored refresh token (transient/ambiguous failure)', async () => {
    const encryptionService = buildEncryptionService();
    const { service, marketplaceAccountsService, lwaClient } = buildService({
      encryptionService,
    });

    marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      amazonAccount({
        encryptedRefreshToken: encryptionService.encrypt('refresh-token'),
        encryptedAccessToken: null,
        tokenExpiresAt: null,
      }),
    );
    lwaClient.refreshAccessToken.mockResolvedValue({
      kind: 'invalid_response',
    });

    await expect(service.ensureValidAccessToken('acc-1')).rejects.toMatchObject(
      { message: 'AMAZON_REFRESH_TRANSIENT_FAILURE' },
    );
    expect(
      marketplaceAccountsService.applyRefreshedTokens,
    ).not.toHaveBeenCalled();
    expect(marketplaceAccountsService.markError).not.toHaveBeenCalled();
    expect(marketplaceAccountsService.markTokenExpired).not.toHaveBeenCalled();
  });

  it('invalid_grant leads to TOKEN_EXPIRED (markTokenExpired), never ERROR', async () => {
    const encryptionService = buildEncryptionService();
    const { service, marketplaceAccountsService, lwaClient } = buildService({
      encryptionService,
    });

    marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      amazonAccount({
        encryptedRefreshToken: encryptionService.encrypt('refresh-token'),
        encryptedAccessToken: null,
        tokenExpiresAt: null,
        tokenVersion: 2,
      }),
    );
    lwaClient.refreshAccessToken.mockResolvedValue({ kind: 'invalid_grant' });

    await expect(service.ensureValidAccessToken('acc-1')).rejects.toMatchObject(
      { message: 'AMAZON_REFRESH_TOKEN_REJECTED' },
    );
    expect(marketplaceAccountsService.markTokenExpired).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'acc-1',
        expectedTokenVersion: 2,
        failureCode: 'AMAZON_REFRESH_TOKEN_REJECTED',
      }),
    );
    expect(marketplaceAccountsService.markError).not.toHaveBeenCalled();
  });

  it('a persistent app-configuration error (invalid_client) leads to ERROR, never TOKEN_EXPIRED, and never destroys the refresh token', async () => {
    const encryptionService = buildEncryptionService();
    const { service, marketplaceAccountsService, lwaClient } = buildService({
      encryptionService,
    });

    marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      amazonAccount({
        encryptedRefreshToken: encryptionService.encrypt('refresh-token'),
        encryptedAccessToken: null,
        tokenExpiresAt: null,
      }),
    );
    lwaClient.refreshAccessToken.mockResolvedValue({
      kind: 'client_configuration_error',
    });

    await expect(service.ensureValidAccessToken('acc-1')).rejects.toMatchObject(
      { message: 'AMAZON_LWA_APP_CONFIGURATION_ERROR' },
    );
    expect(marketplaceAccountsService.markError).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: 'AMAZON_LWA_APP_CONFIGURATION_ERROR',
      }),
    );
    expect(marketplaceAccountsService.markTokenExpired).not.toHaveBeenCalled();
  });

  it.each(['rate_limited', 'provider_unavailable', 'unknown_result'])(
    'HTTP 429/5xx/timeout (%s) never erases the refresh token — no account write happens',
    async (kind) => {
      const encryptionService = buildEncryptionService();
      const { service, marketplaceAccountsService, lwaClient } = buildService({
        encryptionService,
      });

      marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
        amazonAccount({
          encryptedRefreshToken: encryptionService.encrypt('refresh-token'),
          encryptedAccessToken: null,
          tokenExpiresAt: null,
        }),
      );
      lwaClient.refreshAccessToken.mockResolvedValue({ kind });

      await expect(
        service.ensureValidAccessToken('acc-1'),
      ).rejects.toMatchObject({ message: 'AMAZON_REFRESH_TRANSIENT_FAILURE' });
      expect(
        marketplaceAccountsService.applyRefreshedTokens,
      ).not.toHaveBeenCalled();
      expect(marketplaceAccountsService.markError).not.toHaveBeenCalled();
      expect(
        marketplaceAccountsService.markTokenExpired,
      ).not.toHaveBeenCalled();
    },
  );

  it('a stale CAS result (tokenVersion already advanced by a newer write) never overwrites — throws AMAZON_REFRESH_RESULT_NOT_COMMITTED and re-reads real current state', async () => {
    const encryptionService = buildEncryptionService();
    const { service, marketplaceAccountsService, lwaClient } = buildService({
      encryptionService,
    });

    const staleAccount = amazonAccount({
      encryptedRefreshToken: encryptionService.encrypt('refresh-token'),
      encryptedAccessToken: null,
      tokenExpiresAt: null,
      tokenVersion: 1,
    });
    const currentAccount = amazonAccount({
      status: MarketplaceAccountStatus.CONNECTED,
      tokenVersion: 5,
    });

    marketplaceAccountsService.findByIdOrFail
      .mockResolvedValueOnce(staleAccount) // leitura inicial
      .mockResolvedValueOnce(staleAccount) // releitura pós-lock
      .mockResolvedValueOnce(currentAccount); // releitura após CAS falhar
    marketplaceAccountsService.applyRefreshedTokens.mockResolvedValue(false);
    lwaClient.refreshAccessToken.mockResolvedValue({
      kind: 'success',
      token: {
        accessToken: 'new-access-token',
        tokenType: 'bearer',
        expiresInSeconds: 3600,
      },
    });

    await expect(service.ensureValidAccessToken('acc-1')).rejects.toMatchObject(
      { message: 'AMAZON_REFRESH_RESULT_NOT_COMMITTED' },
    );
    expect(marketplaceAccountsService.findByIdOrFail).toHaveBeenCalledTimes(3);
  });

  it('two concurrent renewals make exactly one effective LWA call (the second reuses the token refreshed while it waited for the lock)', async () => {
    const encryptionService = buildEncryptionService();

    // Estado compartilhado simulando a linha real no Postgres.
    let state = {
      encryptedRefreshToken: encryptionService.encrypt('refresh-token'),
      encryptedAccessToken: null as string | null,
      tokenExpiresAt: null as Date | null,
      tokenVersion: 0,
    };

    const marketplaceAccountsService = {
      findByIdOrFail: jest
        .fn()
        .mockImplementation(() => Promise.resolve(amazonAccount({ ...state }))),
      markError: jest.fn().mockResolvedValue(true),
      markTokenExpired: jest.fn().mockResolvedValue(true),
      applyRefreshedTokens: jest
        .fn()
        .mockImplementation(
          (input: {
            encryptedRefreshToken: string;
            encryptedAccessToken: string;
            tokenExpiresAt: Date;
          }) => {
            state = {
              encryptedRefreshToken: input.encryptedRefreshToken,
              encryptedAccessToken: input.encryptedAccessToken,
              tokenExpiresAt: input.tokenExpiresAt,
              tokenVersion: state.tokenVersion + 1,
            };
            return Promise.resolve(true);
          },
        ),
      provisionCredentials: jest.fn(),
    };

    // Mutex real (em memória) que serializa tryAcquire — modela o
    // comportamento de bloqueio do advisory lock do Postgres sem precisar de
    // um banco real neste teste unitário.
    let locked = false;
    const waiters: Array<() => void> = [];
    const advisoryLockService = {
      tryAcquire: jest.fn().mockImplementation(async () => {
        while (locked) {
          await new Promise<void>((resolve) => waiters.push(resolve));
        }
        locked = true;
        return {
          release: () => {
            locked = false;
            const next = waiters.shift();
            if (next) next();
            return Promise.resolve();
          },
        };
      }),
    };

    const lwaClient = {
      refreshAccessToken: jest.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          kind: 'success',
          token: {
            accessToken: 'new-access-token',
            tokenType: 'bearer',
            expiresInSeconds: 3600,
          },
        };
      }),
    };

    const service = new AmazonAuthService(
      marketplaceAccountsService as never,
      advisoryLockService as never,
      lwaClient as never,
      encryptionService,
      buildConfigService(),
    );

    const [tokenA, tokenB] = await Promise.all([
      service.ensureValidAccessToken('acc-1'),
      service.ensureValidAccessToken('acc-1'),
    ]);

    expect(tokenA).toBe('new-access-token');
    expect(tokenB).toBe('new-access-token');
    expect(lwaClient.refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it('no token appears in any thrown error message or in the errorSummary/failureCode written on failure', async () => {
    const encryptionService = buildEncryptionService();
    const rawRefreshToken = 'Atzr|SUPER-SECRET-REFRESH-TOKEN';
    const { service, marketplaceAccountsService, lwaClient } = buildService({
      encryptionService,
    });

    marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      amazonAccount({
        encryptedRefreshToken: encryptionService.encrypt(rawRefreshToken),
        encryptedAccessToken: null,
        tokenExpiresAt: null,
      }),
    );
    lwaClient.refreshAccessToken.mockResolvedValue({ kind: 'invalid_grant' });

    let caught: unknown;
    try {
      await service.ensureValidAccessToken('acc-1');
    } catch (error) {
      caught = error;
    }

    expect(JSON.stringify(caught)).not.toContain(rawRefreshToken);
    const markTokenExpiredArgs = JSON.stringify(
      marketplaceAccountsService.markTokenExpired.mock.calls[0],
    );
    expect(markTokenExpiredArgs).not.toContain(rawRefreshToken);
  });
});

describe('AmazonAuthService.refreshAccessTokenAfterUnauthorized', () => {
  it('forces a fresh LWA call even when tokenExpiresAt is still valid/in the future — a stored token can be locally "valid" yet already revoked server-side', async () => {
    const encryptionService = buildEncryptionService();
    const { service, marketplaceAccountsService, lwaClient } = buildService({
      encryptionService,
    });

    const rejectedAccessToken = encryptionService.encrypt('rejected-token');
    marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      amazonAccount({
        encryptedRefreshToken: encryptionService.encrypt('refresh-token'),
        encryptedAccessToken: rejectedAccessToken,
        tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h no futuro
        tokenVersion: 3,
      }),
    );
    lwaClient.refreshAccessToken.mockResolvedValue({
      kind: 'success',
      token: {
        accessToken: 'brand-new-access-token',
        tokenType: 'bearer',
        expiresInSeconds: 3600,
      },
    });

    const token = await service.refreshAccessTokenAfterUnauthorized(
      'acc-1',
      'rejected-token',
    );

    expect(token).toBe('brand-new-access-token');
    expect(lwaClient.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(
      marketplaceAccountsService.applyRefreshedTokens,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ expectedTokenVersion: 3 }),
    );
  });

  it('reuses the already-refreshed token without a new LWA call when a concurrent renewal already replaced the rejected token', async () => {
    const encryptionService = buildEncryptionService();
    const { service, marketplaceAccountsService, lwaClient } = buildService({
      encryptionService,
    });

    marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      amazonAccount({
        encryptedRefreshToken: encryptionService.encrypt('refresh-token'),
        encryptedAccessToken: encryptionService.encrypt('already-newer-token'),
        tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      }),
    );

    const token = await service.refreshAccessTokenAfterUnauthorized(
      'acc-1',
      'old-rejected-token',
    );

    expect(token).toBe('already-newer-token');
    expect(lwaClient.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('a second consecutive call with the SAME (still-current) rejected token forces exactly one more LWA call — never loops, never reuses across two real rejections', async () => {
    const encryptionService = buildEncryptionService();
    const { service, marketplaceAccountsService, lwaClient } = buildService({
      encryptionService,
    });

    marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      amazonAccount({
        encryptedRefreshToken: encryptionService.encrypt('refresh-token'),
        encryptedAccessToken: encryptionService.encrypt('rejected-again'),
        tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      }),
    );
    lwaClient.refreshAccessToken.mockResolvedValue({
      kind: 'success',
      token: {
        accessToken: 'yet-another-new-token',
        tokenType: 'bearer',
        expiresInSeconds: 3600,
      },
    });

    const token = await service.refreshAccessTokenAfterUnauthorized(
      'acc-1',
      'rejected-again',
    );

    expect(token).toBe('yet-another-new-token');
    expect(lwaClient.refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it('acquires the advisory lock and rereads the account before deciding', async () => {
    const encryptionService = buildEncryptionService();
    const { service, marketplaceAccountsService, advisoryLockService } =
      buildService({ encryptionService });

    marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      amazonAccount({
        encryptedRefreshToken: encryptionService.encrypt('refresh-token'),
        encryptedAccessToken: encryptionService.encrypt('already-newer-token'),
        tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      }),
    );

    await service.refreshAccessTokenAfterUnauthorized('acc-1', 'rejected');

    expect(advisoryLockService.tryAcquire).toHaveBeenCalledWith('acc-1');
    // Uma leitura inicial (fora do lock) + uma releitura pós-lock.
    expect(marketplaceAccountsService.findByIdOrFail).toHaveBeenCalledTimes(2);
  });

  it('never logs, returns, or serializes the rejected access token anywhere, even on failure', async () => {
    const encryptionService = buildEncryptionService();
    const rejectedPlainToken = 'Atza|SUPER-SECRET-REJECTED-ACCESS-TOKEN';
    const { service, marketplaceAccountsService, lwaClient } = buildService({
      encryptionService,
    });

    marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      amazonAccount({
        encryptedRefreshToken: encryptionService.encrypt('refresh-token'),
        encryptedAccessToken: encryptionService.encrypt(rejectedPlainToken),
        tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      }),
    );
    lwaClient.refreshAccessToken.mockResolvedValue({ kind: 'invalid_grant' });

    let caught: unknown;
    try {
      await service.refreshAccessTokenAfterUnauthorized(
        'acc-1',
        rejectedPlainToken,
      );
    } catch (error) {
      caught = error;
    }

    expect(JSON.stringify(caught)).not.toContain(rejectedPlainToken);
    expect(
      JSON.stringify(marketplaceAccountsService.markTokenExpired.mock.calls),
    ).not.toContain(rejectedPlainToken);
  });
});

describe('AmazonAuthService.provisionAccount', () => {
  it('rejects a Mercado Livre account with a closed error', async () => {
    const { service, marketplaceAccountsService } = buildService();
    marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      amazonAccount({ marketplace: Marketplace.MERCADO_LIVRE }),
    );

    await expect(
      service.provisionAccount({
        accountId: 'acc-1',
        sellingPartnerId: 'A1SELLERPARTNERID',
        refreshToken: 'Atzr|refresh',
      }),
    ).rejects.toMatchObject({ message: 'AMAZON_ACCOUNT_MARKETPLACE_MISMATCH' });
    expect(
      marketplaceAccountsService.provisionCredentials,
    ).not.toHaveBeenCalled();
  });

  it('encrypts the refresh token before storing it, and never stores/logs it in plain text', async () => {
    const encryptionService = buildEncryptionService();
    const { service, marketplaceAccountsService } = buildService({
      encryptionService,
    });
    marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      amazonAccount({ id: 'acc-1', tokenVersion: 4 }),
    );
    const rawRefreshToken = 'Atzr|SUPER-SECRET-REFRESH-TOKEN';

    await service.provisionAccount({
      accountId: 'acc-1',
      sellingPartnerId: 'A1SELLERPARTNERID',
      refreshToken: rawRefreshToken,
    });

    expect(
      marketplaceAccountsService.provisionCredentials,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'acc-1',
        expectedTokenVersion: 4,
        externalSellerId: 'A1SELLERPARTNERID',
        connectedByUserId: null,
      }),
    );
    const storedEncrypted = firstCallFirstArg<{
      encryptedRefreshToken: string;
    }>(marketplaceAccountsService.provisionCredentials).encryptedRefreshToken;
    expect(storedEncrypted).not.toBe(rawRefreshToken);
    expect(storedEncrypted).not.toContain(rawRefreshToken);
    expect(encryptionService.decrypt(storedEncrypted)).toBe(rawRefreshToken);
  });

  it('passes an explicit connectedByUserId through to provisionCredentials (Checkpoint 4-C: attributed to the authenticated user calling the controller)', async () => {
    const { service, marketplaceAccountsService } = buildService();
    marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      amazonAccount({ id: 'acc-1', tokenVersion: 1 }),
    );

    await service.provisionAccount({
      accountId: 'acc-1',
      sellingPartnerId: 'A1SELLERPARTNERID',
      refreshToken: 'Atzr|refresh',
      connectedByUserId: 'user-42',
    });

    expect(
      marketplaceAccountsService.provisionCredentials,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ connectedByUserId: 'user-42' }),
    );
  });

  it('maps external_seller_conflict to AMAZON_ACCOUNT_ALREADY_CONNECTED', async () => {
    const { service, marketplaceAccountsService } = buildService({
      marketplaceAccountsService: {
        provisionCredentials: jest
          .fn()
          .mockResolvedValue('external_seller_conflict'),
      },
    });
    marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      amazonAccount(),
    );

    await expect(
      service.provisionAccount({
        accountId: 'acc-1',
        sellingPartnerId: 'A1SELLERPARTNERID',
        refreshToken: 'Atzr|refresh',
      }),
    ).rejects.toMatchObject({ message: 'AMAZON_ACCOUNT_ALREADY_CONNECTED' });
  });

  it('maps version_conflict to AMAZON_PROVISION_VERSION_CONFLICT', async () => {
    const { service, marketplaceAccountsService } = buildService({
      marketplaceAccountsService: {
        provisionCredentials: jest.fn().mockResolvedValue('version_conflict'),
      },
    });
    marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      amazonAccount(),
    );

    await expect(
      service.provisionAccount({
        accountId: 'acc-1',
        sellingPartnerId: 'A1SELLERPARTNERID',
        refreshToken: 'Atzr|refresh',
      }),
    ).rejects.toMatchObject({ message: 'AMAZON_PROVISION_VERSION_CONFLICT' });
  });
});
