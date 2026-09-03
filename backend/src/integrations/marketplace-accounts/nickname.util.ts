export const NICKNAME_MAX_LENGTH = 60;

// Letras (com acentos, via \p{L}), números, espaço, hífen e pontuação
// simples — nunca caracteres de controle/emoji/símbolos exóticos.
const NICKNAME_PATTERN = /^[\p{L}\p{N} .,'\-&!?]+$/u;

export class InvalidNicknameError extends Error {
  readonly code = 'INVALID_NICKNAME';
  constructor() {
    super('INVALID_NICKNAME');
  }
}

export class NicknameAlreadyInUseError extends Error {
  readonly code = 'NICKNAME_ALREADY_IN_USE';
  constructor() {
    super('NICKNAME_ALREADY_IN_USE');
  }
}

/**
 * Aparas as extremidades e reduz espaços internos repetidos a um único
 * espaço — a MESMA normalização usada tanto para validar quanto para
 * persistir, então o valor salvo já é sempre o valor normalizado (o índice
 * único do Postgres compara `lower(nickname)` sem precisar repetir esta
 * lógica em SQL).
 */
export function normalizeNickname(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * Lança `InvalidNicknameError` para: vazio após normalizar, acima de
 * `NICKNAME_MAX_LENGTH`, ou fora do conjunto de caracteres permitido. Nunca
 * usado para o caso `null` (restaurar nome padrão) — esse caminho é tratado
 * separadamente pelo chamador, antes de chegar aqui.
 */
export function assertValidNickname(normalized: string): void {
  if (
    normalized.length === 0 ||
    normalized.length > NICKNAME_MAX_LENGTH ||
    !NICKNAME_PATTERN.test(normalized)
  ) {
    throw new InvalidNicknameError();
  }
}
