import { toSafeExternalId } from './mercado-livre-claims-external-id.util';
import { normalizeClaimVersion } from './mercado-livre-claim-response';
import {
  isNonEmptyString,
  isRecord,
  isValidIsoDateString,
  RawClaimSummary,
  RawResolution,
  validateClaimCore,
  validateResolution,
} from './mercado-livre-claims-search-response';

export interface RawDetailAction {
  actionCode: string;
  mandatory: boolean;
  dueDate: string | null;
}

export interface RawDetailPlayer {
  userId: string;
  role: string;
  type: string | null;
  availableActions: RawDetailAction[];
}

export interface RawClaimDetailInfo {
  dueDate: string | null;
  responsible: string | null;
  title: string | null;
  description: string | null;
  problem: string | null;
}

export interface RawClaimDetail extends Omit<
  RawClaimSummary,
  'players' | 'resolution'
> {
  claimVersion: string | null;
  players: RawDetailPlayer[];
  resolution: RawResolution | null;
  detail: RawClaimDetailInfo | null;
}

export type ClaimDetailValidation =
  { valid: true; claim: RawClaimDetail } | { valid: false };

function validateDetailAction(raw: unknown): RawDetailAction | null {
  if (!isRecord(raw)) return null;
  const actionCode = raw.action;
  if (!isNonEmptyString(actionCode)) return null;
  return {
    actionCode,
    mandatory: raw.mandatory === true,
    dueDate: isValidIsoDateString(raw.due_date) ? raw.due_date : null,
  };
}

function validateDetailPlayer(raw: unknown): RawDetailPlayer | null {
  if (!isRecord(raw)) return null;
  const userId = toSafeExternalId(raw.user_id);
  if (userId === null) return null;
  if (!isNonEmptyString(raw.role)) return null;

  const rawActions = Array.isArray(raw.available_actions)
    ? raw.available_actions
    : [];
  const availableActions: RawDetailAction[] = [];
  for (const rawAction of rawActions) {
    const action = validateDetailAction(rawAction);
    if (action === null) return null;
    availableActions.push(action);
  }

  return {
    userId,
    role: raw.role,
    type: isNonEmptyString(raw.type) ? raw.type : null,
    availableActions,
  };
}

function validateDetailInfo(raw: unknown): RawClaimDetailInfo | null {
  if (!isRecord(raw)) return null;
  return {
    dueDate: isValidIsoDateString(raw.due_date) ? raw.due_date : null,
    responsible: isNonEmptyString(raw.responsible) ? raw.responsible : null,
    title: isNonEmptyString(raw.title) ? raw.title : null,
    description: isNonEmptyString(raw.description) ? raw.description : null,
    problem: isNonEmptyString(raw.problem) ? raw.problem : null,
  };
}

/**
 * Validação de `GET /post-purchase/v1/claims/{claimId}/detail` — reaproveita
 * `validateClaimCore` para os campos comuns e só troca `players` (aqui cada
 * `available_actions` é um objeto `{action, mandatory, due_date}`, não uma
 * lista de códigos) e adiciona o bloco `detail`.
 */
export function validateClaimDetailResponseBody(
  body: unknown,
): ClaimDetailValidation {
  const core = validateClaimCore(body);
  if (core === null) return { valid: false };
  if (!isRecord(body)) return { valid: false };

  const rawPlayers = Array.isArray(body.players) ? body.players : null;
  if (rawPlayers === null) return { valid: false };
  const players: RawDetailPlayer[] = [];
  for (const rawPlayer of rawPlayers) {
    const player = validateDetailPlayer(rawPlayer);
    if (player === null) return { valid: false };
    players.push(player);
  }

  const { players: _players, resolution: _resolution, ...rest } = core;

  return {
    valid: true,
    claim: {
      ...rest,
      claimVersion: normalizeClaimVersion(body.claim_version),
      players,
      resolution: validateResolution(body.resolution),
      detail: validateDetailInfo(body.detail),
    },
  };
}
