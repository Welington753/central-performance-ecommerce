import type {
  ReclassificationAccountOutcome,
  ReclassificationAccountReport,
  ReclassificationPlanReport,
} from '../../../integrations/mercado-livre-orders/mercado-livre-logistics-reclassification.service';

/**
 * Confirmação LITERAL exigida para o modo `--apply`. Exata, sem variação de
 * caixa e sem abreviação — digitá-la é a barreira deliberada contra uma
 * execução acidental que chamaria a API do Mercado Livre e escreveria no
 * banco.
 */
export const RECLASSIFY_CONFIRMATION_TOKEN = 'RECLASSIFY_ML_LOGISTICS';

/** Vocabulário FECHADO de abortos da CLI — nunca uma mensagem livre. */
export type ReclassifyAbortReason =
  | 'UNKNOWN_ARGUMENT'
  | 'CONFIRMATION_WITHOUT_APPLY'
  | 'CONFIRMATION_REQUIRED'
  | 'CONFIRMATION_MISMATCH'
  | 'ACCOUNT_ID_INVALID'
  | 'BATCH_SIZE_INVALID'
  | 'MAX_REQUESTS_INVALID'
  | 'EXECUTION_FAILED';

export class ReclassifyAbortedError extends Error {
  constructor(public readonly reason: ReclassifyAbortReason) {
    super(reason);
  }
}

export interface ParsedReclassifyArgs {
  /**
   * `plan` NUNCA chama nenhuma API externa e NUNCA escreve — só consulta o
   * banco. É o padrão: omitir os argumentos equivale a `--plan`.
   */
  mode: 'plan' | 'apply';
  accountId: string | null;
  batchSize: number | null;
  maxRequestsPerAccount: number | null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parsePositiveInteger(
  raw: string | undefined,
  reason: ReclassifyAbortReason,
): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new ReclassifyAbortedError(reason);
  }
  return value;
}

/**
 * Seguro por padrão: sem `--apply`, o resultado é sempre `plan`. Um
 * argumento desconhecido ABORTA em vez de ser ignorado — nenhum erro de
 * digitação pode silenciosamente virar uma execução real.
 */
export function parseReclassifyArgs(argv: string[]): ParsedReclassifyArgs {
  let apply = false;
  let confirmation: string | null = null;
  let accountId: string | null = null;
  let batchSize: number | null = null;
  let maxRequestsPerAccount: number | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--plan') continue;
    if (argument === '--apply') {
      apply = true;
      continue;
    }
    if (argument === '--confirm') {
      confirmation = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (argument === '--account-id') {
      accountId = argv[index + 1] ?? '';
      index += 1;
      if (!UUID_PATTERN.test(accountId)) {
        throw new ReclassifyAbortedError('ACCOUNT_ID_INVALID');
      }
      continue;
    }
    if (argument === '--batch-size') {
      batchSize = parsePositiveInteger(argv[index + 1], 'BATCH_SIZE_INVALID');
      index += 1;
      continue;
    }
    if (argument === '--max-requests') {
      maxRequestsPerAccount = parsePositiveInteger(
        argv[index + 1],
        'MAX_REQUESTS_INVALID',
      );
      index += 1;
      continue;
    }
    throw new ReclassifyAbortedError('UNKNOWN_ARGUMENT');
  }

  if (!apply && confirmation !== null) {
    throw new ReclassifyAbortedError('CONFIRMATION_WITHOUT_APPLY');
  }
  if (!apply) {
    return { mode: 'plan', accountId, batchSize, maxRequestsPerAccount };
  }
  if (confirmation === null) {
    throw new ReclassifyAbortedError('CONFIRMATION_REQUIRED');
  }
  if (confirmation !== RECLASSIFY_CONFIRMATION_TOKEN) {
    throw new ReclassifyAbortedError('CONFIRMATION_MISMATCH');
  }
  return { mode: 'apply', accountId, batchSize, maxRequestsPerAccount };
}

/**
 * Desfechos que representam FALHA operacional (saída diferente de zero). Os
 * desfechos `STOPPED_*` NÃO entram aqui: são paradas planejadas e
 * retomáveis, com todo o progresso já gravado.
 */
const FAILURE_OUTCOMES: ReadonlySet<ReclassificationAccountOutcome> = new Set([
  'ABORTED_UNAUTHORIZED',
  'ABORTED_TOKEN_UNAVAILABLE',
]);

export function hasFailureOutcome(
  reports: ReclassificationAccountReport[],
): boolean {
  return reports.some((report) => FAILURE_OUTCOMES.has(report.outcome));
}

function accountLabel(nickname: string | null): string {
  return nickname ?? 'conta sem apelido';
}

/**
 * Saída do `--plan`: SOMENTE contagens e o apelido da conta (o mesmo rótulo
 * que o dashboard já exibe). Nunca token, URL, id de pedido ou id de envio.
 */
export function formatPlanReport(report: ReclassificationPlanReport): string[] {
  const lines = [
    'modo: plan (somente leitura do banco, nenhuma chamada externa)',
    `tamanho_lote_considerado: ${report.batchSize}`,
  ];
  let totalPending = 0;
  let totalWithoutId = 0;
  let totalEstimatedMaxRequests = 0;

  for (const account of report.accounts) {
    totalPending += account.pendingWithShipmentId;
    totalWithoutId += account.pendingWithoutShipmentId;
    totalEstimatedMaxRequests += account.estimatedMaxRequests;
    lines.push(
      [
        accountLabel(account.nickname),
        `total_unknown=${account.totalUnknown}`,
        `pendentes_com_identificador=${account.pendingWithShipmentId}`,
        `pendentes_sem_identificador=${account.pendingWithoutShipmentId}`,
        `ja_classificados=${account.resolved}`,
        `estimativa_maxima_chamadas=${account.estimatedMaxRequests}`,
        `lotes_estimados=${account.estimatedBatches}`,
      ].join(' | '),
    );
  }

  lines.push(`total_processavel: ${totalPending}`);
  lines.push(`total_sem_identificador_de_envio: ${totalWithoutId}`);
  lines.push(`estimativa_maxima_chamadas_total: ${totalEstimatedMaxRequests}`);
  return lines;
}

/** Mesma regra de sanitização do `--plan`: só rótulo de conta e contagens. */
export function formatApplyReport(
  reports: ReclassificationAccountReport[],
): string[] {
  const lines = ['modo: apply'];
  for (const report of reports) {
    lines.push(
      [
        accountLabel(report.nickname),
        `desfecho=${report.outcome}`,
        `examinados=${report.ordersExamined}`,
        `consultas_envio=${report.shipmentRequests}`,
        `consultas_detalhe_pedido=${report.orderDetailRequests}`,
        `identificador_recuperado=${report.shipmentIdsRecovered}`,
        `full=${report.resolvedMarketplaceFulfilled}`,
        `sem_full=${report.resolvedSellerFulfilled}`,
        `desconhecido_tipo_nao_reconhecido=${report.leftUnknownUnrecognizedType}`,
        `desconhecido_envio_inexistente=${report.leftUnknownNotFound}`,
        `desconhecido_pedido_inexistente=${report.leftUnknownOrderNotFound}`,
        `desconhecido_falha_transitoria=${report.leftUnknownTransientFailure}`,
        `desconhecido_resposta_invalida=${report.leftUnknownInvalidResponse}`,
        `ja_resolvidos_por_outro_processo=${report.skippedAlreadyResolved}`,
      ].join(' | '),
    );
  }
  return lines;
}

/** Falha: SOMENTE o código fechado. Nunca `message`, `stack` ou `query`. */
export function formatAbortLine(error: unknown): string {
  const reason =
    error instanceof ReclassifyAbortedError ? error.reason : 'EXECUTION_FAILED';
  return `reclassificacao abortada: ${reason}`;
}
