/**
 * Regra de `ML_REDIRECT_URI` (design §5): pathname exatamente
 * `/integrations/mercado-livre/callback` (o caminho fixo do callback do
 * backend — Task 19's `MercadoLivreOAuthController.callback`); HTTPS
 * obrigatório em qualquer `nodeEnv` — HTTP só é aceito quando `nodeEnv` é
 * EXATAMENTE `'development'` (não `'test'`, não `'staging'`, não qualquer
 * outro valor); nunca query string nem fragmento, em nenhum ambiente.
 */
const REQUIRED_CALLBACK_PATHNAME = '/integrations/mercado-livre/callback';

export function validateMercadoLivreRedirectUri(
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

  if (parsed.protocol === 'https:') return true;
  return parsed.protocol === 'http:' && nodeEnv === 'development';
}
