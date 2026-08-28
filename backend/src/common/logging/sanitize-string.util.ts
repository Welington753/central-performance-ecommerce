const MASK = '***REDACTED***';

const SENSITIVE_FORM_KEYS =
  'code_verifier|client_secret|access_token|refresh_token|code|state';

/**
 * Sanitização de VALORES textuais (design §8) — complementar à redação por
 * nome de chave em `redact.util.ts`. Cobre o caso em que um segredo está
 * DENTRO de uma string maior (URL completa, mensagem de erro, corpo de
 * formulário, texto JSON-like), não isolado no valor de uma chave sensível
 * de um objeto. Cada padrão usa seu próprio `replace` com a assinatura de
 * callback correta para o número de grupos capturados — nunca reaproveita
 * um callback genérico entre padrões com formatos de captura diferentes
 * (essa mistura foi a causa de um bug anterior nesta função).
 */
export function sanitizeSensitiveSubstrings(value: string): string {
  let result = value;

  // "Bearer <token>" — sem grupo de captura, replace de string fixa.
  result = result.replace(/Bearer\s+\S+/gi, `Bearer ${MASK}`);

  // key=value (query string / form-urlencoded) — 1 grupo (a chave).
  result = result.replace(
    new RegExp(`\\b(${SENSITIVE_FORM_KEYS})=[^&\\s]+`, 'gi'),
    (_match, key: string) => `${key}=${MASK}`,
  );

  // "key": "value" (JSON-like texto solto) — 1 grupo (a chave), espaços
  // opcionais ao redor de `:` tolerados.
  result = result.replace(
    new RegExp(`"(${SENSITIVE_FORM_KEYS})"\\s*:\\s*"[^"]*"`, 'gi'),
    (_match, key: string) => `"${key}":"${MASK}"`,
  );

  return result;
}
