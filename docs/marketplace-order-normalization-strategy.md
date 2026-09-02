# Estratégia de normalização de pedidos multi-marketplace

Este documento descreve como pedidos de marketplaces diferentes (Mercado
Livre, Amazon) são reduzidos a um único formato normalizado e persistidos
nas mesmas tabelas compartilhadas (`marketplace_orders`,
`marketplace_order_items`), de forma que o endpoint genérico
`/marketplace-analytics/kpis` consiga agregá-los sem conhecer detalhes de
nenhum marketplace específico.

## 1. Núcleo compartilhado (`backend/src/integrations/marketplace-orders/`)

Desde o Checkpoint 4-B, a infraestrutura genérica de pedidos foi extraída
de `mercado-livre-orders/` (onde vivia fisicamente, mas sem nenhuma
dependência real do Mercado Livre) para um módulo próprio:

- `marketplace-order.entity.ts` / `marketplace-order-item.entity.ts` —
  entidades TypeORM, sem nenhum campo específico de marketplace nos nomes
  centrais.
- `money.util.ts` — aritmética monetária exclusivamente em centavos
  (`bigint`), nunca `float`.
- `period.util.ts` — janelas de data/hora, sempre em UTC internamente.
- `order-status.ts` — vocabulário CANÔNICO de status
  (`paid`/`cancelled`/`pending`/`unfulfillable`).
- `coverage-interval.util.ts` — fusão de intervalos de sincronização.
- `marketplace-orders-persistence.service.ts` — único ponto de escrita em
  `marketplace_orders`/`marketplace_order_items`/`sync_runs`, reaproveitado
  por QUALQUER marketplace.

Cada marketplace (`mercado-livre-orders/`, `amazon-orders/`) mantém, no seu
próprio diretório, apenas o que é genuinamente específico dele: o cliente
HTTP do provedor, o parser/validador fechado da resposta bruta, e o
*mapper* que converte a resposta validada para o formato compartilhado.

## 2. O contrato compartilhado: `MappedOrderRecord`

Todo mapper específico de marketplace produz exatamente este formato
(`marketplace-orders/mapped-order-record.ts`) antes de qualquer persistência:

```ts
interface MappedOrderRecord {
  marketplaceAccountId: string;
  externalOrderId: string;
  status: string;              // CANÔNICO: paid | cancelled | pending | unfulfillable
  currencyId: string;
  totalAmount: string;         // decimal, nunca float
  packId: string | null;
  dateCreated: Date;
  dateClosed: Date | null;
  marketplaceLastUpdated: Date | null; // usado para nunca sobrescrever um evento mais novo com um mais antigo
  sourceStatus?: string | null;        // status ORIGINAL do provedor, preservado separadamente
  fulfillmentChannel?: string | null;  // AMAZON (FBA) | MERCHANT (FBM) — só Amazon
  externalMarketplaceId?: string | null; // marketplaceId do provedor — só Amazon
  items: MappedOrderItemRecord[];
}
```

Os três campos opcionais (`sourceStatus`/`fulfillmentChannel`/
`externalMarketplaceId`) existem hoje só para a Amazon — o mapper do
Mercado Livre nunca os define, e ficam `NULL` no banco (colunas nullable,
migration `1788100000000-amazon-orders.ts`), sem qualquer alteração de
comportamento para os dados já existentes.

## 3. Por que o `status` armazenado é sempre canônico

`marketplace_orders.status` armazena sempre um dos quatro valores canônicos
(`order-status.ts`), nunca o vocabulário bruto de um provedor específico:

- **Mercado Livre**: por coincidência de nomenclatura, dois dos status
  brutos da API (`paid`, `cancelled`) já SÃO os canônicos — o mapper do
  Mercado Livre passa o valor adiante sem tradução. Os demais status brutos
  (`confirmed`, `payment_required`, `partially_paid`,
  `partially_refunded`, `pending_cancel`, `invalid`) nunca entram em nenhum
  filtro de KPI (nem `= 'paid'` nem `= 'cancelled'`) — esse já era o
  comportamento antes deste checkpoint, preservado sem alteração.
- **Amazon**: o mapper (`amazon-orders/amazon-order-status.ts`) traduz
  EXPLICITAMENTE o `fulfillment.fulfillmentStatus` bruto (`UNSHIPPED`,
  `PARTIALLY_SHIPPED`, `SHIPPED`, `CANCELLED`, `PENDING`,
  `PENDING_AVAILABILITY`, `UNFULFILLABLE`) para um dos quatro valores
  canônicos, e preserva o valor bruto original em `source_status`.

Isso garante que a agregação genérica (`marketplace-analytics.service.ts`)
nunca precise conhecer o vocabulário de nenhum marketplace — ela sempre lê
e filtra pelos quatro valores canônicos.

## 4. Mapeamento financeiro

- **Total do pedido**: Mercado Livre usa `total_amount` da API; Amazon usa
  `Order.proceeds.grandTotal`. Um pedido PAGO sem total válido nunca vira
  zero — é rejeitado/quarentenado (`AmazonOrderQuarantinedError`, código
  `MISSING_GRAND_TOTAL`) e simplesmente não é persistido nesta
  sincronização.
- **Preço do item**: prioriza o preço direto do produto
  (`product.price.unitPrice`); só usa o breakdown financeiro do item
  (`orderItems[].proceeds`, entrada `type=ITEM`) como fallback. Um item de
  pedido PAGO sem preço resolvível também quarentena o pedido inteiro —
  nunca vira zero silenciosamente.
- **Pedidos não pagos** (`pending`/`cancelled`/`unfulfillable`) toleram
  ausência de total/preço (preenchidos com `"0.00"`) porque nenhum KPI
  atual soma valores desses status — apenas a CONTAGEM de cancelados é
  usada.
- **Moeda**: cada pedido precisa ter uma moeda determinável (do total ou de
  algum item) e todos os itens de um mesmo pedido precisam compartilhar
  essa moeda — divergência quarentena o pedido
  (`CURRENCY_MISMATCH`)/(`MISSING_CURRENCY`).
- **Escopo por marketplace configurado**: um pedido cujo `marketplaceId`
  não esteja em `AMAZON_MARKETPLACE_IDS` é rejeitado
  (`MARKETPLACE_NOT_ALLOWED`) — nunca persistido.
- **Agregação multi-conta/multi-marketplace**: `marketplace-analytics.service.ts`
  verifica, antes de somar `total_amount` de pedidos pagos em um mesmo
  agregado, que todas as moedas envolvidas sejam idênticas — caso
  contrário lança `MarketplaceAnalyticsCurrencyMismatchError`, em vez de
  somar moedas diferentes como se fossem a mesma.

## 5. Idempotência e proteção contra eventos antigos

`MarketplaceOrdersPersistenceService.persistOrders` faz UPSERT por
`(marketplace_account_id, external_order_id)`. A cláusula `WHERE` do
`ON CONFLICT DO UPDATE` só aplica a atualização quando o
`marketplace_last_updated` recebido é `>=` ao já armazenado (ou quando um
dos dois é `NULL`, preservando o comportamento histórico do Mercado
Livre). Uma atualização mais antiga que a já persistida é simplesmente
ignorada — pulada por inteiro, itens inclusive — sem contar como criada
nem como atualizada.

## 6. Fulfillment (FBA/FBM)

`fulfillment_channel` distingue:

- `AMAZON` — Fulfillment by Amazon (a Amazon armazena/despacha);
- `MERCHANT` — Fulfillment by Merchant (o próprio vendedor despacha).

Este conceito não existe no Mercado Livre — a coluna fica `NULL` para
todos os pedidos daquele marketplace.
