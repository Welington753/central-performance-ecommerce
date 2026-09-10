import { ConfigService } from '@nestjs/config';
import {
  isShopeeEnvironment,
  SHOPEE_ENDPOINTS,
  ShopeeEnvironment,
} from './shopee-endpoints';

/**
 * Configuração estática da aplicação Shopee (Partner ID/Partner Key) —
 * credencial de aplicação, não de loja (cada loja autorizada tem seus
 * próprios tokens, mas a mesma Partner ID/Key). Mesma forma de
 * `amazon-config.ts`/`omie-config.ts`: nunca lança, a ausência de qualquer
 * variável nunca pode impedir o backend de subir.
 *
 * `apiHost` é resolvido aqui a partir de `environment` — nunca de uma URL
 * livre configurável (ver `shopee-endpoints.ts`).
 */
export interface ShopeeConfig {
  partnerId: string;
  partnerKey: string;
  redirectUri: string;
  environment: ShopeeEnvironment;
  apiHost: string;
  httpTimeoutMs: number;
  tokenRefreshSkewSeconds: number;
}

export type ShopeeConfigResult =
  { configured: true; config: ShopeeConfig } | { configured: false };

const DEFAULT_HTTP_TIMEOUT_MS = 10000;
const DEFAULT_TOKEN_REFRESH_SKEW_SECONDS = 600;

/**
 * Nunca lança e nunca loga os valores lidos (`partnerKey` em especial —
 * nunca pode ser incluída em nenhuma mensagem/erro/log). Só responde "a
 * credencial está presente e o ambiente é válido?"; validar o FORMATO de
 * `redirectUri` é responsabilidade de `ShopeeCredentialsService` (usa
 * `validateShopeeRedirectUri`, que precisa de `NODE_ENV`, fora do escopo
 * desta função).
 */
export function loadShopeeConfig(
  configService: ConfigService,
): ShopeeConfigResult {
  const partnerId = configService.get<string>('SHOPEE_PARTNER_ID');
  const partnerKey = configService.get<string>('SHOPEE_PARTNER_KEY');
  const redirectUri = configService.get<string>('SHOPEE_REDIRECT_URI');
  const environmentRaw =
    configService.get<string>('SHOPEE_ENVIRONMENT') ?? 'SANDBOX';

  if (!partnerId || !partnerKey || !redirectUri) {
    return { configured: false };
  }
  if (!isShopeeEnvironment(environmentRaw)) {
    return { configured: false };
  }

  const httpTimeoutMs =
    configService.get<number>('SHOPEE_HTTP_TIMEOUT_MS') ??
    DEFAULT_HTTP_TIMEOUT_MS;
  const tokenRefreshSkewSeconds =
    configService.get<number>('SHOPEE_TOKEN_REFRESH_SKEW_SECONDS') ??
    DEFAULT_TOKEN_REFRESH_SKEW_SECONDS;

  return {
    configured: true,
    config: {
      partnerId,
      partnerKey,
      redirectUri,
      environment: environmentRaw,
      apiHost: SHOPEE_ENDPOINTS[environmentRaw].apiHost,
      httpTimeoutMs,
      tokenRefreshSkewSeconds,
    },
  };
}
