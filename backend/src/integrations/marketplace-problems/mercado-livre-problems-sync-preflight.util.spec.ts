import { ConflictException } from '@nestjs/common';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import {
  MercadoLivreProblemsSyncPreflight,
  ProblemsSyncError,
} from './mercado-livre-problems-sync-preflight.util';

function account(
  overrides: Partial<MarketplaceAccount> = {},
): MarketplaceAccount {
  return {
    id: 'acc-1',
    marketplace: Marketplace.MERCADO_LIVRE,
    externalSellerId: '1548451374',
    nickname: 'EZIEHOME',
    status: MarketplaceAccountStatus.CONNECTED,
    errorSummary: null,
    failureCode: null,
    encryptedAccessToken: null,
    encryptedRefreshToken: null,
    encryptedCredentialMetadata: null,
    connectedByUserId: null,
    tokenVersion: 1,
    refreshFailureCount: 0,
    refreshRetryAt: null,
    lastRefreshAttemptAt: null,
    tokenExpiresAt: null,
    lastSuccessfulSyncAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function build(
  overrides: {
    marketplaceAccountsService?: Record<string, jest.Mock>;
    oauthService?: Record<string, jest.Mock>;
  } = {},
) {
  const marketplaceAccountsService = {
    findByIdOrFail: jest.fn().mockResolvedValue(account()),
    ...overrides.marketplaceAccountsService,
  };
  const oauthService = {
    ensureValidAccessToken: jest.fn().mockResolvedValue('access-token'),
    ...overrides.oauthService,
  };
  const preflight = new MercadoLivreProblemsSyncPreflight(
    marketplaceAccountsService as never,
    oauthService as never,
  );
  return { preflight, marketplaceAccountsService, oauthService };
}

describe('MercadoLivreProblemsSyncPreflight.resolveAccountAndToken', () => {
  it('devolve accessToken e externalSellerId em caso de sucesso', async () => {
    const { preflight } = build();
    const result = await preflight.resolveAccountAndToken('acc-1');
    expect(result).toEqual({
      accessToken: 'access-token',
      externalSellerId: '1548451374',
    });
  });

  it.each([Marketplace.AMAZON, Marketplace.SHOPEE])(
    'lança ACCOUNT_NOT_CONNECTED quando marketplace é %s',
    async (marketplace) => {
      const { preflight } = build({
        marketplaceAccountsService: {
          findByIdOrFail: jest.fn().mockResolvedValue(account({ marketplace })),
        },
      });
      await expect(
        preflight.resolveAccountAndToken('acc-1'),
      ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_CONNECTED' });
    },
  );

  it('lança ACCOUNT_NOT_CONNECTED quando status não é CONNECTED', async () => {
    const { preflight } = build({
      marketplaceAccountsService: {
        findByIdOrFail: jest
          .fn()
          .mockResolvedValue(
            account({ status: MarketplaceAccountStatus.ERROR }),
          ),
      },
    });
    await expect(
      preflight.resolveAccountAndToken('acc-1'),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_CONNECTED' });
  });

  it('lança ACCOUNT_NOT_CONNECTED quando não há externalSellerId', async () => {
    const { preflight } = build({
      marketplaceAccountsService: {
        findByIdOrFail: jest
          .fn()
          .mockResolvedValue(account({ externalSellerId: null })),
      },
    });
    await expect(
      preflight.resolveAccountAndToken('acc-1'),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_CONNECTED' });
  });

  it.each([
    ['ACCOUNT_NOT_ELIGIBLE_FOR_TOKEN', 'ACCOUNT_NOT_CONNECTED'],
    ['ACCOUNT_BUSY', 'ACCOUNT_BUSY'],
    ['REFRESH_TOKEN_REJECTED', 'TOKEN_EXPIRED'],
    ['ML_APP_CONFIGURATION_ERROR', 'ML_APP_CONFIGURATION_ERROR'],
    ['REFRESH_TEMPORARY_FAILURE', 'TOKEN_REFRESH_PENDING'],
    ['REFRESH_OUTCOME_UNKNOWN', 'TOKEN_REFRESH_PENDING'],
    ['REFRESH_RESULT_NOT_COMMITTED', 'TOKEN_REFRESH_PENDING'],
    ['CREDENTIAL_DECRYPTION_FAILED', 'CREDENTIAL_DECRYPTION_FAILED'],
  ])(
    'mapeia ConflictException(%s) para ProblemsSyncError(%s)',
    async (oauthMessage, code) => {
      const { preflight } = build({
        oauthService: {
          ensureValidAccessToken: jest
            .fn()
            .mockRejectedValue(new ConflictException(oauthMessage)),
        },
      });
      await expect(
        preflight.resolveAccountAndToken('acc-1'),
      ).rejects.toMatchObject({ code });
    },
  );

  it('mensagem de ConflictException desconhecida cai no fallback TOKEN_REFRESH_PENDING', async () => {
    const { preflight } = build({
      oauthService: {
        ensureValidAccessToken: jest
          .fn()
          .mockRejectedValue(
            new ConflictException('UM_CODIGO_FUTURO_QUALQUER'),
          ),
      },
    });
    await expect(
      preflight.resolveAccountAndToken('acc-1'),
    ).rejects.toMatchObject({ code: 'TOKEN_REFRESH_PENDING' });
  });

  it('propaga erros que não são ConflictException sem transformar', async () => {
    const boom = new Error('falha inesperada');
    const { preflight } = build({
      oauthService: {
        ensureValidAccessToken: jest.fn().mockRejectedValue(boom),
      },
    });
    await expect(preflight.resolveAccountAndToken('acc-1')).rejects.toBe(boom);
  });

  it('erros de ProblemsSyncError são instâncias de Error com .code', async () => {
    const { preflight } = build({
      marketplaceAccountsService: {
        findByIdOrFail: jest
          .fn()
          .mockResolvedValue(account({ externalSellerId: null })),
      },
    });
    try {
      await preflight.resolveAccountAndToken('acc-1');
      throw new Error('deveria ter lançado');
    } catch (error) {
      expect(error).toBeInstanceOf(ProblemsSyncError);
      expect(error).toBeInstanceOf(Error);
    }
  });
});
