import { formatBRL } from "@/lib/kpi-format";
import {
  NOT_AVAILABLE,
  formatDateOrNA,
  formatMoneyOrNA,
  textOrNA,
} from "@/lib/customer-format";
import type { CustomerSummaryItemDto, CustomerType } from "@/types/customers";

const MARKETPLACE_LABEL = { MERCADO_LIVRE: "Mercado Livre", SHOPEE: "Shopee" } as const;

const TYPE_LABEL: Record<CustomerType, string> = {
  NEW: "Novo",
  RECURRING: "Recorrente",
  NO_VALID_ORDER: "Sem compra válida",
};

const HEADERS = [
  "Marketplace",
  "Conta",
  "ID externo",
  "Comprador",
  "Destinatário",
  "E-mail",
  "Telefone do destinatário",
  "Cidade/UF (entrega)",
  "Primeira compra",
  "Última compra",
  "Pedidos",
  "Unidades",
  "Valor bruto pago",
  "Reembolsos conhecidos",
  "Ticket médio",
  "Tipo",
  "Produto mais comprado",
];

function cityState(customer: CustomerSummaryItemDto): string {
  const parts = [customer.city, customer.state].filter(Boolean);
  return parts.length > 0 ? parts.join("/") : NOT_AVAILABLE;
}

interface CustomersTableProps {
  customers: CustomerSummaryItemDto[];
  page: number;
  totalPages: number;
  totalCustomers: number;
  onPageChange: (page: number) => void;
}

export function CustomersTable({
  customers,
  page,
  totalPages,
  totalCustomers,
  onPageChange,
}: CustomersTableProps) {
  if (customers.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border-subtle bg-surface px-6 py-10 text-center text-sm text-foreground/60">
        Nenhum cliente identificado para estes filtros.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-xl border border-border-subtle">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-foreground/5 text-xs uppercase tracking-wide text-foreground/60">
            <tr>
              {HEADERS.map((header) => (
                <th key={header} scope="col" className="whitespace-nowrap px-3 py-2">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.buyerId} className="border-t border-border-subtle">
                <td className="px-3 py-2">{MARKETPLACE_LABEL[customer.marketplace]}</td>
                <td className="px-3 py-2">{textOrNA(customer.accountNickname)}</td>
                <td className="px-3 py-2 font-mono text-xs">{customer.externalBuyerId}</td>
                <td className="px-3 py-2">
                  {textOrNA(customer.buyerName ?? customer.username)}
                  {customer.buyerName && customer.username ? (
                    <span className="block text-xs text-foreground/50">{customer.username}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2">{textOrNA(customer.recipientName)}</td>
                <td className="px-3 py-2">{textOrNA(customer.emailMasked)}</td>
                <td className="px-3 py-2">{textOrNA(customer.recipientPhoneMasked)}</td>
                <td className="px-3 py-2">{cityState(customer)}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatDateOrNA(customer.firstPurchaseAt)}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatDateOrNA(customer.lastPurchaseAt)}</td>
                <td className="px-3 py-2">{customer.validOrders}</td>
                <td className="px-3 py-2">{customer.units}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatBRL(customer.paidRevenue)}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatMoneyOrNA(customer.refundedAmount)}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatMoneyOrNA(customer.averageTicket)}</td>
                <td className="px-3 py-2">{TYPE_LABEL[customer.customerType]}</td>
                <td className="px-3 py-2">
                  {customer.topProduct ? customer.topProduct.title : NOT_AVAILABLE}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav aria-label="Paginação de clientes" className="flex items-center justify-between text-sm">
        <span className="text-foreground/60">
          {totalCustomers.toLocaleString("pt-BR")} clientes · página {page} de {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="rounded-md border border-border-subtle px-3 py-1.5 disabled:opacity-40"
          >
            Anterior
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="rounded-md border border-border-subtle px-3 py-1.5 disabled:opacity-40"
          >
            Próxima
          </button>
        </div>
      </nav>
    </div>
  );
}
