import { stream as excelStream, type Worksheet } from 'exceljs';
import type { Writable } from 'stream';
import { decimalStringToCents } from '../integrations/marketplace-orders/money.util';
import { isMaskedValue } from '../integrations/marketplace-orders/buyer-snapshot';
import {
  isUsableValue,
  maskEmail,
  maskPhone,
  maskPostalCode,
  sanitizeSpreadsheetText,
} from './customer-format.util';
import type { CustomerRecord } from './customer-metrics';
import { fulfillmentLabel } from './customers.dto';
import type { AccountCoverageRow, DetailRow } from './customers.repository';
import {
  COVERAGE_COLUMNS,
  CUSTOMER_TYPE_LABEL,
  DETAIL_COLUMNS,
  FULFILLMENT_LABEL,
  MARKETPLACE_LABEL,
  NOT_AVAILABLE,
  SUMMARY_COLUMNS,
  UNAVAILABLE_BY_MARKETPLACE,
  type ColumnSpec,
} from './customers-workbook.columns';

export { NOT_AVAILABLE };

type Cell = string | number | Date | null;

/**
 * Fonte paginada da planilha — cada chamada devolve UM lote (vazio = fim).
 * A planilha nunca recebe o conjunto inteiro de compradores ou itens.
 */
export interface CustomersWorkbookSource {
  nextCustomers(): Promise<CustomerRecord[]>;
  nextDetails(): Promise<DetailRow[]>;
  coverage(): Promise<AccountCoverageRow[]>;
}

export interface CustomersWorkbookCounts {
  buyersCount: number;
  detailRowsCount: number;
}

/** Download interrompido (cliente desconectou ou resposta destruída). */
export class CustomersExportAbortedError extends Error {
  constructor() {
    super('CUSTOMERS_EXPORT_ABORTED');
  }
}

type CoverageField =
  | 'username'
  | 'buyerName'
  | 'recipientName'
  | 'email'
  | 'recipientPhone'
  | 'city'
  | 'state'
  | 'postalCode';

const PERSONAL_FIELDS: Array<[CoverageField, string]> = [
  ['buyerName', 'nome do comprador'],
  ['recipientName', 'nome do destinatário'],
  ['email', 'e-mail'],
  ['recipientPhone', 'telefone do destinatário'],
  ['city', 'cidade'],
  ['state', 'UF'],
  ['postalCode', 'CEP'],
];

interface CoverageCounter {
  buyers: number;
  masked: number;
  usable: Record<CoverageField, number>;
}

function money(value: string | bigint | null): number | null {
  if (value === null) return null;
  const cents = typeof value === 'bigint' ? value : decimalStringToCents(value);
  return Number(cents) / 100;
}

/**
 * TODA célula passa por aqui: ausência vira "N/D" (nunca zero inventado) e
 * TODO texto — inclusive rótulos fixos — passa por `sanitizeSpreadsheetText`
 * (formula injection), sem depender de lembrar coluna por coluna.
 */
function safeRow(values: Cell[]): Cell[] {
  return values.map((value) => {
    if (value === null) return NOT_AVAILABLE;
    return typeof value === 'string' ? sanitizeSpreadsheetText(value) : value;
  });
}

function coverageNote(record: CustomerRecord): string {
  const masked = PERSONAL_FIELDS.filter(([field]) =>
    isMaskedValue(record[field]),
  ).map(([, label]) => label);
  const missing = PERSONAL_FIELDS.filter(
    ([field]) => record[field] === null,
  ).map(([, label]) => label);
  const notes: string[] = [];
  if (masked.length > 0) {
    notes.push(`Mascarado pela fonte: ${masked.join(', ')}`);
  }
  if (missing.length > 0) notes.push(`Indisponível: ${missing.join(', ')}`);
  return notes.length > 0 ? notes.join('. ') : 'Completo';
}

function summaryRow(c: CustomerRecord, includePersonalData: boolean): Cell[] {
  return [
    MARKETPLACE_LABEL[c.marketplace] ?? c.marketplace,
    c.accountNickname,
    c.externalBuyerId,
    c.username,
    c.buyerName,
    c.recipientName,
    includePersonalData ? c.email : maskEmail(c.email),
    includePersonalData ? c.recipientPhone : maskPhone(c.recipientPhone),
    c.city,
    c.state,
    includePersonalData ? c.postalCode : maskPostalCode(c.postalCode),
    c.firstPurchaseAt,
    c.lastPurchaseAt,
    c.validOrders,
    c.units,
    money(c.paidRevenueCents),
    money(c.refundedCents),
    money(c.averageTicketCents),
    CUSTOMER_TYPE_LABEL[c.customerType],
    c.topProduct?.title ?? null,
    coverageNote(c),
  ];
}

function detailRow(d: DetailRow): Cell[] {
  return [
    MARKETPLACE_LABEL[d.marketplace] ?? d.marketplace,
    d.account_nickname,
    d.external_buyer_id,
    d.username,
    d.external_order_id,
    d.date_created,
    d.source_status ?? d.status,
    d.seller_sku,
    d.title,
    d.external_item_id,
    d.quantity,
    money(d.unit_price),
    money(d.total_amount),
    money(d.refunded_amount),
    FULFILLMENT_LABEL[fulfillmentLabel(d.logistics_classification)],
  ];
}

function countCoverage(
  counters: Map<string, CoverageCounter>,
  c: CustomerRecord,
): void {
  let counter = counters.get(c.accountId);
  if (!counter) {
    counter = {
      buyers: 0,
      masked: 0,
      usable: {
        username: 0,
        buyerName: 0,
        recipientName: 0,
        email: 0,
        recipientPhone: 0,
        city: 0,
        state: 0,
        postalCode: 0,
      },
    };
    counters.set(c.accountId, counter);
  }
  counter.buyers += 1;
  for (const field of Object.keys(counter.usable) as CoverageField[]) {
    if (isUsableValue(c[field])) counter.usable[field] += 1;
  }
  counter.masked += PERSONAL_FIELDS.filter(([field]) =>
    isMaskedValue(c[field]),
  ).length;
}

function coverageRow(
  account: AccountCoverageRow,
  counter: CoverageCounter | undefined,
): Cell[] {
  const usable = (field: CoverageField) => counter?.usable[field] ?? 0;
  return [
    MARKETPLACE_LABEL[account.marketplace] ?? account.marketplace,
    account.account_nickname,
    account.total_orders,
    account.orders_with_buyer,
    counter?.buyers ?? 0,
    usable('username'),
    usable('buyerName'),
    usable('recipientName'),
    usable('email'),
    usable('recipientPhone'),
    usable('city'),
    usable('state'),
    usable('postalCode'),
    counter?.masked ?? 0,
    UNAVAILABLE_BY_MARKETPLACE[account.marketplace] ?? null,
    account.total_orders === 0
      ? null
      : account.orders_with_buyer / account.total_orders,
  ];
}

function startSheet(
  workbook: excelStream.xlsx.WorkbookWriter,
  name: string,
  columns: ColumnSpec[],
): Worksheet {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = columns.map((column) => ({
    width: column.width,
    style: column.numFmt ? { numFmt: column.numFmt } : {},
  }));
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };
  const header = sheet.addRow(columns.map((column) => column.header));
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F2937' },
  };
  header.commit();
  return sheet;
}

/**
 * Espera o destino escoar (backpressure) antes do próximo lote, e aborta se
 * a resposta foi fechada/destruída — nunca acumula a planilha em memória
 * quando o cliente lê devagar ou desistiu.
 */
function waitForDrain(output: Writable, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted || output.destroyed) {
    return Promise.reject(new CustomersExportAbortedError());
  }
  if (!output.writableNeedDrain) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      output.off('drain', onDrain);
      output.off('close', onAbort);
      signal?.removeEventListener('abort', onAbort);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(new CustomersExportAbortedError());
    };
    output.on('drain', onDrain);
    output.on('close', onAbort);
    signal?.addEventListener('abort', onAbort);
  });
}

/**
 * Planilha gravada em STREAMING direto no `output` (writer streaming do
 * ExcelJS, sem shared strings): cada linha é confirmada (`commit`) assim que
 * escrita, as abas são criadas uma de cada vez, e a fonte é lida em lotes —
 * memória limitada a um lote, independentemente do tamanho do histórico.
 * Nunca gravada em disco nem servida por URL pública. Valores financeiros
 * ficam numéricos; e-mail/telefone/CEP mascarados sem `includePersonalData`.
 */
export async function writeCustomersWorkbook(
  source: CustomersWorkbookSource,
  output: Writable,
  options: { includePersonalData: boolean; signal?: AbortSignal },
): Promise<CustomersWorkbookCounts> {
  const workbook = new excelStream.xlsx.WorkbookWriter({
    stream: output,
    useStyles: true,
    useSharedStrings: false,
  });
  workbook.creator = 'Central de Performance';
  const counters = new Map<string, CoverageCounter>();
  let buyersCount = 0;
  let detailRowsCount = 0;

  const summary = startSheet(workbook, 'Resumo de clientes', SUMMARY_COLUMNS);
  for (;;) {
    const batch = await source.nextCustomers();
    if (batch.length === 0) break;
    for (const customer of batch) {
      summary
        .addRow(safeRow(summaryRow(customer, options.includePersonalData)))
        .commit();
      countCoverage(counters, customer);
    }
    buyersCount += batch.length;
    await waitForDrain(output, options.signal);
  }
  summary.commit();

  const details = startSheet(workbook, 'Compras detalhadas', DETAIL_COLUMNS);
  for (;;) {
    const batch = await source.nextDetails();
    if (batch.length === 0) break;
    for (const row of batch) details.addRow(safeRow(detailRow(row))).commit();
    detailRowsCount += batch.length;
    await waitForDrain(output, options.signal);
  }
  details.commit();

  const coverage = startSheet(
    workbook,
    'Cobertura dos dados',
    COVERAGE_COLUMNS,
  );
  for (const account of await source.coverage()) {
    coverage
      .addRow(safeRow(coverageRow(account, counters.get(account.account_id))))
      .commit();
  }
  coverage.commit();

  await workbook.commit();
  return { buyersCount, detailRowsCount };
}
