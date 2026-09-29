import type { RawClaim } from '../mercado-livre-claims/mercado-livre-claim-response';
import type { RawClaimReputationImpact } from '../mercado-livre-claims/mercado-livre-claim-reputation-response';
import { mapClaimToProblemInput } from './mercado-livre-claim-to-problem.mapper';

function baseClaim(overrides: Partial<RawClaim> = {}): RawClaim {
  return {
    externalClaimId: '99999999999999999999',
    resource: 'order',
    resourceId: '123456',
    status: 'opened',
    type: 'mediations',
    stage: 'claim',
    siteId: 'MLB',
    reasonId: 'PDD1234',
    parentClaimId: null,
    fulfilled: false,
    quantityType: 'total',
    claimVersion: '1.5',
    dateCreated: '2026-01-10T12:00:00.123Z',
    lastUpdated: '2026-01-11T08:30:00.456Z',
    players: [],
    resolution: null,
    ...overrides,
  };
}

const actionInput = {
  playerRole: 'respondent',
  playerType: 'seller',
  actionCode: 'allow',
  mandatory: true,
  dueDate: new Date('2026-01-15T00:00:00.000Z'),
};

describe('mapClaimToProblemInput', () => {
  it('mapeia todos os campos core direto do RawClaim, sem tocar em responsibility*', () => {
    const result = mapClaimToProblemInput({
      marketplaceAccountId: 'acc-1',
      claim: baseClaim(),
      detail: { fetched: false },
      reputation: { fetched: false },
    });

    expect(result).toMatchObject({
      marketplaceAccountId: 'acc-1',
      externalClaimId: '99999999999999999999',
      resource: 'order',
      resourceId: '123456',
      status: 'opened',
      type: 'mediations',
      stage: 'claim',
      siteId: 'MLB',
      reasonId: 'PDD1234',
      parentClaimId: null,
      fulfilled: false,
      quantityType: 'total',
      claimVersion: '1.5',
      resolutionReason: null,
      resolutionBenefitedRoles: [],
      resolutionClosedBy: null,
      resolutionAppliedCoverage: null,
      resolutionDate: null,
    });
    expect(result.dateCreated).toEqual(new Date('2026-01-10T12:00:00.123Z'));
    expect(result.lastUpdated).toEqual(new Date('2026-01-11T08:30:00.456Z'));
    expect(result).not.toHaveProperty('responsibility');
    expect(result).not.toHaveProperty('responsibilityConfidence');
    expect(result).not.toHaveProperty('responsibilitySource');
  });

  it('preserva ID externo grande (string) sem conversão numérica', () => {
    const result = mapClaimToProblemInput({
      marketplaceAccountId: 'acc-1',
      claim: baseClaim({ externalClaimId: '99999999999999999999' }),
      detail: { fetched: false },
      reputation: { fetched: false },
    });
    expect(result.externalClaimId).toBe('99999999999999999999');
  });

  it('mapeia resolution presente para os campos normalizados', () => {
    const result = mapClaimToProblemInput({
      marketplaceAccountId: 'acc-1',
      claim: baseClaim({
        resolution: {
          reason: 'buyer_refunded',
          benefitedRoles: ['complainant'],
          closedBy: 'mediator',
          appliedCoverage: true,
          date: '2026-01-12T00:00:00.000Z',
        },
      }),
      detail: { fetched: false },
      reputation: { fetched: false },
    });
    expect(result.resolutionReason).toBe('buyer_refunded');
    expect(result.resolutionBenefitedRoles).toEqual(['complainant']);
    expect(result.resolutionClosedBy).toBe('mediator');
    expect(result.resolutionAppliedCoverage).toBe(true);
    expect(result.resolutionDate).toEqual(new Date('2026-01-12T00:00:00.000Z'));
  });

  describe('detail — 3 estados de FetchOutcome', () => {
    it('fetched=false preserva semântica de "não consultado"', () => {
      const result = mapClaimToProblemInput({
        marketplaceAccountId: 'acc-1',
        claim: baseClaim(),
        detail: { fetched: false },
        reputation: { fetched: false },
      });
      expect(result.detail).toEqual({ fetched: false });
    });

    it('fetched=true,value=null limpa detail (a persistência decide zerar actions)', () => {
      const result = mapClaimToProblemInput({
        marketplaceAccountId: 'acc-1',
        claim: baseClaim(),
        detail: { fetched: true, value: null },
        reputation: { fetched: false },
      });
      expect(result.detail).toEqual({ fetched: true, value: null });
    });

    it('fetched=true,value={...} mapeia info + actions já achatadas', () => {
      const result = mapClaimToProblemInput({
        marketplaceAccountId: 'acc-1',
        claim: baseClaim(),
        detail: {
          fetched: true,
          value: {
            info: {
              dueDate: '2026-01-20T00:00:00.000Z',
              responsible: 'seller',
              title: 'Produto não recebido',
              description: 'desc',
              problem: 'not_delivered',
            },
            actions: [actionInput],
          },
        },
        reputation: { fetched: false },
      });
      expect(result.detail).toEqual({
        fetched: true,
        value: {
          dueDate: new Date('2026-01-20T00:00:00.000Z'),
          responsible: 'seller',
          title: 'Produto não recebido',
          description: 'desc',
          problem: 'not_delivered',
          actions: [
            {
              playerRole: 'respondent',
              playerType: 'seller',
              actionCode: 'allow',
              mandatory: true,
              dueDate: new Date('2026-01-15T00:00:00.000Z'),
            },
          ],
        },
      });
    });

    it('fetched=true,value={info:null,actions:[]} preserva info nulo e actions vazias', () => {
      const result = mapClaimToProblemInput({
        marketplaceAccountId: 'acc-1',
        claim: baseClaim(),
        detail: { fetched: true, value: { info: null, actions: [] } },
        reputation: { fetched: false },
      });
      expect(result.detail).toEqual({
        fetched: true,
        value: {
          dueDate: null,
          responsible: null,
          title: null,
          description: null,
          problem: null,
          actions: [],
        },
      });
    });
  });

  describe('reputation — 3 estados de FetchOutcome', () => {
    const reputationValue: RawClaimReputationImpact = {
      impact: 'affected',
      hasIncentive: true,
      dueDate: '2026-02-01T00:00:00.000Z',
    };

    it('fetched=false preserva semântica de "não consultado"', () => {
      const result = mapClaimToProblemInput({
        marketplaceAccountId: 'acc-1',
        claim: baseClaim(),
        detail: { fetched: false },
        reputation: { fetched: false },
      });
      expect(result.reputation).toEqual({ fetched: false });
    });

    it('fetched=true,value=null limpa reputation', () => {
      const result = mapClaimToProblemInput({
        marketplaceAccountId: 'acc-1',
        claim: baseClaim(),
        detail: { fetched: false },
        reputation: { fetched: true, value: null },
      });
      expect(result.reputation).toEqual({ fetched: true, value: null });
    });

    it('fetched=true,value={...} mapeia impact/hasIncentive/dueDate', () => {
      const result = mapClaimToProblemInput({
        marketplaceAccountId: 'acc-1',
        claim: baseClaim(),
        detail: { fetched: false },
        reputation: { fetched: true, value: reputationValue },
      });
      expect(result.reputation).toEqual({
        fetched: true,
        value: {
          impact: 'affected',
          hasIncentive: true,
          dueDate: new Date('2026-02-01T00:00:00.000Z'),
        },
      });
    });
  });
});
