import {
  resolveShopeeCredentialsErrorCode,
  resolveShopeeOrdersApiErrorCode,
  ShopeeOrdersSyncError,
} from './shopee-orders-sync-error';

describe('ShopeeOrdersSyncError', () => {
  it('a mensagem da exceção é exatamente o código, nunca um texto adicional', () => {
    const error = new ShopeeOrdersSyncError('NOT_CONNECTED');
    expect(error.message).toBe('NOT_CONNECTED');
    expect(error.code).toBe('NOT_CONNECTED');
  });
});

describe('resolveShopeeCredentialsErrorCode', () => {
  it.each([
    ['ACCOUNT_BUSY', 'CONNECTION_BUSY'],
    ['REFRESH_RESULT_NOT_COMMITTED', 'CONNECTION_BUSY'],
    ['SHOPEE_NOT_CONFIGURED', 'NOT_CONFIGURED'],
    ['ACCOUNT_NOT_ELIGIBLE', 'NOT_CONNECTED'],
    ['INVALID_AUTHORIZATION_RESPONSE', 'NOT_CONNECTED'],
    ['REFRESH_FAILED', 'NOT_CONNECTED'],
    ['REFRESH_RESULT_AMBIGUOUS', 'NOT_CONNECTED'],
    ['CREDENTIAL_DECRYPTION_FAILED', 'NOT_CONNECTED'],
  ] as const)(
    'mapeia ConflictException "%s" para "%s" (mesma classificação de ShopeeShopService.mapCredentialsError)',
    (conflictMessage, expectedCode) => {
      expect(resolveShopeeCredentialsErrorCode(conflictMessage)).toBe(
        expectedCode,
      );
    },
  );

  it('qualquer mensagem desconhecida cai fechada em NOT_CONNECTED, nunca propaga crua', () => {
    expect(resolveShopeeCredentialsErrorCode('ALGUM_CODIGO_NOVO')).toBe(
      'NOT_CONNECTED',
    );
  });
});

describe('resolveShopeeOrdersApiErrorCode', () => {
  it.each([
    ['configuration_error', 'NOT_CONFIGURED'],
    ['invalid_request', 'NOT_CONFIGURED'],
    ['provider_rejected', 'DATA_UNAVAILABLE'],
    ['invalid_response', 'DATA_UNAVAILABLE'],
    ['rate_limited', 'TEMPORARILY_UNAVAILABLE'],
    ['temporary_failure', 'TEMPORARILY_UNAVAILABLE'],
    ['unknown_result', 'TEMPORARILY_UNAVAILABLE'],
  ] as const)(
    'mapeia o outcome "%s" do cliente para "%s"',
    (kind, expectedCode) => {
      expect(resolveShopeeOrdersApiErrorCode(kind)).toBe(expectedCode);
    },
  );
});
