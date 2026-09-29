import { toSafeExternalId } from './mercado-livre-claims-external-id.util';

describe('toSafeExternalId', () => {
  it('preserva string não vazia tal como veio', () => {
    expect(toSafeExternalId('2000003508426523')).toBe('2000003508426523');
  });

  it('preserva string acima de Number.MAX_SAFE_INTEGER sem converter/arredondar', () => {
    const huge = '99999999999999999999';
    expect(toSafeExternalId(huge)).toBe(huge);
  });

  it('converte number seguro para string', () => {
    expect(toSafeExternalId(42)).toBe('42');
    expect(toSafeExternalId(Number.MAX_SAFE_INTEGER)).toBe(
      String(Number.MAX_SAFE_INTEGER),
    );
  });

  it('rejeita number inseguro (acima de MAX_SAFE_INTEGER) — nunca perde precisão em silêncio', () => {
    expect(toSafeExternalId(Number.MAX_SAFE_INTEGER + 2)).toBeNull();
    expect(toSafeExternalId(Number.MAX_SAFE_INTEGER * 1000)).toBeNull();
  });

  it('rejeita number não inteiro', () => {
    expect(toSafeExternalId(1.5)).toBeNull();
  });

  it('rejeita string vazia, null, undefined e outros tipos', () => {
    expect(toSafeExternalId('')).toBeNull();
    expect(toSafeExternalId(null)).toBeNull();
    expect(toSafeExternalId(undefined)).toBeNull();
    expect(toSafeExternalId(true)).toBeNull();
    expect(toSafeExternalId({})).toBeNull();
  });
});
