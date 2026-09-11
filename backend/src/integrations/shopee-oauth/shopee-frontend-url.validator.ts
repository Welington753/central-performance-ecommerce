/**
 * Regra de `FRONTEND_URL` para o redirect do callback Shopee (Checkpoint
 * CP2D) — a origem é sempre lida da configuração (nunca de query/request);
 * este validador só confirma que ela é segura o bastante para ser usada
 * como base de um redirect: HTTPS obrigatório fora de `development`, HTTP
 * permitido somente em `development`, sem username/password embutido.
 * `pathname`/query/fragmento de `FRONTEND_URL` nunca importam aqui — o
 * builder (`buildShopeeCallbackRedirectUrl`) sempre substitui o pathname por
 * `/integracoes`, descartando qualquer path/query/fragmento pré-existente.
 *
 * Validador puro — nunca loga nem devolve a URL completa.
 */
export function validateShopeeFrontendUrl(
  frontendUrl: string,
  nodeEnv: string,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(frontendUrl);
  } catch {
    return false;
  }

  if (parsed.username.length > 0 || parsed.password.length > 0) return false;

  if (nodeEnv !== 'development') {
    return parsed.protocol === 'https:';
  }

  return parsed.protocol === 'https:' || parsed.protocol === 'http:';
}
