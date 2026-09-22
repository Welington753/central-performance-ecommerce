import {
  createLogisticsDiagnostics,
  hasPendingReclassification,
  sanitizeLogisticsDiagnostics,
  type LogisticsClassificationDiagnostics,
} from './logistics-classification-diagnostics';

const EXPECTED_KEYS = [
  'distinctShipments',
  'lookupsPerformed',
  'lookupsSkippedByCap',
  'httpAttempts',
  'classificationsResolved',
  'classificationsUnknown',
  'failuresRateLimited',
  'failuresProviderUnavailable',
  'failuresNotFound',
  'failuresUnauthorized',
  'failuresInvalidResponse',
  'ordersLeftUnclassified',
].sort();

describe('logistics classification diagnostics', () => {
  it('starts every counter at zero', () => {
    const diagnostics = createLogisticsDiagnostics();
    expect(Object.keys(diagnostics).sort()).toEqual(EXPECTED_KEYS);
    expect(Object.values(diagnostics).every((value) => value === 0)).toBe(true);
  });

  it('sanitizes to a CLOSED vocabulary — an extra key never reaches the database', () => {
    const polluted = {
      ...createLogisticsDiagnostics(),
      shipmentId: 'ship-42',
      accessToken: 'secret-token-value',
    } as unknown as LogisticsClassificationDiagnostics;

    const sanitized = sanitizeLogisticsDiagnostics(polluted);

    expect(Object.keys(sanitized).sort()).toEqual(EXPECTED_KEYS);
    expect(JSON.stringify(sanitized)).not.toContain('ship-42');
    expect(JSON.stringify(sanitized)).not.toContain('secret-token-value');
  });

  it('coerces every value to a non-negative integer', () => {
    const weird = {
      ...createLogisticsDiagnostics(),
      lookupsPerformed: 3.9,
      lookupsSkippedByCap: -5,
      httpAttempts: Number.NaN,
      failuresNotFound: '7' as unknown as number,
    };

    const sanitized = sanitizeLogisticsDiagnostics(weird);

    expect(sanitized.lookupsPerformed).toBe(3);
    expect(sanitized.lookupsSkippedByCap).toBe(0);
    expect(sanitized.httpAttempts).toBe(0);
    expect(sanitized.failuresNotFound).toBe(0);
    expect(
      Object.values(sanitized).every(
        (value) => typeof value === 'number' && Number.isInteger(value),
      ),
    ).toBe(true);
  });

  it('flags a pending reclassification when the cap skipped a shipment', () => {
    const diagnostics = createLogisticsDiagnostics();
    expect(hasPendingReclassification(diagnostics)).toBe(false);

    diagnostics.lookupsSkippedByCap = 1;
    expect(hasPendingReclassification(diagnostics)).toBe(true);
  });

  it('flags a pending reclassification when orders were left unclassified', () => {
    const diagnostics = createLogisticsDiagnostics();
    diagnostics.ordersLeftUnclassified = 4;
    expect(hasPendingReclassification(diagnostics)).toBe(true);
  });
});
