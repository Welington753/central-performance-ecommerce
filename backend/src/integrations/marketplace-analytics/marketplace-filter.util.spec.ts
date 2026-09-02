import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAnalyticsFilterError,
  assertNoAccountMarketplaceConflict,
  parseAccountIdFilter,
  parseMarketplaceFilter,
} from './marketplace-filter.util';

describe('parseMarketplaceFilter', () => {
  it('defaults to ALL when absent', () => {
    expect(parseMarketplaceFilter(undefined)).toBe('ALL');
    expect(parseMarketplaceFilter('')).toBe('ALL');
  });

  it.each(['ALL', 'MERCADO_LIVRE', 'AMAZON', 'SHOPEE'])(
    'accepts %s',
    (value) => {
      expect(parseMarketplaceFilter(value)).toBe(value);
    },
  );

  it('rejects an unknown marketplace value', () => {
    try {
      parseMarketplaceFilter('EBAY');
      fail('expected to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(MarketplaceAnalyticsFilterError);
      expect((error as MarketplaceAnalyticsFilterError).code).toBe(
        'INVALID_MARKETPLACE',
      );
      // A mensagem nunca deve conter o valor bruto recebido.
      expect((error as Error).message).not.toContain('EBAY');
    }
  });
});

describe('parseAccountIdFilter', () => {
  it('returns null when absent', () => {
    expect(parseAccountIdFilter(undefined)).toBeNull();
    expect(parseAccountIdFilter('')).toBeNull();
  });

  it('accepts a valid UUID', () => {
    expect(parseAccountIdFilter('7ca26d89-e3af-4b62-95c0-1d4ebf1eeaf7')).toBe(
      '7ca26d89-e3af-4b62-95c0-1d4ebf1eeaf7',
    );
  });

  it('rejects an invalid UUID', () => {
    try {
      parseAccountIdFilter('not-a-uuid');
      fail('expected to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(MarketplaceAnalyticsFilterError);
      expect((error as MarketplaceAnalyticsFilterError).code).toBe(
        'INVALID_ACCOUNT_ID',
      );
    }
  });
});

describe('assertNoAccountMarketplaceConflict', () => {
  it('never throws when the filter is ALL', () => {
    expect(() =>
      assertNoAccountMarketplaceConflict('ALL', Marketplace.AMAZON),
    ).not.toThrow();
  });

  it('never throws when the account matches the filtered marketplace', () => {
    expect(() =>
      assertNoAccountMarketplaceConflict(
        Marketplace.MERCADO_LIVRE,
        Marketplace.MERCADO_LIVRE,
      ),
    ).not.toThrow();
  });

  it('throws a closed conflict error when they disagree', () => {
    try {
      assertNoAccountMarketplaceConflict(
        Marketplace.AMAZON,
        Marketplace.MERCADO_LIVRE,
      );
      fail('expected to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(MarketplaceAnalyticsFilterError);
      expect((error as MarketplaceAnalyticsFilterError).code).toBe(
        'ACCOUNT_MARKETPLACE_CONFLICT',
      );
    }
  });
});
