import { isMaskedValue } from '../integrations/marketplace-orders/buyer-snapshot';

export { isUsableValue } from '../integrations/marketplace-orders/buyer-snapshot';

export function maskEmail(value: string | null): string | null {
  if (value === null) return null;
  if (isMaskedValue(value)) return value;
  const at = value.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = value.slice(0, at);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}***${value.slice(at)}`;
}

export function maskPhone(value: string | null): string | null {
  if (value === null) return null;
  if (isMaskedValue(value)) return value;
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

export function maskPostalCode(value: string | null): string | null {
  if (value === null) return null;
  if (isMaskedValue(value)) return value;
  const digits = value.replace(/\D/g, '');
  return digits.length <= 2 ? '*****' : `${digits.slice(0, 2)}***-***`;
}

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/**
 * Proteção contra formula injection (OWASP CSV/Spreadsheet Injection): todo
 * texto que o Excel/LibreOffice poderia interpretar como fórmula recebe um
 * apóstrofo inicial e vira texto literal.
 */
export function sanitizeSpreadsheetText(value: string): string {
  return FORMULA_TRIGGER.test(value) ? `'${value}` : value;
}
