const MASK = '***REDACTED***';

/**
 * Chaves consideradas sensíveis (comparação case-insensitive, ignorando
 * caracteres não alfabéticos, para pegar variações como "access_token",
 * "Access-Token", "accessToken" etc.).
 */
const SENSITIVE_KEY_FRAGMENTS = [
  'password',
  'token',
  'authorization',
  'cookie',
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z]/g, '');
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) =>
    normalized.includes(fragment),
  );
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
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
 * Mascara recursivamente, em qualquer objeto, os valores de chaves sensíveis
 * (password, token, accessToken, refreshToken, authorization, cookie, e
 * variações), antes de qualquer log. Usado por `LoggingInterceptor` e por
 * qualquer outro ponto do sistema que precise logar dados potencialmente
 * sensíveis com segurança.
 */
export function redactSensitiveData<T>(value: T): T {
  return redactValue(value, new WeakSet<object>()) as T;
}

export { MASK as REDACTED_VALUE_PLACEHOLDER };
