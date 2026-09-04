import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
// Script puro Node/CommonJS fora de `src/` (roda como `postbuild`, nunca
// transpilado junto do resto) — testado importando o módulo diretamente,
// igual a qualquer outro módulo CommonJS (tipado via generate-build-info.d.ts).
import { generate } from '../../scripts/generate-build-info';

describe('generate-build-info script', () => {
  it('writes a build-info.json with a commit string and a valid ISO builtAt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'build-info-script-'));
    try {
      const info = generate(dir);
      expect(typeof info.commit).toBe('string');
      expect(info.commit.length).toBeGreaterThan(0);
      expect(new Date(info.builtAt).toISOString()).toBe(info.builtAt);

      const written = JSON.parse(
        readFileSync(join(dir, 'build-info.json'), 'utf8'),
      ) as unknown;
      expect(written).toEqual(info);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves a real commit (this repo is a real git checkout) rather than falling back to "unknown"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'build-info-script-'));
    try {
      const info = generate(dir);
      expect(info.commit).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
