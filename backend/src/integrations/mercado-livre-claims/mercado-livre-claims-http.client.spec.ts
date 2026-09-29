import { ConfigService } from '@nestjs/config';
import { MercadoLivreClaimsHttpClient } from './mercado-livre-claims-http.client';

type FetchMock = jest.MockedFunction<typeof fetch>;

function createFetchMock(): FetchMock {
  return jest.fn();
}

function fakeConfigService(): ConfigService {
  return {
    get: (_key: string, def: unknown) => def,
  } as unknown as ConfigService;
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function calledUrlOf(fetchImpl: FetchMock): URL {
  return new URL(fetchImpl.mock.calls[0][0] as string);
}

const VALID_SEARCH_BODY = {
  paging: { total: 0, offset: 0, limit: 30 },
  data: [],
};

const VALID_CLAIM_BODY = {
  id: 1,
  resource_id: 'r1',
  resource: 'order',
  status: 'opened',
  type: 'mediations',
  stage: 'claim',
  site_id: 'MLB',
  reason_id: null,
  parent_id: null,
  fulfilled: null,
  quantity_type: null,
  date_created: '2026-01-10T12:00:00.000Z',
  last_updated: '2026-01-10T12:00:00.000Z',
  players: [],
  resolution: null,
};

const VALID_CLAIM_DETAIL_BODY = { ...VALID_CLAIM_BODY, detail: null };

const VALID_REASON_BODY = {
  flow: 'mediations',
  name: 'x',
  status: 'active',
};

const VALID_REPUTATION_BODY = { affects_reputation: 'not_applies' };

describe('MercadoLivreClaimsHttpClient', () => {
  describe('searchClaims — montagem de query', () => {
    it('monta players.user_id/role/status/offset/limit exatamente como a evidência de produção', async () => {
      const fetchImpl = createFetchMock();
      fetchImpl.mockResolvedValue(jsonResponse(200, VALID_SEARCH_BODY));
      const client = new MercadoLivreClaimsHttpClient(
        fakeConfigService(),
        fetchImpl,
      );

      await client.searchClaims({
        accessToken: 'token',
        sellerUserId: '999888',
        status: 'opened',
        offset: 0,
        limit: 30,
      });

      const calledUrl = calledUrlOf(fetchImpl);
      expect(calledUrl.origin + calledUrl.pathname).toBe(
        'https://api.mercadolibre.com/post-purchase/v1/claims/search',
      );
      expect(calledUrl.searchParams.get('players.user_id')).toBe('999888');
      expect(calledUrl.searchParams.get('players.role')).toBe('respondent');
      expect(calledUrl.searchParams.get('status')).toBe('opened');
      expect(calledUrl.searchParams.get('offset')).toBe('0');
      expect(calledUrl.searchParams.get('limit')).toBe('30');
      expect(calledUrl.searchParams.has('range')).toBe(false);
    });

    it('monta range=date_created:after:...,before:... com milissegundos quando só dateRange é informado', async () => {
      const fetchImpl = createFetchMock();
      fetchImpl.mockResolvedValue(jsonResponse(200, VALID_SEARCH_BODY));
      const client = new MercadoLivreClaimsHttpClient(
        fakeConfigService(),
        fetchImpl,
      );

      const after = new Date('2026-01-01T00:00:00.000Z');
      const before = new Date('2026-01-31T23:59:59.999Z');
      await client.searchClaims({
        accessToken: 'token',
        sellerUserId: '999888',
        dateRange: { after, before },
        offset: 0,
        limit: 30,
      });

      const calledUrl = calledUrlOf(fetchImpl);
      expect(calledUrl.searchParams.get('range')).toBe(
        'date_created:after:2026-01-01T00:00:00.000Z,before:2026-01-31T23:59:59.999Z',
      );
      expect(calledUrl.searchParams.has('status')).toBe(false);
    });

    it('permite status e dateRange juntos', async () => {
      const fetchImpl = createFetchMock();
      fetchImpl.mockResolvedValue(jsonResponse(200, VALID_SEARCH_BODY));
      const client = new MercadoLivreClaimsHttpClient(
        fakeConfigService(),
        fetchImpl,
      );

      await client.searchClaims({
        accessToken: 'token',
        sellerUserId: '999888',
        status: 'opened',
        dateRange: {
          after: new Date('2026-01-01T00:00:00.000Z'),
          before: new Date('2026-01-31T00:00:00.000Z'),
        },
        offset: 0,
        limit: 30,
        sort: 'date_created.desc',
      });

      const calledUrl = calledUrlOf(fetchImpl);
      expect(calledUrl.searchParams.get('status')).toBe('opened');
      expect(calledUrl.searchParams.has('range')).toBe(true);
      expect(calledUrl.searchParams.get('sort')).toBe('date_created.desc');
    });

    it('rejeita localmente (invalid_request, sem chamar fetch) quando nem status nem dateRange são informados', async () => {
      const fetchImpl = createFetchMock();
      const client = new MercadoLivreClaimsHttpClient(
        fakeConfigService(),
        fetchImpl,
      );

      const result = await client.searchClaims({
        accessToken: 'token',
        sellerUserId: '999888',
        offset: 0,
        limit: 30,
      });

      expect(result).toEqual({ kind: 'invalid_request' });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('rejeita localmente quando limit > 100', async () => {
      const fetchImpl = createFetchMock();
      const client = new MercadoLivreClaimsHttpClient(
        fakeConfigService(),
        fetchImpl,
      );

      const result = await client.searchClaims({
        accessToken: 'token',
        sellerUserId: '999888',
        status: 'opened',
        offset: 0,
        limit: 101,
      });

      expect(result).toEqual({ kind: 'invalid_request' });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('rejeita localmente quando offset + limit >= 10000', async () => {
      const fetchImpl = createFetchMock();
      const client = new MercadoLivreClaimsHttpClient(
        fakeConfigService(),
        fetchImpl,
      );

      const result = await client.searchClaims({
        accessToken: 'token',
        sellerUserId: '999888',
        status: 'opened',
        offset: 9970,
        limit: 30,
      });

      expect(result).toEqual({ kind: 'invalid_request' });
      expect(fetchImpl).not.toHaveBeenCalled();

      const fetchImplBoundary = createFetchMock();
      fetchImplBoundary.mockResolvedValue(jsonResponse(200, VALID_SEARCH_BODY));
      const clientBoundary = new MercadoLivreClaimsHttpClient(
        fakeConfigService(),
        fetchImplBoundary,
      );
      const boundary = await clientBoundary.searchClaims({
        accessToken: 'token',
        sellerUserId: '999888',
        status: 'opened',
        offset: 9969,
        limit: 30,
      });
      // offset + limit = 9999 < 10000: válido, a validação local deixa
      // passar e o fetch É chamado (diferente do caso 9970 acima).
      expect(fetchImplBoundary).toHaveBeenCalledTimes(1);
      expect(boundary.kind).not.toBe('invalid_request');
    });
  });

  describe('os 5 contratos batem na URL certa e retornam success', () => {
    it('searchClaims', async () => {
      const fetchImpl = createFetchMock();
      fetchImpl.mockResolvedValue(jsonResponse(200, VALID_SEARCH_BODY));
      const client = new MercadoLivreClaimsHttpClient(
        fakeConfigService(),
        fetchImpl,
      );
      const result = await client.searchClaims({
        accessToken: 't',
        sellerUserId: 's',
        status: 'opened',
        offset: 0,
        limit: 30,
      });
      expect(result.kind).toBe('success');
    });

    it('fetchClaim', async () => {
      const fetchImpl = createFetchMock();
      fetchImpl.mockResolvedValue(jsonResponse(200, VALID_CLAIM_BODY));
      const client = new MercadoLivreClaimsHttpClient(
        fakeConfigService(),
        fetchImpl,
      );
      const result = await client.fetchClaim('t', 'claim-1');
      expect(fetchImpl.mock.calls[0][0]).toBe(
        'https://api.mercadolibre.com/post-purchase/v1/claims/claim-1',
      );
      expect(result.kind).toBe('success');
    });

    it('fetchClaimDetail', async () => {
      const fetchImpl = createFetchMock();
      fetchImpl.mockResolvedValue(jsonResponse(200, VALID_CLAIM_DETAIL_BODY));
      const client = new MercadoLivreClaimsHttpClient(
        fakeConfigService(),
        fetchImpl,
      );
      const result = await client.fetchClaimDetail('t', 'claim-1');
      expect(fetchImpl.mock.calls[0][0]).toBe(
        'https://api.mercadolibre.com/post-purchase/v1/claims/claim-1/detail',
      );
      expect(result.kind).toBe('success');
    });

    it('fetchClaimReason', async () => {
      const fetchImpl = createFetchMock();
      fetchImpl.mockResolvedValue(jsonResponse(200, VALID_REASON_BODY));
      const client = new MercadoLivreClaimsHttpClient(
        fakeConfigService(),
        fetchImpl,
      );
      const result = await client.fetchClaimReason('t', 'PDD1234');
      expect(fetchImpl.mock.calls[0][0]).toBe(
        'https://api.mercadolibre.com/post-purchase/v1/claims/reasons/PDD1234',
      );
      expect(result.kind).toBe('success');
    });

    it('fetchClaimReputationImpact', async () => {
      const fetchImpl = createFetchMock();
      fetchImpl.mockResolvedValue(jsonResponse(200, VALID_REPUTATION_BODY));
      const client = new MercadoLivreClaimsHttpClient(
        fakeConfigService(),
        fetchImpl,
      );
      const result = await client.fetchClaimReputationImpact('t', 'claim-1');
      expect(fetchImpl.mock.calls[0][0]).toBe(
        'https://api.mercadolibre.com/post-purchase/v1/claims/claim-1/affects-reputation',
      );
      expect(result.kind).toBe('success');
    });
  });

  describe('mapeamento de status HTTP — 400 nunca cai em invalid_response e vice-versa', () => {
    const cases: Array<[number, Record<string, string>, unknown]> = [
      [400, {}, { kind: 'invalid_request' }],
      [401, {}, { kind: 'unauthorized' }],
      [403, {}, { kind: 'forbidden' }],
      [404, {}, { kind: 'not_found' }],
      [500, {}, { kind: 'provider_unavailable' }],
      [502, {}, { kind: 'provider_unavailable' }],
    ];

    it.each(cases)(
      'status %i mapeia para %j',
      async (status, headers, expected) => {
        const fetchImpl = createFetchMock();
        fetchImpl.mockResolvedValue(jsonResponse(status, {}, headers));
        const client = new MercadoLivreClaimsHttpClient(
          fakeConfigService(),
          fetchImpl,
        );
        const result = await client.fetchClaim('t', 'claim-1');
        expect(result).toEqual(expected);
      },
    );

    it('429 mapeia para rate_limited com retryAfterMs do header', async () => {
      const fetchImpl = createFetchMock();
      fetchImpl.mockResolvedValue(
        jsonResponse(429, {}, { 'retry-after': '3' }),
      );
      const client = new MercadoLivreClaimsHttpClient(
        fakeConfigService(),
        fetchImpl,
      );
      const result = await client.fetchClaim('t', 'claim-1');
      expect(result).toEqual({ kind: 'rate_limited', retryAfterMs: 3000 });
    });

    it('falha de rede (fetch rejeita) mapeia para provider_unavailable', async () => {
      const fetchImpl = createFetchMock();
      fetchImpl.mockRejectedValue(new Error('network down'));
      const client = new MercadoLivreClaimsHttpClient(
        fakeConfigService(),
        fetchImpl,
      );
      const result = await client.fetchClaim('t', 'claim-1');
      expect(result).toEqual({ kind: 'provider_unavailable' });
    });

    it('timeout (AbortController) mapeia para provider_unavailable', async () => {
      const fetchImpl = createFetchMock();
      fetchImpl.mockImplementation(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new Error('aborted')),
            );
          }),
      );
      const configService = {
        get: (_key: string, def: unknown) => (def === 10000 ? 5 : def),
      } as unknown as ConfigService;
      const client = new MercadoLivreClaimsHttpClient(configService, fetchImpl);
      const result = await client.fetchClaim('t', 'claim-1');
      expect(result).toEqual({ kind: 'provider_unavailable' });
    });

    it('corpo 2xx desconhecido/malformado vira invalid_response, nunca grava/interpreta', async () => {
      const fetchImpl = createFetchMock();
      fetchImpl.mockResolvedValue(
        jsonResponse(200, { something: 'unexpected' }),
      );
      const client = new MercadoLivreClaimsHttpClient(
        fakeConfigService(),
        fetchImpl,
      );
      const result = await client.fetchClaim('t', 'claim-1');
      expect(result).toEqual({ kind: 'invalid_response' });
    });
  });
});
