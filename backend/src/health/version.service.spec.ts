import { hostname } from 'os';
import { VersionService } from './version.service';

describe('VersionService', () => {
  it('returns complete metadata: service, version, commit, builtAt, startedAt', () => {
    const service = new VersionService(
      { commit: 'abc123', builtAt: '2026-09-04T10:00:00.000Z' },
      '1.2.3',
    );
    const info = service.getInfo();
    expect(info.service).toBe('central-performance-backend');
    expect(info.version).toBe('1.2.3');
    expect(info.commit).toBe('abc123');
    expect(info.builtAt).toBe('2026-09-04T10:00:00.000Z');
    expect(info.startedAt).toEqual(expect.any(String));
    expect(new Date(info.startedAt).toISOString()).toBe(info.startedAt);
  });

  it('falls back to commit "unknown"/builtAt null when there is no build-info at all', () => {
    const service = new VersionService(
      { commit: 'unknown', builtAt: null },
      'unknown',
    );
    const info = service.getInfo();
    expect(info.commit).toBe('unknown');
    expect(info.builtAt).toBeNull();
    expect(info.version).toBe('unknown');
  });

  it('startedAt is captured once at construction — stable across repeated getInfo() calls', () => {
    const service = new VersionService(
      { commit: 'abc', builtAt: null },
      '1.0.0',
    );
    const first = service.getInfo().startedAt;
    const second = service.getInfo().startedAt;
    expect(first).toBe(second);
  });

  it('never includes secrets, local paths, hostname or PID in the response', () => {
    const service = new VersionService(
      { commit: 'abc123', builtAt: '2026-09-04T10:00:00.000Z' },
      '1.2.3',
    );
    const serialized = JSON.stringify(service.getInfo());
    for (const forbidden of [
      'token',
      'Token',
      'password',
      'secret',
      'PID',
      String(process.pid),
      'C:\\',
      '/home/',
      hostname(),
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
