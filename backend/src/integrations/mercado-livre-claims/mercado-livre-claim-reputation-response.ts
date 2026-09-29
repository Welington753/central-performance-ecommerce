import {
  isRecord,
  isValidIsoDateString,
} from './mercado-livre-claims-search-response';

export type ReputationImpact = 'affected' | 'not_affected' | 'not_applies';

const REPUTATION_IMPACT_VALUES: readonly ReputationImpact[] = [
  'affected',
  'not_affected',
  'not_applies',
];

function isReputationImpact(value: unknown): value is ReputationImpact {
  return (
    typeof value === 'string' &&
    (REPUTATION_IMPACT_VALUES as readonly string[]).includes(value)
  );
}

export interface RawClaimReputationImpact {
  impact: ReputationImpact;
  hasIncentive: boolean | null;
  dueDate: string | null;
}

export type ClaimReputationValidation =
  { valid: true; reputation: RawClaimReputationImpact } | { valid: false };

/**
 * Validação de `GET /post-purchase/v1/claims/{claimId}/affects-reputation`.
 * `impact` é um vocabulário fechado de 3 valores — qualquer outro valor
 * reprova a resposta inteira (nunca inferido/arredondado para um dos três).
 */
export function validateClaimReputationResponseBody(
  body: unknown,
): ClaimReputationValidation {
  if (!isRecord(body)) return { valid: false };
  if (!isReputationImpact(body.affects_reputation)) return { valid: false };

  return {
    valid: true,
    reputation: {
      impact: body.affects_reputation,
      hasIncentive:
        typeof body.has_incentive === 'boolean' ? body.has_incentive : null,
      dueDate: isValidIsoDateString(body.due_date) ? body.due_date : null,
    },
  };
}
