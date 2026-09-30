import type { ClaimsHttpOutcome } from '../mercado-livre-claims/mercado-livre-claims-http.client';
import type { RawDetailPlayer } from '../mercado-livre-claims/mercado-livre-claim-detail-response';
import {
  classifyClaimsHttpOutcome,
  classifySearchOutcome,
  flattenDetailActions,
} from './mercado-livre-claim-enrichment.util';

function outcome(
  kind: ClaimsHttpOutcome<unknown>['kind'],
): ClaimsHttpOutcome<unknown> {
  if (kind === 'rate_limited') return { kind, retryAfterMs: 5000 };
  if (kind === 'success') return { kind, data: {} };
  return { kind };
}

describe('classifyClaimsHttpOutcome', () => {
  it.each([
    ['core', 'CORE_UNAUTHORIZED'],
    ['detail', 'DETAIL_UNAUTHORIZED'],
    ['reputation', 'REPUTATION_UNAUTHORIZED'],
    ['reason', 'REASON_UNAUTHORIZED'],
  ] as const)(
    'unauthorized em %s é abort_auth global com %s',
    (operation, failureCode) => {
      expect(
        classifyClaimsHttpOutcome(outcome('unauthorized'), operation),
      ).toEqual({ kind: 'abort_auth', failureCode });
    },
  );

  it.each(['core', 'detail', 'reputation', 'reason'] as const)(
    'forbidden em %s é isolado (403 de um claim nunca derruba a conta)',
    (operation) => {
      expect(
        classifyClaimsHttpOutcome(outcome('forbidden'), operation),
      ).toEqual({ kind: 'isolated', forbidden: true });
    },
  );

  it('classifica rate_limited como abort_rate_limit preservando retryAfterMs', () => {
    expect(classifyClaimsHttpOutcome(outcome('rate_limited'), 'core')).toEqual({
      kind: 'abort_rate_limit',
      retryAfterMs: 5000,
    });
  });

  it('classifica provider_unavailable como abort_provider', () => {
    expect(
      classifyClaimsHttpOutcome(outcome('provider_unavailable'), 'core'),
    ).toEqual({
      kind: 'abort_provider',
    });
  });

  it.each(['not_found', 'invalid_response', 'invalid_request'] as const)(
    'classifica %s como isolated',
    (kind) => {
      expect(classifyClaimsHttpOutcome(outcome(kind), 'detail')).toEqual({
        kind: 'isolated',
        forbidden: false,
      });
    },
  );

  it('classifica success como ok', () => {
    expect(classifyClaimsHttpOutcome(outcome('success'), 'core')).toEqual({
      kind: 'ok',
    });
  });
});

describe('classifySearchOutcome', () => {
  it('classifica success como ok', () => {
    expect(classifySearchOutcome(outcome('success'))).toEqual({ kind: 'ok' });
  });

  it.each(['not_found', 'invalid_response', 'invalid_request'] as const)(
    'classifica %s como SEARCH_CONTRACT_ERROR (nunca isolated)',
    (kind) => {
      expect(classifySearchOutcome(outcome(kind))).toEqual({
        kind: 'SEARCH_CONTRACT_ERROR',
      });
    },
  );

  it.each([
    ['unauthorized', 'SEARCH_UNAUTHORIZED'],
    ['forbidden', 'SEARCH_FORBIDDEN'],
  ] as const)(
    'classifica %s como TERMINAL_AUTH_ERROR com %s',
    (kind, failureCode) => {
      expect(classifySearchOutcome(outcome(kind))).toEqual({
        kind: 'TERMINAL_AUTH_ERROR',
        failureCode,
      });
    },
  );

  it('classifica rate_limited como RATE_LIMITED preservando retryAfterMs', () => {
    expect(classifySearchOutcome(outcome('rate_limited'))).toEqual({
      kind: 'RATE_LIMITED',
      retryAfterMs: 5000,
    });
  });

  it('classifica provider_unavailable como PROVIDER_UNAVAILABLE', () => {
    expect(classifySearchOutcome(outcome('provider_unavailable'))).toEqual({
      kind: 'PROVIDER_UNAVAILABLE',
    });
  });
});

describe('flattenDetailActions', () => {
  function player(overrides: Partial<RawDetailPlayer> = {}): RawDetailPlayer {
    return {
      userId: 'u1',
      role: 'complainant',
      type: 'customer',
      availableActions: [],
      ...overrides,
    };
  }

  it('gera 1 ProblemActionInput por (player, action), preservando role/type do player', () => {
    const players: RawDetailPlayer[] = [
      player({
        role: 'complainant',
        type: 'customer',
        availableActions: [
          {
            actionCode: 'refund',
            mandatory: true,
            dueDate: '2026-03-01T00:00:00.000Z',
          },
          { actionCode: 'reply', mandatory: false, dueDate: null },
        ],
      }),
    ];
    const actions = flattenDetailActions(players);
    expect(actions).toEqual([
      {
        playerRole: 'complainant',
        playerType: 'customer',
        actionCode: 'refund',
        mandatory: true,
        dueDate: new Date('2026-03-01T00:00:00.000Z'),
      },
      {
        playerRole: 'complainant',
        playerType: 'customer',
        actionCode: 'reply',
        mandatory: false,
        dueDate: null,
      },
    ]);
  });

  it('usa playerType "UNKNOWN" quando player.type é null', () => {
    const players: RawDetailPlayer[] = [
      player({
        type: null,
        availableActions: [
          { actionCode: 'refund', mandatory: true, dueDate: null },
        ],
      }),
    ];
    expect(flattenDetailActions(players)[0].playerType).toBe('UNKNOWN');
  });

  it('concatena múltiplos players na ordem original', () => {
    const players: RawDetailPlayer[] = [
      player({
        role: 'complainant',
        availableActions: [
          { actionCode: 'refund', mandatory: true, dueDate: null },
        ],
      }),
      player({
        role: 'respondent',
        availableActions: [
          { actionCode: 'reply', mandatory: false, dueDate: null },
        ],
      }),
    ];
    const actions = flattenDetailActions(players);
    expect(actions.map((a) => a.playerRole)).toEqual([
      'complainant',
      'respondent',
    ]);
  });

  it('player sem actions não gera nenhum item', () => {
    const players: RawDetailPlayer[] = [
      player({ availableActions: [] }),
      player({
        role: 'respondent',
        availableActions: [
          { actionCode: 'reply', mandatory: false, dueDate: null },
        ],
      }),
    ];
    expect(flattenDetailActions(players)).toHaveLength(1);
  });

  it('players presentes mesmo quando claim.detail é null ainda produzem actions (correção 9)', () => {
    // Este teste documenta que flattenDetailActions nunca depende do bloco
    // `detail` (info) — o chamador (mercado-livre-problems-sync.service)
    // decide `detail={fetched:true, value:{info:null, actions:flatten(...)}}`
    // mesmo quando `claim.detail === null`, desde que `players` exista.
    const players: RawDetailPlayer[] = [
      player({
        availableActions: [
          { actionCode: 'refund', mandatory: true, dueDate: null },
        ],
      }),
    ];
    expect(flattenDetailActions(players)).toHaveLength(1);
  });
});
