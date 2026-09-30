import { readFileSync } from 'fs';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { PermissionGuard } from '../../auth/guards/permission.guard';
import { MarketplaceProblemsController } from './marketplace-problems.controller';

const proto = MarketplaceProblemsController.prototype as unknown as Record<
  string,
  () => unknown
>;

const permissionsOf = (handler: string): unknown =>
  Reflect.getMetadata('requireAllPermissions', proto[handler]);
const pathOf = (handler: string): unknown =>
  Reflect.getMetadata(PATH_METADATA, proto[handler]);

describe('MarketplaceProblemsController (metadados de segurança e roteamento)', () => {
  it('AccessTokenGuard + PermissionGuard na classe inteira', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, MarketplaceProblemsController),
    ).toEqual([AccessTokenGuard, PermissionGuard]);
    expect(
      Reflect.getMetadata(PATH_METADATA, MarketplaceProblemsController),
    ).toBe('problems');
  });

  it.each([
    ['summary', 'summary', ['problems.view']],
    ['reasons', 'reasons', ['problems.view']],
    ['syncStatus', 'sync/status', ['problems.view']],
    ['list', '/', ['problems.view']],
    ['findOne', ':id', ['problems.view']],
    ['updateResponsibility', ':id/responsibility', ['problems.manage']],
    ['syncStart', 'sync/accounts/:accountId/start', ['problems.sync']],
    ['syncPause', 'sync/accounts/:accountId/pause', ['problems.sync']],
    ['syncResume', 'sync/accounts/:accountId/resume', ['problems.sync']],
  ])('%s: %s exige %p', (handler, path, permissions) => {
    expect(permissionsOf(handler)).toEqual(permissions);
    expect(pathOf(handler)).toBe(path);
  });

  it('rotas estáticas são declaradas ANTES de :id (GET)', () => {
    const order = Object.getOwnPropertyNames(proto).filter(
      (name) => name !== 'constructor',
    );
    const idIndex = order.indexOf('findOne');
    for (const handler of ['summary', 'reasons', 'syncStatus', 'list']) {
      expect(order.indexOf(handler)).toBeLessThan(idIndex);
    }
  });

  it('o controller não executa tick nem faz HTTP: só depende de query/gestão de estado', () => {
    const source = readFileSync(
      require.resolve('./marketplace-problems.controller'),
      'utf8',
    );
    expect(source).not.toMatch(
      /runTick|TickService|WorkerService|fetch\(|HttpClient/,
    );
  });
});
