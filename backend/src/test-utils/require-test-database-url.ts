/**
 * Toda suíte de teste que precisa de PostgreSQL 16 real chama isto dentro do
 * próprio `beforeAll` (nunca no escopo do módulo, para não rodar antes do
 * Jest terminar de configurar o ambiente). Uma `TEST_DATABASE_URL` ausente
 * FALHA a suíte com um erro claro — nunca `describe.skip`/`.only`/qualquer
 * outro no-op silencioso (design §9/§11).
 */
export function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL não definida. Este arquivo de teste requer um PostgreSQL 16 descartável (ver Task 5) — nunca pule este teste, configure a variável antes de rodar a suíte.',
    );
  }
  return url;
}
