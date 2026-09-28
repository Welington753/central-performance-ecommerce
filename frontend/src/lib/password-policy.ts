/**
 * Espelha `backend/src/auth/password-policy.ts` — só para validação client-
 * side (UX); o backend continua sendo a fonte de verdade e revalida sempre.
 */
export const PASSWORD_MIN_LENGTH = 12;

export function passwordMeetsPolicy(password: string): boolean {
  if (password.length < PASSWORD_MIN_LENGTH) return false;
  if (!/[A-Za-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  return true;
}
