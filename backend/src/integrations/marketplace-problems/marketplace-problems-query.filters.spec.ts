import { BadRequestException } from '@nestjs/common';
import { buildProblemsWhere } from './marketplace-problems-query.filters';

const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';

describe('buildProblemsWhere', () => {
  it('ALL sem filtros: sem cláusula e sem parâmetros', () => {
    expect(buildProblemsWhere({}, { mode: 'ALL' })).toEqual({
      sql: '',
      params: [],
    });
  });

  it('NONE e SELECTED vazio: null (resultado vazio sem consultar o banco)', () => {
    expect(buildProblemsWhere({}, { mode: 'NONE' })).toBeNull();
    expect(
      buildProblemsWhere({}, { mode: 'SELECTED', accountIds: [] }),
    ).toBeNull();
  });

  it('SELECTED aplica o escopo como parâmetro ANY(uuid[])', () => {
    const built = buildProblemsWhere(
      {},
      { mode: 'SELECTED', accountIds: [ACCOUNT_A] },
    )!;
    expect(built.sql).toContain('p.marketplace_account_id = ANY($1::uuid[])');
    expect(built.params).toEqual([[ACCOUNT_A]]);
  });

  it('accountId fora do escopo SELECTED: null, nunca ignora o escopo', () => {
    expect(
      buildProblemsWhere(
        { accountId: ACCOUNT_B },
        { mode: 'SELECTED', accountIds: [ACCOUNT_A] },
      ),
    ).toBeNull();
  });

  it('accountId dentro do escopo: escopo E filtro aplicados', () => {
    const built = buildProblemsWhere(
      { accountId: ACCOUNT_A },
      { mode: 'SELECTED', accountIds: [ACCOUNT_A, ACCOUNT_B] },
    )!;
    expect(built.params).toEqual([[ACCOUNT_A, ACCOUNT_B], ACCOUNT_A]);
  });

  it('nunca interpola valor do cliente no SQL', () => {
    const evil = "x'; DROP TABLE marketplace_problems; --";
    const built = buildProblemsWhere(
      { status: evil, reasonId: evil, orderId: evil },
      { mode: 'ALL' },
    )!;
    expect(built.sql).not.toContain('DROP TABLE');
    expect(built.params).toContain(evil);
  });

  it('período usa o dia de America/Sao_Paulo, inclusivo, com parâmetros', () => {
    const built = buildProblemsWhere(
      { from: '2026-05-01', to: '2026-05-31' },
      { mode: 'ALL' },
    )!;
    expect(built.sql).toContain("AT TIME ZONE 'America/Sao_Paulo'");
    expect(built.params).toEqual(['2026-05-01', '2026-05-31']);
  });

  it.each([
    [{ from: '2026-02-31' }],
    [{ to: '2026-13-01' }],
    [{ from: '2026-06-10', to: '2026-06-01' }],
  ])('datas inválidas/invertidas %p lançam 400', (filters) => {
    expect(() => buildProblemsWhere(filters, { mode: 'ALL' })).toThrow(
      BadRequestException,
    );
  });

  it('ação pendente, vencida e a vencer usam as ações do vendedor em problema não resolvido', () => {
    const pending = buildProblemsWhere(
      { pendingAction: true },
      { mode: 'ALL' },
    )!;
    expect(pending.sql).toContain("pa.player_role = 'respondent'");
    expect(pending.sql).toContain('p.resolution_date IS NULL');
    expect(
      buildProblemsWhere({ pendingAction: false }, { mode: 'ALL' })!.sql,
    ).toContain('NOT (');
    expect(
      buildProblemsWhere({ actionDue: 'overdue' }, { mode: 'ALL' })!.sql,
    ).toContain('pa.due_date < now()');
    expect(
      buildProblemsWhere({ actionDue: 'next7days' }, { mode: 'ALL' })!.sql,
    ).toContain("interval '7 days'");
  });

  it('pedido externo casa o número do pedido associado ou o resource_id', () => {
    const built = buildProblemsWhere({ orderId: '2000123' }, { mode: 'ALL' })!;
    expect(built.sql).toContain('mo.external_order_id = $1');
    expect(built.sql).toContain('p.resource_id = $1');
    expect(built.params).toEqual(['2000123']);
  });
});
