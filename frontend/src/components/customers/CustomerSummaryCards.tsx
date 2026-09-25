import { formatBRL } from "@/lib/kpi-format";
import { formatMoneyOrNA, formatRatioOrNA } from "@/lib/customer-format";
import type { CustomerCardsDto } from "@/types/customers";

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border-subtle bg-surface px-4 py-3">
      <span className="text-xs font-medium uppercase tracking-wide text-foreground/60">
        {label}
      </span>
      <span className="text-xl font-semibold">{value}</span>
      {hint ? <span className="text-xs text-foreground/50">{hint}</span> : null}
    </div>
  );
}

export function CustomerSummaryCards({ cards }: { cards: CustomerCardsDto }) {
  return (
    <section aria-label="Indicadores de clientes" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <Card label="Clientes identificados" value={cards.identifiedCustomers.toLocaleString("pt-BR")} />
      <Card label="Clientes recorrentes" value={cards.recurringCustomers.toLocaleString("pt-BR")} hint="2+ pedidos válidos" />
      <Card
        label="Recorrência"
        value={formatRatioOrNA(cards.recurrenceRate)}
        hint="sobre clientes com compra válida"
      />
      <Card label="Faturamento pago" value={formatBRL(cards.paidRevenue)} hint="pedidos pagos" />
      <Card label="Ticket médio" value={formatMoneyOrNA(cards.averageTicket)} />
      <Card label="Unidades compradas" value={cards.units.toLocaleString("pt-BR")} />
      <Card
        label="Com nome do comprador"
        value={formatRatioOrNA(cards.buyerNameCoverage)}
        hint="Mercado Livre"
      />
      <Card
        label="Com nome do destinatário"
        value={formatRatioOrNA(cards.recipientNameCoverage)}
        hint="Shopee — pode não ser o comprador"
      />
      <Card label="Com e-mail" value={formatRatioOrNA(cards.emailCoverage)} />
      <Card
        label="Com telefone do destinatário"
        value={formatRatioOrNA(cards.recipientPhoneCoverage)}
        hint="Shopee — pode não ser o comprador"
      />
    </section>
  );
}
