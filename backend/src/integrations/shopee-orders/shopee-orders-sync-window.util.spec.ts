import type { PeriodWindow } from '../marketplace-orders/period.util';
import {
  SHOPEE_ORDER_LIST_MAX_BLOCK_SPAN_SECONDS,
  splitShopeeSyncWindowIntoBlocks,
} from './shopee-orders-sync-window.util';

function windowFromSeconds(
  fromSeconds: number,
  toSeconds: number,
): PeriodWindow {
  return { from: new Date(fromSeconds * 1000), to: new Date(toSeconds * 1000) };
}

describe('splitShopeeSyncWindowIntoBlocks', () => {
  it('retorna um único bloco quando a janela cabe em 15 dias', () => {
    const from = 1_700_000_000;
    const to = from + 1000;
    const blocks = splitShopeeSyncWindowIntoBlocks(windowFromSeconds(from, to));

    expect(blocks).toEqual([{ timeFrom: from, timeTo: to }]);
  });

  it('divide uma janela de 60 dias em múltiplos blocos de no máximo 15 dias', () => {
    const from = 1_700_000_000;
    const to = from + 60 * 24 * 60 * 60;
    const blocks = splitShopeeSyncWindowIntoBlocks(windowFromSeconds(from, to));

    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) {
      expect(block.timeTo - block.timeFrom).toBeLessThanOrEqual(
        SHOPEE_ORDER_LIST_MAX_BLOCK_SPAN_SECONDS,
      );
      expect(block.timeFrom).toBeLessThan(block.timeTo);
    }
  });

  it('nunca deixa lacuna: cada bloco seguinte começa antes ou exatamente onde o anterior termina', () => {
    const from = 1_700_000_000;
    const to = from + 45 * 24 * 60 * 60;
    const blocks = splitShopeeSyncWindowIntoBlocks(windowFromSeconds(from, to));

    for (let i = 1; i < blocks.length; i += 1) {
      expect(blocks[i].timeFrom).toBeLessThanOrEqual(blocks[i - 1].timeTo);
    }
  });

  it('aplica exatamente 1 segundo de sobreposição entre blocos consecutivos', () => {
    const from = 1_700_000_000;
    const to = from + 40 * 24 * 60 * 60;
    const blocks = splitShopeeSyncWindowIntoBlocks(windowFromSeconds(from, to));

    for (let i = 1; i < blocks.length; i += 1) {
      expect(blocks[i - 1].timeTo - blocks[i].timeFrom).toBe(1);
    }
  });

  it('o primeiro bloco começa exatamente no início da janela e o último termina exatamente no fim', () => {
    const from = 1_700_000_000;
    const to = from + 37 * 24 * 60 * 60;
    const blocks = splitShopeeSyncWindowIntoBlocks(windowFromSeconds(from, to));

    expect(blocks[0].timeFrom).toBe(from);
    expect(blocks[blocks.length - 1].timeTo).toBe(to);
  });

  it('nenhum bloco excede o teto de 15 dias documentado pela API', () => {
    const from = 1_700_000_000;
    const to = from + 365 * 24 * 60 * 60;
    const blocks = splitShopeeSyncWindowIntoBlocks(windowFromSeconds(from, to));

    for (const block of blocks) {
      expect(block.timeTo - block.timeFrom).toBeLessThanOrEqual(
        15 * 24 * 60 * 60,
      );
    }
  });

  it('janela vazia (from === to) produz zero blocos', () => {
    const blocks = splitShopeeSyncWindowIntoBlocks(
      windowFromSeconds(1_700_000_000, 1_700_000_000),
    );
    expect(blocks).toEqual([]);
  });

  it('janela invertida (to < from) produz zero blocos, nunca um bloco inválido', () => {
    const blocks = splitShopeeSyncWindowIntoBlocks(
      windowFromSeconds(1_700_000_000, 1_699_999_000),
    );
    expect(blocks).toEqual([]);
  });

  it('termina em um número finito de blocos para uma janela de 1 ano (nunca um loop infinito)', () => {
    const from = 1_700_000_000;
    const to = from + 365 * 24 * 60 * 60;
    const blocks = splitShopeeSyncWindowIntoBlocks(windowFromSeconds(from, to));
    expect(blocks.length).toBeLessThan(100);
    expect(blocks.length).toBeGreaterThan(1);
  });
});
