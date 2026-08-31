import { MercadoLivreOAuthController } from './mercado-livre-oauth.controller';

describe('MercadoLivreOAuthController.connect', () => {
  it('delegates to the service with the account id and the authenticated user id', async () => {
    const service = {
      startConnection: jest.fn().mockResolvedValue({
        authorizationUrl: 'https://auth.mercadolivre.com.br/authorization?...',
      }),
    };
    const controller = new MercadoLivreOAuthController(service as never);

    const result = await controller.connect('acc-1', {
      sub: 'user-1',
      email: 'a@b.com',
    });

    expect(service.startConnection).toHaveBeenCalledWith({
      marketplaceAccountId: 'acc-1',
      initiatedByUserId: 'user-1',
    });
    expect(result.authorizationUrl).toContain('authorization');
  });

  it('callback: redirects (302) to whatever URL the service returns, never a JSON body', async () => {
    const service = {
      handleCallback: jest.fn().mockResolvedValue({
        redirectUrl:
          'https://app.example.com/integracoes?ml=success&reason=success',
      }),
    };
    const controller = new MercadoLivreOAuthController(service as never);
    const res = { redirect: jest.fn() };

    await controller.callback({ state: 's', code: 'c' }, res as never);

    expect(service.handleCallback).toHaveBeenCalledWith({
      state: 's',
      code: 'c',
    });
    expect(res.redirect).toHaveBeenCalledWith(
      302,
      'https://app.example.com/integracoes?ml=success&reason=success',
    );
  });
});
