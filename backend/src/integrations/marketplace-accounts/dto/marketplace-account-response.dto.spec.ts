import { Marketplace } from '../../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-account.entity';
import { toMarketplaceAccountResponse } from './marketplace-account-response.dto';

describe('toMarketplaceAccountResponse', () => {
  it('never includes encrypted columns, connectedByUserId, tokenVersion, failureCode or errorSummary (design §7: internal/auditoria only)', () => {
    const account: MarketplaceAccount = {
      id: 'acc-1',
      marketplace: Marketplace.MERCADO_LIVRE,
      externalSellerId: '123',
      nickname: 'Loja principal',
      status: MarketplaceAccountStatus.ERROR,
      errorSummary:
        'Esta conta do Mercado Livre já está conectada em outro registro.',
      failureCode: 'ACCOUNT_ALREADY_CONNECTED',
      encryptedAccessToken: 'iv:tag:cipher-access',
      encryptedRefreshToken: 'iv:tag:cipher-refresh',
      encryptedCredentialMetadata: null,
      connectedByUserId: 'user-1',
      tokenVersion: 4,
      refreshFailureCount: 0,
      refreshRetryAt: null,
      lastRefreshAttemptAt: null,
      tokenExpiresAt: new Date('2026-08-27T12:00:00.000Z'),
      lastSuccessfulSyncAt: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    };

    const dto = toMarketplaceAccountResponse(account);
    const serialized = JSON.stringify(dto);

    expect(serialized).not.toContain('cipher-access');
    expect(serialized).not.toContain('cipher-refresh');
    expect(serialized).not.toContain('ACCOUNT_ALREADY_CONNECTED');
    expect(serialized).not.toContain('já está conectada em outro registro');
    expect(dto).not.toHaveProperty('encryptedAccessToken');
    expect(dto).not.toHaveProperty('encryptedRefreshToken');
    expect(dto).not.toHaveProperty('encryptedCredentialMetadata');
    expect(dto).not.toHaveProperty('connectedByUserId');
    expect(dto).not.toHaveProperty('tokenVersion');
    expect(dto).not.toHaveProperty('failureCode');
    expect(dto).not.toHaveProperty('errorSummary');
    expect(dto.status).toBe('ERROR'); // status É público — o frontend deriva sua própria mensagem fixa a partir dele
    expect(dto.tokenExpiresAt).toBe('2026-08-27T12:00:00.000Z');
  });

  describe('recoveryHint', () => {
    function account(
      overrides: Partial<MarketplaceAccount> = {},
    ): MarketplaceAccount {
      return {
        id: 'acc-1',
        marketplace: Marketplace.MERCADO_LIVRE,
        externalSellerId: '123',
        nickname: null,
        status: MarketplaceAccountStatus.CONNECTED,
        errorSummary: null,
        failureCode: null,
        encryptedAccessToken: null,
        encryptedRefreshToken: null,
        encryptedCredentialMetadata: null,
        connectedByUserId: null,
        tokenVersion: 0,
        refreshFailureCount: 0,
        refreshRetryAt: null,
        lastRefreshAttemptAt: null,
        tokenExpiresAt: null,
        lastSuccessfulSyncAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      };
    }

    it('is null for CONNECTED/DISCONNECTED accounts', () => {
      expect(
        toMarketplaceAccountResponse(
          account({ status: MarketplaceAccountStatus.CONNECTED }),
        ).recoveryHint,
      ).toBeNull();
      expect(
        toMarketplaceAccountResponse(
          account({ status: MarketplaceAccountStatus.DISCONNECTED }),
        ).recoveryHint,
      ).toBeNull();
    });

    it('is RECONNECT_REQUIRED for TOKEN_EXPIRED, regardless of failureCode', () => {
      expect(
        toMarketplaceAccountResponse(
          account({ status: MarketplaceAccountStatus.TOKEN_EXPIRED }),
        ).recoveryHint,
      ).toBe('RECONNECT_REQUIRED');
    });

    it.each([
      'REFRESH_TEMPORARY_FAILURE',
      'REFRESH_OUTCOME_UNKNOWN',
      'REFRESH_RESULT_UNKNOWN',
    ])(
      'is TEMPORARY_RETRY for an ERROR account with failureCode %s (never "Reconectar" as the primary action)',
      (failureCode) => {
        expect(
          toMarketplaceAccountResponse(
            account({ status: MarketplaceAccountStatus.ERROR, failureCode }),
          ).recoveryHint,
        ).toBe('TEMPORARY_RETRY');
      },
    );

    it('exposes nextRetryAt only when recoveryHint is TEMPORARY_RETRY', () => {
      const retryAt = new Date('2026-09-04T12:30:00.000Z');
      const temporary = toMarketplaceAccountResponse(
        account({
          status: MarketplaceAccountStatus.ERROR,
          failureCode: 'REFRESH_TEMPORARY_FAILURE',
          refreshRetryAt: retryAt,
        }),
      );
      expect(temporary.nextRetryAt).toBe('2026-09-04T12:30:00.000Z');

      const reconnectRequired = toMarketplaceAccountResponse(
        account({
          status: MarketplaceAccountStatus.TOKEN_EXPIRED,
          refreshRetryAt: retryAt,
        }),
      );
      expect(reconnectRequired.nextRetryAt).toBeNull();
    });

    it('is CONFIGURATION_ERROR for ML_APP_CONFIGURATION_ERROR — never RECONNECT_REQUIRED', () => {
      expect(
        toMarketplaceAccountResponse(
          account({
            status: MarketplaceAccountStatus.ERROR,
            failureCode: 'ML_APP_CONFIGURATION_ERROR',
          }),
        ).recoveryHint,
      ).toBe('CONFIGURATION_ERROR');
    });

    it('falls back to RECONNECT_REQUIRED for any other ERROR cause (e.g. CREDENTIAL_DECRYPTION_FAILED, or any Amazon failure — behavior unchanged)', () => {
      expect(
        toMarketplaceAccountResponse(
          account({
            status: MarketplaceAccountStatus.ERROR,
            failureCode: 'CREDENTIAL_DECRYPTION_FAILED',
          }),
        ).recoveryHint,
      ).toBe('RECONNECT_REQUIRED');
      expect(
        toMarketplaceAccountResponse(
          account({
            marketplace: Marketplace.AMAZON,
            status: MarketplaceAccountStatus.ERROR,
            failureCode: 'SOME_AMAZON_FAILURE_CODE',
          }),
        ).recoveryHint,
      ).toBe('RECONNECT_REQUIRED');
    });
  });
});
