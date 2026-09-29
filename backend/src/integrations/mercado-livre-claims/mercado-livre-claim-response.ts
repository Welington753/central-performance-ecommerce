import {
  isRecord,
  RawClaimSummary,
  validateClaimCore,
} from './mercado-livre-claims-search-response';

export interface RawClaim extends RawClaimSummary {
  claimVersion: string | null;
}

export type ClaimValidation =
  { valid: true; claim: RawClaim } | { valid: false };

/**
 * `claim_version` é uma versão SEMÂNTICA (`'1'`, `'1.0'`, `'1.5'`, `'2.0'`),
 * nunca um valor para cálculo — normalizada para string preservando o texto
 * exatamente como o Mercado Livre enviou quando já vem como string. Um
 * `number` é convertido com `String()` (sem arredondar nem forçar casas
 * decimais); nunca depende do tipo `numeric` do PostgreSQL/TypeORM.
 */
export function normalizeClaimVersion(value: unknown): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * Validação de `GET /post-purchase/v1/claims/{claimId}` — reaproveita
 * `validateClaimCore` (mesmo núcleo da busca), nunca uma segunda
 * implementação de parsing dos campos comuns.
 */
export function validateClaimResponseBody(body: unknown): ClaimValidation {
  const core = validateClaimCore(body);
  if (core === null) return { valid: false };
  const claimVersion = isRecord(body)
    ? normalizeClaimVersion(body.claim_version)
    : null;
  return { valid: true, claim: { ...core, claimVersion } };
}
