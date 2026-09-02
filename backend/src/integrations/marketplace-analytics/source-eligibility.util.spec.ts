import { Marketplace } from '../contracts/marketplace.enum';
import { MarketplaceAccountStatus } from '../marketplace-accounts/marketplace-account.entity';
import {
  bestAvailability,
  classifyAccount,
  hasProvenData,
  type EligibilityInput,
} from './source-eligibility.util';

function account(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    id: 'acc-1',
    marketplace: Marketplace.MERCADO_LIVRE,
    status: MarketplaceAccountStatus.CONNECTED,
    nickname: null,
    externalSellerId: null,
    lastSuccessfulSyncAt: null,
    hasHistory: false,
    ...overrides,
  };
}

describe('classifyAccount', () => {
  it('CONNECTED with history -> AVAILABLE', () => {
    const result = classifyAccount(
      account({ status: MarketplaceAccountStatus.CONNECTED, hasHistory: true }),
    );
    expect(result?.availability).toBe('AVAILABLE');
  });

  it('CONNECTED without any successful sync -> CONNECTED_NO_DATA', () => {
    const result = classifyAccount(
      account({
        status: MarketplaceAccountStatus.CONNECTED,
        hasHistory: false,
      }),
    );
    expect(result?.availability).toBe('CONNECTED_NO_DATA');
  });

  it('TOKEN_EXPIRED with history -> HISTORICAL_ONLY (never hidden)', () => {
    const result = classifyAccount(
      account({
        status: MarketplaceAccountStatus.TOKEN_EXPIRED,
        hasHistory: true,
      }),
    );
    expect(result?.availability).toBe('HISTORICAL_ONLY');
  });

  it('ERROR with history -> HISTORICAL_ONLY (never hidden)', () => {
    const result = classifyAccount(
      account({ status: MarketplaceAccountStatus.ERROR, hasHistory: true }),
    );
    expect(result?.availability).toBe('HISTORICAL_ONLY');
  });

  it('DISCONNECTED without history -> excluded entirely (the accidental empty account)', () => {
    const result = classifyAccount(
      account({
        status: MarketplaceAccountStatus.DISCONNECTED,
        hasHistory: false,
      }),
    );
    expect(result).toBeNull();
  });

  it('TOKEN_EXPIRED without any history -> excluded entirely (never proven real)', () => {
    const result = classifyAccount(
      account({
        status: MarketplaceAccountStatus.TOKEN_EXPIRED,
        hasHistory: false,
      }),
    );
    expect(result).toBeNull();
  });

  it('never mutates or reads account.status as a side effect — pure classification', () => {
    const input = account({
      status: MarketplaceAccountStatus.CONNECTED,
      hasHistory: true,
    });
    const result = classifyAccount(input);
    expect(input.status).toBe(MarketplaceAccountStatus.CONNECTED);
    expect(result?.status).toBe(MarketplaceAccountStatus.CONNECTED);
  });
});

describe('bestAvailability', () => {
  it('returns NOT_CONNECTED for an empty list', () => {
    expect(bestAvailability([])).toBe('NOT_CONNECTED');
  });

  it('prefers AVAILABLE over any other availability present', () => {
    expect(
      bestAvailability(['CONNECTED_NO_DATA', 'AVAILABLE', 'HISTORICAL_ONLY']),
    ).toBe('AVAILABLE');
  });

  it('prefers HISTORICAL_ONLY over CONNECTED_NO_DATA when there is no AVAILABLE source', () => {
    expect(bestAvailability(['CONNECTED_NO_DATA', 'HISTORICAL_ONLY'])).toBe(
      'HISTORICAL_ONLY',
    );
  });

  it('falls back to CONNECTED_NO_DATA when nothing better is present', () => {
    expect(bestAvailability(['CONNECTED_NO_DATA'])).toBe('CONNECTED_NO_DATA');
  });
});

describe('hasProvenData', () => {
  it('is true only for AVAILABLE and HISTORICAL_ONLY', () => {
    expect(hasProvenData('AVAILABLE')).toBe(true);
    expect(hasProvenData('HISTORICAL_ONLY')).toBe(true);
    expect(hasProvenData('CONNECTED_NO_DATA')).toBe(false);
    expect(hasProvenData('NOT_CONNECTED')).toBe(false);
  });
});
