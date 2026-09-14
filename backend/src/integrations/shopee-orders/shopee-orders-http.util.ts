/**
 * Helpers HTTP de baixo nível compartilhados por `ShopeeOrdersApiClient`
 * (Checkpoint CP2K-2) - extraídos para cá quando um segundo método
 * (`getOrderDetail`) precisou exatamente da mesma lógica de
 * `getOrderList` (Checkpoint CP2K-1), evitando duplicá-la uma segunda vez
 * dentro do mesmo arquivo. Nunca compartilhado com `shopee-oauth/` (mesma
 * decisão de `ShopeeShopApiClient`/`ShopeeHttpClient`/`AmazonLwaClient`: cada
 * família de cliente mantém sua própria cópia, nunca um util cross-domain).
 */

/**
 * Duplicado deliberadamente do parsing de `Retry-After` de
 * `shopee-http.client.ts`/`shopee-shop-api.client.ts` - mesma razão de lá.
 */
export function parseRetryAfterMs(headerValue: string | null): number | null {
  if (headerValue === null) return null;
  if (!/^\d+$/.test(headerValue)) return null;
  const seconds = Number(headerValue);
  if (!Number.isSafeInteger(seconds) || seconds < 0) return null;
  return seconds * 1000;
}

/**
 * Lê o corpo com um teto de tamanho (Checkpoint CP2K-1, revisado no CP2K-2
 * para aceitar `maxBytes` diferente por endpoint) - mesmas duas camadas de
 * `ShopeeShopApiClient.readLimitedResponseText` (Checkpoint CP2I, revisado
 * no CP2I-R1):
 *
 *   1. `Content-Length` declarado: se presente e maior que `maxBytes`,
 *      rejeita ANTES de chamar `response.text()`.
 *   2. Tamanho real pós-leitura: mesmo sem `Content-Length` (ausente ou
 *      mentiroso), o texto já lido é recontado em bytes UTF-8 e rejeitado se
 *      ultrapassar `maxBytes`.
 *
 * Risco documentado (mesmo aceito no CP2I, não resolvido aqui): quando
 * `Content-Length` está ausente ou mentiroso E o corpo real excede
 * `maxBytes`, a camada 1 não impede a leitura - `response.text()` ainda
 * bufferiza o corpo inteiro na memória antes da camada 2 rejeitá-lo. Sem
 * streaming (nenhum cliente HTTP do projeto usa). Mitigação aceita pelo
 * mesmo motivo do CP2I: o host de destino é sempre um dos dois hosts
 * fechados de `SHOPEE_ENDPOINTS[environment].shopApiHost`, e o path é
 * sempre uma constante fechada (`SHOPEE_ORDER_LIST_PATH`/
 * `SHOPEE_ORDER_DETAIL_PATH`), nunca recebidos por parâmetro externo.
 */
export async function readLimitedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader !== null) {
    const declaredBytes = Number(contentLengthHeader);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      throw new Error('SHOPEE_ORDERS_RESPONSE_TOO_LARGE');
    }
  }

  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new Error('SHOPEE_ORDERS_RESPONSE_TOO_LARGE');
  }
  return text;
}
