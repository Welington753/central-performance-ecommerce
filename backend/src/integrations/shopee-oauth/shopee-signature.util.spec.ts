import { createHmac } from 'crypto';
import {
  signShopeePublicRequest,
  signShopeeShopRequest,
} from './shopee-signature.util';

const PARTNER_ID = '1000000';
const PARTNER_KEY = 'fixed-partner-key-for-deterministic-tests';
const TIMESTAMP_SECONDS = 1700000000;
const API_PATH = '/api/v2/auth/token/get';

describe('signShopeePublicRequest', () => {
  it('is deterministic for fixed partnerId/apiPath/timestamp/partnerKey', () => {
    const signature1 = signShopeePublicRequest({
      partnerId: PARTNER_ID,
      partnerKey: PARTNER_KEY,
      apiPath: API_PATH,
      timestampSeconds: TIMESTAMP_SECONDS,
    });
    const signature2 = signShopeePublicRequest({
      partnerId: PARTNER_ID,
      partnerKey: PARTNER_KEY,
      apiPath: API_PATH,
      timestampSeconds: TIMESTAMP_SECONDS,
    });

    expect(signature1).toBe(signature2);
  });

  it('returns lowercase hexadecimal', () => {
    const signature = signShopeePublicRequest({
      partnerId: PARTNER_ID,
      partnerKey: PARTNER_KEY,
      apiPath: API_PATH,
      timestampSeconds: TIMESTAMP_SECONDS,
    });

    expect(signature).toMatch(/^[0-9a-f]+$/);
    expect(signature).toHaveLength(64);
  });

  it('matches an independently computed HMAC-SHA256 of partner_id + api_path + timestamp', () => {
    const expected = createHmac('sha256', PARTNER_KEY)
      .update(`${PARTNER_ID}${API_PATH}${TIMESTAMP_SECONDS}`)
      .digest('hex');

    const signature = signShopeePublicRequest({
      partnerId: PARTNER_ID,
      partnerKey: PARTNER_KEY,
      apiPath: API_PATH,
      timestampSeconds: TIMESTAMP_SECONDS,
    });

    expect(signature).toBe(expected);
  });

  it('changes when apiPath changes', () => {
    const base = signShopeePublicRequest({
      partnerId: PARTNER_ID,
      partnerKey: PARTNER_KEY,
      apiPath: API_PATH,
      timestampSeconds: TIMESTAMP_SECONDS,
    });
    const changed = signShopeePublicRequest({
      partnerId: PARTNER_ID,
      partnerKey: PARTNER_KEY,
      apiPath: '/api/v2/auth/access_token/get',
      timestampSeconds: TIMESTAMP_SECONDS,
    });

    expect(changed).not.toBe(base);
  });

  it('changes when timestampSeconds changes', () => {
    const base = signShopeePublicRequest({
      partnerId: PARTNER_ID,
      partnerKey: PARTNER_KEY,
      apiPath: API_PATH,
      timestampSeconds: TIMESTAMP_SECONDS,
    });
    const changed = signShopeePublicRequest({
      partnerId: PARTNER_ID,
      partnerKey: PARTNER_KEY,
      apiPath: API_PATH,
      timestampSeconds: TIMESTAMP_SECONDS + 1,
    });

    expect(changed).not.toBe(base);
  });

  it('changes when partnerId changes', () => {
    const base = signShopeePublicRequest({
      partnerId: PARTNER_ID,
      partnerKey: PARTNER_KEY,
      apiPath: API_PATH,
      timestampSeconds: TIMESTAMP_SECONDS,
    });
    const changed = signShopeePublicRequest({
      partnerId: '1000001',
      partnerKey: PARTNER_KEY,
      apiPath: API_PATH,
      timestampSeconds: TIMESTAMP_SECONDS,
    });

    expect(changed).not.toBe(base);
  });

  it.each([
    'api/v2/auth/token/get',
    'https://partner.shopeemobile.com/api/v2/auth/token/get',
    '/api/v2/auth/token/get?foo=bar',
    '/api/v2/auth/token/get#frag',
  ])('rejects an invalid apiPath: %s', (invalidPath) => {
    expect(() =>
      signShopeePublicRequest({
        partnerId: PARTNER_ID,
        partnerKey: PARTNER_KEY,
        apiPath: invalidPath,
        timestampSeconds: TIMESTAMP_SECONDS,
      }),
    ).toThrow('SHOPEE_SIGNATURE_INVALID_PATH');
  });

  it.each([0, -1, 1.5, Number.NaN])(
    'rejects an invalid timestampSeconds: %s',
    (invalidTimestamp) => {
      expect(() =>
        signShopeePublicRequest({
          partnerId: PARTNER_ID,
          partnerKey: PARTNER_KEY,
          apiPath: API_PATH,
          timestampSeconds: invalidTimestamp,
        }),
      ).toThrow('SHOPEE_SIGNATURE_INVALID_TIMESTAMP');
    },
  );
});

describe('signShopeeShopRequest', () => {
  const SHOP_API_PATH = '/api/v2/order/get_order_list';
  const ACCESS_TOKEN = 'access-token-example';
  const SHOP_ID = '200000';

  it('matches an independently computed HMAC-SHA256 of partner_id + api_path + timestamp + access_token + shop_id', () => {
    const expected = createHmac('sha256', PARTNER_KEY)
      .update(
        `${PARTNER_ID}${SHOP_API_PATH}${TIMESTAMP_SECONDS}${ACCESS_TOKEN}${SHOP_ID}`,
      )
      .digest('hex');

    const signature = signShopeeShopRequest({
      partnerId: PARTNER_ID,
      partnerKey: PARTNER_KEY,
      apiPath: SHOP_API_PATH,
      timestampSeconds: TIMESTAMP_SECONDS,
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
    });

    expect(signature).toBe(expected);
  });

  it('differs from the Public API signature for the same partnerId/apiPath/timestamp', () => {
    const publicSignature = signShopeePublicRequest({
      partnerId: PARTNER_ID,
      partnerKey: PARTNER_KEY,
      apiPath: SHOP_API_PATH,
      timestampSeconds: TIMESTAMP_SECONDS,
    });
    const shopSignature = signShopeeShopRequest({
      partnerId: PARTNER_ID,
      partnerKey: PARTNER_KEY,
      apiPath: SHOP_API_PATH,
      timestampSeconds: TIMESTAMP_SECONDS,
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
    });

    expect(shopSignature).not.toBe(publicSignature);
  });

  it('changes when accessToken changes', () => {
    const base = signShopeeShopRequest({
      partnerId: PARTNER_ID,
      partnerKey: PARTNER_KEY,
      apiPath: SHOP_API_PATH,
      timestampSeconds: TIMESTAMP_SECONDS,
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
    });
    const changed = signShopeeShopRequest({
      partnerId: PARTNER_ID,
      partnerKey: PARTNER_KEY,
      apiPath: SHOP_API_PATH,
      timestampSeconds: TIMESTAMP_SECONDS,
      accessToken: 'different-access-token',
      shopId: SHOP_ID,
    });

    expect(changed).not.toBe(base);
  });

  it('changes when shopId changes', () => {
    const base = signShopeeShopRequest({
      partnerId: PARTNER_ID,
      partnerKey: PARTNER_KEY,
      apiPath: SHOP_API_PATH,
      timestampSeconds: TIMESTAMP_SECONDS,
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
    });
    const changed = signShopeeShopRequest({
      partnerId: PARTNER_ID,
      partnerKey: PARTNER_KEY,
      apiPath: SHOP_API_PATH,
      timestampSeconds: TIMESTAMP_SECONDS,
      accessToken: ACCESS_TOKEN,
      shopId: '200001',
    });

    expect(changed).not.toBe(base);
  });

  it('rejects an invalid apiPath', () => {
    expect(() =>
      signShopeeShopRequest({
        partnerId: PARTNER_ID,
        partnerKey: PARTNER_KEY,
        apiPath: 'order/get_order_list',
        timestampSeconds: TIMESTAMP_SECONDS,
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
      }),
    ).toThrow('SHOPEE_SIGNATURE_INVALID_PATH');
  });

  it('rejects an invalid timestampSeconds', () => {
    expect(() =>
      signShopeeShopRequest({
        partnerId: PARTNER_ID,
        partnerKey: PARTNER_KEY,
        apiPath: SHOP_API_PATH,
        timestampSeconds: 0,
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
      }),
    ).toThrow('SHOPEE_SIGNATURE_INVALID_TIMESTAMP');
  });
});
