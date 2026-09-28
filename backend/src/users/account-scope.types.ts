/**
 * Escopo de contas RESOLVIDO de um usuário — sempre um destes 3, nunca
 * `null`/array vazio como sinônimo de `ALL` (ver `AccountScopeMode`).
 * Discriminado por `mode`, para o TypeScript forçar o tratamento dos 3 casos
 * em todo consumidor (switch exaustivo).
 */
export type AccountScope =
  | { mode: 'ALL' }
  | { mode: 'SELECTED'; accountIds: string[] }
  | { mode: 'NONE' };
