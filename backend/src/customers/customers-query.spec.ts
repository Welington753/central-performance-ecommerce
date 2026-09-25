import {
  CustomersQueryError,
  parseCustomersFilter,
  parseCustomersPagination,
} from './customers-query';

const NOW = new Date('2026-09-25T15:00:00.000Z');

describe('parseCustomersFilter', () => {
  it('defaults to "Todo o período", all marketplaces and no extra filter', () => {
    expect(parseCustomersFilter({}, NOW)).toEqual({
      marketplace: 'ALL',
      accountId: null,
      period: null,
      customerType: 'ALL',
      search: null,
      product: null,
      onlyWithEmail: false,
      onlyWithRecipientPhone: false,
    });
  });

  it('allTime=true ignores from/to', () => {
    expect(
      parseCustomersFilter(
        { allTime: 'true', from: '2026-01-01', to: '2026-01-31' },
        NOW,
      ).period,
    ).toBeNull();
  });

  it('resolves a custom period with São Paulo day boundaries (to exclusive)', () => {
    const { period } = parseCustomersFilter(
      { from: '2026-01-01', to: '2026-01-31' },
      NOW,
    );
    expect(period).toEqual({
      from: new Date('2026-01-01T03:00:00.000Z'),
      to: new Date('2026-02-01T03:00:00.000Z'),
      fromLabel: '2026-01-01',
      toLabel: '2026-01-31',
    });
  });

  it.each([
    [{ marketplace: 'AMAZON' }, 'INVALID_MARKETPLACE'],
    [{ accountId: 'nao-uuid' }, 'INVALID_ACCOUNT_ID'],
    [{ customerType: 'VIP' }, 'INVALID_CUSTOMER_TYPE'],
    [{ onlyWithEmail: 'sim' }, 'INVALID_BOOLEAN'],
    [{ from: '2026-01-31', to: '2026-01-01' }, 'INVALID_PERIOD'],
    [{ from: '2026-01-01' }, 'INVALID_PERIOD'],
    [{ search: 'x'.repeat(121) }, 'INVALID_FILTER_TEXT'],
  ])('rejects %j with %s (Amazon is out of scope)', (query, code) => {
    expect(() => parseCustomersFilter(query, NOW)).toThrow(
      new CustomersQueryError(code as never),
    );
  });
});

describe('parseCustomersPagination', () => {
  it('defaults to page 1 / 25 per page', () => {
    expect(parseCustomersPagination({})).toEqual({ page: 1, pageSize: 25 });
  });

  it.each([{ page: '0' }, { pageSize: '101' }, { page: 'abc' }])(
    'rejects %j',
    (query) => {
      expect(() => parseCustomersPagination(query)).toThrow(
        CustomersQueryError,
      );
    },
  );
});
