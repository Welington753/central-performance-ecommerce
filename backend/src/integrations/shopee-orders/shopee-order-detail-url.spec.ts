import * as shopeeShopApiUrl from '../shopee-oauth/shopee-shop-api-url';
import { buildShopeeOrderDetailUrl } from './shopee-order-detail-url';

const BASE_PARAMS = {
  partnerId: '1000000',
  timestampSeconds: 1700000000,
  accessToken: 'access-token-example',
  shopId: '200000',
  sign: 'a'.repeat(64),
  orderSnList: ['201214JAJXU6G7', '201214JASXYXY6'],
};

describe('buildShopeeOrderDetailUrl', () => {
  it('builds the exact Sandbox URL', () => {
    const url = buildShopeeOrderDetailUrl({
      environment: 'SANDBOX',
      ...BASE_PARAMS,
    });

    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('openplatform.sandbox.test-stable.shopee.sg');
    expect(url.pathname).toBe('/api/v2/order/get_order_detail');
  });

  it('builds the exact Production Brazil URL', () => {
    const url = buildShopeeOrderDetailUrl({
      environment: 'PRODUCTION',
      ...BASE_PARAMS,
    });

    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('openplatform.shopee.com.br');
    expect(url.pathname).toBe('/api/v2/order/get_order_detail');
  });

  it('never falls back from Sandbox to Production or vice-versa', () => {
    const sandboxUrl = buildShopeeOrderDetailUrl({
      environment: 'SANDBOX',
      ...BASE_PARAMS,
    });
    const productionUrl = buildShopeeOrderDetailUrl({
      environment: 'PRODUCTION',
      ...BASE_PARAMS,
    });
    expect(sandboxUrl.hostname).not.toBe(productionUrl.hostname);
  });

  it('joins order_sn_list with a comma, and sets a fixed, closed response_optional_fields', () => {
    const url = buildShopeeOrderDetailUrl({
      environment: 'SANDBOX',
      ...BASE_PARAMS,
    });

    expect(url.searchParams.get('order_sn_list')).toBe(
      '201214JAJXU6G7,201214JASXYXY6',
    );
    expect(url.searchParams.get('response_optional_fields')).toBe(
      'total_amount,item_list,fulfillment_flag',
    );
  });

  it('sets exactly the seven required query parameters, nothing more', () => {
    const url = buildShopeeOrderDetailUrl({
      environment: 'SANDBOX',
      ...BASE_PARAMS,
    });

    const keys = [...url.searchParams.keys()].sort();
    expect(keys).toEqual(
      [
        'access_token',
        'order_sn_list',
        'partner_id',
        'response_optional_fields',
        'shop_id',
        'sign',
        'timestamp',
      ].sort(),
    );
  });

  it('never accepts a caller-supplied response_optional_fields (interface has no such param)', () => {
    const url = buildShopeeOrderDetailUrl({
      environment: 'SANDBOX',
      ...BASE_PARAMS,
      // @ts-expect-error - response_optional_fields nao existe no tipo do parametro
      responseOptionalFields: 'buyer_user_id,recipient_address',
    });
    expect(url.searchParams.get('response_optional_fields')).toBe(
      'total_amount,item_list,fulfillment_flag',
    );
  });

  it('never leaves a hash/fragment in the built URL', () => {
    const url = buildShopeeOrderDetailUrl({
      environment: 'PRODUCTION',
      ...BASE_PARAMS,
    });
    expect(url.hash).toBe('');
  });

  it('is wired to the SAME host allowlist guard already proven exhaustively in shopee-shop-api-url.spec.ts', () => {
    const spy = jest.spyOn(shopeeShopApiUrl, 'assertAllowedShopApiHost');

    buildShopeeOrderDetailUrl({ environment: 'SANDBOX', ...BASE_PARAMS });

    expect(spy).toHaveBeenCalledTimes(1);
    const [calledWith] = spy.mock.calls[0];
    expect(calledWith.hostname).toBe(
      'openplatform.sandbox.test-stable.shopee.sg',
    );
    spy.mockRestore();
  });
});
