import { ShopeeOrdersApiClient } from './shopee-orders-api.client';
import {
  ACCESS_TOKEN,
  fixedClock,
  jsonResponse,
  makeCredentialsService,
  SHOP_ID,
  textResponse,
  VALID_ORDER_LIST_INPUT,
  VALID_ORDER_SN_LIST,
  validOrderDetailBody,
  validOrderDetailOrder,
  validOrderListBody,
} from './shopee-orders-api.client.test-helpers';

/**
 * Diagnóstico sanitizado anexado ao outcome (instrumentação de
 * DATA_UNAVAILABLE) — nunca corpo bruto, nunca `raw.message`, nunca
 * `order_sn`. Split próprio (mesmo padrão de `.outcomes.spec.ts`/
 * `.security.spec.ts`) para não misturar com os testes de forma pura de
 * outcome já existentes.
 */
describe('ShopeeOrdersApiClient.getOrderList - diagnostico sanitizado', () => {
  it('provider_rejected: propaga httpStatus e providerErrorCode sanitizado a partir de raw.error', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        error: 'error_shop',
        message: 'shopid is invalid',
        request_id: 'req-abc123',
      }),
    );
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderList({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      ...VALID_ORDER_LIST_INPUT,
    });

    expect(outcome).toEqual({
      kind: 'provider_rejected',
      diagnostics: {
        httpStatus: 200,
        providerErrorCode: 'error_shop',
        providerRequestId: 'req-abc123',
      },
    });
  });

  it('provider_rejected: raw.error malformado (espaco/HTML) vira UNCLASSIFIED_PROVIDER_ERROR, nunca o valor bruto', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        error: '<script>alert(1)</script>',
        message: 'malicious',
      }),
    );
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderList({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      ...VALID_ORDER_LIST_INPUT,
    });

    expect(outcome).toEqual({
      kind: 'provider_rejected',
      diagnostics: {
        httpStatus: 200,
        providerErrorCode: 'UNCLASSIFIED_PROVIDER_ERROR',
      },
    });
    expect(JSON.stringify(outcome)).not.toContain('<script>');
    expect(JSON.stringify(outcome)).not.toContain('malicious');
  });

  it('provider_rejected: request_id ausente nunca aparece no diagnostico (campo omitido)', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { error: 'error_param', message: 'bad request' }),
      );
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderList({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      ...VALID_ORDER_LIST_INPUT,
    });

    expect(outcome).toEqual({
      kind: 'provider_rejected',
      diagnostics: { httpStatus: 200, providerErrorCode: 'error_param' },
    });
    expect(
      Object.prototype.hasOwnProperty.call(
        (outcome as { diagnostics: object }).diagnostics,
        'providerRequestId',
      ),
    ).toBe(false);
  });

  it('invalid_response (schema divergente): httpStatus presente, nunca raw.message/campos extras', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { foo: 'bar' }));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderList({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      ...VALID_ORDER_LIST_INPUT,
    });

    expect(outcome).toEqual({
      kind: 'invalid_response',
      diagnostics: { httpStatus: 200 },
    });
  });

  it('invalid_response (JSON invalido): httpStatus presente, sem providerRequestId (corpo nunca foi parseado)', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(textResponse(200, 'not-json{{'));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderList({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      ...VALID_ORDER_LIST_INPUT,
    });

    expect(outcome).toEqual({
      kind: 'invalid_response',
      diagnostics: { httpStatus: 200 },
    });
  });

  it('rate_limited: httpStatus 429 presente no diagnostico', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(429, {}));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderList({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      ...VALID_ORDER_LIST_INPUT,
    });

    expect(outcome).toEqual({
      kind: 'rate_limited',
      retryAfterMs: null,
      diagnostics: { httpStatus: 429 },
    });
  });

  it('temporary_failure: httpStatus 5xx presente no diagnostico', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(503, {}));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderList({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      ...VALID_ORDER_LIST_INPUT,
    });

    expect(outcome).toEqual({
      kind: 'temporary_failure',
      diagnostics: { httpStatus: 503 },
    });
  });

  it('unknown_result: nunca tem diagnostics (nenhuma resposta completa foi recebida)', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderList({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      ...VALID_ORDER_LIST_INPUT,
    });

    expect(outcome).toEqual({ kind: 'unknown_result' });
  });

  it('sucesso: outcome nunca carrega diagnostics', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, validOrderListBody()));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderList({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      ...VALID_ORDER_LIST_INPUT,
    });

    expect(Object.prototype.hasOwnProperty.call(outcome, 'diagnostics')).toBe(
      false,
    );
  });
});

describe('ShopeeOrdersApiClient.getOrderDetail - diagnostico sanitizado', () => {
  it('provider_rejected: propaga httpStatus e providerErrorCode sanitizado', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        error: 'error_order_not_umi',
        message: 'sensitive detail',
        request_id: 'req-xyz789',
      }),
    );
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList: VALID_ORDER_SN_LIST,
    });

    expect(outcome).toEqual({
      kind: 'provider_rejected',
      diagnostics: {
        httpStatus: 200,
        providerErrorCode: 'error_order_not_umi',
        providerRequestId: 'req-xyz789',
      },
    });
    expect(JSON.stringify(outcome)).not.toContain('sensitive detail');
    expect(JSON.stringify(outcome)).not.toContain(VALID_ORDER_SN_LIST[0]);
  });

  it('invalid_response: nunca inclui order_sn nem corpo bruto', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { foo: 'bar' }));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList: VALID_ORDER_SN_LIST,
    });

    expect(outcome).toEqual({
      kind: 'invalid_response',
      diagnostics: {
        httpStatus: 200,
        validationIssueCode: 'ERROR_NOT_STRING',
        validationFieldPath: 'error',
        validationActualType: 'missing',
      },
    });
    expect(JSON.stringify(outcome)).not.toContain(VALID_ORDER_SN_LIST[0]);
  });

  it('invalid_response: propaga o issue code estrutural e o indice do pedido no lote', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(
        200,
        validOrderDetailBody({
          orders: [validOrderDetailOrder({ total_amount: 'R$ 1.004,00' })],
        }),
      ),
    );
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList: VALID_ORDER_SN_LIST,
    });

    expect(outcome).toEqual({
      kind: 'invalid_response',
      diagnostics: {
        httpStatus: 200,
        providerRequestId: 'req-abc123',
        validationIssueCode: 'TOTAL_AMOUNT_INVALID',
        validationFieldPath: 'response.order_list[].total_amount',
        validationActualType: 'string',
        validationOrderIndex: 0,
      },
    });
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain('1.004');
    expect(serialized).not.toContain(VALID_ORDER_SN_LIST[0]);
    expect(serialized).not.toContain('backpack');
    expect(serialized).not.toContain('QAZ-SADOER-05');
  });

  it('invalid_response por JSON ilegivel: nunca inventa issue code de validacao', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(textResponse(200, 'not-json{{'));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList: VALID_ORDER_SN_LIST,
    });

    expect(outcome).toEqual({
      kind: 'invalid_response',
      diagnostics: { httpStatus: 200 },
    });
  });

  it('getOrderList invalido nunca ganha campos de issue de detalhe', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { foo: 'bar' }));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderList({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      ...VALID_ORDER_LIST_INPUT,
    });

    expect(outcome).toEqual({
      kind: 'invalid_response',
      diagnostics: { httpStatus: 200 },
    });
  });

  it('sucesso de detalhe continua sem diagnostics', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, validOrderDetailBody()));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList: VALID_ORDER_SN_LIST,
    });

    expect(outcome.kind).toBe('success');
    expect(Object.prototype.hasOwnProperty.call(outcome, 'diagnostics')).toBe(
      false,
    );
  });
});
