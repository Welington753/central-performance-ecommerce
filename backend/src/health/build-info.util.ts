import { readFileSync } from 'fs';
import { dirname, join } from 'path';

export interface BuildInfo {
  commit: string;
  builtAt: string | null;
}

const UNKNOWN_BUILD_INFO: BuildInfo = { commit: 'unknown', builtAt: null };

/**
 * Diretório do ponto de entrada REAL do processo (`dist/main.js` em
 * produção, o bundle do `nest start` em dev) — nunca `__dirname` de um
 * módulo específico, que aponta para subpastas diferentes conforme o
 * bundler (`dist/health/` no build por `tsc`, um único arquivo no bundle
 * webpack do `nest start`). `require.main` é o mesmo processo em qualquer
 * um dos dois casos.
 */
export function resolveDistDir(): string {
  return dirname(require.main?.filename ?? process.cwd());
}

/**
 * Lê `<distDir>/build-info.json`, gerado no build (nunca em runtime, nunca
 * `git` chamado aqui). Ausente/inválido/corrompido → fallback fechado,
 * nunca lança nem derruba o processo.
 */
export function loadBuildInfo(distDir: string): BuildInfo {
  try {
    const raw = readFileSync(join(distDir, 'build-info.json'), 'utf8');
    const parsed = JSON.parse(raw) as Partial<BuildInfo>;
    return {
      commit:
        typeof parsed.commit === 'string' && parsed.commit
          ? parsed.commit
          : 'unknown',
      builtAt:
        typeof parsed.builtAt === 'string' && parsed.builtAt
          ? parsed.builtAt
          : null,
    };
  } catch {
    return UNKNOWN_BUILD_INFO;
  }
}

/** `package.json` fica um nível acima de `distDir` (`backend/package.json`). */
export function readPackageVersion(distDir: string): string {
  try {
    const raw = readFileSync(join(distDir, '..', 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version
      ? parsed.version
      : 'unknown';
  } catch {
    return 'unknown';
  }
}
