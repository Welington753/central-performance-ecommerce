import { ML_OAUTH_FAILURE_CODES } from './mercado-livre-oauth-failure-code';
import { mapFailureCodeToPublicReason } from './callback-reason.mapper';

describe('mapFailureCodeToPublicReason', () => {
  it('maps every failure code to a defined public reason (no throw, no undefined)', () => {
    for (const code of ML_OAUTH_FAILURE_CODES) {
      expect(typeof mapFailureCodeToPublicReason(code)).toBe('string');
    }
  });

  it.each([
    ['STATE_INVALID', 'OAUTH_CALLBACK_INVALID'],
    ['AUTHORIZATION_PROVIDER_ERROR', 'OAUTH_CALLBACK_INVALID'],
    ['AUTHORIZATION_DENIED', 'AUTHORIZATION_DENIED'],
    ['IDENTITY_MISMATCH', 'IDENTITY_MISMATCH'],
    ['ACCOUNT_ALREADY_CONNECTED', 'ACCOUNT_ALREADY_CONNECTED'],
    ['ACCOUNT_BUSY', 'TRY_AGAIN_LATER'],
    ['CALLBACK_RESULT_UNKNOWN', 'TRY_AGAIN_LATER'],
    ['TOKEN_EXCHANGE_FAILED', 'TRY_AGAIN_LATER'],
    ['IDENTITY_LOOKUP_FAILED', 'TRY_AGAIN_LATER'],
    ['INVALID_TOKEN_RESPONSE', 'TRY_AGAIN_LATER'],
    ['CREDENTIAL_DECRYPTION_FAILED', 'TRY_AGAIN_LATER'],
    ['ACCOUNT_STATE_CONFLICT', 'TRY_AGAIN_LATER'],
    ['TOKEN_RESULT_NOT_COMMITTED', 'TRY_AGAIN_LATER'],
  ] as const)('maps %s to %s (design §7 table)', (code, reason) => {
    expect(mapFailureCodeToPublicReason(code)).toBe(reason);
  });
});
