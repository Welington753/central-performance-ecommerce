import { computeRefundCoverage } from './refund-coverage.util';

describe('computeRefundCoverage', () => {
  it('is COMPLETE when there are no partially_refunded orders in scope', () => {
    expect(computeRefundCoverage(0)).toBe('COMPLETE');
  });

  it('is PARTIAL when there is exactly one partially_refunded order', () => {
    expect(computeRefundCoverage(1)).toBe('PARTIAL');
  });

  it('is PARTIAL when there are several partially_refunded orders', () => {
    expect(computeRefundCoverage(23)).toBe('PARTIAL');
  });
});
