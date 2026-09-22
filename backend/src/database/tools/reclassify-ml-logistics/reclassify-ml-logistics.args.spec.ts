import {
  RECLASSIFY_CONFIRMATION_TOKEN,
  ReclassifyAbortedError,
  formatAbortLine,
  formatApplyReport,
  formatPlanReport,
  hasFailureOutcome,
  parseReclassifyArgs,
} from './reclassify-ml-logistics.args';

function applyReport(overrides: Record<string, unknown> = {}) {
  return {
    nickname: 'Meli 1',
    outcome: 'COMPLETED' as const,
    ordersExamined: 3,
    shipmentRequests: 3,
    resolvedMarketplaceFulfilled: 2,
    resolvedSellerFulfilled: 1,
    leftUnknownUnrecognizedType: 0,
    leftUnknownNotFound: 0,
    leftUnknownTransientFailure: 0,
    leftUnknownInvalidResponse: 0,
    skippedAlreadyResolved: 0,
    orderDetailRequests: 0,
    shipmentIdsRecovered: 0,
    leftUnknownOrderNotFound: 0,
    ...overrides,
  };
}

describe('parseReclassifyArgs', () => {
  it('defaults to the read-only plan mode when no argument is given', () => {
    expect(parseReclassifyArgs([])).toEqual({
      mode: 'plan',
      accountId: null,
      batchSize: null,
      maxRequestsPerAccount: null,
    });
  });

  it('treats an explicit --plan the same as the default', () => {
    expect(parseReclassifyArgs(['--plan']).mode).toBe('plan');
  });

  it('blocks --apply without any confirmation', () => {
    expect(() => parseReclassifyArgs(['--apply'])).toThrow(
      ReclassifyAbortedError,
    );
    try {
      parseReclassifyArgs(['--apply']);
    } catch (error) {
      expect((error as ReclassifyAbortedError).reason).toBe(
        'CONFIRMATION_REQUIRED',
      );
    }
  });

  it('blocks --apply with a wrong confirmation', () => {
    try {
      parseReclassifyArgs(['--apply', '--confirm', 'reclassify_ml_logistics']);
      throw new Error('deveria ter abortado');
    } catch (error) {
      expect((error as ReclassifyAbortedError).reason).toBe(
        'CONFIRMATION_MISMATCH',
      );
    }
  });

  it('blocks a confirmation passed without --apply', () => {
    try {
      parseReclassifyArgs(['--confirm', RECLASSIFY_CONFIRMATION_TOKEN]);
      throw new Error('deveria ter abortado');
    } catch (error) {
      expect((error as ReclassifyAbortedError).reason).toBe(
        'CONFIRMATION_WITHOUT_APPLY',
      );
    }
  });

  it('accepts --apply with the exact confirmation token', () => {
    expect(
      parseReclassifyArgs([
        '--apply',
        '--confirm',
        RECLASSIFY_CONFIRMATION_TOKEN,
      ]).mode,
    ).toBe('apply');
  });

  it('aborts on an unknown argument instead of silently ignoring a typo', () => {
    try {
      parseReclassifyArgs(['--aply']);
      throw new Error('deveria ter abortado');
    } catch (error) {
      expect((error as ReclassifyAbortedError).reason).toBe('UNKNOWN_ARGUMENT');
    }
  });

  it('parses the optional batch and request limits', () => {
    expect(
      parseReclassifyArgs([
        '--account-id',
        '11111111-1111-4111-8111-111111111111',
        '--batch-size',
        '25',
        '--max-requests',
        '300',
      ]),
    ).toEqual({
      mode: 'plan',
      accountId: '11111111-1111-4111-8111-111111111111',
      batchSize: 25,
      maxRequestsPerAccount: 300,
    });
  });

  it.each([
    [['--account-id', 'nao-e-uuid'], 'ACCOUNT_ID_INVALID'],
    [['--batch-size', '0'], 'BATCH_SIZE_INVALID'],
    [['--batch-size', 'abc'], 'BATCH_SIZE_INVALID'],
    [['--max-requests', '-1'], 'MAX_REQUESTS_INVALID'],
  ])('rejects %j', (argv, reason) => {
    try {
      parseReclassifyArgs(argv);
      throw new Error('deveria ter abortado');
    } catch (error) {
      expect((error as ReclassifyAbortedError).reason).toBe(reason);
    }
  });
});

describe('hasFailureOutcome', () => {
  it.each(['ABORTED_UNAUTHORIZED', 'ABORTED_TOKEN_UNAVAILABLE'] as const)(
    'treats %s as a failure (non-zero exit)',
    (outcome) => {
      expect(hasFailureOutcome([applyReport({ outcome })] as never)).toBe(true);
    },
  );

  it.each([
    'COMPLETED',
    'STOPPED_MAX_REQUESTS',
    'STOPPED_RATE_LIMITED',
    'STOPPED_PROVIDER_UNAVAILABLE',
    'SKIPPED_ACCOUNT_BUSY',
    'SKIPPED_NOT_CONNECTED',
    'SKIPPED_NOTHING_PENDING',
  ] as const)(
    'treats %s as a planned, resumable stop (exit zero)',
    (outcome) => {
      expect(hasFailureOutcome([applyReport({ outcome })] as never)).toBe(
        false,
      );
    },
  );
});

describe('saída sanitizada', () => {
  it('prints only counts and the account label in the plan report', () => {
    const lines = formatPlanReport({
      batchSize: 50,
      accounts: [
        {
          nickname: 'Meli 1',
          pendingWithShipmentId: 10,
          pendingWithoutShipmentId: 4000,
          resolved: 900,
          totalUnknown: 4010,
          estimatedMaxRequests: 8010,
          estimatedBatches: 81,
        },
      ],
    });

    expect(lines[0]).toContain('nenhuma chamada externa');
    expect(lines).toContain(
      'Meli 1 | total_unknown=4010 | pendentes_com_identificador=10 | pendentes_sem_identificador=4000 | ja_classificados=900 | estimativa_maxima_chamadas=8010 | lotes_estimados=81',
    );
    expect(lines).toContain('total_processavel: 10');
    expect(lines).toContain('total_sem_identificador_de_envio: 4000');
    expect(lines).toContain('estimativa_maxima_chamadas_total: 8010');
  });

  it('never prints tokens, urls, order ids or shipment ids', () => {
    const output = [
      ...formatPlanReport({
        batchSize: 50,
        accounts: [
          {
            nickname: 'Meli 1',
            pendingWithShipmentId: 1,
            pendingWithoutShipmentId: 0,
            resolved: 0,
            totalUnknown: 1,
            estimatedMaxRequests: 1,
            estimatedBatches: 1,
          },
        ],
      }),
      ...formatApplyReport([applyReport()] as never),
    ].join('\n');

    expect(output).not.toMatch(/https?:\/\//);
    expect(output).not.toMatch(/Bearer/i);
    expect(output).not.toMatch(/token/i);
    expect(output).not.toMatch(/ship-/);
  });

  it('prints only the closed error code on an abort', () => {
    expect(
      formatAbortLine(new ReclassifyAbortedError('UNKNOWN_ARGUMENT')),
    ).toBe('reclassificacao abortada: UNKNOWN_ARGUMENT');
  });

  it('never propagates a raw error message', () => {
    const line = formatAbortLine(
      new Error('connection to postgres://user:senha@host failed'),
    );
    expect(line).toBe('reclassificacao abortada: EXECUTION_FAILED');
    expect(line).not.toContain('senha');
  });
});
