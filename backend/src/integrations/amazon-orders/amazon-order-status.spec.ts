import {
  AMAZON_ORDER_STATUSES,
  isKnownAmazonOrderStatus,
  mapAmazonOrderStatusToCanonical,
} from './amazon-order-status';

describe('isKnownAmazonOrderStatus', () => {
  it('accepts every documented status', () => {
    for (const status of AMAZON_ORDER_STATUSES) {
      expect(isKnownAmazonOrderStatus(status)).toBe(true);
    }
  });

  it('rejects an unknown status', () => {
    expect(isKnownAmazonOrderStatus('INVOICE_UNCONFIRMED')).toBe(false);
    expect(isKnownAmazonOrderStatus('')).toBe(false);
    expect(isKnownAmazonOrderStatus(42)).toBe(false);
    expect(isKnownAmazonOrderStatus(null)).toBe(false);
  });
});

describe('mapAmazonOrderStatusToCanonical', () => {
  it.each([
    ['UNSHIPPED', 'paid'],
    ['PARTIALLY_SHIPPED', 'paid'],
    ['SHIPPED', 'paid'],
    ['CANCELLED', 'cancelled'],
    ['PENDING', 'pending'],
    ['PENDING_AVAILABILITY', 'pending'],
    ['UNFULFILLABLE', 'unfulfillable'],
  ] as const)('maps %s to %s', (raw, canonical) => {
    expect(mapAmazonOrderStatusToCanonical(raw)).toBe(canonical);
  });

  it('never treats PENDING as a paid sale', () => {
    expect(mapAmazonOrderStatusToCanonical('PENDING')).not.toBe('paid');
    expect(mapAmazonOrderStatusToCanonical('PENDING_AVAILABILITY')).not.toBe(
      'paid',
    );
  });

  it('never treats UNFULFILLABLE as an automatic cancellation', () => {
    expect(mapAmazonOrderStatusToCanonical('UNFULFILLABLE')).not.toBe(
      'cancelled',
    );
  });

  it('covers every status in the closed vocabulary with no fallthrough', () => {
    for (const status of AMAZON_ORDER_STATUSES) {
      expect(() => mapAmazonOrderStatusToCanonical(status)).not.toThrow();
    }
  });
});
