// Espelha MercadoLivreKpisResponseDto (backend, Fase 3 + Checkpoint 2)
// exatamente — nenhum campo interno/PII: só o que o endpoint GET
// /marketplace-accounts/:id/mercado-livre/kpis já allowlista.
export interface MercadoLivreKpisDto {
  account: {
    id: string;
    externalSellerId: string | null;
    nickname: string | null;
  };
  period: {
    days: number;
    timeZone: string;
    from: string;
    to: string;
  };
  comparisonPeriod: {
    days: number;
    from: string;
    to: string;
  };
  summary: {
    grossRevenue: string;
    orders: number;
    units: number;
    averageTicket: string;
    cancelledOrders: number;
    cancellationRate: number;
    distinctProducts: number;
    unitsPerOrder: number;
    avgUnitPrice: string;
  };
  comparison: {
    grossRevenuePct: number | null;
    ordersPct: number | null;
    unitsPct: number | null;
    averageTicketPct: number | null;
    cancelledOrdersPct: number | null;
    cancellationRateDiffPp: number;
    distinctProductsPct: number | null;
    unitsPerOrderPct: number | null;
  };
  bestDay: {
    date: string;
    grossRevenue: string;
    paidOrders: number;
    units: number;
  } | null;
  dailySeries: Array<{
    date: string;
    grossRevenue: string;
    paidOrders: number;
    units: number;
    cancelledOrders: number;
  }>;
  topProducts: Array<{
    sku: string | null;
    title: string;
    units: number;
    grossRevenue: string;
  }>;
  topProductsBySku: Array<{
    sku: string | null;
    title: string;
    distinctListings: number;
    units: number;
    grossRevenue: string;
    unitsSharePct: number;
  }>;
  topListings: Array<{
    listingId: string;
    sku: string | null;
    title: string;
    units: number;
    grossRevenue: string;
  }>;
  dataCoverage: {
    status: "complete" | "partial" | "unknown";
    synchronizedFrom: string | null;
    synchronizedTo: string | null;
    selectedPeriodComplete: boolean;
    comparisonPeriodComplete: boolean;
  };
  lastSync: string | null;
}

// Espelha SyncOrdersSummary (backend, Fase 3) — retorno de
// POST /marketplace-accounts/:id/mercado-livre/sync-orders.
export interface MercadoLivreSyncSummary {
  status: "SUCCESS";
  startedAt: string;
  finishedAt: string;
  pagesFetched: number;
  ordersFetched: number;
  ordersCreated: number;
  ordersUpdated: number;
  itemsPersisted: number;
  periodFrom: string;
  periodTo: string;
}
