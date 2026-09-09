/**
 * Regra de `APP_HOST`: hostname ou endereço IPv4 puro — nunca uma URL
 * (sem esquema `http://`/`https://`) nem um par `host:porta` (a porta já
 * tem sua própria variável, `PORT`). Aceita qualquer hostname/IP válido —
 * `127.0.0.1` para restringir ao loopback em desenvolvimento local,
 * `0.0.0.0` para escutar em todas as interfaces (uso típico dentro de um
 * container em produção), ou um hostname real.
 */
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export function validateAppHost(value: string): boolean {
  if (value.length === 0) return false;
  if (value.includes('://')) return false;
  if (value.includes('/')) return false;
  if (value.includes('@')) return false;
  if (value.includes(':')) return false; // rejeita host:porta e literais IPv6
  return HOSTNAME_PATTERN.test(value);
}
