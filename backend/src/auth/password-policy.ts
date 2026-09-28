/**
 * Política mínima de senha — único ponto de verdade, reaproveitado tanto
 * para validar `newPassword` em `POST /auth/change-password` quanto como
 * invariante estrutural de `generateTemporaryPassword` (a senha gerada
 * SEMPRE atende esta mesma política, por construção do alfabeto/tamanho
 * usado). Nenhuma segunda política de senha existe no projeto.
 */
export const PASSWORD_MIN_LENGTH = 12;

export function passwordMeetsPolicy(password: string): boolean {
  if (password.length < PASSWORD_MIN_LENGTH) return false;
  if (!/[A-Za-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  return true;
}
