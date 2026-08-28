import type { MercadoLivreOAuthPublicReason } from './callback-reason.mapper';

/**
 * Redirect final do callback (design §6.2 passo 13): sempre a URL fixa
 * `FRONTEND_URL/integracoes`, montada com a API `URL` (nunca concatenação de
 * strings), nunca um `returnUrl` arbitrário.
 */
export function buildCallbackRedirectUrl(input: {
  frontendUrl: string;
  reason: 'success' | MercadoLivreOAuthPublicReason;
}): string {
  const url = new URL('/integracoes', input.frontendUrl);
  url.searchParams.set('ml', input.reason === 'success' ? 'success' : 'error');
  url.searchParams.set('reason', input.reason);
  return url.toString();
}
