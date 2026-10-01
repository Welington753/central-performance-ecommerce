/**
 * Catálogo CENTRAL de rótulos PT-BR dos códigos de motivo conhecidos (nome do
 * motivo no cache de `marketplace_problem_reasons`). O código original NUNCA é
 * substituído — os consumidores devolvem os dois (`code` + `label`).
 */
export const PROBLEM_REASON_LABELS_PT_BR: Readonly<Record<string, string>> = {
  repentant_buyer: 'Arrependimento do comprador',
  undelivered_repentant_buyer: 'Não entregue — arrependimento do comprador',
  broken_item: 'Produto quebrado ou com defeito',
  undelivered_other: 'Não entregue — outro motivo',
  missing_item: 'Produto faltando',
  delivered_but_not_receive_package:
    'Entregue, mas o comprador não recebeu o pacote',
  different_than_published: 'Produto diferente do anunciado',
  missing_accessories: 'Acessórios faltando',
  unauthorized_purchase: 'Compra não autorizada',
};

const MAX_UNKNOWN_LABEL_LENGTH = 60;
const UNKNOWN_REASON_LABEL = 'Motivo desconhecido';

/**
 * Rótulo PT-BR de um código. Código desconhecido nunca quebra: só caracteres
 * seguros (`A-Z a-z 0-9 _ -`) sobrevivem, `_`/`-` viram espaço e o texto é
 * truncado — legível, sem expor conteúdo arbitrário vindo do provedor.
 */
export function problemReasonLabel(code: string): string {
  const known = Object.hasOwn(PROBLEM_REASON_LABELS_PT_BR, code)
    ? PROBLEM_REASON_LABELS_PT_BR[code]
    : undefined;
  if (known) return known;

  const readable = code
    .replace(/[^A-Za-z0-9_-]/g, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .slice(0, MAX_UNKNOWN_LABEL_LENGTH);
  if (readable === '') return UNKNOWN_REASON_LABEL;
  return readable === readable.toLowerCase()
    ? readable.charAt(0).toUpperCase() + readable.slice(1)
    : readable;
}
