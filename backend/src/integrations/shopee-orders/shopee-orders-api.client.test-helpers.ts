import { ConflictException } from '@nestjs/common';
import { ShopeeConfig } from '../shopee-oauth/shopee-config';
import { ShopeeCredentialsService } from '../shopee-oauth/shopee-credentials.service';

/**
 * Helpers compartilhados entre os specs de `ShopeeOrdersApiClient`
 * (Checkpoint CP2K-1) - fica num módulo próprio (não num `.spec.ts`) de
 * propósito: importar um `.spec.ts` de outro reexecutaria o
 * `describe`/`it` de nível superior daquele arquivo como efeito colateral
 * do import, duplicando a suíte inteira (mesma lição do Checkpoint
 * CP2I-R1).
 */

export const PARTNER_ID = '1000000';
export const PARTNER_KEY = 'super-secret-partner-key-never-logged';
export const FIXED_TIMESTAMP = 1700000000;
export const ACCESS_TOKEN = 'access-token-example';
export const SHOP_ID = '200000';

export const VALID_CONFIG: ShopeeConfig = {
  partnerId: PARTNER_ID,
  partnerKey: PARTNER_KEY,
  redirectUri: 'https://api.example.com/integrations/shopee/callback',
  environment: 'SANDBOX',
  apiHost: 'https://openplatform.sandbox.test-stable.shopee.sg',
  httpTimeoutMs: 50,
  tokenRefreshSkewSeconds: 600,
};

export const VALID_ORDER_LIST_INPUT = {
  timeRangeField: 'create_time' as const,
  timeFrom: 1700000000,
  timeTo: 1700003600,
  pageSize: 20,
};

export function makeCredentialsService(
  config: ShopeeConfig | null = VALID_CONFIG,
): ShopeeCredentialsService {
  return {
    ensureCredentials: () => {
      if (config === null) throw new ConflictException('SHOPEE_NOT_CONFIGURED');
      return config;
    },
  } as unknown as ShopeeCredentialsService;
}

export function textResponse(
  status: number,
  text: string,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

export function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return textResponse(status, JSON.stringify(body), headers);
}

export function validOrderListBody(
  overrides: {
    response?: Record<string, unknown>;
    error?: string;
    message?: string;
    request_id?: string;
  } = {},
) {
  return {
    error: overrides.error ?? '',
    message: overrides.message ?? '',
    request_id: overrides.request_id ?? 'req-abc123',
    response: {
      more: false,
      next_cursor: '',
      order_list: [{ order_sn: '201218V2Y6E59M' }],
      ...overrides.response,
    },
  };
}

export function fixedClock(): number {
  return FIXED_TIMESTAMP;
}
