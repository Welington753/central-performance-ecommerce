import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface CachedReason {
  flow: string;
  name: string;
  detail: string | null;
  status: string;
  triage: string[];
  allowedFlows: string[];
  expectedResolutions: string[];
  fetchedAt: Date;
}

export interface CachedReasonInput extends CachedReason {
  marketplace: string;
  siteId: string;
  reasonId: string;
}

interface ReasonRawRow {
  flow: string;
  name: string;
  detail: string | null;
  status: string;
  triage: string[];
  allowed_flows: string[];
  expected_resolutions: string[];
  fetched_at: Date;
}

function mapRow(row: ReasonRawRow): CachedReason {
  return {
    flow: row.flow,
    name: row.name,
    detail: row.detail,
    status: row.status,
    triage: row.triage,
    allowedFlows: row.allowed_flows,
    expectedResolutions: row.expected_resolutions,
    fetchedAt: row.fetched_at,
  };
}

/**
 * Cache de motivo de claim (`marketplace_problem_reasons`, CP1). Chave
 * `(marketplace, site_id, reason_id)` — SEM conta: intencionalmente
 * COMPARTILHADA entre todas as contas do mesmo marketplace/site (o mesmo
 * `reason_id` no mesmo site tem o mesmo significado para qualquer vendedor);
 * isola só marketplaces/sites diferentes, nunca contas.
 *
 * Nunca chama rede — quem decide buscar `fetchClaimReason` e chamar
 * `upsert()` com o resultado é a camada de orquestração (CP2-B, futuro).
 */
@Injectable()
export class MarketplaceProblemReasonsCacheRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async findFresh(
    marketplace: string,
    siteId: string,
    reasonId: string,
    maxAgeMs: number,
    now: Date,
  ): Promise<CachedReason | null> {
    const rows = await this.dataSource.query<ReasonRawRow[]>(
      `SELECT flow, name, detail, status, triage, allowed_flows, expected_resolutions, fetched_at
         FROM marketplace_problem_reasons
        WHERE marketplace = $1 AND site_id = $2 AND reason_id = $3`,
      [marketplace, siteId, reasonId],
    );
    const row = rows[0];
    if (!row) return null;
    const ageMs = now.getTime() - new Date(row.fetched_at).getTime();
    if (ageMs > maxAgeMs) return null;
    return mapRow(row);
  }

  /**
   * Substitui por inteiro — quem chama sempre tem uma resposta HTTP fresca
   * de `fetchClaimReason` em mãos (nenhum conceito de "não consultado" aqui,
   * diferente da persistência de problema/detail/reputation).
   */
  async upsert(entry: CachedReasonInput): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO marketplace_problem_reasons
          (marketplace, site_id, reason_id, flow, name, detail, status, triage, allowed_flows, expected_resolutions, fetched_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (marketplace, site_id, reason_id) DO UPDATE SET
          flow = EXCLUDED.flow,
          name = EXCLUDED.name,
          detail = EXCLUDED.detail,
          status = EXCLUDED.status,
          triage = EXCLUDED.triage,
          allowed_flows = EXCLUDED.allowed_flows,
          expected_resolutions = EXCLUDED.expected_resolutions,
          fetched_at = EXCLUDED.fetched_at,
          updated_at = now()`,
      [
        entry.marketplace,
        entry.siteId,
        entry.reasonId,
        entry.flow,
        entry.name,
        entry.detail,
        entry.status,
        entry.triage,
        entry.allowedFlows,
        entry.expectedResolutions,
        entry.fetchedAt,
      ],
    );
  }
}
