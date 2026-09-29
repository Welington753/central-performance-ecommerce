import { validateClaimResponseBody } from './mercado-livre-claim-response';

function baseClaim(overrides: Record<string, unknown> = {}) {
  return {
    id: 5000000123,
    resource_id: '123456',
    resource: 'order',
    status: 'opened',
    type: 'mediations',
    stage: 'claim',
    site_id: 'MLB',
    reason_id: 'PDD1234',
    parent_id: null,
    fulfilled: false,
    quantity_type: 'total',
    date_created: '2026-01-10T12:00:00.123Z',
    last_updated: '2026-01-11T08:30:00.456Z',
    players: [],
    resolution: null,
    ...overrides,
  };
}

describe('validateClaimResponseBody', () => {
  it('normaliza claim_version string preservando o texto exato', () => {
    for (const version of ['1', '1.0', '1.5', '2.0']) {
      const result = validateClaimResponseBody(
        baseClaim({ claim_version: version }),
      );
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.claim.claimVersion).toBe(version);
    }
  });

  it('normaliza claim_version number para string', () => {
    const result = validateClaimResponseBody(baseClaim({ claim_version: 2 }));
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.claim.claimVersion).toBe('2');
  });

  it('claim_version ausente vira null', () => {
    const result = validateClaimResponseBody(baseClaim());
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.claim.claimVersion).toBeNull();
  });

  it('rejeita corpo estruturalmente inválido', () => {
    expect(validateClaimResponseBody(null).valid).toBe(false);
    expect(validateClaimResponseBody({}).valid).toBe(false);
  });
});
