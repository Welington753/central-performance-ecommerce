/**
 * Allowlist fechada dos endpoints regionais oficiais da Amazon SP-API
 * (documentação pública da Amazon: região NA, EU e FE). Nenhum outro host é
 * aceito — protege contra SSRF via uma variável de ambiente mal configurada
 * ou adulterada, já que `AMAZON_SP_API_ENDPOINT` nunca é validada apenas por
 * ser uma URI bem-formada (isso o schema Joi já garante), mas também por
 * pertencer a este conjunto fechado.
 */
export const ALLOWED_AMAZON_SP_API_ENDPOINTS = [
  'https://sellingpartnerapi-na.amazon.com',
  'https://sellingpartnerapi-eu.amazon.com',
  'https://sellingpartnerapi-fe.amazon.com',
] as const;

export function isAllowedAmazonSpApiEndpoint(endpoint: string): boolean {
  return (ALLOWED_AMAZON_SP_API_ENDPOINTS as readonly string[]).includes(
    endpoint,
  );
}
