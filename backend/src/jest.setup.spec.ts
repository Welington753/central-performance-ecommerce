describe('jest.setup network guard', () => {
  it('throws when something calls the real global fetch without mocking it', () => {
    expect(() =>
      global.fetch('https://api.mercadolibre.com/oauth/token'),
    ).toThrow(/rede real bloqueada/i);
  });
});
