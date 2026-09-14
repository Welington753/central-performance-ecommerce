import { ConflictException, NotFoundException } from '@nestjs/common';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { ShopeeAccessTokenService } from './shopee-access-token.service';

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

describe('ShopeeAccessTokenService.ensureValidAccessToken — elegibilidade da conta', () => {
  it('lança NotFoundException quando a conta não existe', async () => {
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest
        .fn()
        .mockRejectedValue(
          new NotFoundException('Conta de marketplace não encontrada.'),
        ),
    });
    const service = buildService({ marketplaceAccountsService });

    await expect(service.ensureValidAccessToken('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejeita quando o marketplace da conta não é SHOPEE', async () => {
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest
        .fn()
        .mockResolvedValue(account({ marketplace: Marketplace.MERCADO_LIVRE })),
    });
    const service = buildService({ marketplaceAccountsService });

    await expect(
      service.ensureValidAccessToken('acc-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it.each([
    MarketplaceAccountStatus.DISCONNECTED,
    MarketplaceAccountStatus.TOKEN_EXPIRED,
    MarketplaceAccountStatus.ERROR,
  ])(
    'rejeita quando o status da conta é %s (não CONNECTED)',
    async (status) => {
      const marketplaceAccountsService = fakeMarketplaceAccountsService({
        findByIdOrFail: jest.fn().mockResolvedValue(account({ status })),
      });
      const service = buildService({ marketplaceAccountsService });

      await expect(
        service.ensureValidAccessToken('acc-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    },
  );

  it('rejeita quando encryptedAccessToken está ausente', async () => {
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest
        .fn()
        .mockResolvedValue(account({ encryptedAccessToken: null })),
    });
    const service = buildService({ marketplaceAccountsService });

    await expect(
      service.ensureValidAccessToken('acc-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejeita quando encryptedRefreshToken está ausente', async () => {
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest
        .fn()
        .mockResolvedValue(account({ encryptedRefreshToken: null })),
    });
    const service = buildService({ marketplaceAccountsService });

    await expect(
      service.ensureValidAccessToken('acc-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejeita quando tokenExpiresAt está ausente', async () => {
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest
        .fn()
        .mockResolvedValue(account({ tokenExpiresAt: null })),
    });
    const service = buildService({ marketplaceAccountsService });

    await expect(
      service.ensureValidAccessToken('acc-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejeita quando externalSellerId está ausente', async () => {
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest
        .fn()
        .mockResolvedValue(account({ externalSellerId: null })),
    });
    const service = buildService({ marketplaceAccountsService });

    await expect(
      service.ensureValidAccessToken('acc-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejeita quando externalSellerId não é um decimal válido (shop_id)', async () => {
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest
        .fn()
        .mockResolvedValue(account({ externalSellerId: 'abc' })),
    });
    const service = buildService({ marketplaceAccountsService });

    await expect(
      service.ensureValidAccessToken('acc-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

const FIXED_NOW_MS = 1_700_000_000_000;
const SKEW_SECONDS = 600;

describe('ShopeeAccessTokenService.ensureValidAccessToken — fast path por skew', () => {
  it('acima da margem: descriptografa e devolve o access token atual sem tentar lock/renovação', async () => {
    const acc = account({
      tokenExpiresAt: new Date(FIXED_NOW_MS + (SKEW_SECONDS + 3600) * 1000),
      encryptedAccessToken: 'enc:current-access',
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

    const token = await service.ensureValidAccessToken('acc-1');

    expect(token).toBe('current-access');
    expect(advisoryLockService.tryAcquire).not.toHaveBeenCalled();
  });

  it('exatamente no limite da margem: NÃO usa o fast path, inicia renovação (tenta o lock)', async () => {
    const acc = account({
      tokenExpiresAt: new Date(FIXED_NOW_MS + SKEW_SECONDS * 1000),
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
    expect(advisoryLockService.tryAcquire).toHaveBeenCalledWith('acc-1');
  });

  it('dentro da margem (perto do vencimento, ainda não vencido): inicia renovação (tenta o lock)', async () => {
    const acc = account({
      tokenExpiresAt: new Date(FIXED_NOW_MS + 60 * 1000),
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
    expect(advisoryLockService.tryAcquire).toHaveBeenCalledWith('acc-1');
  });

  it('já vencido: inicia renovação (tenta o lock)', async () => {
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
    expect(advisoryLockService.tryAcquire).toHaveBeenCalledWith('acc-1');
  });
});

describe('ShopeeAccessTokenService.ensureValidAccessToken — concorrência (lock)', () => {
  it('lock indisponível: nunca chama a Shopee, lança ConflictException(ACCOUNT_BUSY)', async () => {
    const acc = account({
      tokenExpiresAt: new Date(FIXED_NOW_MS - 60 * 1000),
    });
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

    await expect(service.ensureValidAccessToken('acc-1')).rejects.toMatchObject(
      { message: 'ACCOUNT_BUSY' },
    );
    expect(httpClient.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('relê a conta após o lock: se já não está mais vencida (skew), devolve o token relido sem chamar a Shopee', async () => {
    const staleAccount = account({
      tokenExpiresAt: new Date(FIXED_NOW_MS - 60 * 1000),
    });
    const rereadAccount = account({
      tokenExpiresAt: new Date(FIXED_NOW_MS + 3600 * 1000),
      encryptedAccessToken: 'enc:already-refreshed-by-other-process',
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

    const token = await service.ensureValidAccessToken('acc-1');

    expect(token).toBe('already-refreshed-by-other-process');
    expect(httpClient.refreshAccessToken).not.toHaveBeenCalled();
    expect(marketplaceAccountsService.findByIdOrFail).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalled();
  });
});

describe('ShopeeAccessTokenService.ensureValidAccessToken — renovação bem-sucedida', () => {
  function withLock() {
    const release = jest.fn().mockResolvedValue(undefined);
    return {
      release,
      advisoryLockService: fakeAdvisoryLockService({
        tryAcquire: jest.fn().mockResolvedValue({ release }),
      }),
    };
  }

  it('chama o refresh com o refresh_token descriptografado e o shop_id da conta', async () => {
    const acc = account({
      tokenExpiresAt: new Date(FIXED_NOW_MS - 60 * 1000),
      externalSellerId: '987654',
      encryptedRefreshToken: 'enc:old-refresh-token',
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

    await service.ensureValidAccessToken('acc-1');

    expect(httpClient.refreshAccessToken).toHaveBeenCalledWith({
      refreshToken: 'old-refresh-token',
      shopId: '987654',
    });
  });

  it('em sucesso: criptografa e persiste access+refresh novos juntos, via CAS por id+token_version', async () => {
    const acc = account({
      id: 'acc-9',
      tokenVersion: 3,
      tokenExpiresAt: new Date(FIXED_NOW_MS - 60 * 1000),
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

    const token = await service.ensureValidAccessToken('acc-1');

    expect(token).toBe('new-access-token');
    expect(
      marketplaceAccountsService.applyRefreshedTokens,
    ).toHaveBeenCalledWith({
      id: 'acc-9',
      expectedTokenVersion: 3,
      encryptedAccessToken: 'enc:new-access-token',
      encryptedRefreshToken: 'enc:new-refresh-token',
      tokenExpiresAt: new Date(FIXED_NOW_MS + 14400 * 1000),
    });
  });

  it('nunca persiste somente um dos dois tokens (chamada única e atômica de applyRefreshedTokens)', async () => {
    const acc = account({ tokenExpiresAt: new Date(FIXED_NOW_MS - 60 * 1000) });
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

    await service.ensureValidAccessToken('acc-1');

    expect(
      marketplaceAccountsService.applyRefreshedTokens,
    ).toHaveBeenCalledTimes(1);
  });

  it('falha ao descriptografar o refresh_token: marca ERROR e lança, sem chamar a Shopee', async () => {
    const acc = account({
      tokenExpiresAt: new Date(FIXED_NOW_MS - 60 * 1000),
      tokenVersion: 5,
    });
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest.fn().mockResolvedValue(acc),
    });
    const { advisoryLockService } = withLock();
    const httpClient = fakeHttpClient();
    const encryptionService = fakeEncryptionService({
      decrypt: jest.fn(() => {
        throw new Error('bad ciphertext');
      }),
      encrypt: jest.fn((plain: string) => `enc:${plain}`),
    });
    const configService = fakeConfigService({
      SHOPEE_TOKEN_REFRESH_SKEW_SECONDS: SKEW_SECONDS,
    });
    const service = buildService({
      marketplaceAccountsService,
      advisoryLockService,
      httpClient,
      encryptionService,
      configService,
      clock: () => FIXED_NOW_MS,
    });

    await expect(service.ensureValidAccessToken('acc-1')).rejects.toMatchObject(
      {
        message: 'CREDENTIAL_DECRYPTION_FAILED',
      },
    );
    expect(httpClient.refreshAccessToken).not.toHaveBeenCalled();
    expect(marketplaceAccountsService.markError).toHaveBeenCalledWith({
      id: 'acc-1',
      expectedTokenVersion: 5,
      failureCode: 'CREDENTIAL_DECRYPTION_FAILED',
      errorSummary: 'Falha ao descriptografar credencial armazenada.',
    });
  });
});

describe('ShopeeAccessTokenService.ensureValidAccessToken — rejeição do provedor (classificação conservadora, CP2H-R1)', () => {
  function withLock() {
    const release = jest.fn().mockResolvedValue(undefined);
    return {
      release,
      advisoryLockService: fakeAdvisoryLockService({
        tryAcquire: jest.fn().mockResolvedValue({ release }),
      }),
    };
  }

  it('provider_rejected: NUNCA marca TOKEN_EXPIRED (não há confirmação de que é o refresh_token) — marca ERROR e exige reconexão', async () => {
    const acc = account({
      tokenExpiresAt: new Date(FIXED_NOW_MS - 60 * 1000),
      tokenVersion: 7,
    });
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest.fn().mockResolvedValue(acc),
      markError: jest.fn().mockResolvedValue(true),
    });
    const { advisoryLockService } = withLock();
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

    await expect(service.ensureValidAccessToken('acc-1')).rejects.toMatchObject(
      { message: 'REFRESH_FAILED' },
    );
    expect(marketplaceAccountsService.markTokenExpired).not.toHaveBeenCalled();
    expect(marketplaceAccountsService.markError).toHaveBeenCalledWith({
      id: 'acc-1',
      expectedTokenVersion: 7,
      failureCode: 'REFRESH_FAILED',
      errorSummary:
        'A Shopee rejeitou a renovação do token (motivo não detalhado pelo provedor — pode ser refresh_token inválido, assinatura ou configuração). Reconexão necessária.',
    });
  });
});

describe('ShopeeAccessTokenService.ensureValidAccessToken — rate limit (CP2H-R1: reclassificado como ambíguo)', () => {
  function withLock() {
    const release = jest.fn().mockResolvedValue(undefined);
    return {
      release,
      advisoryLockService: fakeAdvisoryLockService({
        tryAcquire: jest.fn().mockResolvedValue({ release }),
      }),
    };
  }

  it('rate_limited (429): NÃO agenda retry com o mesmo refresh_token — trata como ambíguo, marca ERROR, nunca devolve o token atual', async () => {
    const acc = account({
      // Deliberadamente ainda "válido" por mais alguns segundos, para provar
      // que o novo comportamento NUNCA devolve o token atual neste outcome
      // (ao contrário do tratamento antigo, que devolvia se ainda válido).
      tokenExpiresAt: new Date(FIXED_NOW_MS + 30 * 1000),
      tokenVersion: 2,
      encryptedAccessToken: 'enc:still-valid-access',
    });
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest.fn().mockResolvedValue(acc),
      markError: jest.fn().mockResolvedValue(true),
    });
    const { advisoryLockService } = withLock();
    const httpClient = fakeHttpClient({
      refreshAccessToken: jest
        .fn()
        .mockResolvedValue({ kind: 'rate_limited', retryAfterMs: 5000 }),
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

    await expect(service.ensureValidAccessToken('acc-1')).rejects.toMatchObject(
      { message: 'REFRESH_RESULT_AMBIGUOUS' },
    );
    expect(
      marketplaceAccountsService.markRefreshDeferred,
    ).not.toHaveBeenCalled();
    expect(marketplaceAccountsService.markError).toHaveBeenCalledWith({
      id: 'acc-1',
      expectedTokenVersion: 2,
      failureCode: 'REFRESH_RESULT_AMBIGUOUS',
      errorSummary:
        'Resultado ambíguo ao renovar o token da Shopee (limite de requisições, resposta inválida ou conexão interrompida) — sem confirmação de que o refresh_token não foi consumido. Reconexão manual necessária.',
    });
  });

  it('rate_limited nunca chama a Shopee de novo automaticamente com o mesmo refresh_token', async () => {
    const acc = account({ tokenExpiresAt: new Date(FIXED_NOW_MS - 5000) });
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest.fn().mockResolvedValue(acc),
      markError: jest.fn().mockResolvedValue(true),
    });
    const { advisoryLockService } = withLock();
    const httpClient = fakeHttpClient({
      refreshAccessToken: jest
        .fn()
        .mockResolvedValue({ kind: 'rate_limited', retryAfterMs: null }),
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
      service.ensureValidAccessToken('acc-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(httpClient.refreshAccessToken).toHaveBeenCalledTimes(1);
  });
});

describe('ShopeeAccessTokenService.ensureValidAccessToken — resultado ambíguo (nunca reutiliza o refresh_token)', () => {
  function withLock() {
    const release = jest.fn().mockResolvedValue(undefined);
    return {
      release,
      advisoryLockService: fakeAdvisoryLockService({
        tryAcquire: jest.fn().mockResolvedValue({ release }),
      }),
    };
  }

  it.each(['invalid_response', 'unknown_result'] as const)(
    'outcome %s: marca ERROR (fail-closed), nunca devolve o token atual, mesmo se ainda não vencido',
    async (kind) => {
      const acc = account({
        tokenExpiresAt: new Date(FIXED_NOW_MS - 5000),
        tokenVersion: 4,
      });
      const marketplaceAccountsService = fakeMarketplaceAccountsService({
        findByIdOrFail: jest.fn().mockResolvedValue(acc),
        markError: jest.fn().mockResolvedValue(true),
      });
      const { advisoryLockService } = withLock();
      const httpClient = fakeHttpClient({
        refreshAccessToken: jest.fn().mockResolvedValue({ kind }),
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
        service.ensureValidAccessToken('acc-1'),
      ).rejects.toMatchObject({
        message: 'REFRESH_RESULT_AMBIGUOUS',
      });
      expect(marketplaceAccountsService.markError).toHaveBeenCalledWith({
        id: 'acc-1',
        expectedTokenVersion: 4,
        failureCode: 'REFRESH_RESULT_AMBIGUOUS',
        errorSummary:
          'Resultado ambíguo ao renovar o token da Shopee (limite de requisições, resposta inválida ou conexão interrompida) — sem confirmação de que o refresh_token não foi consumido. Reconexão manual necessária.',
      });
    },
  );

  it('nunca chama a Shopee de novo automaticamente com o mesmo refresh_token após resultado ambíguo', async () => {
    const acc = account({ tokenExpiresAt: new Date(FIXED_NOW_MS - 5000) });
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest.fn().mockResolvedValue(acc),
      markError: jest.fn().mockResolvedValue(true),
    });
    const { advisoryLockService } = withLock();
    const httpClient = fakeHttpClient({
      refreshAccessToken: jest
        .fn()
        .mockResolvedValue({ kind: 'unknown_result' }),
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
      service.ensureValidAccessToken('acc-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(httpClient.refreshAccessToken).toHaveBeenCalledTimes(1);
  });
});

describe('ShopeeAccessTokenService.ensureValidAccessToken — CAS perdido em sucesso', () => {
  function withLock() {
    const release = jest.fn().mockResolvedValue(undefined);
    return {
      release,
      advisoryLockService: fakeAdvisoryLockService({
        tryAcquire: jest.fn().mockResolvedValue({ release }),
      }),
    };
  }

  it('CAS perdido, mas releitura mostra que outro processo já aplicou um refresh mais novo: usa o token já armazenado', async () => {
    const acc = account({
      id: 'acc-1',
      tokenExpiresAt: new Date(FIXED_NOW_MS - 5000),
      tokenVersion: 1,
    });
    const newerAccount = account({
      id: 'acc-1',
      tokenVersion: 2,
      status: MarketplaceAccountStatus.CONNECTED,
      tokenExpiresAt: new Date(FIXED_NOW_MS + 3600 * 1000),
      encryptedAccessToken: 'enc:token-from-winning-process',
      encryptedRefreshToken: 'enc:refresh-from-winning-process',
    });
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      // 1ª chamada: verificação inicial (fora do lock). 2ª: releitura após o
      // lock (ainda vencida, então segue para a tentativa de refresh). 3ª:
      // releitura ESPECÍFICA de recuperação de CAS perdido, após
      // `applyRefreshedTokens` devolver `false` — mostra que outro processo
      // já venceu a corrida e aplicou um refresh mais novo.
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

    const token = await service.ensureValidAccessToken('acc-1');

    expect(token).toBe('token-from-winning-process');
  });

  it('CAS perdido e a releitura NÃO mostra um estado mais novo seguro: falha fechado, nunca reenvia o refresh_token antigo', async () => {
    const acc = account({
      id: 'acc-1',
      tokenExpiresAt: new Date(FIXED_NOW_MS - 5000),
      tokenVersion: 1,
    });
    const staleStillAccount = account({
      id: 'acc-1',
      status: MarketplaceAccountStatus.ERROR,
      tokenVersion: 1,
    });
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest
        .fn()
        .mockResolvedValueOnce(acc)
        .mockResolvedValueOnce(acc)
        .mockResolvedValueOnce(staleStillAccount),
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

    await expect(service.ensureValidAccessToken('acc-1')).rejects.toMatchObject(
      {
        message: 'REFRESH_RESULT_NOT_COMMITTED',
      },
    );
    expect(httpClient.refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it('CAS perdido e a releitura mostra a MESMA token_version (mesmo com status CONNECTED e credenciais aparentemente válidas): falha fechado (CP2H-R1)', async () => {
    const acc = account({
      id: 'acc-1',
      tokenExpiresAt: new Date(FIXED_NOW_MS - 5000),
      tokenVersion: 1,
    });
    // Releitura com a MESMA versão (1) usada na tentativa — mesmo que
    // status/credenciais pareçam válidos, uma versão IGUAL nunca prova que
    // outro processo aplicou uma renovação mais nova: é só a mesma linha,
    // ainda não atualizada. Defesa em profundidade além da checagem de
    // status (Revisão CP2H-R1).
    const sameVersionAccount = account({
      id: 'acc-1',
      status: MarketplaceAccountStatus.CONNECTED,
      tokenVersion: 1,
      tokenExpiresAt: new Date(FIXED_NOW_MS + 3600 * 1000),
      encryptedAccessToken: 'enc:should-never-be-returned',
      encryptedRefreshToken: 'enc:should-never-be-returned-refresh',
    });
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest
        .fn()
        .mockResolvedValueOnce(acc)
        .mockResolvedValueOnce(acc)
        .mockResolvedValueOnce(sameVersionAccount),
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

    await expect(service.ensureValidAccessToken('acc-1')).rejects.toMatchObject(
      { message: 'REFRESH_RESULT_NOT_COMMITTED' },
    );
  });
});

describe('ShopeeAccessTokenService — escritas de falha nunca sobrescrevem uma versão mais nova (CP2H-R1)', () => {
  function withLock() {
    const release = jest.fn().mockResolvedValue(undefined);
    return {
      release,
      advisoryLockService: fakeAdvisoryLockService({
        tryAcquire: jest.fn().mockResolvedValue({ release }),
      }),
    };
  }

  it('markError perde o CAS (conta já reconectada/atualizada concorrentemente): não lança erro extra, apenas descarta a escrita e mantém o outcome original', async () => {
    const acc = account({ tokenExpiresAt: new Date(FIXED_NOW_MS - 5000) });
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest.fn().mockResolvedValue(acc),
      // CAS de `markError` perde a corrida — simula uma reconexão/callback
      // concorrente que já mudou `token_version` antes desta escrita.
      markError: jest.fn().mockResolvedValue(false),
    });
    const { advisoryLockService } = withLock();
    const httpClient = fakeHttpClient({
      refreshAccessToken: jest
        .fn()
        .mockResolvedValue({ kind: 'unknown_result' }),
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

    // O outcome original (`REFRESH_RESULT_AMBIGUOUS`) ainda é o que é
    // devolvido ao chamador — a escrita perdida é só logada, nunca
    // sobrescreve a versão vencedora nem lança uma exceção diferente sobre
    // a falha da própria escrita.
    await expect(service.ensureValidAccessToken('acc-1')).rejects.toMatchObject(
      { message: 'REFRESH_RESULT_AMBIGUOUS' },
    );
  });
});

describe('ShopeeAccessTokenService — nenhuma informação sensível em logs/exceções', () => {
  it('a mensagem de qualquer ConflictException lançada nunca contém o access/refresh token em texto puro', async () => {
    const acc = account({
      tokenExpiresAt: new Date(1_700_000_000_000 - 5000),
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
        .mockResolvedValue({ kind: 'unknown_result' }),
    });
    const configService = fakeConfigService({
      SHOPEE_TOKEN_REFRESH_SKEW_SECONDS: SKEW_SECONDS,
    });
    const service = buildService({
      marketplaceAccountsService,
      advisoryLockService,
      httpClient,
      configService,
      clock: () => 1_700_000_000_000,
    });

    const plainAccessToken = 'access';
    const plainRefreshToken = 'refresh';

    try {
      await service.ensureValidAccessToken('acc-1');
      throw new Error('deveria ter lançado');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(plainAccessToken);
      expect(message).not.toContain(plainRefreshToken);
      expect(message).not.toMatch(/enc:/);
    }
  });
});
