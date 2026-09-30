import type { ClaimsHttpOutcome } from '../mercado-livre-claims/mercado-livre-claims-http.client';
import type { RawClaim } from '../mercado-livre-claims/mercado-livre-claim-response';
import type { RawClaimDetail } from '../mercado-livre-claims/mercado-livre-claim-detail-response';
import type { SearchClaimsInput } from '../mercado-livre-claims/mercado-livre-claims-http.client';
import type { UpsertProblemInput } from './mercado-livre-claim-to-problem.mapper';
import { ProblemsSyncError } from './mercado-livre-problems-sync-preflight.util';
import { MercadoLivreProblemsSyncService } from './mercado-livre-problems-sync.service';

function lastCallArg<T>(mockFn: jest.Mock): T {
  const calls = mockFn.mock.calls as unknown as T[][];
  return calls[calls.length - 1][0];
}

function rawClaim(id: string, overrides: Partial<RawClaim> = {}): RawClaim {
  return {
    externalClaimId: id,
    resource: 'order',
    resourceId: `order-${id}`,
    status: 'opened',
    type: 'mediations',
    stage: 'claim',
    siteId: 'MLB',
    reasonId: null,
    parentClaimId: null,
    fulfilled: null,
    quantityType: null,
    dateCreated: '2026-01-10T12:00:00.000Z',
    lastUpdated: '2026-01-10T12:00:00.000Z',
    players: [],
    resolution: null,
    claimVersion: '1',
    ...overrides,
  };
}

function rawClaimDetail(
  id: string,
  overrides: Partial<RawClaimDetail> = {},
): RawClaimDetail {
  return {
    externalClaimId: id,
    resource: 'order',
    resourceId: `order-${id}`,
    status: 'opened',
    type: 'mediations',
    stage: 'claim',
    siteId: 'MLB',
    reasonId: null,
    parentClaimId: null,
    fulfilled: null,
    quantityType: null,
    dateCreated: '2026-01-10T12:00:00.000Z',
    lastUpdated: '2026-01-10T12:00:00.000Z',
    claimVersion: '1',
    players: [],
    resolution: null,
    detail: null,
    ...overrides,
  };
}

function ok<T>(data: T): ClaimsHttpOutcome<T> {
  return { kind: 'success', data };
}
function notFound<T = never>(): ClaimsHttpOutcome<T> {
  return { kind: 'not_found' };
}
function invalidResponse<T = never>(): ClaimsHttpOutcome<T> {
  return { kind: 'invalid_response' };
}
function unauthorized<T = never>(): ClaimsHttpOutcome<T> {
  return { kind: 'unauthorized' };
}
function rateLimited<T = never>(
  retryAfterMs: number | null = 3000,
): ClaimsHttpOutcome<T> {
  return { kind: 'rate_limited', retryAfterMs };
}
function providerUnavailable<T = never>(): ClaimsHttpOutcome<T> {
  return { kind: 'provider_unavailable' };
}

function build(
  overrides: {
    preflight?: Record<string, jest.Mock>;
    httpClient?: Record<string, jest.Mock>;
    reasonCache?: Record<string, jest.Mock>;
    persistence?: Record<string, jest.Mock>;
    configValues?: Record<string, unknown>;
  } = {},
) {
  const preflight = {
    resolveAccountAndToken: jest.fn().mockResolvedValue({
      accessToken: 'token-1',
      externalSellerId: 'seller-1',
    }),
    ...overrides.preflight,
  };
  const httpClient = {
    searchClaims: jest.fn().mockResolvedValue(
      ok({
        valid: true,
        data: [],
        paging: { total: 0, offset: 0, limit: 100 },
      }),
    ),
    fetchClaim: jest.fn().mockResolvedValue(notFound()),
    // Default seguro (falha isolada) para testes que não se importam com
    // enriquecimento — nunca `undefined`, que quebraria classifyClaimsHttpOutcome.
    fetchClaimDetail: jest.fn().mockResolvedValue(notFound()),
    fetchClaimReputationImpact: jest.fn().mockResolvedValue(notFound()),
    fetchClaimReason: jest.fn().mockResolvedValue(notFound()),
    ...overrides.httpClient,
  };
  const reasonCache = {
    findFresh: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue(undefined),
    ...overrides.reasonCache,
  };
  const persistence = {
    upsertProblem: jest
      .fn()
      .mockResolvedValue({ accepted: true, id: 'p-1', inserted: true }),
    findProblemsNeedingRefresh: jest.fn().mockResolvedValue([]),
    ...overrides.persistence,
  };
  const configValues: Record<string, unknown> = { ...overrides.configValues };
  const configService = {
    get: (key: string, fallback?: unknown) => configValues[key] ?? fallback,
  };

  const service = new MercadoLivreProblemsSyncService(
    preflight as never,
    httpClient as never,
    reasonCache as never,
    persistence as never,
    configService as never,
  );

  return { service, preflight, httpClient, reasonCache, persistence };
}

function claimSearchSuccess(ids: string[], total = ids.length) {
  return ok({
    valid: true,
    data: ids.map((id) => rawClaim(id)),
    paging: { total, offset: 0, limit: 100 },
  });
}

describe('MercadoLivreProblemsSyncService — validação de entrada', () => {
  it('lança Error quando window.from >= window.to', async () => {
    const { service } = build();
    await expect(
      service.syncCreationWindow('acc-1', {
        from: new Date('2026-01-02T00:00:00.000Z'),
        to: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ).rejects.toThrow();
  });

  it('lança Error quando budget.maxClaims não é inteiro positivo', async () => {
    const { service } = build();
    await expect(
      service.syncCreationWindow(
        'acc-1',
        {
          from: new Date('2026-01-01T00:00:00.000Z'),
          to: new Date('2026-01-02T00:00:00.000Z'),
        },
        { maxClaims: -1 },
      ),
    ).rejects.toThrow();
  });

  it('lança Error quando status do censo é string vazia', async () => {
    const { service } = build();
    await expect(service.censusOpenClaims('acc-1', '', null)).rejects.toThrow();
  });

  it('lança Error quando batchSize não é inteiro positivo', async () => {
    const { service } = build();
    await expect(service.refreshNonTerminalBatch('acc-1', 0)).rejects.toThrow();
  });
});

describe('MercadoLivreProblemsSyncService — pré-voo', () => {
  it('propaga ProblemsSyncError do pré-voo sem chamar nenhuma API de claims', async () => {
    const { service, httpClient } = build({
      preflight: {
        resolveAccountAndToken: jest
          .fn()
          .mockRejectedValue(new ProblemsSyncError('ACCOUNT_NOT_CONNECTED')),
      },
    });
    await expect(
      service.syncCreationWindow('acc-1', {
        from: new Date('2026-01-01T00:00:00.000Z'),
        to: new Date('2026-01-02T00:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(ProblemsSyncError);
    expect(httpClient.searchClaims).not.toHaveBeenCalled();
  });
});

describe('MercadoLivreProblemsSyncService.syncCreationWindow — fluxo feliz e cobertura de core', () => {
  const window = {
    from: new Date('2026-01-01T00:00:00.000Z'),
    to: new Date('2026-01-01T01:00:00.000Z'),
  };

  it('fluxo completo: fetchClaim + detail + reputation + reason cache miss -> persiste e atualiza cache', async () => {
    const { service, httpClient, reasonCache, persistence } = build({
      httpClient: {
        searchClaims: jest.fn().mockResolvedValue(claimSearchSuccess(['c1'])),
        fetchClaim: jest
          .fn()
          .mockResolvedValue(
            ok({ claim: rawClaim('c1', { reasonId: 'PDD1' }) }),
          ),
        fetchClaimDetail: jest.fn().mockResolvedValue(
          ok({
            claim: rawClaimDetail('c1', {
              detail: {
                dueDate: null,
                responsible: null,
                title: 't',
                description: null,
                problem: null,
              },
            }),
          }),
        ),
        fetchClaimReputationImpact: jest.fn().mockResolvedValue(
          ok({
            reputation: {
              impact: 'not_applies',
              hasIncentive: null,
              dueDate: null,
            },
          }),
        ),
        fetchClaimReason: jest.fn().mockResolvedValue(
          ok({
            reason: {
              flow: 'mediations',
              name: 'Motivo',
              detail: null,
              status: 'active',
              triage: [],
              allowedFlows: [],
              expectedResolutions: [],
            },
          }),
        ),
      },
    });

    const result = await service.syncCreationWindow('acc-1', window);

    expect(persistence.upsertProblem).toHaveBeenCalledTimes(1);
    const input = lastCallArg<UpsertProblemInput>(persistence.upsertProblem);
    expect(input.detail).toEqual({
      fetched: true,
      value: {
        dueDate: null,
        responsible: null,
        title: 't',
        description: null,
        problem: null,
        actions: [],
      },
    });
    expect(input.reputation).toEqual({
      fetched: true,
      value: { impact: 'not_applies', hasIncentive: null, dueDate: null },
    });
    expect(reasonCache.upsert).toHaveBeenCalledTimes(1);
    expect(result.claimsProcessed).toBe(1);
    expect(result.claimsCoreCovered).toBe(1);
    expect(result.claimsPersisted).toBe(1);
    expect(result.reasonCacheRefreshed).toBe(1);
    expect(result.complete).toBe(true);
    expect(result.stopReason).toBe('COMPLETED');
    expect(httpClient.searchClaims).toHaveBeenCalledTimes(1);
  });

  it('reason cache fresco: fetchClaimReason NUNCA é chamado', async () => {
    const { service, httpClient, reasonCache } = build({
      httpClient: {
        searchClaims: jest.fn().mockResolvedValue(claimSearchSuccess(['c1'])),
        fetchClaim: jest
          .fn()
          .mockResolvedValue(
            ok({ claim: rawClaim('c1', { reasonId: 'PDD1' }) }),
          ),
        fetchClaimDetail: jest
          .fn()
          .mockResolvedValue(ok({ claim: rawClaimDetail('c1') })),
        fetchClaimReputationImpact: jest.fn().mockResolvedValue(
          ok({
            reputation: {
              impact: 'not_applies',
              hasIncentive: null,
              dueDate: null,
            },
          }),
        ),
      },
      reasonCache: {
        findFresh: jest.fn().mockResolvedValue({
          flow: 'mediations',
          name: 'x',
          detail: null,
          status: 'active',
          triage: [],
          allowedFlows: [],
          expectedResolutions: [],
          fetchedAt: new Date(),
        }),
      },
    });

    await service.syncCreationWindow('acc-1', window);
    expect(httpClient.fetchClaimReason).not.toHaveBeenCalled();
    expect(reasonCache.upsert).not.toHaveBeenCalled();
  });

  it('fetchClaim -> not_found: NÃO persiste, complete:false, stopReason CORE_COVERAGE_INCOMPLETE, nextWindowFrom NÃO avança', async () => {
    const { service, persistence } = build({
      httpClient: {
        searchClaims: jest.fn().mockResolvedValue(claimSearchSuccess(['c1'])),
        fetchClaim: jest.fn().mockResolvedValue(notFound()),
      },
    });

    const result = await service.syncCreationWindow('acc-1', window);

    expect(persistence.upsertProblem).not.toHaveBeenCalled();
    expect(result.claimsProcessed).toBe(1);
    expect(result.claimsCoreCovered).toBe(0);
    expect(result.claimsFailed).toBe(1);
    expect(result.complete).toBe(false);
    expect(result.stopReason).toBe('CORE_COVERAGE_INCOMPLETE');
    expect(result.nextWindowFrom).toBe(window.from.toISOString());
  });

  it('fetchClaim -> invalid_response: mesmo tratamento fail-closed de not_found (nunca cobertura silenciosa)', async () => {
    const { service, persistence } = build({
      httpClient: {
        searchClaims: jest.fn().mockResolvedValue(claimSearchSuccess(['c1'])),
        fetchClaim: jest.fn().mockResolvedValue(invalidResponse()),
      },
    });

    const result = await service.syncCreationWindow('acc-1', window);

    expect(persistence.upsertProblem).not.toHaveBeenCalled();
    expect(result.complete).toBe(false);
    expect(result.stopReason).toBe('CORE_COVERAGE_INCOMPLETE');
    expect(result.nextWindowFrom).toBe(window.from.toISOString());
  });

  it('2ª execução com a mesma window.from persiste o claim que falhou isolado na 1ª (repetição fail-closed)', async () => {
    const fetchClaimMock = jest
      .fn()
      .mockResolvedValueOnce(invalidResponse())
      .mockResolvedValueOnce(ok({ claim: rawClaim('c1') }));
    const { service, persistence } = build({
      httpClient: {
        searchClaims: jest.fn().mockResolvedValue(claimSearchSuccess(['c1'])),
        fetchClaim: fetchClaimMock,
      },
    });

    const first = await service.syncCreationWindow('acc-1', window);
    expect(first.complete).toBe(false);
    expect(persistence.upsertProblem).not.toHaveBeenCalled();

    const second = await service.syncCreationWindow('acc-1', {
      from: new Date(first.nextWindowFrom as string),
      to: window.to,
    });
    expect(second.complete).toBe(true);
    expect(persistence.upsertProblem).toHaveBeenCalledTimes(1);
  });

  it('candidatos já persistidos na 1ª tentativa são reprocessados sem duplicação na 2ª', async () => {
    const fetchClaimMock = jest.fn<
      Promise<ClaimsHttpOutcome<{ claim: RawClaim }>>,
      [string, string]
    >((_token, id) => {
      const priorCallsForC2 = fetchClaimMock.mock.calls.filter(
        (call) => call[1] === 'c2',
      ).length;
      if (id === 'c2' && priorCallsForC2 === 1) {
        return Promise.resolve(invalidResponse());
      }
      return Promise.resolve(ok({ claim: rawClaim(id) }));
    });
    const { service, persistence } = build({
      httpClient: {
        searchClaims: jest
          .fn()
          .mockResolvedValue(claimSearchSuccess(['c1', 'c2'])),
        fetchClaim: fetchClaimMock,
      },
    });

    const first = await service.syncCreationWindow('acc-1', window);
    expect(first.complete).toBe(false);
    expect(persistence.upsertProblem).toHaveBeenCalledTimes(1); // c1 persistiu, c2 falhou

    await service.syncCreationWindow('acc-1', {
      from: new Date(first.nextWindowFrom as string),
      to: window.to,
    });
    // c1 é reprocessado (idempotente) + c2 finalmente persiste = mais 2 chamadas
    expect(persistence.upsertProblem).toHaveBeenCalledTimes(3);
  });

  it('fetchClaim -> 401/403: aborta TUDO, stopReason TERMINAL_AUTH_ERROR', async () => {
    const { service } = build({
      httpClient: {
        searchClaims: jest
          .fn()
          .mockResolvedValue(claimSearchSuccess(['c1', 'c2'])),
        fetchClaim: jest.fn().mockResolvedValue(unauthorized()),
      },
    });
    const result = await service.syncCreationWindow('acc-1', window);
    expect(result.stopReason).toBe('TERMINAL_AUTH_ERROR');
    expect(result.complete).toBe(false);
  });

  it('fetchClaim -> 429: stopReason RATE_LIMITED com retryAfterMs propagado', async () => {
    const { service } = build({
      httpClient: {
        searchClaims: jest.fn().mockResolvedValue(claimSearchSuccess(['c1'])),
        fetchClaim: jest.fn().mockResolvedValue(rateLimited(7000)),
      },
    });
    const result = await service.syncCreationWindow('acc-1', window);
    expect(result.stopReason).toBe('RATE_LIMITED');
    expect(result.retryAfterMs).toBe(7000);
  });

  it('fetchClaim -> provider_unavailable: stopReason PROVIDER_UNAVAILABLE', async () => {
    const { service } = build({
      httpClient: {
        searchClaims: jest.fn().mockResolvedValue(claimSearchSuccess(['c1'])),
        fetchClaim: jest.fn().mockResolvedValue(providerUnavailable()),
      },
    });
    const result = await service.syncCreationWindow('acc-1', window);
    expect(result.stopReason).toBe('PROVIDER_UNAVAILABLE');
  });

  it('fetchClaimDetail isolado (not_found): core AINDA persiste, detail={fetched:false}', async () => {
    const { service, persistence } = build({
      httpClient: {
        searchClaims: jest.fn().mockResolvedValue(claimSearchSuccess(['c1'])),
        fetchClaim: jest.fn().mockResolvedValue(ok({ claim: rawClaim('c1') })),
        fetchClaimDetail: jest.fn().mockResolvedValue(notFound()),
      },
    });
    const result = await service.syncCreationWindow('acc-1', window);
    expect(persistence.upsertProblem).toHaveBeenCalledTimes(1);
    const detailFailedInput = lastCallArg<UpsertProblemInput>(
      persistence.upsertProblem,
    );
    expect(detailFailedInput.detail).toEqual({
      fetched: false,
    });
    expect(result.detailFailures).toBe(1);
    expect(result.complete).toBe(true);
  });

  it('fetchClaimDetail sucesso com detail:null mas players com actions -> {fetched:true, value:{info:null, actions:[...]}}', async () => {
    const { service, persistence } = build({
      httpClient: {
        searchClaims: jest.fn().mockResolvedValue(claimSearchSuccess(['c1'])),
        fetchClaim: jest.fn().mockResolvedValue(ok({ claim: rawClaim('c1') })),
        fetchClaimDetail: jest.fn().mockResolvedValue(
          ok({
            claim: rawClaimDetail('c1', {
              detail: null,
              players: [
                {
                  userId: 'u1',
                  role: 'complainant',
                  type: 'customer',
                  availableActions: [
                    { actionCode: 'refund', mandatory: true, dueDate: null },
                  ],
                },
              ],
            }),
          }),
        ),
      },
    });
    await service.syncCreationWindow('acc-1', window);
    const input = lastCallArg<UpsertProblemInput>(persistence.upsertProblem);
    // mapClaimToProblemInput achata `info` nos campos finais de
    // ProblemDetailValue (CP2-A) — aqui só provamos que `actions` não some
    // quando `detail:null` mas `players` traz actions (correção 9).
    expect(input.detail).toEqual({
      fetched: true,
      value: {
        dueDate: null,
        responsible: null,
        title: null,
        description: null,
        problem: null,
        actions: [
          {
            playerRole: 'complainant',
            playerType: 'customer',
            actionCode: 'refund',
            mandatory: true,
            dueDate: null,
          },
        ],
      },
    });
  });

  it('fetchClaimDetail -> 401: aborta o LOTE inteiro (não só o claim atual)', async () => {
    const { service } = build({
      httpClient: {
        searchClaims: jest
          .fn()
          .mockResolvedValue(claimSearchSuccess(['c1', 'c2'])),
        fetchClaim: jest.fn().mockResolvedValue(ok({ claim: rawClaim('c1') })),
        fetchClaimDetail: jest.fn().mockResolvedValue(unauthorized()),
      },
    });
    const result = await service.syncCreationWindow('acc-1', window);
    expect(result.stopReason).toBe('TERMINAL_AUTH_ERROR');
  });

  it('upsertProblem lança exceção -> claimsFailed+=1, stopReason PERSISTENCE_UNAVAILABLE, candidatos seguintes nunca tentados', async () => {
    const fetchClaimMock = jest
      .fn()
      .mockResolvedValue(ok({ claim: rawClaim('c1') }));
    const { service } = build({
      httpClient: {
        searchClaims: jest
          .fn()
          .mockResolvedValue(claimSearchSuccess(['c1', 'c2'])),
        fetchClaim: fetchClaimMock,
      },
      persistence: {
        upsertProblem: jest
          .fn()
          .mockRejectedValue(new Error('conexão perdida')),
      },
    });
    const result = await service.syncCreationWindow('acc-1', window);
    expect(result.stopReason).toBe('PERSISTENCE_UNAVAILABLE');
    expect(result.claimsFailed).toBe(1);
    expect(fetchClaimMock).toHaveBeenCalledTimes(1);
  });

  it('reasonCache.findFresh lança exceção -> PERSISTENCE_UNAVAILABLE, não escapa cru', async () => {
    const { service } = build({
      httpClient: {
        searchClaims: jest.fn().mockResolvedValue(claimSearchSuccess(['c1'])),
        fetchClaim: jest
          .fn()
          .mockResolvedValue(
            ok({ claim: rawClaim('c1', { reasonId: 'PDD1' }) }),
          ),
      },
      reasonCache: {
        findFresh: jest.fn().mockRejectedValue(new Error('db down')),
      },
    });
    const result = await service.syncCreationWindow('acc-1', window);
    expect(result.stopReason).toBe('PERSISTENCE_UNAVAILABLE');
  });

  it('reasonCache.upsert lança exceção -> PERSISTENCE_UNAVAILABLE', async () => {
    const { service } = build({
      httpClient: {
        searchClaims: jest.fn().mockResolvedValue(claimSearchSuccess(['c1'])),
        fetchClaim: jest
          .fn()
          .mockResolvedValue(
            ok({ claim: rawClaim('c1', { reasonId: 'PDD1' }) }),
          ),
        fetchClaimReason: jest.fn().mockResolvedValue(
          ok({
            reason: {
              flow: 'mediations',
              name: 'x',
              detail: null,
              status: 'active',
              triage: [],
              allowedFlows: [],
              expectedResolutions: [],
            },
          }),
        ),
      },
      reasonCache: {
        upsert: jest.fn().mockRejectedValue(new Error('db down')),
      },
    });
    const result = await service.syncCreationWindow('acc-1', window);
    expect(result.stopReason).toBe('PERSISTENCE_UNAVAILABLE');
  });

  it('reserva: orçamento só para busca + 1 fetchClaim/candidato -> todos os cores persistem, ZERO enriquecimento é chamado', async () => {
    const ids = ['c1', 'c2', 'c3'];
    const fetchClaimMock = jest
      .fn()
      .mockImplementation((_t: string, id: string) =>
        Promise.resolve(ok({ claim: rawClaim(id) })),
      );
    const { service, httpClient, persistence } = build({
      httpClient: {
        searchClaims: jest.fn().mockResolvedValue(claimSearchSuccess(ids)),
        fetchClaim: fetchClaimMock,
      },
    });
    // 1 chamada de busca + 3 fetchClaim = 4 chamadas — orçamento exato, zero sobra.
    const result = await service.syncCreationWindow('acc-1', window, {
      maxClaims: 10,
      maxHttpCalls: 4,
    });

    expect(persistence.upsertProblem).toHaveBeenCalledTimes(3);
    expect(httpClient.fetchClaimDetail).not.toHaveBeenCalled();
    expect(httpClient.fetchClaimReputationImpact).not.toHaveBeenCalled();
    expect(httpClient.fetchClaimReason).not.toHaveBeenCalled();
    // avanço de nextWindowFrom mesmo com enriquecimento ausente (correção 3):
    expect(result.complete).toBe(true);
    expect(result.stopReason).toBe('COMPLETED');
    expect(result.nextWindowFrom).not.toBe(window.from.toISOString());
  });

  it('teste estrutural de ordem: upsertProblem só é chamado depois de todas as chamadas HTTP do claim', async () => {
    const events: string[] = [];
    const { service } = build({
      httpClient: {
        searchClaims: jest.fn().mockResolvedValue(claimSearchSuccess(['c1'])),
        fetchClaim: jest.fn().mockImplementation(() => {
          events.push('fetchClaim');
          return Promise.resolve(ok({ claim: rawClaim('c1') }));
        }),
        fetchClaimDetail: jest.fn().mockImplementation(() => {
          events.push('fetchClaimDetail');
          return Promise.resolve(ok({ claim: rawClaimDetail('c1') }));
        }),
        fetchClaimReputationImpact: jest.fn().mockImplementation(() => {
          events.push('fetchClaimReputationImpact');
          return Promise.resolve(
            ok({
              reputation: {
                impact: 'not_applies',
                hasIncentive: null,
                dueDate: null,
              },
            }),
          );
        }),
      },
      persistence: {
        upsertProblem: jest.fn().mockImplementation(() => {
          events.push('upsertProblem');
          return Promise.resolve({ accepted: true, id: 'p1', inserted: true });
        }),
      },
    });
    await service.syncCreationWindow('acc-1', window);
    expect(events).toEqual([
      'fetchClaim',
      'fetchClaimDetail',
      'fetchClaimReputationImpact',
      'upsertProblem',
    ]);
  });
});

describe('MercadoLivreProblemsSyncService.refreshNonTerminalBatch', () => {
  it('chama findProblemsNeedingRefresh com min(batchSize, maxClaims, maxHttpCalls) e processa cada id', async () => {
    const { service, persistence, httpClient } = build({
      persistence: {
        findProblemsNeedingRefresh: jest
          .fn()
          .mockResolvedValue([{ externalClaimId: 'c1' }]),
      },
      httpClient: {
        fetchClaim: jest.fn().mockResolvedValue(ok({ claim: rawClaim('c1') })),
      },
    });
    await service.refreshNonTerminalBatch('acc-1', 50, {
      maxClaims: 20,
      maxHttpCalls: 5,
    });
    expect(persistence.findProblemsNeedingRefresh).toHaveBeenCalledWith(
      'acc-1',
      5,
    );
    expect(httpClient.fetchClaim).toHaveBeenCalledTimes(1);
  });

  it('findProblemsNeedingRefresh lança exceção -> PERSISTENCE_UNAVAILABLE imediato, zero processado', async () => {
    const { service, httpClient } = build({
      persistence: {
        findProblemsNeedingRefresh: jest
          .fn()
          .mockRejectedValue(new Error('db down')),
      },
    });
    const result = await service.refreshNonTerminalBatch('acc-1', 10);
    expect(result.stopReason).toBe('PERSISTENCE_UNAVAILABLE');
    expect(result.claimsProcessed).toBe(0);
    expect(httpClient.fetchClaim).not.toHaveBeenCalled();
  });

  it('falha isolada de core não atualiza last_checked_at (não chama upsertProblem) — linha continua elegível', async () => {
    const { service, persistence } = build({
      persistence: {
        findProblemsNeedingRefresh: jest
          .fn()
          .mockResolvedValue([{ externalClaimId: 'c1' }]),
      },
      httpClient: { fetchClaim: jest.fn().mockResolvedValue(notFound()) },
    });
    const result = await service.refreshNonTerminalBatch('acc-1', 10);
    expect(persistence.upsertProblem).not.toHaveBeenCalled();
    expect(result.complete).toBe(false);
    expect(result.stopReason).toBe('CORE_COVERAGE_INCOMPLETE');
  });
});

describe('MercadoLivreProblemsSyncService.censusOpenClaims', () => {
  it('paging.total abaixo do teto/reserva pagina direto e processa', async () => {
    const { service, httpClient, persistence } = build({
      httpClient: {
        searchClaims: jest.fn().mockResolvedValue(claimSearchSuccess(['c1'])),
        fetchClaim: jest.fn().mockResolvedValue(ok({ claim: rawClaim('c1') })),
      },
    });
    const result = await service.censusOpenClaims('acc-1', 'opened', null);
    expect(result.complete).toBe(true);
    expect(persistence.upsertProblem).toHaveBeenCalledTimes(1);
    expect(httpClient.searchClaims).toHaveBeenCalledTimes(1);
    const callArgs = lastCallArg<SearchClaimsInput>(httpClient.searchClaims);
    expect(callArgs.dateRange).toBeUndefined();
    expect(callArgs.status).toBe('opened');
  });

  it('acima do teto/reserva sem coverageFrom -> sem processamento parcial, claimsFound:0', async () => {
    const { service, persistence } = build({
      httpClient: {
        searchClaims: jest
          .fn()
          .mockResolvedValue(claimSearchSuccess([], 999999)),
      },
    });
    const result = await service.censusOpenClaims('acc-1', 'opened', null);
    expect(result.claimsFound).toBe(0);
    expect(result.complete).toBe(false);
    expect([
      'CLAIM_BUDGET_EXHAUSTED',
      'CALL_BUDGET_EXHAUSTED',
      'SAFETY_LIMIT_REACHED',
    ]).toContain(result.stopReason);
    expect(result.coverageFrom).toBeNull();
    expect(persistence.upsertProblem).not.toHaveBeenCalled();
  });

  it('acima do teto/reserva COM coverageFrom -> delega à divisão segura, coverageFrom ecoado', async () => {
    const coverageFrom = new Date('2026-01-01T00:00:00.000Z');
    const { service, httpClient } = build({
      httpClient: {
        searchClaims: jest
          .fn()
          .mockImplementation((input: SearchClaimsInput) => {
            if (!input.dateRange) {
              return Promise.resolve(claimSearchSuccess([], 999999));
            }
            return Promise.resolve(claimSearchSuccess(['c1']));
          }),
        fetchClaim: jest.fn().mockResolvedValue(ok({ claim: rawClaim('c1') })),
      },
    });
    const result = await service.censusOpenClaims(
      'acc-1',
      'opened',
      coverageFrom,
      {
        maxClaims: 10000,
        maxHttpCalls: 10000,
      },
    );
    expect(result.coverageFrom).toBe(coverageFrom.toISOString());
    expect(httpClient.searchClaims).toHaveBeenCalled();
  });
});
