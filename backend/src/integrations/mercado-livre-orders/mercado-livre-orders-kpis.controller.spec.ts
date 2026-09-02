import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { MarketplaceAccountStatus } from '../marketplace-accounts/marketplace-account.entity';
import { MercadoLivreOrdersKpisController } from './mercado-livre-orders-kpis.controller';

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acc-1',
    externalSellerId: '1548451374',
    nickname: 'EZIEHOME',
    status: MarketplaceAccountStatus.CONNECTED,
    lastSuccessfulSyncAt: null,
    failureCode: 'SHOULD_NEVER_LEAK',
    connectedByUserId: 'SHOULD_NEVER_LEAK',
    encryptedAccessToken: 'SHOULD_NEVER_LEAK',
    ...overrides,
  };
}

function buildController(
  overrides: {
    kpiService?: Record<string, jest.Mock>;
    marketplaceAccountsService?: Record<string, jest.Mock>;
  } = {},
) {
  const kpiService = { getAggregate: jest.fn(), ...overrides.kpiService };
  const marketplaceAccountsService = {
    findByIdOrFail: jest.fn().mockResolvedValue(account()),
    ...overrides.marketplaceAccountsService,
  };
  const controller = new MercadoLivreOrdersKpisController(
    kpiService as never,
    marketplaceAccountsService as never,
  );
  return { controller, kpiService, marketplaceAccountsService };
}

describe('MercadoLivreOrdersKpisController', () => {
  it('requires AccessTokenGuard at the class level (endpoint protegido)', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      MercadoLivreOrdersKpisController,
    ) as unknown[];
    expect(guards).toContain(AccessTokenGuard);
  });

  describe('getKpis', () => {
    it('returns a DTO that never contains failureCode, connectedByUserId or encrypted* fields', async () => {
      const { controller } = buildController({
        kpiService: {
          getAggregate: jest.fn().mockResolvedValue({
            currentWindow: { from: new Date(0), to: new Date(0) },
            previousWindow: { from: new Date(0), to: new Date(0) },
            current: { grossRevenueCents: 0n, orders: 0, units: 0 },
            previous: { grossRevenueCents: 0n, orders: 0, units: 0 },
            topProducts: [],
          }),
        },
      });

      const dto = await controller.getKpis('acc-1');
      const serialized = JSON.stringify(dto);
      expect(serialized).not.toContain('SHOULD_NEVER_LEAK');
      expect(dto.account).toEqual({
        id: 'acc-1',
        externalSellerId: '1548451374',
        nickname: 'EZIEHOME',
      });
    });
  });
});
