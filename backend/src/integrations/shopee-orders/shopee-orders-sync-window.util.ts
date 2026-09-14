import type { PeriodWindow } from '../marketplace-orders/period.util';

const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Mesmo teto de 15 dias já validado por `validateShopeeOrderListInput`
 * (`shopee-order-list-input.ts`, Checkpoint CP2K-1) — duplicado
 * deliberadamente aqui (não exportado de lá para não acoplar o validador de
 * entrada do cliente à lógica de particionamento de janela do serviço de
 * sincronização, camadas distintas).
 */
export const SHOPEE_ORDER_LIST_MAX_BLOCK_SPAN_SECONDS = 15 * SECONDS_PER_DAY;

/** Sobreposição de segurança de 1 segundo entre blocos consecutivos (Checkpoint CP2K-3B) —
 * a documentação oficial não declara se `time_from`/`time_to` são inclusivos
 * ou exclusivos nas bordas, então o próximo bloco começa 1 segundo ANTES do
 * fim do anterior, nunca exatamente onde ele termina — garante que nenhum
 * pedido na borda seja perdido, ao custo de possivelmente ver o mesmo
 * `order_sn` nos dois blocos (por isso a deduplicação em
 * `shopee-orders-fetch.util.ts` é obrigatória, nunca opcional). */
const BLOCK_OVERLAP_SECONDS = 1;

export interface ShopeeSyncBlock {
  timeFrom: number;
  timeTo: number;
}

/**
 * Particiona uma janela [from, to) em blocos de no máximo 15 dias cada, com
 * 1 segundo de sobreposição entre blocos consecutivos — nunca uma lacuna.
 * `PeriodWindow` usa `Date` (instantes); a Shopee usa segundos desde a época
 * (`time_from`/`time_to`) — a conversão acontece só aqui, uma vez.
 *
 * Termina em um número finito de iterações: a cada passo o início avança em
 * (`SHOPEE_ORDER_LIST_MAX_BLOCK_SPAN_SECONDS` - `BLOCK_OVERLAP_SECONDS`)
 * segundos, um valor fixo e positivo — nunca um loop infinito, mesmo para
 * uma janela muito longa.
 */
export function splitShopeeSyncWindowIntoBlocks(
  window: PeriodWindow,
): ShopeeSyncBlock[] {
  const fromSeconds = Math.floor(window.from.getTime() / 1000);
  const toSeconds = Math.ceil(window.to.getTime() / 1000);
  if (fromSeconds >= toSeconds) return [];

  const blocks: ShopeeSyncBlock[] = [];
  let blockFrom = fromSeconds;
  for (;;) {
    const blockTo = Math.min(
      blockFrom + SHOPEE_ORDER_LIST_MAX_BLOCK_SPAN_SECONDS,
      toSeconds,
    );
    blocks.push({ timeFrom: blockFrom, timeTo: blockTo });
    if (blockTo >= toSeconds) break;
    blockFrom = blockTo - BLOCK_OVERLAP_SECONDS;
  }
  return blocks;
}
