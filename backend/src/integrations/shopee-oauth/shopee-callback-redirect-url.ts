import type { ShopeeOAuthPublicReason } from './shopee-callback-reason.mapper';

/**
 * Redirect final do callback Shopee (Checkpoint CP2D) — sempre a URL fixa
 * `FRONTEND_URL/integracoes`, montada com a API `URL` (`new URL('/integracoes',
 * frontendUrl)` descarta qualquer path/query/fragmento pré-existente de
 * `frontendUrl`), nunca um `returnUrl` arbitrário vindo da requisição.
 *
 * Formato: sucesso → `?shopee=success` (sem `reason`); falha →
 * `?shopee=error&reason=<CODIGO_PUBLICO>`. Builder puro — não valida
 * `frontendUrl` (isso é responsabilidade de `validateShopeeFrontendUrl`,
 * chamada pelo `ShopeeOAuthService` ANTES de montar qualquer redirect).
 */
export function buildShopeeCallbackRedirectUrl(input: {
  frontendUrl: string;
  reason: 'success' | ShopeeOAuthPublicReason;
}): string {
  const url = new URL('/integracoes', input.frontendUrl);
  if (input.reason === 'success') {
    url.searchParams.set('shopee', 'success');
  } else {
    url.searchParams.set('shopee', 'error');
    url.searchParams.set('reason', input.reason);
  }
  return url.toString();
}
