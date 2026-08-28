import { sanitizeSensitiveSubstrings } from './sanitize-string.util';

const MASK = '***REDACTED***';

/**
 * Categorias de chave sensível (design §8):
 * - Igualdade EXATA: nomes curtos e ambíguos demais para virar fragmento
 *   (ex.: "code"/"state"/"token" combinariam com "failureCode"/"statusCode"/
 *   "tokenVersion" se fossem fragmentos).
 * - Sufixo normalizado: cobre variações como ML_CLIENT_SECRET, someAccessToken.
 * - Fragmento (substring): só para chaves que nunca colidem com campos
 *   operacionais conhecidos do sistema.
 */
const EXACT_MATCH_KEYS = ['code', 'state', 'token'];

const SUFFIX_KEYS = [
  'codeverifier',
  'clientsecret',
  'authorizationcode',
  'accesstoken',
  'refreshtoken',
  'encryptionkey',
];

const SENSITIVE_KEY_FRAGMENTS = ['password', 'authorization', 'cookie'];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z]/g, '');
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);

  if (EXACT_MATCH_KEYS.includes(normalized)) return true;
  if (SUFFIX_KEYS.some((suffix) => normalized.endsWith(suffix))) return true;
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) =>
    normalized.includes(fragment),
  );
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    // Sempre varrido, mesmo quando o valor não está sob uma chave sensível
    // (design §8: sanitização recursiva de valores textuais).
    return sanitizeSensitiveSubstrings(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }

  if (value instanceof Date) {
    return value;
  }

  if (value && typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);

    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = isSensitiveKey(key) ? MASK : redactValue(val, seen);
    }
    return result;
  }

  return value;
}

/**
 * Mascara recursivamente, em qualquer objeto, os valores de chaves
 * sensíveis (por nome de chave) E o conteúdo de qualquer string (por
 * padrão de conteúdo, via `sanitizeSensitiveSubstrings`) — antes de
 * qualquer log. As duas camadas são complementares: uma chave sensível
 * mascara o valor inteiro; um valor não-sensível que contenha um segredo
 * embutido (ex.: uma URL completa) é sanitizado pelo conteúdo.
 */
export function redactSensitiveData<T>(value: T): T {
  return redactValue(value, new WeakSet<object>()) as T;
}

export { MASK as REDACTED_VALUE_PLACEHOLDER };
