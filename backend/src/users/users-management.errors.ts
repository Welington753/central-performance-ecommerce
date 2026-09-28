/**
 * Erros de domínio de `UsersManagementService` — mapeados para HTTP pelo
 * `UsersController` (nunca stack/SQL/detalhe de constraint na resposta).
 * `LastActiveAdminRequiredError` fica em `last-admin-guard.ts` (mesmo
 * módulo da checagem que a lança).
 */
export class UserNotFoundError extends Error {
  constructor() {
    super('USER_NOT_FOUND');
    this.name = 'UserNotFoundError';
  }
}

export class UserEmailAlreadyExistsError extends Error {
  constructor() {
    super('USER_EMAIL_ALREADY_EXISTS');
    this.name = 'UserEmailAlreadyExistsError';
  }
}

export class RoleNotFoundError extends Error {
  constructor() {
    super('ROLE_NOT_FOUND');
    this.name = 'RoleNotFoundError';
  }
}

export class InvalidPermissionError extends Error {
  constructor(reason: string) {
    super('INVALID_PERMISSION');
    this.name = 'InvalidPermissionError';
    this.reason = reason;
  }
  /** Só para log interno/depuração — nunca enviado ao cliente pelo controller. */
  readonly reason: string;
}

export class InvalidAccountScopeError extends Error {
  constructor(reason: string) {
    super('INVALID_ACCOUNT_SCOPE');
    this.name = 'InvalidAccountScopeError';
    this.reason = reason;
  }
  readonly reason: string;
}

export class CannotResetOwnPasswordError extends Error {
  constructor() {
    super('CANNOT_RESET_OWN_PASSWORD');
    this.name = 'CannotResetOwnPasswordError';
  }
}
