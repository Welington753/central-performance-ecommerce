import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { AccountScope } from '../../users/account-scope.types';
import {
  MarketplaceProblemsListQueryService,
  PROBLEM_NOT_FOUND_MESSAGE,
} from './marketplace-problems-list-query.service';
import type {
  ManualProblemResponsibility,
  ProblemDetailDto,
} from './marketplace-problems.types';

export const MANUAL_RESPONSIBILITY_SOURCE = 'MANUAL_USER';

/**
 * Correção MANUAL de responsabilidade (`problems.manage`). Uma única
 * `UPDATE` atômica grava as 6 colunas de responsabilidade JÁ existentes e
 * NADA MAIS — nunca toca em dado recebido do Mercado Livre. O account scope
 * é parte do `WHERE` da própria escrita: fora do escopo (ou inexistente)
 * afeta zero linhas e responde o MESMO 404 genérico, antes de qualquer
 * efeito. A sincronização futura nunca sobrescreve: o `upsertProblem` do
 * CP2-A não tem essas colunas em nenhuma cláusula (provado em teste real).
 *
 * Auditoria: não existe tabela própria para "Problemas" (e nenhuma migration
 * nova foi criada), então só a correção MAIS RECENTE fica registrada nas
 * colunas (`overridden_by_user_id`/`overridden_at`/`override_reason`) —
 * histórico de correções anteriores não é preservado. O motivo (texto livre)
 * nunca é logado.
 */
@Injectable()
export class MarketplaceProblemsResponsibilityService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly listQuery: MarketplaceProblemsListQueryService,
  ) {}

  async override(
    id: string,
    scope: AccountScope,
    userId: string,
    input: { responsibility: ManualProblemResponsibility; reason: string },
  ): Promise<ProblemDetailDto> {
    if (scope.mode === 'NONE') {
      throw new NotFoundException(PROBLEM_NOT_FOUND_MESSAGE);
    }
    if (scope.mode === 'SELECTED' && scope.accountIds.length === 0) {
      throw new NotFoundException(PROBLEM_NOT_FOUND_MESSAGE);
    }
    const params: unknown[] = [
      id,
      input.responsibility,
      MANUAL_RESPONSIBILITY_SOURCE,
      userId,
      input.reason,
    ];
    let scopeClause = '';
    if (scope.mode === 'SELECTED') {
      params.push(scope.accountIds);
      scopeClause = `AND marketplace_account_id = ANY($${params.length}::uuid[])`;
    }
    const [updated] = await this.dataSource.query<
      [Array<{ id: string }>, number]
    >(
      `UPDATE marketplace_problems
          SET responsibility = $2,
              responsibility_confidence = 'MANUAL',
              responsibility_source = $3,
              responsibility_overridden_by_user_id = $4,
              responsibility_overridden_at = now(),
              responsibility_override_reason = $5,
              updated_at = now()
        WHERE id = $1 ${scopeClause}
        RETURNING id`,
      params,
    );
    if (updated.length === 0) {
      throw new NotFoundException(PROBLEM_NOT_FOUND_MESSAGE);
    }
    return this.listQuery.findOne(id, scope);
  }
}
