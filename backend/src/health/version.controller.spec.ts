import { VersionController } from './version.controller';
import { VersionService } from './version.service';

describe('VersionController', () => {
  it('returns the exact contract: service, version, commit, builtAt, startedAt', () => {
    const service = new VersionService(
      { commit: 'sha123', builtAt: '2026-09-04T10:00:00.000Z' },
      '0.0.1',
    );
    const controller = new VersionController(service);
    const { startedAt, ...rest } = controller.getVersion();

    expect(rest).toEqual({
      service: 'central-performance-backend',
      version: '0.0.1',
      commit: 'sha123',
      builtAt: '2026-09-04T10:00:00.000Z',
    });
    expect(typeof startedAt).toBe('string');
  });

  it('never leaks secrets/paths/hostname/PID in the serialized response', () => {
    const service = new VersionService(
      { commit: 'sha123', builtAt: '2026-09-04T10:00:00.000Z' },
      '0.0.1',
    );
    const controller = new VersionController(service);
    const serialized = JSON.stringify(controller.getVersion());
    for (const forbidden of ['token', 'Token', 'password', 'secret', 'PID']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
