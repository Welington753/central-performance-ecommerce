import {
  CANCELLED_ORDER_STATUS,
  PAID_ORDER_STATUS,
  PENDING_ORDER_STATUS,
  UNFULFILLABLE_ORDER_STATUS,
} from './order-status';

describe('order-status (vocabulário canônico)', () => {
  it('exposes exactly the four canonical values, each distinct from the others', () => {
    const values = [
      PAID_ORDER_STATUS,
      CANCELLED_ORDER_STATUS,
      PENDING_ORDER_STATUS,
      UNFULFILLABLE_ORDER_STATUS,
    ];
    expect(new Set(values).size).toBe(4);
  });

  it('matches the exact literal strings already relied upon by marketplace_orders.status', () => {
    expect(PAID_ORDER_STATUS).toBe('paid');
    expect(CANCELLED_ORDER_STATUS).toBe('cancelled');
    expect(PENDING_ORDER_STATUS).toBe('pending');
    expect(UNFULFILLABLE_ORDER_STATUS).toBe('unfulfillable');
  });
});
