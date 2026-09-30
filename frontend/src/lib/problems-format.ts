import type {
  ManualProblemResponsibility,
  ProblemResponsibility,
  ProblemsSyncJobStatus,
} from "@/types/problems";

/**
 * Textos PT-BR dos códigos do Mercado Livre. Valor desconhecido nunca é
 * inventado: cai no próprio código, legível (sem `_`), para o usuário ver
 * exatamente o que o provedor devolveu.
 */
function humanize(code: string): string {
  const text = code.replace(/_/g, " ").trim();
  return text.length > 0 ? text.charAt(0).toUpperCase() + text.slice(1) : code;
}

const STATUS_LABELS: Record<string, string> = {
  opened: "Aberto",
  closed: "Encerrado",
};

const STAGE_LABELS: Record<string, string> = {
  claim: "Reclamação",
  dispute: "Disputa",
  recontact: "Recontato",
  stale: "Sem resposta",
  none: "Sem etapa",
};

const TYPE_LABELS: Record<string, string> = {
  mediations: "Mediação",
  returns: "Devolução",
  fulfillment: "Fulfillment",
  ml_case: "Caso do Mercado Livre",
  cancel_sale: "Cancelamento de venda",
  cancel_purchase: "Cancelamento de compra",
  change: "Troca",
  service: "Serviço",
};

const IMPACT_LABELS: Record<string, string> = {
  affected: "Afeta a reputação",
  not_affected: "Não afeta a reputação",
  not_applies: "Não se aplica",
};

export const RESPONSIBILITY_LABELS: Record<ProblemResponsibility, string> = {
  UNKNOWN: "Não classificada",
  SELLER: "Vendedor",
  BUYER: "Comprador",
  MARKETPLACE: "Marketplace",
  CARRIER: "Transportadora",
  OTHER: "Outra",
};

export const MANUAL_RESPONSIBILITY_OPTIONS: ManualProblemResponsibility[] = [
  "SELLER",
  "BUYER",
  "MARKETPLACE",
  "CARRIER",
  "OTHER",
];

const ACTION_LABELS: Record<string, string> = {
  send_proof: "Enviar comprovante",
  refund: "Reembolsar",
  open_dispute: "Abrir disputa",
  allow_return: "Autorizar devolução",
  send_message_to_complainant: "Responder ao comprador",
  send_message_to_mediator: "Responder ao mediador",
  add_shipping_evidence: "Enviar evidência de envio",
};

const MARKETPLACE_LABELS: Record<string, string> = {
  MERCADO_LIVRE: "Mercado Livre",
  SHOPEE: "Shopee",
  AMAZON: "Amazon",
};

const JOB_STATUS_LABELS: Record<ProblemsSyncJobStatus | "NOT_STARTED", string> = {
  NOT_STARTED: "Não iniciada",
  RUNNING: "Ativa",
  WAITING_RETRY: "Aguardando nova tentativa",
  PAUSED: "Pausada",
  FAILED: "Falhou",
  FAILED_AUTH: "Autorização necessária",
};

const ERROR_LABELS: Record<string, string> = {
  PROVIDER_UNAVAILABLE: "Mercado Livre indisponível no momento",
  RATE_LIMITED: "Limite de requisições do Mercado Livre atingido",
  TERMINAL_AUTH_ERROR: "Autorização expirada — reconecte a conta",
  TOKEN_EXPIRED: "Autorização expirada — reconecte a conta",
  ACCOUNT_NOT_CONNECTED: "Conta desconectada — reconecte a conta",
  ACCOUNT_BUSY: "Conta ocupada por outra operação",
  TOKEN_REFRESH_PENDING: "Renovação de autorização pendente",
  SAFETY_LIMIT_REACHED: "Volume acima do limite de segurança",
  PERSISTENCE_UNAVAILABLE: "Falha ao gravar os dados",
  CORE_COVERAGE_INCOMPLETE: "Cobertura incompleta — nova tentativa agendada",
  SEARCH_CONTRACT_ERROR: "Resposta inesperada do Mercado Livre",
  ML_APP_CONFIGURATION_ERROR: "Configuração do aplicativo do Mercado Livre",
  CREDENTIAL_DECRYPTION_FAILED: "Credenciais ilegíveis — reconecte a conta",
  SYNC_FAILED: "Falha na sincronização",
};

export const statusLabel = (code: string): string => STATUS_LABELS[code] ?? humanize(code);
export const stageLabel = (code: string): string => STAGE_LABELS[code] ?? humanize(code);
export const typeLabel = (code: string): string => TYPE_LABELS[code] ?? humanize(code);
export const actionLabel = (code: string): string => ACTION_LABELS[code] ?? humanize(code);
export const marketplaceLabel = (code: string): string => MARKETPLACE_LABELS[code] ?? humanize(code);

export function impactLabel(code: string | null): string {
  return code === null ? "Sem informação" : (IMPACT_LABELS[code] ?? humanize(code));
}

export function jobStatusLabel(status: ProblemsSyncJobStatus | "NOT_STARTED"): string {
  return JOB_STATUS_LABELS[status];
}

export function jobErrorLabel(code: string | null): string | null {
  return code === null ? null : (ERROR_LABELS[code] ?? "Falha na sincronização");
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(iso: string | null): string {
  return iso === null ? "—" : dateFormatter.format(new Date(iso));
}

export function formatDateTime(iso: string | null): string {
  return iso === null ? "—" : dateTimeFormatter.format(new Date(iso));
}

/** Prazo de uma ação: vencido é destacado; sem prazo informado é dito claramente. */
export function dueLabel(
  iso: string | null,
  now: Date = new Date(),
): { text: string; overdue: boolean } {
  if (iso === null) return { text: "Sem prazo informado", overdue: false };
  const overdue = new Date(iso).getTime() < now.getTime();
  return { text: `${overdue ? "Vencida em" : "Até"} ${formatDate(iso)}`, overdue };
}

export function accountDisplayName(
  nickname: string | null,
  marketplace: string,
): string {
  return nickname ?? `Conta ${marketplaceLabel(marketplace)}`;
}
