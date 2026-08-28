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
});
