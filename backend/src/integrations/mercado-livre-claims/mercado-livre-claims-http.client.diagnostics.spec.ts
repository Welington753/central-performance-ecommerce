import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MercadoLivreClaimsHttpClient } from './mercado-livre-claims-http.client';

const TOKEN = 'secret-token-abc';
const SELLER = '777666555';
const CLAIM = '5123456789';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function brokenJsonResponse(): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.reject(new SyntaxError('Unexpected token')),
  } as unknown as Response;
}

const config = {
  get: (_key: string, def: unknown) => def,
} as unknown as ConfigService;

function clientReturning(response: Response | Error) {
  const fetchImpl = jest.fn(() =>
    response instanceof Error
      ? Promise.reject(response)
      : Promise.resolve(response),
  );
  return {
    client: new MercadoLivreClaimsHttpClient(config, fetchImpl),
    fetchImpl,
  };
}

const searchInput = (overrides: Record<string, unknown> = {}) => ({
  accessToken: TOKEN,
  sellerUserId: SELLER,
  status: 'closed',
  dateRange: {
    after: new Date('2026-08-01T00:00:00.000Z'),
    before: new Date('2026-09-30T00:00:00.000Z'),
  },
  offset: 0,
  limit: 100,
  operation: 'search_creation_closed' as const,
  ...overrides,
});

const VALID_CLAIM = {
  id: Number(CLAIM),
  resource_id: '2000001234',
  resource: 'order',
  status: 'closed',
  type: 'mediations',
  stage: 'claim',
  site_id: 'MLB',
  date_created: '2026-08-10T12:00:00.000Z',
  last_updated: '2026-08-10T12:00:00.000Z',
  players: [],
  resolution: null,
};

describe('MercadoLivreClaimsHttpClient — diagnóstico sanitizado de falhas', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  /** Único evento emitido, com o payload exato (e nada além). */
  function onlyDiagnostic(): Record<string, unknown> {
    expect(warn).toHaveBeenCalledTimes(1);
    const [event, payload] = warn.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(event).toBe('ml_claims_http_failure');
    expect(Object.keys(payload).sort()).toEqual([
      'category',
      'httpStatus',
      'operation',
      'validatorStage',
    ]);
    return payload;
  }

  function expectNoSensitiveData(): void {
    const serialized = JSON.stringify(warn.mock.calls);
    for (const forbidden of [
      TOKEN,
      SELLER,
      CLAIM,
      '2000001234',
      'api.mercadolibre.com',
      'claims/search',
      'players.user_id',
      'Bearer',
      'Unexpected token',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  }

  it.each([
    ['search_creation_closed', 'closed'],
    ['search_creation_opened', 'opened'],
  ] as const)(
    'busca da criação com 400 identificada como %s — sem URL, token, IDs',
    async (operation, status) => {
      const { client } = clientReturning(
        jsonResponse(400, {
          message: `seller ${SELLER}`,
          error: 'bad_request',
        }),
      );
      const result = await client.searchClaims(
        searchInput({ status, operation }),
      );
      expect(result).toEqual({ kind: 'invalid_request' });
      expect(onlyDiagnostic()).toEqual({
        operation,
        category: 'invalid_request',
        httpStatus: 400,
        validatorStage: null,
      });
      expectNoSensitiveData();
    },
  );

  it('busca do censo identificada como search_census', async () => {
    const { client } = clientReturning(jsonResponse(503, {}));
    await client.searchClaims(
      searchInput({
        status: 'opened',
        dateRange: undefined,
        operation: 'search_census',
      }),
    );
    expect(onlyDiagnostic()).toEqual({
      operation: 'search_census',
      category: 'provider_unavailable',
      httpStatus: 503,
      validatorStage: null,
    });
  });

  it.each([
    ['envelope', 'not an object'],
    ['data', { results: [], paging: { total: 0, offset: 0, limit: 100 } }],
    ['paging', { data: [], paging: { total: 'x' } }],
    [
      'item',
      {
        data: [{ ...VALID_CLAIM, id: null }],
        paging: { total: 1, offset: 0, limit: 100 },
      },
    ],
  ])(
    'corpo 2xx reprovado no estágio %s do validador da busca',
    async (stage, body) => {
      const { client } = clientReturning(jsonResponse(200, body));
      const result = await client.searchClaims(searchInput());
      expect(result).toEqual({ kind: 'invalid_response' });
      expect(onlyDiagnostic()).toEqual({
        operation: 'search_creation_closed',
        category: 'invalid_response',
        httpStatus: 200,
        validatorStage: stage,
      });
      expectNoSensitiveData();
    },
  );

  it('corpo 2xx que não é JSON: estágio json_parse', async () => {
    const { client } = clientReturning(brokenJsonResponse());
    await client.searchClaims(searchInput());
    expect(onlyDiagnostic()).toEqual({
      operation: 'search_creation_closed',
      category: 'invalid_response',
      httpStatus: 200,
      validatorStage: 'json_parse',
    });
    expectNoSensitiveData();
  });

  it('entrada reprovada localmente: estágio request_input, sem HTTP status e sem chamar fetch', async () => {
    const { client, fetchImpl } = clientReturning(jsonResponse(200, {}));
    await client.searchClaims(searchInput({ limit: 101 }));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onlyDiagnostic()).toEqual({
      operation: 'search_creation_closed',
      category: 'invalid_request',
      httpStatus: null,
      validatorStage: 'request_input',
    });
  });

  it('falha de rede: provider_unavailable sem HTTP status nem mensagem do erro', async () => {
    const { client } = clientReturning(
      new Error(`connect failed for ${TOKEN}`),
    );
    await client.searchClaims(searchInput());
    expect(onlyDiagnostic()).toEqual({
      operation: 'search_creation_closed',
      category: 'provider_unavailable',
      httpStatus: null,
      validatorStage: null,
    });
    expectNoSensitiveData();
  });

  it('busca sem rótulo de operação cai no rótulo genérico search', async () => {
    const { client } = clientReturning(jsonResponse(400, {}));
    await client.searchClaims(searchInput({ operation: undefined }));
    expect(onlyDiagnostic().operation).toBe('search');
  });

  it.each([
    [
      'fetch_core',
      (c: MercadoLivreClaimsHttpClient) => c.fetchClaim(TOKEN, CLAIM),
    ],
    [
      'detail',
      (c: MercadoLivreClaimsHttpClient) => c.fetchClaimDetail(TOKEN, CLAIM),
    ],
    [
      'reputation',
      (c: MercadoLivreClaimsHttpClient) =>
        c.fetchClaimReputationImpact(TOKEN, CLAIM),
    ],
    [
      'reason',
      (c: MercadoLivreClaimsHttpClient) => c.fetchClaimReason(TOKEN, 'PDD9939'),
    ],
  ])('%s: 404 identifica a operação sem o ID', async (operation, call) => {
    const { client } = clientReturning(jsonResponse(404, {}));
    await call(client);
    expect(onlyDiagnostic()).toEqual({
      operation,
      category: 'not_found',
      httpStatus: 404,
      validatorStage: null,
    });
    expectNoSensitiveData();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('PDD9939');
  });

  it('fetch_core com corpo 2xx fora do contrato: estágio response_schema', async () => {
    const { client } = clientReturning(
      jsonResponse(200, { something: 'unexpected' }),
    );
    await client.fetchClaim(TOKEN, CLAIM);
    expect(onlyDiagnostic()).toEqual({
      operation: 'fetch_core',
      category: 'invalid_response',
      httpStatus: 200,
      validatorStage: 'response_schema',
    });
  });

  it('sucesso não emite diagnóstico', async () => {
    const { client } = clientReturning(
      jsonResponse(200, {
        data: [VALID_CLAIM],
        paging: { total: 1, offset: 0, limit: 100 },
      }),
    );
    const result = await client.searchClaims(searchInput());
    expect(result.kind).toBe('success');
    expect(warn).not.toHaveBeenCalled();
  });
});
