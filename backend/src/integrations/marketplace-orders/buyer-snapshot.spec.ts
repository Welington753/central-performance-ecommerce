import {
  emptyBuyerPersonalData,
  isMaskedValue,
  mergeBuyerSnapshot,
  type BuyerPersonalData,
  type StoredBuyerSnapshot,
} from './buyer-snapshot';

const T1 = new Date('2026-01-01T00:00:00.000Z');
const T2 = new Date('2026-02-01T00:00:00.000Z');

function data(overrides: Partial<BuyerPersonalData> = {}): BuyerPersonalData {
  return { ...emptyBuyerPersonalData(), ...overrides };
}

function stored(
  overrides: Partial<BuyerPersonalData> = {},
  at: Date | null = T1,
): StoredBuyerSnapshot {
  return { data: data(overrides), personalDataLastUpdatedAt: at };
}

describe('isMaskedValue', () => {
  it.each([
    ['****', true],
    ['J***a', true],
    ['Maria', false],
    [null, false],
  ])('%s → %s', (value, expected) => {
    expect(isMaskedValue(value)).toBe(expected);
  });
});

describe('mergeBuyerSnapshot', () => {
  it('fills an empty stored snapshot and records the source instant', () => {
    const result = mergeBuyerSnapshot(
      stored({}, null),
      data({ username: 'nick', city: 'SP' }),
      T1,
    );
    expect(result.changed).toBe(true);
    expect(result.snapshot.data).toMatchObject({
      username: 'nick',
      city: 'SP',
    });
    expect(result.snapshot.personalDataLastUpdatedAt).toEqual(T1);
  });

  it('never erases existing data when a partial payload brings null', () => {
    const result = mergeBuyerSnapshot(
      stored({ username: 'nick', recipientPhone: '11999990000' }),
      data({ username: 'nick' }),
      T2,
    );
    expect(result.snapshot.data.recipientPhone).toBe('11999990000');
    expect(result.snapshot.data.username).toBe('nick');
  });

  it('a newer event overwrites non-null values', () => {
    const result = mergeBuyerSnapshot(
      stored({ city: 'Campinas' }, T1),
      data({ city: 'Santos' }),
      T2,
    );
    expect(result.snapshot.data.city).toBe('Santos');
    expect(result.snapshot.personalDataLastUpdatedAt).toEqual(T2);
  });

  it('an older event never regresses newer data, only fills gaps', () => {
    const result = mergeBuyerSnapshot(
      stored({ city: 'Santos', state: null }, T2),
      data({ city: 'Campinas', state: 'SP' }),
      T1,
    );
    expect(result.snapshot.data.city).toBe('Santos');
    expect(result.snapshot.data.state).toBe('SP');
    expect(result.snapshot.personalDataLastUpdatedAt).toEqual(T2);
  });

  it('a masked value never replaces an unmasked one, even if newer', () => {
    const result = mergeBuyerSnapshot(
      stored({ buyerName: 'Maria Silva', recipientPhone: '11999990000' }, T1),
      data({ buyerName: 'M****a', recipientPhone: '******0000' }),
      T2,
    );
    expect(result.snapshot.data.buyerName).toBe('Maria Silva');
    expect(result.snapshot.data.recipientPhone).toBe('11999990000');
  });

  it('an unmasked newer value replaces a masked one', () => {
    const result = mergeBuyerSnapshot(
      stored({ buyerName: 'M****a' }, T1),
      data({ buyerName: 'Maria Silva' }),
      T2,
    );
    expect(result.snapshot.data.buyerName).toBe('Maria Silva');
  });

  it('is idempotent: re-applying the same snapshot reports no change', () => {
    const first = mergeBuyerSnapshot(
      stored({}, null),
      data({ username: 'nick' }),
      T1,
    );
    const second = mergeBuyerSnapshot(
      first.snapshot,
      data({ username: 'nick' }),
      T1,
    );
    expect(second.changed).toBe(false);
  });
});
