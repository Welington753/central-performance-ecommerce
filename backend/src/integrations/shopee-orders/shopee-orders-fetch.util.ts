import type { ShopeeShopCredentials } from '../shopee-oauth/shopee-access-token.service';
import type { ShopeeOrderDetailOrder } from './shopee-order-detail-response';
import type {
  ShopeeOrderDetailOutcome,
  ShopeeOrderListOutcome,
} from './shopee-orders-api.client';
import {
  resolveShopeeOrdersApiErrorCode,
  ShopeeOrdersSyncError,
} from './shopee-orders-sync-error';
import type { ShopeeSyncBlock } from './shopee-orders-sync-window.util';
import type {
  ShopeeOrdersHttpDiagnostics,
  ShopeeOrderSyncFailureDiagnostics,
  ShopeeOrderSyncOutcomeKind,
  ShopeeOrderSyncStage,
} from './shopee-order-sync-diagnostics';

/**
 * Único subconjunto de `kind` que carrega diagnóstico propagável
 * (`ShopeeOrderSyncOutcomeKind`) — `configuration_error`/`invalid_request`
 * nunca são causa de `DATA_UNAVAILABLE`/`TEMPORARILY_UNAVAILABLE` (mapeiam
 * para `NOT_CONFIGURED`, `resolveShopeeOrdersApiErrorCode`), então nunca
 * geram diagnóstico de `stage` — continuam sem log estruturado, como já era.
 */
function isLoggableOrdersOutcomeKind(
  kind: string,
): kind is ShopeeOrderSyncOutcomeKind {
  return (
    kind === 'provider_rejected' ||
    kind === 'invalid_response' ||
    kind === 'rate_limited' ||
    kind === 'temporary_failure' ||
    kind === 'unknown_result'
  );
}

function buildOrdersFetchFailureDiagnostics(
  stage: ShopeeOrderSyncStage,
  kind: string,
  diagnostics: ShopeeOrdersHttpDiagnostics | undefined,
  index: { blockIndex: number } | { batchIndex: number },
): ShopeeOrderSyncFailureDiagnostics | undefined {
  if (!isLoggableOrdersOutcomeKind(kind)) return undefined;
  return {
    stage,
    outcomeKind: kind,
    ...index,
    ...(diagnostics ?? {}),
  };
}

const ORDER_LIST_PAGE_SIZE = 100;

/**
 * Teto de páginas por bloco de 15 dias (Checkpoint CP2K-3B) — 100
 * pedidos/página * 50 páginas = 5000 pedidos por bloco, mesma ordem de
 * grandeza do teto total abaixo; protege um único bloco contra um cursor
 * cíclico/corrompido mesmo antes do teto total ser considerado.
 */
export const MAX_PAGES_PER_BLOCK = 50;

/**
 * Teto total de pedidos por execução (Checkpoint CP2K-3B) — decisão de
 * produto: cada lote de até 50 pedidos exige uma chamada adicional a
 * `get_order_detail` (Checkpoint CP2K-2), então um teto muito alto
 * multiplicaria o custo de chamadas por execução; 5000 cobre uma janela
 * incremental típica com folga larga e mantém no máximo 100 chamadas de
 * detalhe por sincronização.
 */
export const MAX_TOTAL_ORDERS_PER_SYNC = 5000;

/** Mesmo teto rígido de `ShopeeOrderDetailInput` (Checkpoint CP2K-2). */
export const ORDER_DETAIL_BATCH_SIZE = 50;

interface OrderListClient {
  getOrderList(input: {
    accessToken: string;
    shopId: string;
    timeRangeField: 'update_time';
    timeFrom: number;
    timeTo: number;
    pageSize: number;
    cursor?: string;
  }): Promise<ShopeeOrderListOutcome>;
}

export interface ShopeeOrderSnFetchResult {
  orderSns: string[];
  pagesFetched: number;
  /** `true` quando um teto de segurança interrompeu a busca antes do fim natural da janela. */
  capped: boolean;
  /**
   * Checkpoint CP2K-5C-2: `timeTo` do último bloco INTEIRAMENTE enumerado
   * antes de um cap — a fronteira até onde a janela foi PROVADA, nunca a
   * janela requisitada inteira. Sempre `null` quando `capped: false` (a
   * janela inteira foi enumerada, o conceito de "fronteira parcial" não se
   * aplica) e também `null` quando o cap ocorreu antes de concluir o
   * PRIMEIRO bloco (nenhum prefixo provado ainda). Consumido por
   * `finalizeSyncRunPartial` (Checkpoint CP2K-5C-1) — nunca usado aqui, só
   * calculado.
   */
  completedThroughSeconds: number | null;
}

/**
 * Busca todos os `order_sn` de `get_order_list` (Checkpoint CP2K-3B) para
 * todos os blocos de uma janela, sempre com `time_range_field=update_time`.
 * Deduplica entre páginas e entre blocos (a sobreposição de 1 segundo entre
 * blocos, ver `shopee-orders-sync-window.util.ts`, pode repetir o mesmo
 * pedido), preservando a ordem da primeira ocorrência.
 *
 * Nunca lança por ter atingido um teto de segurança (página, total de
 * pedidos, cursor vazio/repetido) — devolve `capped: true` com o que já foi
 * coletado; só lança `ShopeeOrdersSyncError` para uma falha real do
 * provedor (outcome que não é `success`).
 *
 * Laço externo INDEXADO (Checkpoint CP2K-5C-2, antigo "CP2K-5E") — nunca
 * `for...of` — porque o teto total agora também é avaliado NA FRONTEIRA
 * entre blocos (não só no meio de um bloco, correção do commit 36956ef):
 * um bloco que termina naturalmente (`more=false`) e já atinge o teto
 * PARA antes do próximo bloco, exceto quando é o ÚLTIMO bloco da janela —
 * nesse caso a janela inteira foi enumerada e não há cap de verdade,
 * mesmo com o total acima do teto (mesma lógica de "só ultrapassar não
 * basta, sem `more=true` restante não é cap" do CP2K-5B-R1, agora também
 * entre blocos). Saber se existe PRÓXIMO bloco exige o índice.
 */
export async function fetchShopeeOrderSns(input: {
  client: OrderListClient;
  credentials: ShopeeShopCredentials;
  blocks: ShopeeSyncBlock[];
}): Promise<ShopeeOrderSnFetchResult> {
  const orderSnSet = new Set<string>();
  const orderSns: string[] = [];
  let pagesFetched = 0;
  // `timeTo` do último bloco que terminou naturalmente (more=false) — nunca
  // do bloco corrente ainda em andamento. `null` até o primeiro bloco
  // concluir; é exatamente o valor devolvido quando um cap acontece DENTRO
  // de um bloco (meio de página ou anomalia de cursor), nunca recalculado
  // ali.
  let lastCompletedBlockTimeTo: number | null = null;

  for (let blockIndex = 0; blockIndex < input.blocks.length; blockIndex += 1) {
    const block = input.blocks[blockIndex];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;

    for (;;) {
      const outcome = await input.client.getOrderList({
        accessToken: input.credentials.accessToken,
        shopId: input.credentials.shopId,
        timeRangeField: 'update_time',
        timeFrom: block.timeFrom,
        timeTo: block.timeTo,
        pageSize: ORDER_LIST_PAGE_SIZE,
        cursor,
      });

      if (outcome.kind !== 'success') {
        throw new ShopeeOrdersSyncError(
          resolveShopeeOrdersApiErrorCode(outcome.kind),
          buildOrdersFetchFailureDiagnostics(
            'ORDER_LIST',
            outcome.kind,
            'diagnostics' in outcome ? outcome.diagnostics : undefined,
            { blockIndex },
          ),
        );
      }
      pagesFetched += 1;

      for (const order of outcome.result.orders) {
        if (!orderSnSet.has(order.orderSn)) {
          orderSnSet.add(order.orderSn);
          orderSns.push(order.orderSn);
        }
      }

      // Checkpoint CP2K-5B-R1: o teto só é aplicado NA FRONTEIRA entre
      // páginas, nunca no meio de uma página já recebida - todos os
      // `order_sn` de uma página são sempre preservados (nunca truncados
      // silenciosamente), mesmo quando a página sozinha ultrapassa
      // `MAX_TOTAL_ORDERS_PER_SYNC` (o pedido de página é sempre fixo em
      // `ORDER_LIST_PAGE_SIZE` = 100, então a ultrapassagem máxima normal é
      // limitada ao restante dessa página, nunca ilimitada). `more=false`
      // decide sozinho: a Shopee confirmou que a enumeração da janela
      // terminou aqui, então NUNCA é cap de verdade, mesmo que o total final
      // exceda o teto (cai no `if (!outcome.result.more) break` abaixo,
      // nunca no `return` deste bloco). Só quando `more=true` (existe página
      // não enumerada) E o teto já foi atingido/ultrapassado é que a busca
      // para com `capped: true` — a fronteira provada é a do último bloco
      // ANTERIOR concluído (`null` se isto aconteceu ainda no primeiro
      // bloco), nunca o bloco corrente, que não terminou de ser enumerado.
      if (outcome.result.more && orderSnSet.size >= MAX_TOTAL_ORDERS_PER_SYNC) {
        return {
          orderSns,
          pagesFetched,
          capped: true,
          completedThroughSeconds: lastCompletedBlockTimeTo,
        };
      }

      if (!outcome.result.more) break;

      const nextCursor = outcome.result.nextCursor;
      if (nextCursor === null || nextCursor === '') {
        // Defesa em profundidade: o cliente (CP2K-1) já garante `nextCursor`
        // não vazio quando `more=true`, mas nunca confia duas vezes sem
        // reconferir — nunca segue paginando com um cursor inconsistente.
        return {
          orderSns,
          pagesFetched,
          capped: true,
          completedThroughSeconds: lastCompletedBlockTimeTo,
        };
      }
      if (
        seenCursors.has(nextCursor) ||
        seenCursors.size + 1 >= MAX_PAGES_PER_BLOCK
      ) {
        // Cursor repetido (ciclo) OU teto de páginas deste bloco atingido —
        // nunca reenvia a mesma chamada em loop.
        return {
          orderSns,
          pagesFetched,
          capped: true,
          completedThroughSeconds: lastCompletedBlockTimeTo,
        };
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }

    // Bloco corrente terminou NATURALMENTE (more=false na última página) —
    // a fronteira provada avança até aqui.
    lastCompletedBlockTimeTo = block.timeTo;

    const isLastBlock = blockIndex === input.blocks.length - 1;
    if (!isLastBlock && orderSnSet.size >= MAX_TOTAL_ORDERS_PER_SYNC) {
      // Teto atingido NA FRONTEIRA entre blocos (Checkpoint CP2K-5C-2):
      // este bloco fechou por inteiro, mas ainda existe pelo menos mais um
      // bloco na janela — para aqui, ANTES de fazer qualquer chamada para
      // o próximo bloco. Quando este é o ÚLTIMO bloco, cai fora deste `if`
      // e o laço externo termina sozinho — a janela inteira foi enumerada,
      // nunca um cap de verdade, mesmo com o total acima do teto.
      return {
        orderSns,
        pagesFetched,
        capped: true,
        completedThroughSeconds: block.timeTo,
      };
    }
  }

  return {
    orderSns,
    pagesFetched,
    capped: false,
    completedThroughSeconds: null,
  };
}

interface OrderDetailClient {
  getOrderDetail(input: {
    accessToken: string;
    shopId: string;
    orderSnList: string[];
  }): Promise<ShopeeOrderDetailOutcome>;
}

/**
 * Busca `get_order_detail` (Checkpoint CP2K-2) em lotes de até
 * `ORDER_DETAIL_BATCH_SIZE`. A correspondência integral entre pedidos
 * solicitados e retornados já é garantida pelo próprio cliente
 * (`validateShopeeOrderDetailResponseBody`) — um lote com pedido
 * ausente/extra/duplicado já chega aqui como outcome `invalid_response`,
 * nunca como `success` parcial.
 */
export async function fetchShopeeOrderDetails(input: {
  client: OrderDetailClient;
  credentials: ShopeeShopCredentials;
  orderSns: string[];
}): Promise<ShopeeOrderDetailOrder[]> {
  const details: ShopeeOrderDetailOrder[] = [];

  for (let i = 0; i < input.orderSns.length; i += ORDER_DETAIL_BATCH_SIZE) {
    const batch = input.orderSns.slice(i, i + ORDER_DETAIL_BATCH_SIZE);
    const outcome = await input.client.getOrderDetail({
      accessToken: input.credentials.accessToken,
      shopId: input.credentials.shopId,
      orderSnList: batch,
    });

    if (outcome.kind !== 'success') {
      throw new ShopeeOrdersSyncError(
        resolveShopeeOrdersApiErrorCode(outcome.kind),
        buildOrdersFetchFailureDiagnostics(
          'ORDER_DETAIL',
          outcome.kind,
          'diagnostics' in outcome ? outcome.diagnostics : undefined,
          { batchIndex: i / ORDER_DETAIL_BATCH_SIZE },
        ),
      );
    }
    details.push(...outcome.result.orders);
  }

  return details;
}
