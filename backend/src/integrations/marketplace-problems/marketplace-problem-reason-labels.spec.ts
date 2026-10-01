import {
  PROBLEM_REASON_LABELS_PT_BR,
  problemReasonLabel,
} from './marketplace-problem-reason-labels';

describe('catálogo de rótulos PT-BR dos motivos', () => {
  it.each([
    ['repentant_buyer', 'Arrependimento do comprador'],
    [
      'undelivered_repentant_buyer',
      'Não entregue — arrependimento do comprador',
    ],
    ['broken_item', 'Produto quebrado ou com defeito'],
    ['undelivered_other', 'Não entregue — outro motivo'],
    ['missing_item', 'Produto faltando'],
    [
      'delivered_but_not_receive_package',
      'Entregue, mas o comprador não recebeu o pacote',
    ],
    ['different_than_published', 'Produto diferente do anunciado'],
    ['missing_accessories', 'Acessórios faltando'],
    ['unauthorized_purchase', 'Compra não autorizada'],
  ])('traduz o código conhecido %s', (code, label) => {
    expect(problemReasonLabel(code)).toBe(label);
  });

  it('cobre exatamente os 9 códigos conhecidos, todos com rótulo PT-BR acentuado e sem o código cru', () => {
    expect(Object.keys(PROBLEM_REASON_LABELS_PT_BR).sort()).toEqual(
      [
        'repentant_buyer',
        'undelivered_repentant_buyer',
        'broken_item',
        'undelivered_other',
        'missing_item',
        'delivered_but_not_receive_package',
        'different_than_published',
        'missing_accessories',
        'unauthorized_purchase',
      ].sort(),
    );
    for (const [code, label] of Object.entries(PROBLEM_REASON_LABELS_PT_BR)) {
      expect(label).not.toContain('_');
      expect(label).not.toBe(code);
    }
  });

  it('código desconhecido vira texto legível, sem quebrar', () => {
    expect(problemReasonLabel('some_new_code')).toBe('Some new code');
    expect(problemReasonLabel('PNR3')).toBe('PNR3');
    expect(problemReasonLabel('SEM_CACHE')).toBe('SEM CACHE');
    expect(problemReasonLabel('kebab-case-code')).toBe('Kebab case code');
  });

  it('só caracteres seguros sobrevivem (nunca HTML/URL/quebra de linha do provedor)', () => {
    const label = problemReasonLabel(
      '<script>alert(1)</script>\nhttps://x.y/z',
    );
    expect(label).not.toMatch(/[<>/:()\n.]/);
    expect(problemReasonLabel('***')).toBe('Motivo desconhecido');
    expect(problemReasonLabel('')).toBe('Motivo desconhecido');
  });

  it('texto longo é truncado', () => {
    expect(problemReasonLabel('a'.repeat(500)).length).toBeLessThanOrEqual(60);
  });

  it('chaves de protótipo não vazam funções do Object', () => {
    for (const code of [
      'constructor',
      'toString',
      '__proto__',
      'hasOwnProperty',
    ]) {
      const label = problemReasonLabel(code);
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
    expect(problemReasonLabel('constructor')).toBe('Constructor');
  });
});
