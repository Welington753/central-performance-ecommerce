import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadBuildInfo, readPackageVersion } from './build-info.util';

describe('build-info.util', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'build-info-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('loadBuildInfo', () => {
    it('reads a valid build-info.json and returns commit/builtAt as-is', () => {
      writeFileSync(
        join(dir, 'build-info.json'),
        JSON.stringify({
          commit: 'abc123',
          builtAt: '2026-09-04T10:00:00.000Z',
        }),
      );
      expect(loadBuildInfo(dir)).toEqual({
        commit: 'abc123',
        builtAt: '2026-09-04T10:00:00.000Z',
      });
    });

    it('falls back to commit "unknown"/builtAt null when the file does not exist — never throws', () => {
      expect(loadBuildInfo(join(dir, 'does-not-exist'))).toEqual({
        commit: 'unknown',
        builtAt: null,
      });
    });

    it('falls back when the file exists but is not valid JSON', () => {
      writeFileSync(join(dir, 'build-info.json'), 'not json{{{');
      expect(loadBuildInfo(dir)).toEqual({ commit: 'unknown', builtAt: null });
    });

    it('falls back per-field when commit/builtAt are missing or have the wrong type', () => {
      writeFileSync(
        join(dir, 'build-info.json'),
        JSON.stringify({ commit: 123, builtAt: '' }),
      );
      expect(loadBuildInfo(dir)).toEqual({ commit: 'unknown', builtAt: null });
    });
  });

  describe('readPackageVersion', () => {
    it('reads the version field from package.json one level above distDir', () => {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ version: '1.2.3' }),
      );
      const distDir = join(dir, 'dist');
      expect(readPackageVersion(distDir)).toBe('1.2.3');
    });

    it('falls back to "unknown" when package.json is missing', () => {
      expect(readPackageVersion(join(dir, 'dist'))).toBe('unknown');
    });
  });
});
