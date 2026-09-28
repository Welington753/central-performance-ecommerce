/**
 * Escopo de contas de marketplace que um usuário pode enxergar — SEMPRE
 * explícito e fail-closed (nunca "ausência de linha = tudo liberado"):
 *
 * - `ALL`: todas as contas (atuais e futuras).
 * - `SELECTED`: só as contas registradas em `user_account_scope`; sem
 *   nenhuma linha lá, equivale a `NONE` (nunca a `ALL`).
 * - `NONE`: nenhuma conta — default de todo usuário novo, até a criação
 *   escolher `ALL` ou `SELECTED` explicitamente.
 */
export enum AccountScopeMode {
  ALL = 'ALL',
  SELECTED = 'SELECTED',
  NONE = 'NONE',
}
