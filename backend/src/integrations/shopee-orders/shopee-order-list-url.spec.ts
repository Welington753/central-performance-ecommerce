import * as shopeeShopApiUrl from '../shopee-oauth/shopee-shop-api-url';
import { buildShopeeOrderListUrl } from './shopee-order-list-url';

const BASE_PARAMS = {
  partnerId: '1000000',
  timestampSeconds: 1700000000,
  accessToken: 'access-token-example',
  shopId: '200000',
  sign: 'a'.repeat(64),
  timeRangeField: 'create_time' as const,
  timeFrom: 1700000000,
  timeTo: 1700003600,
  pageSize: 20,
  cursor: null,
};

describe('buildShopeeOrderListUrl', () => {
  it('builds the exact Sandbox URL', () => {
    const url = buildShopeeOrderListUrl({
      environment: 'SANDBOX',
      ...BASE_PARAMS,
    });

    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('openplatform.sandbox.test-stable.shopee.sg');
    expect(url.pathname).toBe('/api/v2/order/get_order_list');
  });

  it('builds the exact Production Brazil URL', () => {
    const url = buildShopeeOrderListUrl({
      environment: 'PRODUCTION',
      ...BASE_PARAMS,
    });

    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('openplatform.shopee.com.br');
    expect(url.pathname).toBe('/api/v2/order/get_order_list');
  });

  it('never falls back from Sandbox to Production or vice-versa', () => {
    const sandboxUrl = buildShopeeOrderListUrl({
      environment: 'SANDBOX',
      ...BASE_PARAMS,
    });
    const productionUrl = buildShopeeOrderListUrl({
      environment: 'PRODUCTION',
      ...BASE_PARAMS,
    });

    expect(sandboxUrl.hostname).not.toBe(productionUrl.hostname);
  });

  it('sets exactly the nine required query parameters when cursor is null (no cursor param)', () => {
    const url = buildShopeeOrderListUrl({
      environment: 'SANDBOX',
      ...BASE_PARAMS,
    });

    const keys = [...url.searchParams.keys()].sort();
    expect(keys).toEqual(
      [
        'access_token',
        'page_size',
        'partner_id',
        'shop_id',
        'sign',
        'time_from',
        'time_range_field',
        'time_to',
        'timestamp',
      ].sort(),
    );
    expect(url.searchParams.get('partner_id')).toBe(BASE_PARAMS.partnerId);
    expect(url.searchParams.get('timestamp')).toBe(
      String(BASE_PARAMS.timestampSeconds),
    );
    expect(url.searchParams.get('access_token')).toBe(BASE_PARAMS.accessToken);
    expect(url.searchParams.get('shop_id')).toBe(BASE_PARAMS.shopId);
    expect(url.searchParams.get('sign')).toBe(BASE_PARAMS.sign);
    expect(url.searchParams.get('time_range_field')).toBe('create_time');
    expect(url.searchParams.get('time_from')).toBe('1700000000');
    expect(url.searchParams.get('time_to')).toBe('1700003600');
    expect(url.searchParams.get('page_size')).toBe('20');
  });

  it('includes the cursor param, correctly encoded, when a cursor is provided', () => {
    const url = buildShopeeOrderListUrl({
      environment: 'SANDBOX',
      ...BASE_PARAMS,
      cursor: '20+extra/value=x&y',
    });

    expect(url.searchParams.has('cursor')).toBe(true);
    expect(url.searchParams.get('cursor')).toBe('20+extra/value=x&y');
    expect([...url.searchParams.keys()]).toHaveLength(10);
  });

  it('never leaves a hash/fragment in the built URL', () => {
    const url = buildShopeeOrderListUrl({
      environment: 'PRODUCTION',
      ...BASE_PARAMS,
    });
    expect(url.hash).toBe('');
  });

  it('is wired to the SAME host allowlist guard already proven exhaustively in shopee-shop-api-url.spec.ts (old/incorrect host, look-alike domain, suffix trick)', () => {
    // O builder nunca aceita host externo por parâmetro — host antigo,
    // domínio parecido e truque de sufixo já são cobertos exaustivamente
    // pelos testes de `assertAllowedShopApiHost` em
    // `shopee-shop-api-url.spec.ts`. Duplicar cada caso aqui violaria "não
    // duplicar suítes" - em vez disso, este teste prova que
    // `buildShopeeOrderListUrl` de fato invoca essa MESMA função (nenhuma
    // cópia própria, nenhuma checagem enfraquecida) antes de montar a URL.
    const spy = jest.spyOn(shopeeShopApiUrl, 'assertAllowedShopApiHost');

    buildShopeeOrderListUrl({ environment: 'SANDBOX', ...BASE_PARAMS });

    expect(spy).toHaveBeenCalledTimes(1);
    const [calledWith] = spy.mock.calls[0];
    expect(calledWith.hostname).toBe(
      'openplatform.sandbox.test-stable.shopee.sg',
    );
    spy.mockRestore();
  });

  it('never accepts an externally supplied host/path — only environment selects among the closed allowlist', () => {
    const url = buildShopeeOrderListUrl({
      environment: 'PRODUCTION',
      ...BASE_PARAMS,
    });
    // Nenhum parâmetro de `buildShopeeOrderListUrl` permite host/path
    // arbitrário - `BASE_PARAMS` não tem `host`/`path`, e o tipo de
    // `environment` só aceita os dois valores fechados de `ShopeeEnvironment`.
    expect(url.hostname).toBe('openplatform.shopee.com.br');
    expect(url.pathname).toBe('/api/v2/order/get_order_list');
  });
});
