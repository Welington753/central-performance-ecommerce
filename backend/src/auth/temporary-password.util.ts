import { randomInt } from 'crypto';
import { passwordMeetsPolicy } from './password-policy';

// Sem caracteres visualmente ambíguos (0/O, 1/l/I) — reduz erro de digitação
// ao copiar a senha temporária, sem reduzir a política a um alfabeto fraco.
const CHARSET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
const LENGTH = 20;

function draw(): string {
  let password = '';
  for (let i = 0; i < LENGTH; i += 1) {
    password += CHARSET[randomInt(CHARSET.length)];
  }
  return password;
}

/**
 * Gerador criptograficamente seguro (`crypto.randomInt`, nunca
 * `Math.random`) — ~119 bits de entropia (64 símbolos ^ 20), muito acima do
 * mínimo de `PASSWORD_MIN_LENGTH`. Amostragem uniforme por si só NÃO
 * garante pelo menos um dígito em 20 sorteios (só ~10/64 símbolos são
 * dígitos — a chance de nenhum sair é ~3%, longe de desprezível) — por
 * isso o resultado é sempre revalidado contra `passwordMeetsPolicy` antes
 * de devolver, sorteando de novo (raríssimo) até satisfazer.
 */
export function generateTemporaryPassword(): string {
  let password = draw();
  while (!passwordMeetsPolicy(password)) {
    password = draw();
  }
  return password;
}
