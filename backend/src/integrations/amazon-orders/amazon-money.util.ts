/**
 * Validação fechada de um valor monetário Amazon (`{ amount, currencyCode }`
 * — schema `Money` da SP-API). Só aceita uma STRING decimal com até duas
 * casas decimais, nunca negativa — rejeita, por construção (o valor precisa
 * ser `typeof === 'string'`), qualquer `NaN`/`Infinity`/número em ponto
 * flutuante que a resposta porventura traga como JSON number.
 */
const DECIMAL_AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

export function validateAmazonMoneyAmount(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!DECIMAL_AMOUNT_PATTERN.test(value)) return null;
  return value;
}

export function isValidCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && CURRENCY_CODE_PATTERN.test(value);
}

export interface ValidatedMoney {
  amount: string;
  currencyCode: string;
}

/**
 * Valida um objeto `Money` completo — `null` se `amount` OU `currencyCode`
 * forem inválidos (nunca um dos dois isolado: um valor sem moeda válida, ou
 * uma moeda sem valor válido, é tratado como ausente por inteiro).
 */
export function validateAmazonMoney(value: unknown): ValidatedMoney | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const amount = validateAmazonMoneyAmount(raw.amount);
  if (amount === null || !isValidCurrencyCode(raw.currencyCode)) return null;
  return { amount, currencyCode: raw.currencyCode };
}

/**
 * Converte um valor já validado por `DECIMAL_AMOUNT_PATTERN` (`\d+(\.\d{1,2})?`,
 * nunca negativo) para centavos em `bigint` — nunca `float`/`Number`, que
 * introduziria erro de ponto flutuante em cálculo financeiro (Checkpoint
 * 4-B-R1, "Correção 4"). Preenche a casa decimal ausente (`"5.5"` -> 50
 * centavos, `"100"` -> 10000 centavos).
 */
export function decimalAmountToCents(amount: string): bigint {
  const [integerPart, fractionPart = ''] = amount.split('.');
  const cents = fractionPart.padEnd(2, '0');
  return BigInt(integerPart) * 100n + BigInt(cents);
}

/**
 * Inverso de `decimalAmountToCents` — sempre produz exatamente duas casas
 * decimais, o mesmo formato aceito por `DECIMAL_AMOUNT_PATTERN`. Nunca
 * chamado com um valor negativo neste código-base (dinheiro de pedido nunca
 * é negativo).
 */
export function centsToDecimalAmount(cents: bigint): string {
  const integerPart = cents / 100n;
  const fractionPart = (cents % 100n).toString().padStart(2, '0');
  return `${integerPart}.${fractionPart}`;
}
