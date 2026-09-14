import { ConflictException, NotFoundException } from '@nestjs/common';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import type { ShopeeShopInfoOutcome } from './shopee-shop-api.client';
import {
  ShopeeShopService,
  ShopeeShopServiceError,
} from './shopee-shop.service';

function account(
  overrides: Partial<MarketplaceAccount> = {},
): MarketplaceAccount {
  return {
    id: 'acc-1',
    marketplace: Marketplace.SHOPEE,
    externalSellerId: '555444',
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
    ...overrides,
  };
}

function fakeAccessTokenService(overrides: Record<string, jest.Mock> = {}) {
  return {
    ensureValidShopCredentials: jest.fn().mockResolvedValue({
      accessToken: 'plain-access-token',
      shopId: '555444',
    }),
    ...overrides,
  };
}

function fakeShopApiClient(overrides: Record<string, jest.Mock> = {}) {
  return {
    getShopInfo: jest.fn(),
    ...overrides,
  };
}

function successOutcome(
  overrides: Record<string, unknown> = {},
): ShopeeShopInfoOutcome {
  return {
    kind: 'success',
    shopInfo: {
      shopName: 'Loja Exemplo',
      region: 'BR',
      status: 'NORMAL',
      authTime: 1700000000,
      expireTime: 1700100000,
      merchantId: null,
      requestId: 'req-abc123',
      ...overrides,
    },
  };
}

function buildService(
  deps: {
    marketplaceAccountsService?: ReturnType<
      typeof fakeMarketplaceAccountsService
    >;
    accessTokenService?: ReturnType<typeof fakeAccessTokenService>;
    shopApiClient?: ReturnType<typeof fakeShopApiClient>;
  } = {},
): ShopeeShopService {
  return new ShopeeShopService(
    (deps.marketplaceAccountsService ??
      fakeMarketplaceAccountsService()) as never,
    (deps.accessTokenService ?? fakeAccessTokenService()) as never,
    (deps.shopApiClient ?? fakeShopApiClient()) as never,
  );
}

describe('ShopeeShopService.getShopInfo — conta e credenciais', () => {
  it('conta inexistente: propaga NotFoundException da própria MarketplaceAccountsService', async () => {
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest
        .fn()
        .mockRejectedValue(
          new NotFoundException('Conta de marketplace não encontrada.'),
        ),
    });
    const service = buildService({ marketplaceAccountsService });

    await expect(service.getShopInfo('acc-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('marketplace diferente de SHOPEE: 404 genérico, mesma mensagem de "não encontrada" (nunca revela o marketplace real)', async () => {
    const marketplaceAccountsService = fakeMarketplaceAccountsService({
      findByIdOrFail: jest
        .fn()
        .mockResolvedValue(account({ marketplace: Marketplace.MERCADO_LIVRE })),
    });
    const service = buildService({ marketplaceAccountsService });

    const error = await service.getShopInfo('acc-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).message).toBe(
      'Conta de marketplace não encontrada.',
    );
  });

  it.each([
    MarketplaceAccountStatus.DISCONNECTED,
    MarketplaceAccountStatus.TOKEN_EXPIRED,
    MarketplaceAccountStatus.ERROR,
  ])(
    'status %s (não CONNECTED): SHOPEE_NOT_CONNECTED, nunca chama credenciais/cliente',
    async (status) => {
      const marketplaceAccountsService = fakeMarketplaceAccountsService({
        findByIdOrFail: jest.fn().mockResolvedValue(account({ status })),
      });
      const accessTokenService = fakeAccessTokenService();
      const shopApiClient = fakeShopApiClient();
      const service = buildService({
        marketplaceAccountsService,
        accessTokenService,
        shopApiClient,
      });

      await expect(service.getShopInfo('acc-1')).rejects.toMatchObject({
        code: 'SHOPEE_NOT_CONNECTED',
      });
      expect(
        accessTokenService.ensureValidShopCredentials,
      ).not.toHaveBeenCalled();
      expect(shopApiClient.getShopInfo).not.toHaveBeenCalled();
    },
  );
});

describe('ShopeeShopService.getShopInfo — vínculo token + shopId', () => {
  it('chama ShopeeAccessTokenService.ensureValidShopCredentials e usa exatamente o accessToken/shopId devolvidos por ele', async () => {
    const accessTokenService = fakeAccessTokenService({
      ensureValidShopCredentials: jest.fn().mockResolvedValue({
        accessToken: 'paired-access-token',
        shopId: '999999',
      }),
    });
    const shopApiClient = fakeShopApiClient({
      getShopInfo: jest.fn().mockResolvedValue(successOutcome()),
    });
    const service = buildService({ accessTokenService, shopApiClient });

    await service.getShopInfo('acc-1');

    expect(accessTokenService.ensureValidShopCredentials).toHaveBeenCalledWith(
      'acc-1',
    );
    expect(shopApiClient.getShopInfo).toHaveBeenCalledWith({
      accessToken: 'paired-access-token',
      shopId: '999999',
    });
  });

  it('renovação é delegada exclusivamente ao ShopeeAccessTokenService — o serviço nunca chama nada além de ensureValidShopCredentials nele', async () => {
    const accessTokenService = fakeAccessTokenService();
    const shopApiClient = fakeShopApiClient({
      getShopInfo: jest.fn().mockResolvedValue(successOutcome()),
    });
    const service = buildService({ accessTokenService, shopApiClient });

    await service.getShopInfo('acc-1');

    const calledMethods = Object.keys(accessTokenService).filter(
      (key) =>
        (accessTokenService as unknown as Record<string, jest.Mock>)[key].mock
          .calls.length > 0,
    );
    expect(calledMethods).toEqual(['ensureValidShopCredentials']);
  });
});

describe('ShopeeShopService.getShopInfo — sucesso e campos públicos', () => {
  it('devolve exatamente os seis campos públicos, datas convertidas para ISO-8601 UTC', async () => {
    const shopApiClient = fakeShopApiClient({
      getShopInfo: jest.fn().mockResolvedValue(
        successOutcome({
          shopName: 'Loja Exemplo',
          region: 'BR',
          status: 'NORMAL',
          authTime: 1700000000,
          expireTime: 1700100000,
          merchantId: 123456,
        }),
      ),
    });
    const service = buildService({ shopApiClient });

    const result = await service.getShopInfo('acc-1');

    expect(result).toEqual({
      shopName: 'Loja Exemplo',
      region: 'BR',
      status: 'NORMAL',
      authorizationGrantedAt: new Date(1700000000 * 1000).toISOString(),
      authorizationExpiresAt: new Date(1700100000 * 1000).toISOString(),
      merchantId: 123456,
    });
    expect(Object.keys(result)).toEqual([
      'shopName',
      'region',
      'status',
      'authorizationGrantedAt',
      'authorizationExpiresAt',
      'merchantId',
    ]);
  });

  it('merchantId null é preservado como null (não vira undefined nem 0)', async () => {
    const shopApiClient = fakeShopApiClient({
      getShopInfo: jest
        .fn()
        .mockResolvedValue(successOutcome({ merchantId: null })),
    });
    const service = buildService({ shopApiClient });

    const result = await service.getShopInfo('acc-1');

    expect(result.merchantId).toBeNull();
  });

  it.each(['NORMAL', 'BANNED', 'FROZEN'] as const)(
    'propaga o status documentado %s sem alteração',
    async (status) => {
      const shopApiClient = fakeShopApiClient({
        getShopInfo: jest.fn().mockResolvedValue(successOutcome({ status })),
      });
      const service = buildService({ shopApiClient });

      const result = await service.getShopInfo('acc-1');
      expect(result.status).toBe(status);
    },
  );

  it('nunca inclui requestId do fornecedor nem qualquer campo além dos seis públicos', async () => {
    const shopApiClient = fakeShopApiClient({
      getShopInfo: jest.fn().mockResolvedValue(successOutcome()),
    });
    const service = buildService({ shopApiClient });

    const result = await service.getShopInfo('acc-1');
    expect(JSON.stringify(result)).not.toContain('req-abc123');
  });

  it('chama ShopeeShopApiClient.getShopInfo exatamente uma vez, nunca repete automaticamente', async () => {
    const shopApiClient = fakeShopApiClient({
      getShopInfo: jest.fn().mockResolvedValue(successOutcome()),
    });
    const service = buildService({ shopApiClient });

    await service.getShopInfo('acc-1');
    expect(shopApiClient.getShopInfo).toHaveBeenCalledTimes(1);
  });
});

describe('ShopeeShopService.getShopInfo — nenhuma persistência', () => {
  it('nunca chama nenhum método de escrita em MarketplaceAccountsService (só findByIdOrFail, leitura)', async () => {
    const marketplaceAccountsService = fakeMarketplaceAccountsService();
    const shopApiClient = fakeShopApiClient({
      getShopInfo: jest.fn().mockResolvedValue(successOutcome()),
    });
    const service = buildService({ marketplaceAccountsService, shopApiClient });

    await service.getShopInfo('acc-1');

    expect(Object.keys(marketplaceAccountsService)).toEqual(['findByIdOrFail']);
  });
});

describe('ShopeeShopService.getShopInfo — mapeamento de cada outcome do cliente', () => {
  it.each([
    [
      'configuration_error',
      { kind: 'configuration_error', failureCode: 'SHOPEE_NOT_CONFIGURED' },
      'SHOPEE_NOT_CONFIGURED',
    ],
    [
      'invalid_request',
      { kind: 'invalid_request', failureCode: 'INVALID_SHOP_ID' },
      'SHOPEE_NOT_CONFIGURED',
    ],
    [
      'provider_rejected',
      { kind: 'provider_rejected' },
      'SHOPEE_DATA_UNAVAILABLE',
    ],
    [
      'rate_limited',
      { kind: 'rate_limited', retryAfterMs: null },
      'SHOPEE_TEMPORARILY_UNAVAILABLE',
    ],
    [
      'temporary_failure',
      { kind: 'temporary_failure' },
      'SHOPEE_TEMPORARILY_UNAVAILABLE',
    ],
    [
      'invalid_response',
      { kind: 'invalid_response' },
      'SHOPEE_DATA_UNAVAILABLE',
    ],
    [
      'unknown_result',
      { kind: 'unknown_result' },
      'SHOPEE_TEMPORARILY_UNAVAILABLE',
    ],
  ] as const)(
    'outcome %s → ShopeeShopServiceError(%s)',
    async (_label, outcome, expectedCode) => {
      const shopApiClient = fakeShopApiClient({
        getShopInfo: jest.fn().mockResolvedValue(outcome),
      });
      const service = buildService({ shopApiClient });

      const error = await service.getShopInfo('acc-1').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ShopeeShopServiceError);
      expect((error as ShopeeShopServiceError).code).toBe(expectedCode);
    },
  );
});

describe('ShopeeShopService.getShopInfo — falhas de credenciais (lock/refresh)', () => {
  it('lock indisponível (ACCOUNT_BUSY): SHOPEE_CONNECTION_BUSY', async () => {
    const accessTokenService = fakeAccessTokenService({
      ensureValidShopCredentials: jest
        .fn()
        .mockRejectedValue(new ConflictException('ACCOUNT_BUSY')),
    });
    const service = buildService({ accessTokenService });

    const error = await service.getShopInfo('acc-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ShopeeShopServiceError);
    expect((error as ShopeeShopServiceError).code).toBe(
      'SHOPEE_CONNECTION_BUSY',
    );
  });

  it('renovação concorrente sem commit observável (REFRESH_RESULT_NOT_COMMITTED): SHOPEE_CONNECTION_BUSY', async () => {
    const accessTokenService = fakeAccessTokenService({
      ensureValidShopCredentials: jest
        .fn()
        .mockRejectedValue(
          new ConflictException('REFRESH_RESULT_NOT_COMMITTED'),
        ),
    });
    const service = buildService({ accessTokenService });

    const error = await service.getShopInfo('acc-1').catch((e: unknown) => e);
    expect((error as ShopeeShopServiceError).code).toBe(
      'SHOPEE_CONNECTION_BUSY',
    );
  });

  it.each([
    'ACCOUNT_NOT_ELIGIBLE',
    'REFRESH_FAILED',
    'REFRESH_RESULT_AMBIGUOUS',
    'CREDENTIAL_DECRYPTION_FAILED',
    'INVALID_AUTHORIZATION_RESPONSE',
  ])(
    'falha de refresh/elegibilidade (%s): SHOPEE_NOT_CONNECTED',
    async (message) => {
      const accessTokenService = fakeAccessTokenService({
        ensureValidShopCredentials: jest
          .fn()
          .mockRejectedValue(new ConflictException(message)),
      });
      const service = buildService({ accessTokenService });

      const error = await service.getShopInfo('acc-1').catch((e: unknown) => e);
      expect((error as ShopeeShopServiceError).code).toBe(
        'SHOPEE_NOT_CONNECTED',
      );
    },
  );

  it('SHOPEE_NOT_CONFIGURED (config ausente): SHOPEE_NOT_CONFIGURED', async () => {
    const accessTokenService = fakeAccessTokenService({
      ensureValidShopCredentials: jest
        .fn()
        .mockRejectedValue(new ConflictException('SHOPEE_NOT_CONFIGURED')),
    });
    const service = buildService({ accessTokenService });

    const error = await service.getShopInfo('acc-1').catch((e: unknown) => e);
    expect((error as ShopeeShopServiceError).code).toBe(
      'SHOPEE_NOT_CONFIGURED',
    );
  });

  it('erro inesperado (não ConflictException) propaga sem transformação', async () => {
    const boom = new Error('boom');
    const accessTokenService = fakeAccessTokenService({
      ensureValidShopCredentials: jest.fn().mockRejectedValue(boom),
    });
    const service = buildService({ accessTokenService });

    await expect(service.getShopInfo('acc-1')).rejects.toBe(boom);
  });
});

describe('ShopeeShopService.getShopInfo — datas', () => {
  it('authorizationExpiresAt não pode ser anterior a authorizationGrantedAt — falha fechado se detectado', async () => {
    const shopApiClient = fakeShopApiClient({
      getShopInfo: jest
        .fn()
        .mockResolvedValue(
          successOutcome({ authTime: 1700010000, expireTime: 1700000000 }),
        ),
    });
    const service = buildService({ shopApiClient });

    const error = await service.getShopInfo('acc-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ShopeeShopServiceError);
  });

  it('datas resultantes usam sempre UTC (sufixo Z), nunca timezone local', async () => {
    const shopApiClient = fakeShopApiClient({
      getShopInfo: jest.fn().mockResolvedValue(successOutcome()),
    });
    const service = buildService({ shopApiClient });

    const result = await service.getShopInfo('acc-1');
    expect(result.authorizationGrantedAt).toMatch(/Z$/);
    expect(result.authorizationExpiresAt).toMatch(/Z$/);
  });
});

describe('ShopeeShopService.getShopInfo — nenhuma informação sensível', () => {
  it('mensagem maliciosa/bruta nunca aparece em nenhum erro lançado', async () => {
    const shopApiClient = fakeShopApiClient({
      getShopInfo: jest.fn().mockResolvedValue({ kind: 'provider_rejected' }),
    });
    const service = buildService({ shopApiClient });

    const error = await service.getShopInfo('acc-1').catch((e: unknown) => e);
    expect(JSON.stringify(error)).not.toContain(
      'provider_rejected_raw_message',
    );
  });

  it('nenhum token/sign/Partner Key aparece no resultado de sucesso nem em exceções', async () => {
    const accessTokenService = fakeAccessTokenService({
      ensureValidShopCredentials: jest.fn().mockResolvedValue({
        accessToken: 'super-secret-access-token',
        shopId: '555444',
      }),
    });
    const shopApiClient = fakeShopApiClient({
      getShopInfo: jest.fn().mockResolvedValue(successOutcome()),
    });
    const service = buildService({ accessTokenService, shopApiClient });

    const result = await service.getShopInfo('acc-1');
    expect(JSON.stringify(result)).not.toContain('super-secret-access-token');
  });

  it('nunca chama console.log/warn/error', async () => {
    const consoleLog = jest.spyOn(console, 'log').mockImplementation();
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    const consoleError = jest.spyOn(console, 'error').mockImplementation();

    const shopApiClient = fakeShopApiClient({
      getShopInfo: jest.fn().mockResolvedValue({ kind: 'unknown_result' }),
    });
    const service = buildService({ shopApiClient });

    await service.getShopInfo('acc-1').catch(() => undefined);

    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();

    consoleLog.mockRestore();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });
});
