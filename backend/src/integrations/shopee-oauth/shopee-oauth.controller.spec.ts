import { GUARDS_METADATA, HEADERS_METADATA } from '@nestjs/common/constants';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { ShopeeOAuthController } from './shopee-oauth.controller';

function methodFn(name: 'connect' | 'callback'): object {
  // `@Header`/`@UseGuards` em método gravam metadados na FUNÇÃO
  // (`descriptor.value`), não em `prototype`+nome — ver mesmo padrão em
  // `amazon-connection.controller.spec.ts`.
  return Object.getOwnPropertyDescriptor(ShopeeOAuthController.prototype, name)
    ?.value as object;
}

describe('ShopeeOAuthController', () => {
  describe('connect', () => {
    it('24/12: exige AccessTokenGuard (autenticação + mesma permissão do Mercado Livre)', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        methodFn('connect'),
      ) as unknown[];
      expect(guards).toContain(AccessTokenGuard);
    });

    it('21: envia Cache-Control: no-store', () => {
      const headers = Reflect.getMetadata(
        HEADERS_METADATA,
        methodFn('connect'),
      ) as Array<{ name: string; value: string }>;
      expect(headers).toContainEqual({
        name: 'Cache-Control',
        value: 'no-store',
      });
    });

    it('20: delega ao service e devolve somente authorizationUrl', async () => {
      const service = {
        startConnection: jest.fn().mockResolvedValue({
          authorizationUrl: 'https://open.shopee.com.br/auth?...',
        }),
      };
      const controller = new ShopeeOAuthController(service as never);

      const result = await controller.connect('acc-1', {
        sub: 'user-1',
        email: 'a@b.com',
      });

      expect(service.startConnection).toHaveBeenCalledWith({
        marketplaceAccountId: 'acc-1',
        initiatedByUserId: 'user-1',
      });
      expect(Object.keys(result)).toEqual(['authorizationUrl']);
    });
  });

  describe('callback', () => {
    it('24: é público — nenhum guard registrado no método', () => {
      const guards: unknown = Reflect.getMetadata(
        GUARDS_METADATA,
        methodFn('callback'),
      );
      expect(guards).toBeUndefined();
    });

    it('31: envia Cache-Control: no-store', () => {
      const headers = Reflect.getMetadata(
        HEADERS_METADATA,
        methodFn('callback'),
      ) as Array<{ name: string; value: string }>;
      expect(headers).toContainEqual({
        name: 'Cache-Control',
        value: 'no-store',
      });
    });

    it('32: envia Referrer-Policy: no-referrer', () => {
      const headers = Reflect.getMetadata(
        HEADERS_METADATA,
        methodFn('callback'),
      ) as Array<{ name: string; value: string }>;
      expect(headers).toContainEqual({
        name: 'Referrer-Policy',
        value: 'no-referrer',
      });
    });

    it('25: redireciona (302) para a URL que o service devolve, nunca um corpo JSON', async () => {
      const service = {
        handleCallback: jest.fn().mockResolvedValue({
          redirectUrl: 'https://app.example.com/integracoes?shopee=success',
        }),
      };
      const controller = new ShopeeOAuthController(service as never);
      const res = { redirect: jest.fn(), set: jest.fn() };

      await controller.callback(
        { state: 's', code: 'c', shop_id: '1' },
        res as never,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        302,
        'https://app.example.com/integracoes?shopee=success',
      );
    });

    it('mapeia query.shop_id (snake_case) para shopId ao chamar o service — nunca passa parâmetros extras da query adiante', async () => {
      const service = {
        handleCallback: jest.fn().mockResolvedValue({
          redirectUrl: 'https://app.example.com/integracoes?shopee=success',
        }),
      };
      const controller = new ShopeeOAuthController(service as never);
      const res = { redirect: jest.fn() };

      await controller.callback(
        {
          state: 's',
          code: 'c',
          shop_id: '200000',
          // 34: parâmetro de redirect arbitrário na query — nunca lido.
          returnUrl: 'https://evil.example.com',
        },
        res as never,
      );

      expect(service.handleCallback).toHaveBeenCalledWith({
        state: 's',
        code: 'c',
        shopId: '200000',
      });
    });
  });
});
