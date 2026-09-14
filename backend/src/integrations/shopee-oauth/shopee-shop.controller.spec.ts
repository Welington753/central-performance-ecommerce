import { GUARDS_METADATA, HEADERS_METADATA } from '@nestjs/common/constants';
import {
  BadGatewayException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { ShopeeShopController } from './shopee-shop.controller';
import { ShopeeShopServiceError } from './shopee-shop.service';

function methodFn(): object {
  // `@Header`/`@UseGuards` em método gravam metadados na FUNÇÃO
  // (`descriptor.value`), não em `prototype`+nome — mesmo padrão de
  // `shopee-oauth.controller.spec.ts`.
  return Object.getOwnPropertyDescriptor(
    ShopeeShopController.prototype,
    'getShopInfo',
  )?.value as object;
}

const PUBLIC_DTO = {
  shopName: 'Loja Exemplo',
  region: 'BR',
  status: 'NORMAL' as const,
  authorizationGrantedAt: '2023-11-14T22:13:20.000Z',
  authorizationExpiresAt: '2023-11-16T02:13:20.000Z',
  merchantId: null,
};

describe('ShopeeShopController.getShopInfo', () => {
  it('exige AccessTokenGuard explícito', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      methodFn(),
    ) as unknown[];
    expect(guards).toContain(AccessTokenGuard);
  });

  it('envia Cache-Control: no-store', () => {
    const headers = Reflect.getMetadata(HEADERS_METADATA, methodFn()) as Array<{
      name: string;
      value: string;
    }>;
    expect(headers).toContainEqual({
      name: 'Cache-Control',
      value: 'no-store',
    });
  });

  it('delega ao service com o accountId recebido e devolve exatamente o DTO público', async () => {
    const service = { getShopInfo: jest.fn().mockResolvedValue(PUBLIC_DTO) };
    const controller = new ShopeeShopController(service as never);

    const result = await controller.getShopInfo('acc-1');

    expect(service.getShopInfo).toHaveBeenCalledWith('acc-1');
    expect(result).toBe(PUBLIC_DTO);
  });

  it('a resposta contém exatamente os seis campos públicos documentados', async () => {
    const service = { getShopInfo: jest.fn().mockResolvedValue(PUBLIC_DTO) };
    const controller = new ShopeeShopController(service as never);

    const result = await controller.getShopInfo('acc-1');

    expect(Object.keys(result)).toEqual([
      'shopName',
      'region',
      'status',
      'authorizationGrantedAt',
      'authorizationExpiresAt',
      'merchantId',
    ]);
  });

  it('a assinatura do método só aceita o accountId (via @Param) — nenhum @Query/@Body declarado para controlar a chamada', () => {
    // `getShopInfo` tem aridade 1 (só `id`) — nenhum segundo parâmetro
    // (`@Query`/`@Body`) que pudesse aceitar token/shopId/environment/host/
    // path/returnUrl vindos do cliente.
    expect(ShopeeShopController.prototype.getShopInfo.length).toBe(1);
  });

  it('nenhum token ou identificador interno (shopId) aparece na resposta delegada', async () => {
    const service = { getShopInfo: jest.fn().mockResolvedValue(PUBLIC_DTO) };
    const controller = new ShopeeShopController(service as never);

    const result = await controller.getShopInfo('acc-1');
    expect(JSON.stringify(result)).not.toMatch(
      /shopId|accessToken|partnerKey|sign/i,
    );
  });

  it.each([
    ['SHOPEE_NOT_CONNECTED', ConflictException],
    ['SHOPEE_CONNECTION_BUSY', ConflictException],
    ['SHOPEE_NOT_CONFIGURED', ConflictException],
    ['SHOPEE_DATA_UNAVAILABLE', BadGatewayException],
    ['SHOPEE_TEMPORARILY_UNAVAILABLE', ServiceUnavailableException],
  ] as const)(
    'mapeia ShopeeShopServiceError(%s) para %s',
    async (code, expectedType) => {
      const service = {
        getShopInfo: jest
          .fn()
          .mockRejectedValue(new ShopeeShopServiceError(code)),
      };
      const controller = new ShopeeShopController(service as never);

      await expect(controller.getShopInfo('acc-1')).rejects.toBeInstanceOf(
        expectedType,
      );
    },
  );

  it('erro não reconhecido (não ShopeeShopServiceError) propaga sem transformação', async () => {
    const boom = new Error('boom');
    const service = { getShopInfo: jest.fn().mockRejectedValue(boom) };
    const controller = new ShopeeShopController(service as never);

    await expect(controller.getShopInfo('acc-1')).rejects.toBe(boom);
  });
});
