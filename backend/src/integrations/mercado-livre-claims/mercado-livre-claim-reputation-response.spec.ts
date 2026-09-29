import { validateClaimReputationResponseBody } from './mercado-livre-claim-reputation-response';

describe('validateClaimReputationResponseBody', () => {
  it.each(['affected', 'not_affected', 'not_applies'] as const)(
    'aceita affects_reputation = %s',
    (impact) => {
      const result = validateClaimReputationResponseBody({
        affects_reputation: impact,
        has_incentive: true,
        due_date: '2026-02-01T00:00:00.000Z',
      });
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.reputation.impact).toBe(impact);
      expect(result.reputation.hasIncentive).toBe(true);
      expect(result.reputation.dueDate).toBe('2026-02-01T00:00:00.000Z');
    },
  );

  it('has_incentive e due_date ausentes viram null', () => {
    const result = validateClaimReputationResponseBody({
      affects_reputation: 'not_applies',
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.reputation.hasIncentive).toBeNull();
    expect(result.reputation.dueDate).toBeNull();
  });

  it('rejeita affects_reputation fora do vocabulário fechado', () => {
    expect(
      validateClaimReputationResponseBody({ affects_reputation: 'maybe' })
        .valid,
    ).toBe(false);
    expect(validateClaimReputationResponseBody({}).valid).toBe(false);
    expect(validateClaimReputationResponseBody(null).valid).toBe(false);
  });
});
