export type ShopeeShopStatus = 'NORMAL' | 'BANNED' | 'FROZEN';

export interface ShopeeShopInfoResult {
  shopName: string;
  region: string;
  status: ShopeeShopStatus;
  authTime: number;
  expireTime: number;
  /** `null` quando a Shopee não vincula a loja a um `merchant_id`. */
  merchantId: number | null;
  /**
   * Revisão CP2I-R1: a documentação oficial confirma que `request_id` é
   * SEMPRE retornado pela Shopee — nunca opcional no caminho de sucesso.
   * Por isso aqui é `string` obrigatória, nunca `string | null`. Ausência,
   * tipo incorreto, string vazia ou acima do limite de tamanho fazem a
   * resposta inteira falhar como `invalid_response` (nunca um sucesso com
   * `requestId` inventado/nulo).
   */
  requestId: string;
}

export type ShopeeShopInfoValidation =
  { valid: true; shopInfo: ShopeeShopInfoResult } | { valid: false };

const MAX_SHOP_NAME_LENGTH = 256;
const MAX_REGION_LENGTH = 64;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Teto defensivo (~ano 2100) — não é um limite oficial da Shopee, só protege
 * contra um timestamp corrompido/absurdo. Mesmo espírito de
 * `MAX_EXPIRE_IN_SECONDS` em `shopee-token-response.ts`.
 */
const MAX_PLAUSIBLE_UNIX_SECONDS = 4102444800;

function isPlausibleUnixSeconds(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_PLAUSIBLE_UNIX_SECONDS
  );
}

/**
 * `null`/inteiro positivo seguro — NUNCA aceita um `merchant_id` que já
 * perdeu precisão de int64. Um literal JSON maior que
 * `Number.MAX_SAFE_INTEGER` nunca "arredonda de volta" para dentro da faixa
 * seguro ao ser convertido para `number` por `JSON.parse`: o double
 * resultante permanece acima do teto (doubles representam every inteiro até
 * 2^53 exatamente; além disso, o arredondamento nunca produz um valor menor
 * que a magnitude original). Por isso `Number.isSafeInteger` sozinho, após o
 * `JSON.parse` nativo já ter rodado, já é suficiente para detectar qualquer
 * perda de precisão — nenhuma inspeção do texto bruto é necessária aqui.
 */
function isValidMerchantId(value: unknown): value is number | null {
  if (value === null) return true;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * Validador puro de uma resposta DESCONHECIDA de
 * `GET /api/v2/shop/get_shop_info` (Checkpoint CP2I). `input` sempre começa
 * como `unknown` — nunca confia em nenhum campo antes de checar tipo e
 * faixa. Nunca usa `String(value)`/`Number(value)` (coerção implícita
 * mascararia um tipo incorreto como se fosse válido).
 *
 * Campos opcionais documentados (`is_cb`, `is_sip`, `sip_affi_shops`, etc.)
 * são silenciosamente ignorados — mesma decisão explícita do checkpoint:
 * compatibilidade futura, nenhum mapeamento nesta primeira versão.
 *
 * Um `status` fora do vocabulário fechado (`NORMAL`/`BANNED`/`FROZEN`) NUNCA
 * é repassado — a Shopee poderia introduzir um novo valor no futuro; expô-lo
 * cru inventaria silenciosamente um novo status "público". Em vez disso,
 * esta função só devolve `{ valid: false }`; o chamador (`ShopeeShopApiClient`)
 * classifica isso como `invalid_response`, nunca como sucesso com um status
 * desconhecido.
 */
export function validateShopeeShopInfoResponseBody(
  body: unknown,
): ShopeeShopInfoValidation {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { valid: false };
  }
  const raw = body as Record<string, unknown>;

  const error = raw.error;
  if (typeof error !== 'string') return { valid: false };
  if (typeof raw.message !== 'string') return { valid: false };
  if (error.length > 0) return { valid: false };

  const shopName = raw.shop_name;
  if (
    typeof shopName !== 'string' ||
    shopName.length === 0 ||
    shopName.length > MAX_SHOP_NAME_LENGTH
  ) {
    return { valid: false };
  }

  const region = raw.region;
  if (
    typeof region !== 'string' ||
    region.length === 0 ||
    region.length > MAX_REGION_LENGTH
  ) {
    return { valid: false };
  }

  const status = raw.status;
  if (status !== 'NORMAL' && status !== 'BANNED' && status !== 'FROZEN') {
    return { valid: false };
  }

  const authTime = raw.auth_time;
  if (!isPlausibleUnixSeconds(authTime)) return { valid: false };

  const expireTime = raw.expire_time;
  if (!isPlausibleUnixSeconds(expireTime)) return { valid: false };

  if (expireTime < authTime) return { valid: false };

  if (!('merchant_id' in raw) || !isValidMerchantId(raw.merchant_id)) {
    return { valid: false };
  }
  const merchantId = raw.merchant_id;

  const requestId = raw.request_id;
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
    // Cobre ausência, tipo incorreto, string vazia e acima do limite (o
    // próprio `REQUEST_ID_PATTERN` já exige 1-128 caracteres) — nunca
    // sanitiza para um valor inventado, nunca aceita a resposta como sucesso
    // sem um `request_id` genuíno da Shopee.
    return { valid: false };
  }

  return {
    valid: true,
    shopInfo: {
      shopName,
      region,
      status,
      authTime,
      expireTime,
      merchantId,
      requestId,
    },
  };
}
