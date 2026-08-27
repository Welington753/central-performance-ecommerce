import packageJson from '../../../package.json';

/**
 * Reproduz um defeito real encontrado na homologação: o script npm
 * "seed:admin" passava `--compiler-options {"module":"commonjs"}` como
 * argumento bruto do shell. Em shells POSIX (Git Bash no Windows, WSL,
 * macOS, Linux — inclusive muitos runners de CI), a remoção de aspas do
 * shell corrompe esse JSON embutido (`{"module":"commonjs"}` vira
 * `{module:commonjs}`), e `ts-node` falha ao tentar fazer `JSON.parse`
 * das opções do compilador, quebrando `npm run seed:admin` antes mesmo de
 * chegar à lógica do script.
 *
 * `tsconfig.json` já não precisa desse override: sem `--compiler-options`,
 * o `ts-node` resolve `module` corretamente a partir do `tsconfig.json` do
 * projeto (que não declara `"type": "module"` no `package.json`, então é
 * tratado como CommonJS).
 */
describe('script "seed:admin" (compatibilidade entre shells)', () => {
  it('não deve passar JSON embutido via --compiler-options na linha de comando', () => {
    const scripts = (packageJson as { scripts: Record<string, string> })
      .scripts;
    const seedAdminScript = scripts['seed:admin'];

    expect(seedAdminScript).toBeDefined();
    expect(seedAdminScript).not.toMatch(/--compiler-options/);
  });
});
