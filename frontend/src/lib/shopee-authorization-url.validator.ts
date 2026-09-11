/**
 * Allowlist fechada dos únicos hosts+paths de autorização Shopee aceitos
 * pelo frontend antes de redirecionar o navegador (CP2E) — espelha
 * `SHOPEE_ENDPOINTS` do backend (`shopee-endpoints.ts`), nunca uma URL
 * arbitrária vinda da resposta do backend sem essa checagem.
 *
 * CP2F-R1: o host Sandbox `open.sandbox.test-stable.shopee.com.br` nunca
 * resolveu em DNS real (NXDOMAIN confirmado) — substituído pelo host global
 * `open.sandbox.test-stable.shopee.com` (sem `.br`), único confirmado pelo
 * fluxo real de autorização no Console da Shopee. Produção
 * (`open.shopee.com.br`) permanece inalterada.
 */
const SHOPEE_AUTHORIZATION_URL_ALLOWLIST: ReadonlySet<string> = new Set([
  "https://open.shopee.com.br/auth",
  "https://open.sandbox.test-stable.shopee.com/auth",
]);

/**
 * Valida a `authorizationUrl` recebida do backend antes do redirect.
 * Exige HTTPS, origin+pathname EXATOS contra a allowlist, sem credenciais
 * embutidas e sem fragmento — nunca aceita host parcial, subdomínio
 * parecido ou URL relativa (o construtor `URL` sem base lança para
 * relativas, capturado abaixo).
 */
export function isAllowedShopeeAuthorizationUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  if (url.hash !== "") return false;

  const originAndPath = `${url.origin}${url.pathname}`;
  return SHOPEE_AUTHORIZATION_URL_ALLOWLIST.has(originAndPath);
}
