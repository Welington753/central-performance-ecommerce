/**
 * Estado da reclassificação histórica Full do Mercado Livre (correção da
 * auditoria Full, "Render free sem Shell"). Espelha
 * `MlLogisticsReclassificationAccountStatus` (backend) — nunca inclui token,
 * `external_shipment_id`, `external_order_id` ou resposta bruta do provedor.
 */
export type MlLogisticsReclassificationStatusValue =
  | "IDLE"
  | "RUNNING"
  | "PAUSED"
  | "WAITING_RETRY"
  | "COMPLETED"
  | "FAILED_AUTH";

export interface MlLogisticsReclassificationAccountStatusDto {
  accountId: string;
  nickname: string | null;
  status: MlLogisticsReclassificationStatusValue;
  initialUnknownCount: number;
  remainingUnknownCount: number;
  resolvedFullCount: number;
  resolvedNotFullCount: number;
  callsMadeCount: number;
  lastActivityAt: string | null;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  pauseRequested: boolean;
  /** Mesma interpretação efetiva que o worker do backend usa — nunca afirmar "processando" quando `false`. */
  workerEnabled: boolean;
}
