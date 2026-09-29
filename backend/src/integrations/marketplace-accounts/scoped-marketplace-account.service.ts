import { Injectable, NotFoundException } from '@nestjs/common';
import { AccountScopeService } from '../../users/account-scope.service';
import type { AccountScope } from '../../users/account-scope.types';
import {
  ACCOUNT_NOT_FOUND_MESSAGE,
  MarketplaceAccountsService,
} from './marketplace-accounts.service';
import type { MarketplaceAccount } from './marketplace-account.entity';

/**
 * Ponto ÚNICO (Checkpoint 5A) de "esta conta está no escopo do usuário" para
 * toda rota humana por `:accountId` — nunca reimplementado inline em cada
 * controller. Injetável (não uma função solta) para ser tão fácil de
 * mockar em teste de controller quanto qualquer outro service, e para haver
 * um só lugar grepável desta regra em todo o checkpoint.
 */
@Injectable()
export class ScopedMarketplaceAccountService {
  constructor(
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
    private readonly accountScopeService: AccountScopeService,
  ) {}

  /**
   * ORDEM CRÍTICA: verifica o escopo ANTES de tocar o banco. `NONE`,
   * `SELECTED` vazio ou `SELECTED` sem este id nunca chegam a consultar
   * `marketplace_accounts` — 404 genérico imediato, sem query, sem carregar
   * entidade, sem transação, sem chamada externa. Só quando o id passa no
   * escopo é que `findByIdOrFail` roda (e aí sim pode devolver um 404 real
   * de "não existe" — MESMA mensagem, nunca distinguível de "existe mas
   * fora do escopo").
   */
  async assertAllowedAndFindOrFail(
    scope: AccountScope,
    accountId: string,
  ): Promise<MarketplaceAccount> {
    if (!this.accountScopeService.isAccountAllowed(scope, accountId)) {
      throw new NotFoundException(ACCOUNT_NOT_FOUND_MESSAGE);
    }
    return this.marketplaceAccountsService.findByIdOrFail(accountId);
  }
}
