import { Marketplace } from '../integrations/contracts/marketplace.enum';
import type { CustomerType } from './customer-metrics';

// Colunas e rótulos fixos das três abas do Excel de clientes.

export const NOT_AVAILABLE = 'N/D';
const MONEY_FORMAT = '"R$" #,##0.00';
const DATE_FORMAT = 'dd/mm/yyyy hh:mm';
const PERCENT_FORMAT = '0.0%';

export interface ColumnSpec {
  header: string;
  width: number;
  numFmt?: string;
}

export const MARKETPLACE_LABEL: Record<string, string> = {
  [Marketplace.MERCADO_LIVRE]: 'Mercado Livre',
  [Marketplace.SHOPEE]: 'Shopee',
};

export const CUSTOMER_TYPE_LABEL: Record<CustomerType, string> = {
  NEW: 'Novo',
  RECURRING: 'Recorrente',
  NO_VALID_ORDER: 'Sem compra válida',
};

/** Campos que cada marketplace nunca fornece no fluxo de pedidos atual. */
export const NEVER_COLLECTED =
  'CPF/documento e endereço completo nunca são coletados';
export const UNAVAILABLE_BY_MARKETPLACE: Record<string, string> = {
  [Marketplace.MERCADO_LIVRE]: `e-mail, telefone, cidade, UF e CEP (não vêm no pedido do Mercado Livre); ${NEVER_COLLECTED}`,
  [Marketplace.SHOPEE]: `nome e e-mail do comprador (não fornecidos pela Shopee; nome, telefone, cidade, UF e CEP são do destinatário da entrega); ${NEVER_COLLECTED}`,
};

export const FULFILLMENT_LABEL = {
  FULL: 'Full',
  NORMAL: 'Venda normal',
  UNKNOWN: NOT_AVAILABLE,
} as const;

export const SUMMARY_COLUMNS: ColumnSpec[] = [
  { header: 'Marketplace', width: 16 },
  { header: 'Conta', width: 18 },
  { header: 'ID comprador', width: 18 },
  { header: 'Username do comprador', width: 22 },
  { header: 'Nome do comprador', width: 26 },
  { header: 'Nome do destinatário', width: 26 },
  { header: 'E-mail', width: 28 },
  { header: 'Telefone do destinatário', width: 22 },
  { header: 'Cidade (entrega)', width: 18 },
  { header: 'UF (entrega)', width: 10 },
  { header: 'CEP (entrega)', width: 14 },
  { header: 'Primeira compra', width: 18, numFmt: DATE_FORMAT },
  { header: 'Última compra', width: 18, numFmt: DATE_FORMAT },
  { header: 'Pedidos', width: 10 },
  { header: 'Unidades', width: 10 },
  { header: 'Valor bruto pago', width: 18, numFmt: MONEY_FORMAT },
  { header: 'Reembolso conhecido', width: 20, numFmt: MONEY_FORMAT },
  { header: 'Ticket médio', width: 16, numFmt: MONEY_FORMAT },
  { header: 'Novo/recorrente', width: 18 },
  { header: 'Produto mais comprado', width: 36 },
  { header: 'Cobertura/observação', width: 48 },
];

export const DETAIL_COLUMNS: ColumnSpec[] = [
  { header: 'Marketplace', width: 16 },
  { header: 'Conta', width: 18 },
  { header: 'ID comprador', width: 18 },
  { header: 'Username do comprador', width: 22 },
  { header: 'Pedido', width: 22 },
  { header: 'Data', width: 18, numFmt: DATE_FORMAT },
  { header: 'Status', width: 18 },
  { header: 'SKU', width: 18 },
  { header: 'Produto', width: 40 },
  { header: 'Anúncio', width: 18 },
  { header: 'Quantidade', width: 12 },
  { header: 'Preço unitário', width: 16, numFmt: MONEY_FORMAT },
  { header: 'Total do pedido', width: 16, numFmt: MONEY_FORMAT },
  { header: 'Reembolso conhecido', width: 20, numFmt: MONEY_FORMAT },
  { header: 'Full/venda normal', width: 18 },
];

export const COVERAGE_COLUMNS: ColumnSpec[] = [
  { header: 'Marketplace', width: 16 },
  { header: 'Conta', width: 18 },
  { header: 'Pedidos totais', width: 14 },
  { header: 'Pedidos associados a comprador', width: 30 },
  { header: 'Compradores identificados', width: 26 },
  { header: 'Com username', width: 14 },
  { header: 'Com nome do comprador', width: 22 },
  { header: 'Com nome do destinatário', width: 24 },
  { header: 'Com e-mail', width: 12 },
  { header: 'Com telefone do destinatário', width: 28 },
  { header: 'Com cidade (entrega)', width: 20 },
  { header: 'Com UF (entrega)', width: 16 },
  { header: 'Com CEP (entrega)', width: 18 },
  { header: 'Campos mascarados', width: 18 },
  { header: 'Campos indisponíveis', width: 60 },
  { header: 'Cobertura de pedidos', width: 20, numFmt: PERCENT_FORMAT },
];
