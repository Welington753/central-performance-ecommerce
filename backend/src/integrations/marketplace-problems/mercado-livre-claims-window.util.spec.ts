import type { ClaimsHttpOutcome } from '../mercado-livre-claims/mercado-livre-claims-http.client';
import {
  commitSafeSubWindow,
  computeAdvancedWindowFrom,
  WINDOW_SPLIT_OVERLAP_MS,
  type FetchWindowPage,
  type SearchPageResult,
  type WindowRange,
} from './mercado-livre-claims-window.util';

function ok(ids: string[], total: number): ClaimsHttpOutcome<SearchPageResult> {
  return { kind: 'success', data: { ids, total } };
}

function range(fromIso: string, toIso: string): WindowRange {
  return { from: new Date(fromIso), to: new Date(toIso) };
}

/**
 * Simula um provedor com `count` claims distribuídos uniformemente entre
 * `windowFrom`/`windowTo` (1 claim a cada `stepMs`), respondendo por
 * `range`/`offset`/`limit` como o Mercado Livre faria: só os claims cujo
 * `dateCreated` cai dentro do `range` pedido, paginados por `offset`/`limit`.
 */
function makeUniformFetchPage(
  windowFromMs: number,
  count: number,
  stepMs: number,
): FetchWindowPage {
  const claims = Array.from({ length: count }, (_, i) => ({
    id: `claim-${i}`,
    createdAtMs: windowFromMs + i * stepMs,
  }));
  const calls: Array<{ range: WindowRange; offset: number; limit: number }> =
    [];
  const fetchPage: FetchWindowPage = (r, offset, limit) => {
    calls.push({ range: r, offset, limit });
    const inRange = claims.filter(
      (c) =>
        c.createdAtMs >= r.from.getTime() && c.createdAtMs <= r.to.getTime(),
    );
    const page = inRange.slice(offset, offset + limit);
    return Promise.resolve(
      ok(
        page.map((c) => c.id),
        inRange.length,
      ),
    );
  };
  (fetchPage as unknown as { calls: typeof calls }).calls = calls;
  return fetchPage;
}

describe('commitSafeSubWindow', () => {
  it('pagina até paging.total sem perder nenhum id, em múltiplas páginas', async () => {
    const fetchPage = makeUniformFetchPage(
      new Date('2026-01-01T00:00:00.000Z').getTime(),
      250,
      1000,
    );
    const result = await commitSafeSubWindow(
      fetchPage,
      range('2026-01-01T00:00:00.000Z', '2026-01-01T00:10:00.000Z'),
      1000,
      1000,
      1,
    );
    expect(result.kind).toBe('committed');
    if (result.kind === 'committed') {
      expect(result.ids).toHaveLength(250);
    }
  });

  it('nunca chama com offset+limit >= 10000', async () => {
    const fetchPage = jest.fn((_r: WindowRange, _offset: number) =>
      Promise.resolve(ok([], 9999999)),
    ) as unknown as FetchWindowPage;
    await commitSafeSubWindow(
      fetchPage,
      range('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
      100000,
      100000,
      1,
    );
    const mockFn = fetchPage as unknown as jest.Mock;
    for (const call of mockFn.mock.calls) {
      const [, offset, limit] = call as [WindowRange, number, number];
      expect(offset + limit).toBeLessThan(10000);
    }
  });

  it('divide a janela ao meio (metade esquerda com sobreposição) quando total excede o teto de 10000', async () => {
    // Escala realista: janela de 2h, minSplitMs bem acima de 2x o overlap
    // (1000ms) para não cair no ponto fixo da recursão de divisão (nenhum
    // teste desta suíte pode violar minSplitMs > 2*WINDOW_SPLIT_OVERLAP_MS —
    // é a mesma precondição validada no serviço público).
    const from = new Date('2026-01-01T00:00:00.000Z').getTime();
    const to = new Date('2026-01-01T02:00:00.000Z').getTime();
    const minSplitMs = 5000;
    const seenRanges: WindowRange[] = [];
    const fetchPage: FetchWindowPage = (r) => {
      seenRanges.push(r);
      const sizeMs = r.to.getTime() - r.from.getTime();
      if (sizeMs <= minSplitMs) return Promise.resolve(ok(['only-one'], 1));
      return Promise.resolve(ok([], 20000));
    };
    const result = await commitSafeSubWindow(
      fetchPage,
      range('2026-01-01T00:00:00.000Z', '2026-01-01T02:00:00.000Z'),
      100000,
      100000,
      minSplitMs,
    );
    expect(result.kind).toBe('committed');
    // Toda sub-janela tentada deve ser a metade ESQUERDA (from original preservado).
    for (const r of seenRanges) {
      expect(r.from.getTime()).toBe(from);
      expect(r.to.getTime()).toBeLessThanOrEqual(to);
    }
  });

  it('claim exatamente no midpoint de uma divisão aparece na lista final (sobreposição interna)', async () => {
    const from = new Date('2026-01-01T00:00:00.000Z').getTime();
    const to = new Date('2026-01-01T00:00:20.000Z').getTime();
    const mid = from + (to - from) / 2;
    // 1 único claim, exatamente no midpoint. Um total "grande" força a
    // divisão (mesmo sem exceder o teto de 10000, usamos orçamento de
    // claims=0 para forçar sempre a divisão até o minSplitMs).
    const fetchPage: FetchWindowPage = (r) => {
      const inRange = mid >= r.from.getTime() && mid <= r.to.getTime();
      return Promise.resolve(
        ok(inRange ? ['midpoint-claim'] : [], inRange ? 1 : 0),
      );
    };
    const result = await commitSafeSubWindow(
      fetchPage,
      range('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:20.000Z'),
      1000,
      1000,
      1,
    );
    expect(result.kind).toBe('committed');
    if (result.kind === 'committed') {
      expect(result.ids).toContain('midpoint-claim');
    }
  });

  it('total cabe no teto de 10000 mas excede o orçamento de claims -> divide e tenta de novo', async () => {
    const minSplitMs = 5000;
    const calls: number[] = [];
    const fetchPage: FetchWindowPage = (r) => {
      const sizeMs = r.to.getTime() - r.from.getTime();
      calls.push(sizeMs);
      if (sizeMs <= minSplitMs) return Promise.resolve(ok(['x'], 1));
      return Promise.resolve(ok([], 500)); // 500 > orçamento de claims (10)
    };
    const result = await commitSafeSubWindow(
      fetchPage,
      range('2026-01-01T00:00:00.000Z', '2026-01-01T02:00:00.000Z'),
      10,
      100000,
      minSplitMs,
    );
    expect(result.kind).toBe('committed');
    expect(calls.length).toBeGreaterThan(1);
  });

  it('janela no minSplitMs ainda excede o teto de 10000 -> SAFETY_LIMIT_REACHED, nunca finge cobertura completa', async () => {
    const minSplitMs = 5000;
    const fetchPage: FetchWindowPage = () => Promise.resolve(ok([], 50000));
    const result = await commitSafeSubWindow(
      fetchPage,
      range('2026-01-01T00:00:00.000Z', '2026-01-01T02:00:00.000Z'),
      1000000,
      1000000,
      minSplitMs,
    );
    expect(result.kind).toBe('safety_limit_reached');
  });

  it('janela no minSplitMs cabe no teto mas excede orçamento de claims -> claim_budget_exhausted', async () => {
    const minSplitMs = 5000;
    const fetchPage: FetchWindowPage = () => Promise.resolve(ok([], 500));
    const result = await commitSafeSubWindow(
      fetchPage,
      range('2026-01-01T00:00:00.000Z', '2026-01-01T02:00:00.000Z'),
      10,
      1000000,
      minSplitMs,
    );
    expect(result.kind).toBe('claim_budget_exhausted');
  });

  it('janela no minSplitMs cabe no teto e no orçamento de claims mas não na reserva de chamadas -> call_budget_exhausted', async () => {
    const minSplitMs = 5000;
    const fetchPage: FetchWindowPage = () => Promise.resolve(ok([], 50));
    const result = await commitSafeSubWindow(
      fetchPage,
      range('2026-01-01T00:00:00.000Z', '2026-01-01T02:00:00.000Z'),
      1000,
      // orçamento de chamadas insuficiente até para 50 fetchClaim reservados
      20,
      minSplitMs,
    );
    expect(result.kind).toBe('call_budget_exhausted');
  });

  it('orçamento insuficiente para sequer 1 probe -> call_budget_exhausted sem nenhuma chamada', async () => {
    const fetchPage = jest.fn(() => Promise.resolve(ok([], 0)));
    const result = await commitSafeSubWindow(
      fetchPage,
      range('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:10.000Z'),
      100,
      0,
      1,
    );
    expect(result.kind).toBe('call_budget_exhausted');
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('reserva de chamadas: total cabe no teto e no orçamento de claims mas a reserva (páginas + 1 fetchClaim/candidato) não cabe -> divide ANTES de paginar por completo', async () => {
    const pagesCalled: number[] = [];
    const fetchPage: FetchWindowPage = (r, offset) => {
      pagesCalled.push(offset);
      const sizeMs = r.to.getTime() - r.from.getTime();
      // Janelas com mais de 1 minuto "têm" 300 candidatos (cabe no teto de
      // 10000 e no orçamento de claims, mas additionalSearchCalls(2)+300=302
      // > remainingHttpCalls(50) — força divisão); a partir de 1 minuto ou
      // menos, só 10 candidatos (cabe folgadamente em tudo).
      if (sizeMs <= 60000) return Promise.resolve(ok(['x'], 10));
      return Promise.resolve(ok([], 300));
    };
    const result = await commitSafeSubWindow(
      fetchPage,
      range('2026-01-01T00:00:00.000Z', '2026-01-01T02:00:00.000Z'),
      1000,
      50,
      5000,
    );
    expect(result.kind).toBe('committed');
    // nunca pagina além do offset 0 da janela GRANDE original (300 claims) —
    // a divisão acontece antes de gastar chamadas extras nela.
    expect(pagesCalled.filter((o) => o > 0)).toHaveLength(0);
  });

  it('erro classificado (abort) em qualquer chamada interrompe imediatamente', async () => {
    const fetchPage: FetchWindowPage = () =>
      Promise.resolve({ kind: 'unauthorized' });
    const result = await commitSafeSubWindow(
      fetchPage,
      range('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:10.000Z'),
      1000,
      1000,
      1,
    );
    expect(result.kind).toBe('search_error');
    if (result.kind === 'search_error') {
      expect(result.classification.kind).toBe('TERMINAL_AUTH_ERROR');
    }
  });

  it('erro classificado durante a paginação (não no probe) também interrompe', async () => {
    let call = 0;
    const fetchPage: FetchWindowPage = () => {
      call += 1;
      if (call === 1) {
        return Promise.resolve(
          ok(
            Array.from({ length: 100 }, (_, i) => `c${i}`),
            150,
          ),
        );
      }
      return Promise.resolve({ kind: 'rate_limited', retryAfterMs: 2000 });
    };
    const result = await commitSafeSubWindow(
      fetchPage,
      range('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:10.000Z'),
      1000,
      1000,
      1,
    );
    expect(result.kind).toBe('search_error');
    if (result.kind === 'search_error') {
      expect(result.classification).toEqual({
        kind: 'RATE_LIMITED',
        retryAfterMs: 2000,
      });
    }
  });
});

describe('progresso multi-execução (sem starvation, orçamento de chamadas pequeno)', () => {
  it('cobre todos os claims eventualmente, avançando nextWindowFrom a cada execução', async () => {
    const windowFromMs = new Date('2026-01-01T00:00:00.000Z').getTime();
    const fetchPage = makeUniformFetchPage(windowFromMs, 240, 1000);
    let cursorFrom = new Date(windowFromMs);
    const to = new Date(windowFromMs + 240 * 1000 + 5000);
    const seenIds = new Set<string>();
    let iterations = 0;

    while (cursorFrom.getTime() < to.getTime() && iterations < 50) {
      iterations += 1;
      const result = await commitSafeSubWindow(
        fetchPage,
        { from: cursorFrom, to },
        // orçamento de chamadas pequeno o bastante para forçar várias
        // sub-janelas menores por execução (nunca tudo de uma vez).
        30,
        30,
        1,
      );
      if (result.kind !== 'committed') {
        throw new Error(`execução inesperada: ${result.kind}`);
      }
      for (const id of result.ids) seenIds.add(id);
      const nextFrom = computeAdvancedWindowFrom(result.range.to, cursorFrom);
      const nextFromDate = new Date(nextFrom);
      expect(nextFromDate.getTime()).toBeGreaterThan(cursorFrom.getTime());
      cursorFrom = nextFromDate;
    }

    expect(seenIds.size).toBe(240);
  });
});

describe('computeAdvancedWindowFrom', () => {
  it('recua WINDOW_SPLIT_OVERLAP_MS a partir do fim da janela commitada', () => {
    const committedTo = new Date('2026-01-01T00:10:00.000Z');
    const originalFrom = new Date('2026-01-01T00:00:00.000Z');
    const next = computeAdvancedWindowFrom(committedTo, originalFrom);
    expect(new Date(next).getTime()).toBe(
      committedTo.getTime() - WINDOW_SPLIT_OVERLAP_MS,
    );
  });

  it('claim exatamente na fronteira entre duas execuções não desaparece', () => {
    // Execução 1 commita [from, boundary]; a execução 2 deve começar ANTES
    // de `boundary` (por causa da sobreposição), então um claim com
    // dateCreated === boundary ainda é visto na 2ª busca.
    const boundary = new Date('2026-01-01T00:10:00.000Z');
    const originalFrom = new Date('2026-01-01T00:00:00.000Z');
    const nextFrom = new Date(
      computeAdvancedWindowFrom(boundary, originalFrom),
    );
    expect(nextFrom.getTime()).toBeLessThanOrEqual(boundary.getTime());
  });

  it('clamp: nunca avança para antes ou igual ao originalFrom', () => {
    // Janela commitada minúscula (menor que o overlap) — caso degenerado
    // que a validação de entrada (minSplitMs > 2*overlap) já deveria evitar
    // no serviço público, mas o helper continua seguro por conta própria.
    const committedTo = new Date('2026-01-01T00:00:00.500Z');
    const originalFrom = new Date('2026-01-01T00:00:00.000Z');
    const next = computeAdvancedWindowFrom(committedTo, originalFrom);
    expect(new Date(next).getTime()).toBeGreaterThan(originalFrom.getTime());
  });
});
