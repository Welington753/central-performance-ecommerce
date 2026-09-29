import { validateClaimDetailResponseBody } from './mercado-livre-claim-detail-response';

function baseDetail(overrides: Record<string, unknown> = {}) {
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
    claim_version: '1.5',
    date_created: '2026-01-10T12:00:00.123Z',
    last_updated: '2026-01-11T08:30:00.456Z',
    resolution: null,
    detail: null,
    players: [
      {
        user_id: 111,
        role: 'respondent',
        type: 'seller',
        available_actions: [
          {
            action: 'allow',
            mandatory: true,
            due_date: '2026-01-15T00:00:00.000Z',
          },
          { action: 'answer', mandatory: false },
        ],
      },
      {
        user_id: 222,
        role: 'complainant',
        type: 'buyer',
        available_actions: [{ action: 'refund', mandatory: false }],
      },
    ],
    ...overrides,
  };
}

describe('validateClaimDetailResponseBody', () => {
  it('aceita múltiplos players, cada um com múltiplas available_actions (mandatory/due_date)', () => {
    const result = validateClaimDetailResponseBody(baseDetail());
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.claim.players).toHaveLength(2);
    expect(result.claim.players[0].availableActions).toEqual([
      {
        actionCode: 'allow',
        mandatory: true,
        dueDate: '2026-01-15T00:00:00.000Z',
      },
      { actionCode: 'answer', mandatory: false, dueDate: null },
    ]);
    expect(result.claim.players[1].availableActions).toEqual([
      { actionCode: 'refund', mandatory: false, dueDate: null },
    ]);
  });

  it('normaliza claim_version preservando o texto exato', () => {
    const result = validateClaimDetailResponseBody(
      baseDetail({ claim_version: '2.0' }),
    );
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.claim.claimVersion).toBe('2.0');
  });

  it('aceita detail null e resolution null', () => {
    const result = validateClaimDetailResponseBody(baseDetail());
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.claim.detail).toBeNull();
    expect(result.claim.resolution).toBeNull();
  });

  it('aceita bloco detail preenchido', () => {
    const result = validateClaimDetailResponseBody(
      baseDetail({
        detail: {
          due_date: '2026-01-20T00:00:00.000Z',
          responsible: 'seller',
          title: 'Produto não recebido',
          description: 'Comprador alega não ter recebido o produto',
          problem: 'not_delivered',
        },
      }),
    );
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.claim.detail).toEqual({
      dueDate: '2026-01-20T00:00:00.000Z',
      responsible: 'seller',
      title: 'Produto não recebido',
      description: 'Comprador alega não ter recebido o produto',
      problem: 'not_delivered',
    });
  });

  it('rejeita quando players não é array', () => {
    const result = validateClaimDetailResponseBody(
      baseDetail({ players: null }),
    );
    expect(result.valid).toBe(false);
  });

  it('rejeita available_actions com action ausente', () => {
    const result = validateClaimDetailResponseBody(
      baseDetail({
        players: [
          {
            user_id: 1,
            role: 'respondent',
            available_actions: [{ mandatory: true }],
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
  });

  it('rejeita corpo estruturalmente inválido', () => {
    expect(validateClaimDetailResponseBody(null).valid).toBe(false);
    expect(validateClaimDetailResponseBody({}).valid).toBe(false);
  });
});
