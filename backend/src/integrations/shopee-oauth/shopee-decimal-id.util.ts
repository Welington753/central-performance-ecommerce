/**
 * Converte uma string decimal para `number` SOMENTE depois de confirmar que
 * ela representa um inteiro positivo seguro (Checkpoint CP2B — revisão de
 * segurança, "Correção 4"; extraído para util compartilhado no Checkpoint
 * CP2C, reaproveitado também pela validação de entrada do callback): nunca
 * aceita sinal negativo, zero, caracteres não numéricos, nem um valor que
 * exceda `Number.MAX_SAFE_INTEGER`. A comparação `String(parsed) !== value`
 * cobre dois problemas ao mesmo tempo: perda de precisão (um valor grande
 * demais arredonda na conversão, então o round-trip nunca bate) E zeros à
 * esquerda (`"007"` nunca é uma representação canônica de `7`, mesmo sendo
 * numericamente válida) — IDs reais (`partner_id`/`shop_id`) da Shopee nunca
 * chegam em nenhum dos dois formatos.
 */
export function parsePositiveSafeIntegerString(value: string): number | null {
  if (!/^[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  if (String(parsed) !== value) return null;
  return parsed;
}
