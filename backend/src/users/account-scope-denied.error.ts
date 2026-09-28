/**
 * Lançado por `AccountScopeService.assertAccountAllowed` quando a conta não
 * está no escopo do usuário. Mensagem SEMPRE genérica — nunca inclui o
 * `accountId` nem confirma/nega que a conta existe: quem chama (service de
 * analytics/sincronização/integração de um checkpoint futuro) decide como
 * mapear isto para HTTP, mas o domínio nunca vaza esse detalhe.
 */
export class AccountScopeDeniedError extends Error {
  constructor() {
    super('ACCOUNT_SCOPE_DENIED');
    this.name = 'AccountScopeDeniedError';
  }
}
