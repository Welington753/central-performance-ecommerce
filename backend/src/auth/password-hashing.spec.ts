import * as argon2 from 'argon2';

describe('Password hashing (argon2)', () => {
  it('produces a hash different from the plain text password', async () => {
    const password = 'minha-senha-secreta-123';
    const hash = await argon2.hash(password);

    expect(hash).not.toBe(password);
    expect(hash.startsWith('$argon2')).toBe(true);
  });

  it('verify() succeeds for the correct password and fails for a wrong one', async () => {
    const password = 'outra-senha-bem-forte';
    const hash = await argon2.hash(password);

    await expect(argon2.verify(hash, password)).resolves.toBe(true);
    await expect(argon2.verify(hash, 'senha-errada')).resolves.toBe(false);
  });

  it('produces a different hash for the same password on each call (salt aleatório)', async () => {
    const password = 'mesma-senha';
    const [first, second] = await Promise.all([
      argon2.hash(password),
      argon2.hash(password),
    ]);

    expect(first).not.toBe(second);
  });
});
