/**
 * Representa uma execução de sincronização com um marketplace.
 *
 * Genérico por design: não referencia nenhum marketplace específico. O campo
 * `marketplace` é uma string livre vinda do backend (ex.: "MERCADO_LIVRE"),
 * mantendo o frontend agnóstico a quais canais existem.
 */
export interface SyncRun {
  id: string;
  marketplace: string;
  account: string;
  type: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  recordsRead: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsFailed: number;
}
