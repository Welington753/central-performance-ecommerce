import { Marketplace } from '../contracts/marketplace.enum';
import { MarketplaceAnalyticsFilterError } from './marketplace-filter.util';
import {
  assertLogisticsScopeRequiresMercadoLivre,
  classificationValuesForScope,
  parseLogisticsScopeFilter,
} from './logistics-scope-filter.util';

describe('parseLogisticsScopeFilter', () => {
  it('defaults to ALL when absent', () => {
    expect(parseLogisticsScopeFilter(undefined)).toBe('ALL');
    expect(parseLogisticsScopeFilter('')).toBe('ALL');
  });

  it.each(['ALL', 'FULL', 'NON_FULL'])('accepts %s', (value) => {
    expect(parseLogisticsScopeFilter(value)).toBe(value);
  });

  it('rejects an unknown value', () => {
    try {
      parseLogisticsScopeFilter('FLEX');
      fail('expected to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(MarketplaceAnalyticsFilterError);
      expect((error as MarketplaceAnalyticsFilterError).code).toBe(
        'INVALID_LOGISTICS_SCOPE',
      );
      expect((error as Error).message).not.toContain('FLEX');
    }
  });
});

describe('assertLogisticsScopeRequiresMercadoLivre', () => {
  it('never throws for ALL regardless of marketplace', () => {
    expect(() =>
      assertLogisticsScopeRequiresMercadoLivre('ALL', 'ALL'),
    ).not.toThrow();
    expect(() =>
      assertLogisticsScopeRequiresMercadoLivre('ALL', Marketplace.AMAZON),
    ).not.toThrow();
  });

  it('never throws for FULL/NON_FULL when marketplace is MERCADO_LIVRE', () => {
    expect(() =>
      assertLogisticsScopeRequiresMercadoLivre(
        'FULL',
        Marketplace.MERCADO_LIVRE,
      ),
    ).not.toThrow();
    expect(() =>
      assertLogisticsScopeRequiresMercadoLivre(
        'NON_FULL',
        Marketplace.MERCADO_LIVRE,
      ),
    ).not.toThrow();
  });

  it.each(['ALL' as const, Marketplace.AMAZON, Marketplace.SHOPEE])(
    'rejects FULL/NON_FULL when marketplace is %s',
    (marketplace) => {
      for (const scope of ['FULL', 'NON_FULL'] as const) {
        try {
          assertLogisticsScopeRequiresMercadoLivre(scope, marketplace);
          fail('expected to throw');
        } catch (error) {
          expect(error).toBeInstanceOf(MarketplaceAnalyticsFilterError);
          expect((error as MarketplaceAnalyticsFilterError).code).toBe(
            'INVALID_LOGISTICS_SCOPE',
          );
        }
      }
    },
  );
});

describe('classificationValuesForScope', () => {
  it('returns null for ALL (no filter)', () => {
    expect(classificationValuesForScope('ALL')).toBeNull();
  });

  it('returns only MARKETPLACE_FULFILLED for FULL', () => {
    expect(classificationValuesForScope('FULL')).toEqual([
      'MARKETPLACE_FULFILLED',
    ]);
  });

  it('returns only SELLER_FULFILLED for NON_FULL — never UNKNOWN', () => {
    const values = classificationValuesForScope('NON_FULL');
    expect(values).toEqual(['SELLER_FULFILLED']);
    expect(values).not.toContain('UNKNOWN');
  });
});
