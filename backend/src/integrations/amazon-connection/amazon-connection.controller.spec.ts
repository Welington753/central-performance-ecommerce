import { GUARDS_METADATA, HEADERS_METADATA } from '@nestjs/common/constants';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { AmazonConnectionController } from './amazon-connection.controller';

function buildController(
  overrides: { service?: Record<string, jest.Mock> } = {},
) {
  const service = {
    getSetupStatus: jest.fn(),
    provision: jest.fn(),
    verify: jest.fn(),
    ...overrides.service,
  };
  const controller = new AmazonConnectionController(service as never);
  return { controller, service };
}

const CURRENT_USER = { sub: 'user-1', email: 'user@example.com' } as never;

describe('AmazonConnectionController', () => {
  it('requires AccessTokenGuard at the class level (protegido, mesmo mecanismo do Mercado Livre)', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AmazonConnectionController,
    ) as unknown[];
    expect(guards).toContain(AccessTokenGuard);
  });

  describe('setupStatus', () => {
    it('sends Cache-Control: no-store', () => {
      // `@Header` grava metadados na FUNÇÃO do método (`descriptor.value`),
      // não em `prototype`+nome — `getOwnPropertyDescriptor(...).value`
      // (em vez de `prototype.setupStatus` direto) evita o falso positivo
      // do lint `unbound-method`, já que nunca acessamos o método como uma
      // referência "solta" de instância.
      const setupStatusFn = Object.getOwnPropertyDescriptor(
        AmazonConnectionController.prototype,
        'setupStatus',
      )?.value as unknown;
      const headers = Reflect.getMetadata(
        HEADERS_METADATA,
        setupStatusFn as object,
      ) as Array<{ name: string; value: string }>;
      expect(headers).toContainEqual({
        name: 'Cache-Control',
        value: 'no-store',
      });
    });

    it('delegates to the service and returns its result unchanged', async () => {
      const status = {
        applicationConfigured: true,
        missingConfigurationKeys: [],
        hasAccount: false,
        accounts: [],
        canProvision: true,
        canVerify: false,
        canSynchronize: false,
      };
      const { controller, service } = buildController({
        service: { getSetupStatus: jest.fn().mockResolvedValue(status) },
      });

      const result = await controller.setupStatus();

      expect(service.getSetupStatus).toHaveBeenCalledWith();
      expect(result).toEqual(status);
    });
  });

  describe('provision', () => {
    it('delegates to the service with the account id, the closed DTO, and the authenticated user id', async () => {
      const { controller, service } = buildController({
        service: {
          provision: jest.fn().mockResolvedValue({ id: 'acc-1' }),
        },
      });
      const dto = {
        sellingPartnerId: 'A1SELLERPARTNERID',
        refreshToken: 'Atzr|refresh',
      };

      await controller.provision('acc-1', dto, CURRENT_USER);

      expect(service.provision).toHaveBeenCalledWith('acc-1', dto, 'user-1');
    });
  });

  describe('verify', () => {
    it('delegates to the service with only the account id', async () => {
      const result = {
        connected: true,
        code: 'VERIFIED',
        verifiedAt: '2026-09-03T12:00:00.000Z',
        marketplaceCount: 1,
      };
      const { controller, service } = buildController({
        service: { verify: jest.fn().mockResolvedValue(result) },
      });

      const response = await controller.verify('acc-1');

      expect(service.verify).toHaveBeenCalledWith('acc-1');
      expect(response).toEqual(result);
    });
  });
});
