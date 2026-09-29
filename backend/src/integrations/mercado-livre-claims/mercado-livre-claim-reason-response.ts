import {
  isNonEmptyString,
  isRecord,
} from './mercado-livre-claims-search-response';

export interface RawClaimReason {
  flow: string;
  name: string;
  detail: string | null;
  status: string;
  triage: string[];
  allowedFlows: string[];
  expectedResolutions: string[];
}

export type ClaimReasonValidation =
  { valid: true; reason: RawClaimReason } | { valid: false };

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
}

/**
 * Validação de `GET /post-purchase/v1/claims/reasons/{reasonId}`.
 * `settings.rules_engine_triage` é sempre um array (nunca escalar) — se o
 * campo `settings` vier ausente/malformado, `triage` cai para `[]` (nunca
 * reprova o motivo inteiro por causa disso, já que o restante dos campos
 * pode ser válido).
 */
export function validateClaimReasonResponseBody(
  body: unknown,
): ClaimReasonValidation {
  if (!isRecord(body)) return { valid: false };
  if (!isNonEmptyString(body.flow)) return { valid: false };
  if (!isNonEmptyString(body.name)) return { valid: false };
  if (!isNonEmptyString(body.status)) return { valid: false };

  const settings = isRecord(body.settings) ? body.settings : null;

  return {
    valid: true,
    reason: {
      flow: body.flow,
      name: body.name,
      detail: isNonEmptyString(body.detail) ? body.detail : null,
      status: body.status,
      triage: settings ? stringArray(settings.rules_engine_triage) : [],
      allowedFlows: stringArray(body.allowed_flows),
      expectedResolutions: stringArray(body.expected_resolutions),
    },
  };
}
