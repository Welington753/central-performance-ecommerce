import { Marketplace } from '../contracts/marketplace.enum';
import { MarketplaceAccountStatus } from '../marketplace-accounts/marketplace-account.entity';

/**
 * Vocabulário fechado de disponibilidade de uma fonte de dados (Checkpoint
 * 3, "Contrato genérico"). `NOT_CONNECTED` nunca é atribuído a uma conta
 * individual — só ao nível de marketplace/escopo, quando não sobra nenhuma
 * conta elegível.
 */
export type SourceAvailability =
  'AVAILABLE' | 'CONNECTED_NO_DATA' | 'HISTORICAL_ONLY' | 'NOT_CONNECTED';

export type AccountAvailability = Exclude<SourceAvailability, 'NOT_CONNECTED'>;

export interface EligibilityInput {
  id: string;
  marketplace: Marketplace;
  status: MarketplaceAccountStatus;
  nickname: string | null;
  externalSellerId: string | null;
  lastSuccessfulSyncAt: Date | null;
  /** Existe pelo menos um pedido OU uma `sync_runs` `SUCCESS` para esta conta. */
  hasHistory: boolean;
}

export interface ClassifiedAccount extends EligibilityInput {
  availability: AccountAvailability;
}

/**
 * Classifica uma conta segundo as regras de "Fontes elegíveis" (Checkpoint
 * 3). Retorna `null` quando a conta deve ser EXCLUÍDA por completo do
 * agregado e de qualquer breakdown — nunca commitada em nenhum lugar da
 * resposta. Cobre exatamente o caso da conta `DISCONNECTED` vazia criada
 * acidentalmente no banco local: sem histórico e não conectada, ela nunca
 * aparece.
 *
 * `TOKEN_EXPIRED`/`ERROR`/`DISCONNECTED` com histórico real viram
 * `HISTORICAL_ONLY` — os dados já sincronizados continuam legíveis mesmo
 * que a conexão precise de atenção (achado #2). O estado da conta em si
 * (`status`) nunca é alterado por esta classificação — é uma leitura pura.
 */
export function classifyAccount(
  input: EligibilityInput,
): ClassifiedAccount | null {
  if (input.status === MarketplaceAccountStatus.CONNECTED) {
    return {
      ...input,
      availability: input.hasHistory ? 'AVAILABLE' : 'CONNECTED_NO_DATA',
    };
  }
  if (input.hasHistory) {
    return { ...input, availability: 'HISTORICAL_ONLY' };
  }
  return null;
}

const AVAILABILITY_PRIORITY: readonly SourceAvailability[] = [
  'AVAILABLE',
  'HISTORICAL_ONLY',
  'CONNECTED_NO_DATA',
  'NOT_CONNECTED',
];

/**
 * Resume várias disponibilidades de conta em uma única disponibilidade
 * "de escopo" (por marketplace, ou do filtro inteiro) — a melhor entre as
 * presentes. `NOT_CONNECTED` quando a lista está vazia (nenhuma conta
 * elegível naquele escopo).
 */
export function bestAvailability(
  availabilities: readonly SourceAvailability[],
): SourceAvailability {
  for (const candidate of AVAILABILITY_PRIORITY) {
    if (availabilities.includes(candidate)) return candidate;
  }
  return 'NOT_CONNECTED';
}

/** `true` quando esta disponibilidade prova a existência de dado real (mesmo que zero) para o período consultado. */
export function hasProvenData(availability: SourceAvailability): boolean {
  return availability === 'AVAILABLE' || availability === 'HISTORICAL_ONLY';
}
