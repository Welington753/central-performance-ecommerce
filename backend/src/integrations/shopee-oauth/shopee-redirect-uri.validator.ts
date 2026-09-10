/**
 * Regra de `SHOPEE_REDIRECT_URI` (Checkpoint CP2A) — análoga a
 * `mercado-livre-redirect-uri.validator.ts`: pathname exatamente
 * `/integrations/shopee/callback` (caminho fixo do futuro callback do
 * backend, ainda não implementado); HTTPS obrigatório fora de
 * `development`; sem query string nem fragmento; sem username/password
 * embutido na URL; `localhost`/`127.0.0.1` aceitos apenas quando `nodeEnv`
 * é EXATAMENTE `'development'` (nunca em produção, mesmo com HTTPS).
 *
 * Validador puro — nunca loga nem devolve a URL completa: o chamador é
 * responsável por lançar apenas o código fechado `INVALID_REDIRECT_URI`,
 * nunca a URL recebida.
 */
const REQUIRED_CALLBACK_PATHNAME = '/integrations/shopee/callback';

export function validateShopeeRedirectUri(
  uri: string,
  nodeEnv: string,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }

  if (parsed.pathname !== REQUIRED_CALLBACK_PATHNAME) return false;
  if (parsed.search.length > 0 || parsed.hash.length > 0) return false;
  if (parsed.username.length > 0 || parsed.password.length > 0) return false;

  const isLocalhost =
    parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';

  if (nodeEnv !== 'development') {
    if (isLocalhost) return false;
    return parsed.protocol === 'https:';
  }

  return parsed.protocol === 'https:' || parsed.protocol === 'http:';
}
