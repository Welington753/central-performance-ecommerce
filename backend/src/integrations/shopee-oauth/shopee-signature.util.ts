import { createHmac } from 'crypto';

/**
 * Assinatura HMAC-SHA256 da Shopee Open Platform (Checkpoint CP2A). Duas
 * formas de `baseString`, conforme a documentação oficial:
 *   - Public API (inclusive token e refresh): `partner_id + api_path + timestamp`;
 *   - Shop API: `partner_id + api_path + timestamp + access_token + shop_id`.
 *
 * `partner_id`/`shop_id` são recebidos como `string` (nunca `number`) —
 * IDs decimais da Shopee podem exceder `Number.MAX_SAFE_INTEGER`; converter
 * para `number` em qualquer ponto do pipeline arriscaria perder precisão e
 * gerar uma assinatura para um ID diferente do real.
 *
 * `createHmac(...).digest('hex')` do Node já devolve hexadecimal minúsculo
 * — nenhuma normalização adicional de case é necessária.
 *
 * Lança (nunca retorna um valor inválido) quando `apiPath`/`timestampSeconds`
 * não respeitam o contrato — mesmo padrão defensivo de
 * `assertValidSearchOrdersDateMode` (Amazon SP-API): um erro síncrono antes
 * de qualquer uso do valor, nunca uma assinatura calculada sobre entrada
 * inválida.
 */

function assertValidApiPath(apiPath: string): void {
  if (!apiPath.startsWith('/')) {
    throw new Error('SHOPEE_SIGNATURE_INVALID_PATH');
  }
  if (apiPath.includes('://')) {
    throw new Error('SHOPEE_SIGNATURE_INVALID_PATH');
  }
  if (apiPath.includes('?') || apiPath.includes('#')) {
    throw new Error('SHOPEE_SIGNATURE_INVALID_PATH');
  }
}

function assertValidTimestamp(timestampSeconds: number): void {
  if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds <= 0) {
    throw new Error('SHOPEE_SIGNATURE_INVALID_TIMESTAMP');
  }
}

export interface ShopeePublicSignatureInput {
  partnerId: string;
  partnerKey: string;
  apiPath: string;
  timestampSeconds: number;
}

export interface ShopeeShopSignatureInput extends ShopeePublicSignatureInput {
  accessToken: string;
  shopId: string;
}

/** `baseString = partner_id + api_path + timestamp`. */
export function signShopeePublicRequest(
  input: ShopeePublicSignatureInput,
): string {
  assertValidApiPath(input.apiPath);
  assertValidTimestamp(input.timestampSeconds);

  const baseString = `${input.partnerId}${input.apiPath}${input.timestampSeconds}`;
  return createHmac('sha256', input.partnerKey)
    .update(baseString)
    .digest('hex');
}

/** `baseString = partner_id + api_path + timestamp + access_token + shop_id`. */
export function signShopeeShopRequest(input: ShopeeShopSignatureInput): string {
  assertValidApiPath(input.apiPath);
  assertValidTimestamp(input.timestampSeconds);

  const baseString =
    `${input.partnerId}${input.apiPath}${input.timestampSeconds}` +
    `${input.accessToken}${input.shopId}`;
  return createHmac('sha256', input.partnerKey)
    .update(baseString)
    .digest('hex');
}
