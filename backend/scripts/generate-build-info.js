// Gera `dist/build-info.json` no momento do BUILD — nunca em runtime, nunca
// por request (design "/version": "commit/builtAt representam o artefato
// compilado", "não executar git a cada chamada"). Roda como `postbuild`
// (ver package.json), então `dist/` já existe quando este script executa.
// Puro Node/CommonJS (sem TypeScript) — evita depender do próprio build que
// ele documenta, e funciona igual em Windows/Linux (child_process/fs/path
// são multiplataforma; nenhum comando de shell externo além de `git`).
'use strict';

const { execSync } = require('child_process');
const { writeFileSync } = require('fs');
const { join } = require('path');

/**
 * `git rev-parse HEAD` roda UMA vez aqui. Falha (sem `.git`, sem `git`
 * instalado, checkout raso sem HEAD) nunca derruba o build — vira
 * `'unknown'`, igual ao fallback em runtime quando o arquivo nem existir.
 */
function resolveCommit() {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

function generate(outputDir) {
  const buildInfo = {
    commit: resolveCommit(),
    builtAt: new Date().toISOString(),
  };
  writeFileSync(
    join(outputDir, 'build-info.json'),
    JSON.stringify(buildInfo, null, 2) + '\n',
  );
  return buildInfo;
}

if (require.main === module) {
  const outputDir = process.argv[2] || join(__dirname, '..', 'dist');
  const info = generate(outputDir);
  console.log(
    `build-info.json gerado em ${outputDir}: commit=${info.commit} builtAt=${info.builtAt}`,
  );
}

module.exports = { generate, resolveCommit };
