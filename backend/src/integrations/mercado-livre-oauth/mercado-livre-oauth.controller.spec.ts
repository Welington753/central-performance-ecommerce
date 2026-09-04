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

describe('MercadoLivreOAuthController.recover', () => {
  it('delegates to the service and returns the outcome as a 200 JSON body — never an exception for a normal recoverable outcome', async () => {
    const service = {
      recoverConnection: jest.fn().mockResolvedValue('RECOVERED'),
    };
    const controller = new MercadoLivreOAuthController(service as never);

    const result = await controller.recover('acc-1');

    expect(service.recoverConnection).toHaveBeenCalledWith('acc-1');
    expect(result).toEqual({ outcome: 'RECOVERED' });
  });

  it.each(['PENDING_RETRY', 'RECONNECT_REQUIRED', 'CONFIGURATION_ERROR'])(
    'passes through the %s outcome unchanged',
    async (outcome) => {
      const service = {
        recoverConnection: jest.fn().mockResolvedValue(outcome),
      };
      const controller = new MercadoLivreOAuthController(service as never);

      expect(await controller.recover('acc-1')).toEqual({ outcome });
    },
  );

  it('propagates a service exception (e.g. ACCOUNT_NOT_RECOVERABLE) instead of swallowing it', async () => {
    const service = {
      recoverConnection: jest
        .fn()
        .mockRejectedValue(new Error('ACCOUNT_NOT_RECOVERABLE')),
    };
    const controller = new MercadoLivreOAuthController(service as never);

    await expect(controller.recover('acc-1')).rejects.toThrow(
      /ACCOUNT_NOT_RECOVERABLE/,
    );
  });
});
