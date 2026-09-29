import { validateClaimsSearchResponseBody } from './mercado-livre-claims-search-response';

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
    players: [
      {
        user_id: 111,
        role: 'respondent',
        type: 'seller',
        available_actions: ['allow', 'answer'],
      },
      {
        user_id: 222,
        role: 'complainant',
        type: 'buyer',
        available_actions: ['refund'],
      },
    ],
    resolution: null,
    ...overrides,
  };
}

function bodyWith(data: unknown[]) {
  return {
    paging: { total: data.length, offset: 0, limit: 30 },
    data,
  };
}

describe('validateClaimsSearchResponseBody', () => {
  it('aceita envelope {paging, data} com múltiplos players e available_actions', () => {
    const result = validateClaimsSearchResponseBody(bodyWith([baseClaim()]));
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].players).toHaveLength(2);
    expect(result.data[0].players[0].availableActionCodes).toEqual([
      'allow',
      'answer',
    ]);
    expect(result.data[0].players[1].availableActionCodes).toEqual(['refund']);
    expect(result.paging).toEqual({ total: 1, offset: 0, limit: 30 });
  });

  it('rejeita envelope com "results" no lugar de "data"', () => {
    const result = validateClaimsSearchResponseBody({
      paging: { total: 1, offset: 0, limit: 30 },
      results: [baseClaim()],
    });
    expect(result.valid).toBe(false);
  });

  it('aceita resolution ausente (null) e campos opcionais null', () => {
    const result = validateClaimsSearchResponseBody(
      bodyWith([
        baseClaim({
          reason_id: null,
          parent_id: null,
          fulfilled: null,
          quantity_type: null,
        }),
      ]),
    );
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.data[0].reasonId).toBeNull();
    expect(result.data[0].parentClaimId).toBeNull();
    expect(result.data[0].fulfilled).toBeNull();
    expect(result.data[0].quantityType).toBeNull();
    expect(result.data[0].resolution).toBeNull();
  });

  it('aceita resolution presente com campos normalizados', () => {
    const result = validateClaimsSearchResponseBody(
      bodyWith([
        baseClaim({
          resolution: {
            reason: 'buyer_refunded',
            benefited_roles: ['complainant'],
            closed_by: 'mediator',
            applied_coverage: true,
            date_created: '2026-01-12T00:00:00.000Z',
          },
        }),
      ]),
    );
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.data[0].resolution).toEqual({
      reason: 'buyer_refunded',
      benefitedRoles: ['complainant'],
      closedBy: 'mediator',
      appliedCoverage: true,
      date: '2026-01-12T00:00:00.000Z',
    });
  });

  it('preserva IDs grandes como string sem perder precisão', () => {
    const result = validateClaimsSearchResponseBody(
      bodyWith([baseClaim({ id: '99999999999999999999' })]),
    );
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.data[0].externalClaimId).toBe('99999999999999999999');
  });

  it('rejeita quando players não é array', () => {
    const result = validateClaimsSearchResponseBody(
      bodyWith([baseClaim({ players: 'not-an-array' })]),
    );
    expect(result.valid).toBe(false);
  });

  it('rejeita corpo estruturalmente desconhecido sem gravar/interpretar nada', () => {
    expect(validateClaimsSearchResponseBody(null).valid).toBe(false);
    expect(validateClaimsSearchResponseBody(undefined).valid).toBe(false);
    expect(validateClaimsSearchResponseBody('a string').valid).toBe(false);
    expect(validateClaimsSearchResponseBody({}).valid).toBe(false);
    expect(
      validateClaimsSearchResponseBody({ paging: {}, data: [] }).valid,
    ).toBe(false);
  });
});
