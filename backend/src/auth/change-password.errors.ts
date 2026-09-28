export class CurrentPasswordInvalidError extends Error {
  constructor() {
    super('CURRENT_PASSWORD_INVALID');
    this.name = 'CurrentPasswordInvalidError';
  }
}

export class NewPasswordMustDifferError extends Error {
  constructor() {
    super('NEW_PASSWORD_MUST_DIFFER');
    this.name = 'NewPasswordMustDifferError';
  }
}
