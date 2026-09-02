import { percentChange } from './percent-change.util';

describe('percentChange', () => {
  it('returns null when the comparison base is zero', () => {
    expect(percentChange(100, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
  });

  it('computes the percentage change rounded to one decimal place', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(90, 100)).toBe(-10);
    expect(percentChange(133, 100)).toBe(33);
  });
});
