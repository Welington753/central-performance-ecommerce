/**
 * Aritmética monetária exclusivamente em centavos (`bigint`) — nunca `float`
 * (design: "valores monetários em numeric, nunca float"). Colunas Postgres
 * `numeric(14,2)` sempre voltam do driver `pg` como string com exatamente 2
 * casas decimais fixas, então o parsing aqui nunca precisa lidar com escala
 * variável.
 */

export function decimalStringToCents(value: string | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;

  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [wholePart, fractionalPart = ''] = unsigned.split('.');
  const paddedFraction = (fractionalPart + '00').slice(0, 2);

  const cents = BigInt(wholePart || '0') * 100n + BigInt(paddedFraction || '0');
  return negative ? -cents : cents;
}

export function centsToDecimalString(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = absolute % 100n;
  const sign = negative && absolute !== 0n ? '-' : '';
  return `${sign}${whole.toString()}.${fraction.toString().padStart(2, '0')}`;
}

/**
 * Ticket médio: `faturamento bruto / quantidade de pedidos`, arredondado ao
 * centavo mais próximo. Sem pedidos, retorna "0.00" — nunca divisão inválida
 * (NaN/Infinity).
 */
export function divideCents(
  numeratorCents: bigint,
  denominator: bigint,
): string {
  if (denominator === 0n) return '0.00';

  const doubledNumerator = numeratorCents * 2n;
  const roundedQuotient = (doubledNumerator + denominator) / (denominator * 2n);
  return centsToDecimalString(roundedQuotient);
}
