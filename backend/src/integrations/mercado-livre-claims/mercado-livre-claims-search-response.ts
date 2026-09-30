import { toSafeExternalId } from './mercado-livre-claims-external-id.util';

export interface RawClaimPlayer {
  userId: string;
  role: string;
  type: string | null;
  availableActionCodes: string[];
}

export interface RawResolution {
  reason: string | null;
  benefitedRoles: string[];
  closedBy: string | null;
  appliedCoverage: boolean | null;
  date: string | null;
}

export interface RawClaimSummary {
  externalClaimId: string;
  resource: string;
  resourceId: string;
  status: string;
  type: string;
  stage: string;
  siteId: string;
  reasonId: string | null;
  parentClaimId: string | null;
  fulfilled: boolean | null;
  quantityType: string | null;
  dateCreated: string;
  lastUpdated: string;
  players: RawClaimPlayer[];
  resolution: RawResolution | null;
}

export interface ClaimsSearchPaging {
  total: number;
  offset: number;
  limit: number;
}

/** Estágio em que o validador da busca reprovou o corpo (só para diagnóstico). */
export type ClaimsSearchValidationStage =
  'envelope' | 'data' | 'paging' | 'item';

export type ClaimsSearchValidation =
  | { valid: true; data: RawClaimSummary[]; paging: ClaimsSearchPaging }
  | { valid: false; stage?: ClaimsSearchValidationStage };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isValidIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
}

/**
 * `resolution` do claim — todos os campos opcionais/nullable (nunca
 * confirmado que TODO claim tem resolução). Ausência do objeto inteiro
 * também é válida (`null`), nunca reprova o claim.
 */
export function validateResolution(raw: unknown): RawResolution | null {
  if (!isRecord(raw)) return null;
  return {
    reason: isNonEmptyString(raw.reason) ? raw.reason : null,
    benefitedRoles: stringArray(raw.benefited_roles),
    closedBy: isNonEmptyString(raw.closed_by) ? raw.closed_by : null,
    appliedCoverage:
      typeof raw.applied_coverage === 'boolean' ? raw.applied_coverage : null,
    date: isValidIsoDateString(raw.date_created) ? raw.date_created : null,
  };
}

function validatePlayer(raw: unknown): RawClaimPlayer | null {
  if (!isRecord(raw)) return null;
  const userId = toSafeExternalId(raw.user_id);
  if (userId === null) return null;
  if (!isNonEmptyString(raw.role)) return null;
  return {
    userId,
    role: raw.role,
    type: isNonEmptyString(raw.type) ? raw.type : null,
    availableActionCodes: stringArray(raw.available_actions),
  };
}

/**
 * Núcleo comum entre a busca (`/claims/search`) e `GET /claims/{claimId}` —
 * mesmo formato de item, reaproveitado por `mercado-livre-claim-response.ts`
 * e `mercado-livre-claim-detail-response.ts` (nunca uma segunda
 * implementação de parsing). Um campo de IDENTIDADE inválido reprova o claim
 * inteiro (`null`); campos de detalhe/resolução ausentes nunca reprovam.
 */
export function validateClaimCore(raw: unknown): RawClaimSummary | null {
  if (!isRecord(raw)) return null;

  const externalClaimId = toSafeExternalId(raw.id);
  const resourceId = toSafeExternalId(raw.resource_id);
  if (externalClaimId === null) return null;
  if (resourceId === null) return null;
  if (!isNonEmptyString(raw.resource)) return null;
  if (!isNonEmptyString(raw.status)) return null;
  if (!isNonEmptyString(raw.type)) return null;
  if (!isNonEmptyString(raw.stage)) return null;
  if (!isNonEmptyString(raw.site_id)) return null;
  if (!isValidIsoDateString(raw.date_created)) return null;
  if (!isValidIsoDateString(raw.last_updated)) return null;

  const rawPlayers = Array.isArray(raw.players) ? raw.players : null;
  if (rawPlayers === null) return null;
  const players: RawClaimPlayer[] = [];
  for (const rawPlayer of rawPlayers) {
    const player = validatePlayer(rawPlayer);
    if (player === null) return null;
    players.push(player);
  }

  return {
    externalClaimId,
    resource: raw.resource,
    resourceId,
    status: raw.status,
    type: raw.type,
    stage: raw.stage,
    siteId: raw.site_id,
    reasonId: toSafeExternalId(raw.reason_id),
    parentClaimId: toSafeExternalId(raw.parent_id),
    fulfilled: typeof raw.fulfilled === 'boolean' ? raw.fulfilled : null,
    quantityType: isNonEmptyString(raw.quantity_type)
      ? raw.quantity_type
      : null,
    dateCreated: raw.date_created,
    lastUpdated: raw.last_updated,
    players,
    resolution: validateResolution(raw.resolution),
  };
}

function validatePaging(raw: unknown): ClaimsSearchPaging | null {
  if (!isRecord(raw)) return null;
  const { total, offset, limit } = raw;
  if (
    typeof total !== 'number' ||
    typeof offset !== 'number' ||
    typeof limit !== 'number' ||
    !Number.isSafeInteger(total) ||
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(limit)
  ) {
    return null;
  }
  return { total, offset, limit };
}

/**
 * Validação fechada de `GET /post-purchase/v1/claims/search` — envelope
 * `{ paging, data }` (NUNCA `results`, confirmado na sondagem de produção).
 * Um claim estruturalmente inválido reprova a página inteira, nunca persiste
 * parcialmente uma página corrompida.
 */
export function validateClaimsSearchResponseBody(
  body: unknown,
): ClaimsSearchValidation {
  if (!isRecord(body)) return { valid: false, stage: 'envelope' };
  if (!Array.isArray(body.data)) return { valid: false, stage: 'data' };

  const paging = validatePaging(body.paging);
  if (paging === null) return { valid: false, stage: 'paging' };

  const data: RawClaimSummary[] = [];
  for (const rawClaim of body.data) {
    const claim = validateClaimCore(rawClaim);
    if (claim === null) return { valid: false, stage: 'item' };
    data.push(claim);
  }

  return { valid: true, data, paging };
}
