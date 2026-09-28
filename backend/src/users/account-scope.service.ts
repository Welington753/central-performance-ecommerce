import { Injectable } from '@nestjs/common';
import { AccountScopeDeniedError } from './account-scope-denied.error';
import type { AccountScope } from './account-scope.types';

/**
 * Helper independente para checar/filtrar acesso por conta a partir de um
 * `AccountScope` já resolvido (por `PermissionResolverService`). Puro — não
 * acessa banco nem sabe nada de usuário; `ALL` nunca é resolvido aqui contra
 * a lista real de contas do sistema, é responsabilidade de quem chamar já
 * ter a lista de accountIds candidata (ex.: da própria query). Ainda não
 * conectado a nenhuma query/service real — isso é do checkpoint de proteção
 * das rotas existentes.
 */
@Injectable()
export class AccountScopeService {
  isAccountAllowed(scope: AccountScope, accountId: string): boolean {
    switch (scope.mode) {
      case 'ALL':
        return true;
      case 'NONE':
        return false;
      case 'SELECTED':
        return scope.accountIds.includes(accountId);
    }
  }

  /**
   * @throws AccountScopeDeniedError quando a conta não está no escopo —
   * mensagem genérica de propósito (ver a própria classe do erro).
   */
  assertAccountAllowed(scope: AccountScope, accountId: string): void {
    if (!this.isAccountAllowed(scope, accountId)) {
      throw new AccountScopeDeniedError();
    }
  }

  /** Nunca adiciona um id que não estava em `accountIds` — só remove os fora do escopo. */
  filterAllowedAccountIds(
    scope: AccountScope,
    accountIds: readonly string[],
  ): string[] {
    return accountIds.filter((accountId) =>
      this.isAccountAllowed(scope, accountId),
    );
  }

  describeScope(scope: AccountScope): AccountScope {
    return scope;
  }
}
