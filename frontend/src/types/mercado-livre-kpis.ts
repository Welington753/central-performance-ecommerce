// Espelha MercadoLivreKpisResponseDto (backend, Fase 3) exatamente — nenhum
// campo interno/PII: só o que o endpoint GET
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
  summary: {
    grossRevenue: string;
    orders: number;
    units: number;
    averageTicket: string;
  };
  comparison: {
    grossRevenuePct: number | null;
    ordersPct: number | null;
    unitsPct: number | null;
    averageTicketPct: number | null;
  };
  topProducts: Array<{
    sku: string | null;
    title: string;
    units: number;
    grossRevenue: string;
  }>;
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
