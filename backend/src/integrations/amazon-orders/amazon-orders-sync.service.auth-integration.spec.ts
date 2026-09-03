import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { Marketplace } from '../contracts/marketplace.enum';
import { MarketplaceAccountStatus } from '../marketplace-accounts/marketplace-account.entity';
import { AmazonAuthService } from '../amazon-sp-api/amazon-auth.service';
import { AmazonOrdersSyncService } from './amazon-orders-sync.service';

/**
 * Teste de integração REAL entre `AmazonOrdersSyncService` e
 * `AmazonAuthService` (Checkpoint 4-B-R1, "Correção 6") — só a fronteira
 * LWA/SP-API é mockada; `AmazonAuthService` é uma instância de verdade, não
 * um mock de `ensureValidAccessToken`/`refreshAccessTokenAfterUnauthorized`.
 * Prova o cenário exato exigido: um token armazenado ainda VÁLIDO
 * localmente (`tokenExpiresAt` no futuro) que a SP-API rejeita com 401
 * mesmo assim — a renovação precisa ser FORÇADA (nunca reaproveitar o
 * mesmo token por causa do leeway local), a LWA chamada exatamente uma vez,
 * e a segunda chamada SP-API usar o token novo.
 */

const ENCRYPTION_KEY = 'a'.repeat(64);

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
  AMAZON_SP_API_USER_AGENT: 'CentralPerformance/1.0',
  AMAZON_MARKETPLACE_IDS: 'A2Q3Y263D00KWC',
};

function buildConfigService(values: Record<string, unknown> = AMAZON_ENV) {
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

function successPage(orders: unknown[] = [], nextToken: string | null = null) {
  return {
    kind: 'success' as const,
    body: { orders, pagination: { nextToken } },
  };
}

describe('AmazonOrdersSyncService + real AmazonAuthService — forced renewal after 401 (Correção 6)', () => {
  function buildHarness() {
    const encryptionService = buildEncryptionService();

    // Estado da "conta" compartilhado entre os fakes — modela a linha real
    // do Postgres, mas em memória (o foco deste teste é a orquestração
    // auth <-> sync, não a persistência, que já tem cobertura própria em
    // Postgres real).
    let state: {
      encryptedAccessToken: string | null;
      encryptedRefreshToken: string;
      tokenExpiresAt: Date | null;
      tokenVersion: number;
    } = {
      encryptedAccessToken: encryptionService.encrypt('old-access-token'),
      encryptedRefreshToken: encryptionService.encrypt('refresh-token'),
      // Token LOCALMENTE válido por 1h — o cenário exigido é exatamente
      // este: mesmo com leeway/expiração local no futuro, um 401 real da
      // SP-API precisa forçar a renovação.
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      tokenVersion: 1,
    };

    const amazonAccount = () => ({
      id: 'acc-amazon-1',
      marketplace: Marketplace.AMAZON,
      externalSellerId: 'A1SELLERPARTNERID',
      nickname: null,
      status: MarketplaceAccountStatus.CONNECTED,
      errorSummary: null,
      failureCode: null,
      connectedByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSuccessfulSyncAt: null,
      ...state,
    });

    const marketplaceAccountsService = {
      findByIdOrFail: jest
        .fn()
        .mockImplementation(() => Promise.resolve(amazonAccount())),
      applyRefreshedTokens: jest
        .fn()
        .mockImplementation(
          (input: {
            expectedTokenVersion: number;
            encryptedAccessToken: string;
            encryptedRefreshToken: string;
            tokenExpiresAt: Date;
          }) => {
            if (input.expectedTokenVersion !== state.tokenVersion) {
              return Promise.resolve(false);
            }
            state = {
              encryptedAccessToken: input.encryptedAccessToken,
              encryptedRefreshToken: input.encryptedRefreshToken,
              tokenExpiresAt: input.tokenExpiresAt,
              tokenVersion: state.tokenVersion + 1,
            };
            return Promise.resolve(true);
          },
        ),
      markError: jest.fn().mockResolvedValue(true),
      markTokenExpired: jest.fn().mockResolvedValue(true),
      provisionCredentials: jest.fn(),
    };

    const advisoryLockService = {
      tryAcquire: jest
        .fn()
        .mockResolvedValue({ release: jest.fn().mockResolvedValue(undefined) }),
    };

    const lwaClient = { refreshAccessToken: jest.fn() };

    const configService = buildConfigService();

    const authService = new AmazonAuthService(
      marketplaceAccountsService as never,
      advisoryLockService as never,
      lwaClient as never,
      encryptionService,
      configService,
    );

    const spApiClient = { searchOrders: jest.fn() };
    const persistence = {
      beginSyncRun: jest.fn().mockResolvedValue('run-1'),
      finalizeSyncRunSuccess: jest.fn().mockResolvedValue(undefined),
      finalizeSyncRunFailure: jest.fn().mockResolvedValue(undefined),
      finalizeSyncRunIncomplete: jest.fn().mockResolvedValue(undefined),
      markAccountSynced: jest.fn().mockResolvedValue(undefined),
      persistOrders: jest.fn().mockResolvedValue({
        ordersCreated: 0,
        ordersUpdated: 0,
        itemsPersisted: 0,
      }),
      getAccountSyncCoverage: jest.fn().mockResolvedValue({
        intervals: [],
        oldestFrom: null,
        oldestRunRecordsRead: null,
      }),
    };
    const sleep = jest.fn().mockResolvedValue(undefined);
    const clock = () => new Date('2026-08-20T15:00:00.000Z');

    const syncService = new AmazonOrdersSyncService(
      marketplaceAccountsService as never,
      authService,
      spApiClient as never,
      persistence as never,
      configService,
      sleep,
      clock,
    );

    return {
      syncService,
      authService,
      lwaClient,
      spApiClient,
      persistence,
      encryptionService,
    };
  }

  it('a locally-valid token rejected with 401 forces exactly one LWA call, and the retry uses the new token — the test fails if the same token is repeated', async () => {
    const { syncService, lwaClient, spApiClient } = buildHarness();

    lwaClient.refreshAccessToken.mockResolvedValue({
      kind: 'success',
      token: {
        accessToken: 'brand-new-access-token',
        tokenType: 'bearer',
        expiresInSeconds: 3600,
      },
    });

    spApiClient.searchOrders
      .mockImplementationOnce(
        (input: { accessToken: string }): Promise<unknown> => {
          expect(input.accessToken).toBe('old-access-token');
          return Promise.resolve({ kind: 'unauthorized' });
        },
      )
      .mockImplementationOnce(
        (input: { accessToken: string }): Promise<unknown> => {
          expect(input.accessToken).toBe('brand-new-access-token');
          expect(input.accessToken).not.toBe('old-access-token');
          return Promise.resolve(successPage([], null));
        },
      );

    const result = await syncService.syncOrders('acc-amazon-1');

    expect(result.status).toBe('SUCCESS');
    expect(lwaClient.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(spApiClient.searchOrders).toHaveBeenCalledTimes(2);
  });

  it('a second consecutive 401 (after the one allowed renewal) ends the sync without looping — no second LWA call', async () => {
    const { syncService, lwaClient, spApiClient } = buildHarness();

    lwaClient.refreshAccessToken.mockResolvedValue({
      kind: 'success',
      token: {
        accessToken: 'brand-new-access-token',
        tokenType: 'bearer',
        expiresInSeconds: 3600,
      },
    });
    spApiClient.searchOrders.mockResolvedValue({ kind: 'unauthorized' });

    await expect(syncService.syncOrders('acc-amazon-1')).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });

    expect(lwaClient.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(spApiClient.searchOrders).toHaveBeenCalledTimes(2);
  });
});
