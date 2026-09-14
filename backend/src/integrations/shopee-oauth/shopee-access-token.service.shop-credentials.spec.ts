import { ConflictException } from '@nestjs/common';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { ShopeeAccessTokenService } from './shopee-access-token.service';

/**
 * Checkpoint CP2J — cobre exclusivamente `ensureValidShopCredentials`
 * (extensão de `ShopeeAccessTokenService` que devolve `accessToken` + `shopId`
 * da MESMA leitura/versão da conta, nunca um `shopId` relido separadamente
 * depois). Split de `shopee-access-token.service.spec.ts` (já grande, só
 * cobre `ensureValidAccessToken`) — mesmos helpers locais, duplicados
 * deliberadamente (convenção já usada em todo o projeto: cada spec define
 * seus próprios fixtures).
 */
function account(
  overrides: Partial<MarketplaceAccount> = {},
): MarketplaceAccount {
  return {
    id: 'acc-1',
    marketplace: Marketplace.SHOPEE,
    externalSellerId: '123456',
    nickname: null,
    status: MarketplaceAccountStatus.CONNECTED,
    errorSummary: null,
    failureCode: null,
    encryptedAccessToken: 'enc:access',
    encryptedRefreshToken: 'enc:refresh',
    encryptedCredentialMetadata: null,
    connectedByUserId: null,
    tokenVersion: 3,
    refreshFailureCount: 0,
    refreshRetryAt: null,
    lastRefreshAttemptAt: null,
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    lastSuccessfulSyncAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeMarketplaceAccountsService(
  overrides: Record<string, jest.Mock> = {},
) {
  return {
    findByIdOrFail: jest.fn().mockResolvedValue(account()),
    applyRefreshedTokens: jest.fn(),
    markTokenExpired: jest.fn(),
    markError: jest.fn(),
    markRefreshDeferred: jest.fn(),
    ...overrides,
  };
}

function fakeAdvisoryLockService(overrides: Record<string, jest.Mock> = {}) {
  return {
    tryAcquire: jest.fn(),
    ...overrides,
  };
}

function fakeHttpClient(overrides: Record<string, jest.Mock> = {}) {
  return {
    refreshAccessToken: jest.fn(),
    ...overrides,
  };
}

function fakeEncryptionService(overrides: Record<string, jest.Mock> = {}) {
  return {
    encrypt: jest.fn((plain: string) => `enc:${plain}`),
    decrypt: jest.fn((cipher: string) => cipher.replace(/^enc:/, '')),
    ...overrides,
  };
}

function fakeConfigService(values: Record<string, unknown> = {}) {
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  };
}

function buildService(
  deps: {
    marketplaceAccountsService?: ReturnType<
      typeof fakeMarketplaceAccountsService
    >;
    advisoryLockService?: ReturnType<typeof fakeAdvisoryLockService>;
    httpClient?: ReturnType<typeof fakeHttpClient>;
    encryptionService?: ReturnType<typeof fakeEncryptionService>;
    configService?: ReturnType<typeof fakeConfigService>;
    clock?: () => number;
  } = {},
): ShopeeAccessTokenService {
  return new ShopeeAccessTokenService(
    (deps.marketplaceAccountsService ??
      fakeMarketplaceAccountsService()) as never,
    (deps.advisoryLockService ?? fakeAdvisoryLockService()) as never,
    (deps.httpClient ?? fakeHttpClient()) as never,
    (deps.encryptionService ?? fakeEncryptionService()) as never,
    (deps.configService ?? fakeConfigService()) as never,
    deps.clock,
  );
}

const FIXED_NOW_MS = 1_700_000_000_000;
const SKEW_SECONDS = 600;

describe('ShopeeAccessTokenService.ensureValidShopCredentials — fast path (sem renovação)', () => {
  it('devolve accessToken + shopId da mesma conta, sem tentar lock/renovação', async () => {
    const acc = account({
      tokenExpiresAt: new Date(FIXED_NOW_MS + (SKEW_SECONDS + 3600) * 1000),
      encryptedAccessToken: 'enc:current-access',
      externalSellerId: '555444',
    });
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest.fn().mockResolvedValue(acc),
    });
    const advisoryLockService = fakeAdvisoryLockService();
    const configService = fakeConfigService({
      SHOPEE_TOKEN_REFRESH_SKEW_SECONDS: SKEW_SECONDS,
    });
    const service = buildService({
      marketplaceAccountsService,
      advisoryLockService,
      configService,
      clock: () => FIXED_NOW_MS,
    });

    const credentials = await service.ensureValidShopCredentials('acc-1');

    expect(credentials).toEqual({
      accessToken: 'current-access',
      shopId: '555444',
    });
    expect(advisoryLockService.tryAcquire).not.toHaveBeenCalled();
  });

  it('relê a conta após o lock: se já não está mais vencida, devolve token+shopId relidos sem chamar a Shopee', async () => {
    const staleAccount = account({
      tokenExpiresAt: new Date(FIXED_NOW_MS - 60 * 1000),
      externalSellerId: '111111',
    });
    const rereadAccount = account({
      tokenExpiresAt: new Date(FIXED_NOW_MS + 3600 * 1000),
      encryptedAccessToken: 'enc:already-refreshed-by-other-process',
      externalSellerId: '222222',
    });
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest
        .fn()
        .mockResolvedValueOnce(staleAccount)
        .mockResolvedValueOnce(rereadAccount),
    });
    const release = jest.fn().mockResolvedValue(undefined);
    const advisoryLockService = fakeAdvisoryLockService({
      tryAcquire: jest.fn().mockResolvedValue({ release }),
    });
    const httpClient = fakeHttpClient();
    const configService = fakeConfigService({
      SHOPEE_TOKEN_REFRESH_SKEW_SECONDS: SKEW_SECONDS,
    });
    const service = buildService({
      marketplaceAccountsService,
      advisoryLockService,
      httpClient,
      configService,
      clock: () => FIXED_NOW_MS,
    });

    const credentials = await service.ensureValidShopCredentials('acc-1');

    // shopId vem da MESMA releitura (`rereadAccount`, "222222"), nunca da
    // leitura inicial vencida (`staleAccount`, "111111") — prova que
    // accessToken e shopId sempre pertencem à mesma versão da conta.
    expect(credentials).toEqual({
      accessToken: 'already-refreshed-by-other-process',
      shopId: '222222',
    });
    expect(httpClient.refreshAccessToken).not.toHaveBeenCalled();
  });
});

describe('ShopeeAccessTokenService.ensureValidShopCredentials — renovação bem-sucedida', () => {
  function withLock() {
    const release = jest.fn().mockResolvedValue(undefined);
    return {
      release,
      advisoryLockService: fakeAdvisoryLockService({
        tryAcquire: jest.fn().mockResolvedValue({ release }),
      }),
    };
  }

  it('em sucesso: devolve o accessToken novo emparelhado com o shopId usado NA MESMA chamada de refresh', async () => {
    const acc = account({
      tokenExpiresAt: new Date(FIXED_NOW_MS - 60 * 1000),
      externalSellerId: '987654',
    });
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest.fn().mockResolvedValue(acc),
      applyRefreshedTokens: jest.fn().mockResolvedValue(true),
    });
    const { advisoryLockService } = withLock();
    const httpClient = fakeHttpClient({
      refreshAccessToken: jest.fn().mockResolvedValue({
        kind: 'success',
        token: {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
          expiresInSeconds: 14400,
          requestId: 'req-1',
        },
      }),
    });
    const configService = fakeConfigService({
      SHOPEE_TOKEN_REFRESH_SKEW_SECONDS: SKEW_SECONDS,
    });
    const service = buildService({
      marketplaceAccountsService,
      advisoryLockService,
      httpClient,
      configService,
      clock: () => FIXED_NOW_MS,
    });

    const credentials = await service.ensureValidShopCredentials('acc-1');

    expect(credentials).toEqual({
      accessToken: 'new-access-token',
      shopId: '987654',
    });
    expect(httpClient.refreshAccessToken).toHaveBeenCalledWith({
      refreshToken: 'refresh',
      shopId: '987654',
    });
  });
});

describe('ShopeeAccessTokenService.ensureValidShopCredentials — CAS perdido em sucesso (nunca mistura token antigo com shopId novo, ou vice-versa)', () => {
  function withLock() {
    const release = jest.fn().mockResolvedValue(undefined);
    return {
      release,
      advisoryLockService: fakeAdvisoryLockService({
        tryAcquire: jest.fn().mockResolvedValue({ release }),
      }),
    };
  }

  it('CAS perdido, releitura mostra reconexão vencedora com shopId DIFERENTE: usa accessToken+shopId da releitura vencedora, nunca o shopId da tentativa perdedora', async () => {
    const acc = account({
      id: 'acc-1',
      tokenExpiresAt: new Date(FIXED_NOW_MS - 5000),
      tokenVersion: 1,
      externalSellerId: '111111', // shop da tentativa que vai perder o CAS
    });
    const newerAccount = account({
      id: 'acc-1',
      tokenVersion: 2,
      status: MarketplaceAccountStatus.CONNECTED,
      tokenExpiresAt: new Date(FIXED_NOW_MS + 3600 * 1000),
      encryptedAccessToken: 'enc:token-from-winning-process',
      encryptedRefreshToken: 'enc:refresh-from-winning-process',
      externalSellerId: '999999', // shop de uma reconexão concorrente vencedora
    });
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest
        .fn()
        .mockResolvedValueOnce(acc)
        .mockResolvedValueOnce(acc)
        .mockResolvedValueOnce(newerAccount),
      applyRefreshedTokens: jest.fn().mockResolvedValue(false),
    });
    const { advisoryLockService } = withLock();
    const httpClient = fakeHttpClient({
      refreshAccessToken: jest.fn().mockResolvedValue({
        kind: 'success',
        token: {
          accessToken: 'new-access-token-that-lost-the-race',
          refreshToken: 'new-refresh-token-that-lost-the-race',
          expiresInSeconds: 14400,
          requestId: null,
        },
      }),
    });
    const configService = fakeConfigService({
      SHOPEE_TOKEN_REFRESH_SKEW_SECONDS: SKEW_SECONDS,
    });
    const service = buildService({
      marketplaceAccountsService,
      advisoryLockService,
      httpClient,
      configService,
      clock: () => FIXED_NOW_MS,
    });

    const credentials = await service.ensureValidShopCredentials('acc-1');

    // NUNCA o shopId "111111" (da tentativa que perdeu o CAS) emparelhado
    // com o token "token-from-winning-process" (da releitura vencedora) —
    // ambos os campos vêm de `newerAccount`.
    expect(credentials).toEqual({
      accessToken: 'token-from-winning-process',
      shopId: '999999',
    });
  });

  it('CAS perdido e a releitura vencedora tem externalSellerId ausente/inválido: falha fechado, nunca devolve shopId inválido ou ausente', async () => {
    const acc = account({
      id: 'acc-1',
      tokenExpiresAt: new Date(FIXED_NOW_MS - 5000),
      tokenVersion: 1,
    });
    const newerAccountMissingShopId = account({
      id: 'acc-1',
      tokenVersion: 2,
      status: MarketplaceAccountStatus.CONNECTED,
      tokenExpiresAt: new Date(FIXED_NOW_MS + 3600 * 1000),
      encryptedAccessToken: 'enc:should-never-be-returned',
      encryptedRefreshToken: 'enc:should-never-be-returned-refresh',
      externalSellerId: null,
    });
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest
        .fn()
        .mockResolvedValueOnce(acc)
        .mockResolvedValueOnce(acc)
        .mockResolvedValueOnce(newerAccountMissingShopId),
      applyRefreshedTokens: jest.fn().mockResolvedValue(false),
    });
    const { advisoryLockService } = withLock();
    const httpClient = fakeHttpClient({
      refreshAccessToken: jest.fn().mockResolvedValue({
        kind: 'success',
        token: {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
          expiresInSeconds: 14400,
          requestId: null,
        },
      }),
    });
    const configService = fakeConfigService({
      SHOPEE_TOKEN_REFRESH_SKEW_SECONDS: SKEW_SECONDS,
    });
    const service = buildService({
      marketplaceAccountsService,
      advisoryLockService,
      httpClient,
      configService,
      clock: () => FIXED_NOW_MS,
    });

    await expect(
      service.ensureValidShopCredentials('acc-1'),
    ).rejects.toMatchObject({ message: 'REFRESH_RESULT_NOT_COMMITTED' });
  });
});

describe('ShopeeAccessTokenService.ensureValidShopCredentials — falhas propagadas (nenhuma duplicação da lógica de refresh)', () => {
  it('lock indisponível: lança ConflictException(ACCOUNT_BUSY), nunca chama a Shopee', async () => {
    const acc = account({ tokenExpiresAt: new Date(FIXED_NOW_MS - 60 * 1000) });
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest.fn().mockResolvedValue(acc),
    });
    const advisoryLockService = fakeAdvisoryLockService({
      tryAcquire: jest.fn().mockResolvedValue(null),
    });
    const httpClient = fakeHttpClient();
    const configService = fakeConfigService({
      SHOPEE_TOKEN_REFRESH_SKEW_SECONDS: SKEW_SECONDS,
    });
    const service = buildService({
      marketplaceAccountsService,
      advisoryLockService,
      httpClient,
      configService,
      clock: () => FIXED_NOW_MS,
    });

    await expect(
      service.ensureValidShopCredentials('acc-1'),
    ).rejects.toMatchObject({ message: 'ACCOUNT_BUSY' });
    expect(httpClient.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('provider_rejected: propaga ConflictException(REFRESH_FAILED), mesmo comportamento fail-closed do CP2H', async () => {
    const acc = account({
      tokenExpiresAt: new Date(FIXED_NOW_MS - 60 * 1000),
      tokenVersion: 7,
    });
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest.fn().mockResolvedValue(acc),
      markError: jest.fn().mockResolvedValue(true),
    });
    const release = jest.fn().mockResolvedValue(undefined);
    const advisoryLockService = fakeAdvisoryLockService({
      tryAcquire: jest.fn().mockResolvedValue({ release }),
    });
    const httpClient = fakeHttpClient({
      refreshAccessToken: jest
        .fn()
        .mockResolvedValue({ kind: 'provider_rejected' }),
    });
    const configService = fakeConfigService({
      SHOPEE_TOKEN_REFRESH_SKEW_SECONDS: SKEW_SECONDS,
    });
    const service = buildService({
      marketplaceAccountsService,
      advisoryLockService,
      httpClient,
      configService,
      clock: () => FIXED_NOW_MS,
    });

    await expect(
      service.ensureValidShopCredentials('acc-1'),
    ).rejects.toMatchObject({ message: 'REFRESH_FAILED' });
  });
});

describe('ShopeeAccessTokenService.ensureValidAccessToken — permanece compatível (wrapper sobre ensureValidShopCredentials)', () => {
  it('continua devolvendo só a string do accessToken, mesmo comportamento de antes', async () => {
    const acc = account({
      tokenExpiresAt: new Date(FIXED_NOW_MS + (SKEW_SECONDS + 3600) * 1000),
      encryptedAccessToken: 'enc:current-access',
    });
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest.fn().mockResolvedValue(acc),
    });
    const configService = fakeConfigService({
      SHOPEE_TOKEN_REFRESH_SKEW_SECONDS: SKEW_SECONDS,
    });
    const service = buildService({
      marketplaceAccountsService,
      configService,
      clock: () => FIXED_NOW_MS,
    });

    const token = await service.ensureValidAccessToken('acc-1');

    expect(token).toBe('current-access');
  });

  it('lock indisponível: continua lançando ConflictException(ACCOUNT_BUSY)', async () => {
    const acc = account({
      tokenExpiresAt: new Date(FIXED_NOW_MS - 60 * 1000),
    });
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest.fn().mockResolvedValue(acc),
    });
    const advisoryLockService = fakeAdvisoryLockService({
      tryAcquire: jest.fn().mockResolvedValue(null),
    });
    const configService = fakeConfigService({
      SHOPEE_TOKEN_REFRESH_SKEW_SECONDS: SKEW_SECONDS,
    });
    const service = buildService({
      marketplaceAccountsService,
      advisoryLockService,
      configService,
      clock: () => FIXED_NOW_MS,
    });

    await expect(
      service.ensureValidAccessToken('acc-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
