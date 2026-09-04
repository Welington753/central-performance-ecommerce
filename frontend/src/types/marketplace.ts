export interface MarketplaceCardData {
  id: string;
  name: string;
  statusLabel: string;
  description: string;
  cta?: {
    label: string;
    disabled: boolean;
    tooltip?: string;
    onClick?: () => void;
  };
  // Ação secundária opcional (Checkpoint 4-C) — ex.: "Reconfigurar
  // credenciais" ao lado de "Sincronizar agora" numa conta Amazon
  // conectada. Nunca usado pelo Mercado Livre — retrocompatível.
  secondaryCta?: {
    label: string;
    disabled: boolean;
    onClick?: () => void;
  };
  // Renomeação opcional (Fase 4): omitido para cards que não representam
  // uma conta real (placeholders "não conectado"/"disponível futuramente").
  // `secondaryLabel` mostra o identificador real (externalSellerId ou id
  // curto) ao lado do apelido, para nunca confundir contas parecidas.
  rename?: {
    currentNickname: string | null;
    secondaryLabel: string;
    onSave: (nickname: string | null) => Promise<void>;
  };
}

// Espelha MarketplaceAccountResponseDto (Task 14) exatamente — sem
// failureCode/errorSummary: design §7 os define como interno/auditoria,
// nunca expostos ao navegador. O frontend deriva mensagens públicas fixas
// só a partir de `status` (STATUS_LABELS/STATUS_DESCRIPTIONS na página).
// Sinal sanitizado para decidir a ação principal — nunca o failureCode
// interno (Fase 4, correção de resiliência OAuth). `TEMPORARY_RETRY` nunca
// mostra "Reconectar" como ação principal; `CONFIGURATION_ERROR` não
// orienta reconexão nenhuma.
export type MarketplaceAccountRecoveryHint =
  | "RECONNECT_REQUIRED"
  | "TEMPORARY_RETRY"
  | "CONFIGURATION_ERROR"
  | null;

export interface MarketplaceAccountDto {
  id: string;
  marketplace: "MERCADO_LIVRE" | "AMAZON" | "SHOPEE";
  externalSellerId: string | null;
  nickname: string | null;
  status: "DISCONNECTED" | "CONNECTED" | "TOKEN_EXPIRED" | "ERROR";
  recoveryHint: MarketplaceAccountRecoveryHint;
  nextRetryAt: string | null;
  tokenExpiresAt: string | null;
  lastSuccessfulSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}
