import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import type { AccountScope } from '../users/account-scope.types';
import { ListSyncRunsQueryDto } from './dto/list-sync-runs.query.dto';
import { SyncRun } from './sync-run.entity';

@Injectable()
export class SyncRunsService {
  constructor(
    @InjectRepository(SyncRun)
    private readonly repository: Repository<SyncRun>,
  ) {}

  /**
   * Uso INTERNO apenas (workers/services já existentes, ex.
   * `MarketplaceBackfillService.getStatus`) — NUNCA exposto a uma requisição
   * HTTP sem passar por `findAllForScope` abaixo. Assinatura/comportamento
   * inalterados pelo Checkpoint 5A.
   */
  findAll(filter: ListSyncRunsQueryDto = {}): Promise<SyncRun[]> {
    const where: FindOptionsWhere<SyncRun> = {};

    if (filter.marketplaceAccountId) {
      where.marketplaceAccountId = filter.marketplaceAccountId;
    }
    if (filter.marketplace) {
      where.marketplace = filter.marketplace;
    }

    return this.repository.find({ where, order: { startedAt: 'DESC' } });
  }

  /**
   * Checkpoint 5A: única entrada usada pelo `SyncRunsController` — `scope`
   * é OBRIGATÓRIO (nunca `?`), para nunca cair em "todas" por engano de
   * quem esquece de passá-lo. `NONE` e `SELECTED` com lista vazia devolvem
   * `[]` SEM consultar o banco. `SELECTED` faz interseção com qualquer
   * `marketplaceAccountId` já pedido no filtro: se o filtro já pede uma
   * conta específica fora do escopo, o resultado final é `[]`, nunca a
   * conta.
   */
  findAllForScope(
    filter: ListSyncRunsQueryDto,
    scope: AccountScope,
  ): Promise<SyncRun[]> {
    if (scope.mode === 'NONE') return Promise.resolve([]);

    const where: FindOptionsWhere<SyncRun> = {};
    if (filter.marketplace) {
      where.marketplace = filter.marketplace;
    }

    if (scope.mode === 'SELECTED') {
      if (scope.accountIds.length === 0) return Promise.resolve([]);
      if (filter.marketplaceAccountId) {
        // Interseção: o filtro pede uma conta específica — só prossegue se
        // ela também estiver no escopo, nunca a substitui pelo conjunto do
        // escopo inteiro.
        if (!scope.accountIds.includes(filter.marketplaceAccountId)) {
          return Promise.resolve([]);
        }
        where.marketplaceAccountId = filter.marketplaceAccountId;
      } else {
        where.marketplaceAccountId = In(scope.accountIds);
      }
      return this.repository.find({ where, order: { startedAt: 'DESC' } });
    }

    // ALL — mesmo comportamento de findAll(), só que sempre com `scope`
    // explícito na assinatura (nunca implícito/opcional).
    if (filter.marketplaceAccountId) {
      where.marketplaceAccountId = filter.marketplaceAccountId;
    }
    return this.repository.find({ where, order: { startedAt: 'DESC' } });
  }
}
