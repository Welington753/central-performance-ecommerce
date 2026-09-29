/**
 * ID externo (claim/resource/reason) tratado como string sempre — nunca
 * depende da precisão de `number`. `string` não vazia é preservada tal como
 * veio (nunca reformatada); `number` só é aceito quando
 * `Number.isSafeInteger`, porque acima de `MAX_SAFE_INTEGER` o próprio motor
 * JS já pode ter perdido precisão antes deste código rodar — nunca aceito
 * esse valor como se fosse exato. Qualquer outro caso reprova (`null`),
 * reprovando o registro inteiro no validador que chamar esta função.
 */
export function toSafeExternalId(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.length > 0 ? value : null;
  }
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? String(value) : null;
  }
  return null;
}
