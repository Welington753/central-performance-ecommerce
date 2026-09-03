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
    expect(isKnownAmazonOrderStatus('SOME_MADE_UP_STATUS')).toBe(false);
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
    ['INVOICE_UNCONFIRMED', 'pending'],
  ] as const)('maps %s to %s', (raw, canonical) => {
    expect(mapAmazonOrderStatusToCanonical(raw)).toBe(canonical);
  });

  it('never treats PENDING as a paid sale', () => {
    expect(mapAmazonOrderStatusToCanonical('PENDING')).not.toBe('paid');
    expect(mapAmazonOrderStatusToCanonical('PENDING_AVAILABILITY')).not.toBe(
      'paid',
    );
  });

  it('never treats INVOICE_UNCONFIRMED as a paid sale nor as a cancellation', () => {
    expect(mapAmazonOrderStatusToCanonical('INVOICE_UNCONFIRMED')).not.toBe(
      'paid',
    );
    expect(mapAmazonOrderStatusToCanonical('INVOICE_UNCONFIRMED')).not.toBe(
      'cancelled',
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
